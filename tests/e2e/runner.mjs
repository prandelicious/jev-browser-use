import { changedPathsSince, selectSuitesFromPaths, scenariosForSuites } from './selection.mjs';
import { buildReport, exitCodeFor } from './report.mjs';
import { createProcessManager } from './process-manager.mjs';
import { startFixtureServer } from './fixtures/server.mjs';
import { runScenario, SCENARIOS } from './scenarios.mjs';

function parseArgs(argv) {
  const args = { json: false, suites: [], scenarios: [], changedSince: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--json') args.json = true;
    else if (token === '--suite') args.suites.push(argv[++i]);
    else if (token === '--scenario') args.scenarios.push(argv[++i]);
    else if (token === '--changed-since') args.changedSince = argv[++i];
  }
  return args;
}

export async function runE2E(argv = process.argv.slice(2), { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const started = Date.now();
  const processes = createProcessManager();
  let status = 'RUNNER_ERROR';
  try {
    const args = parseArgs(argv);
    let selectedSuites = args.suites;
    let reasons = args.suites.map((suite) => ({ rule: '--suite', suites: [suite] }));
    let changedPaths = [];
    if (!selectedSuites.length && !args.scenarios.length) {
      changedPaths = await changedPathsSince(args.changedSince, cwd);
      const selection = selectSuitesFromPaths(changedPaths);
      selectedSuites = selection.selectedSuites.length ? selection.selectedSuites : ['gate'];
      reasons = selection.reasons;
    }
    if (!selectedSuites.length && args.scenarios.length) selectedSuites = ['core'];
    const scenarioIds = args.scenarios.length ? args.scenarios : scenariosForSuites(selectedSuites);
    const unknown = scenarioIds.filter((id) => !SCENARIOS[id]);
    if (unknown.length) throw new Error(`Unknown scenario: ${unknown.join(', ')}`);

    const fixture = await startFixtureServer();
    processes.track({ purpose: 'fixture-server', handle: fixture, stop: fixture.stop });

    const results = [];
    if (selectedSuites.includes('cli') || selectedSuites.includes('mcp')) {
      const missing = selectedSuites.filter((suite) => suite === 'cli' || suite === 'mcp');
      for (const suite of missing) {
        results.push({
          id: suite,
          status: 'SKIPPED',
          durationMs: 0,
          failures: [],
          applicationStatus: 'skipped',
          browserActions: 0,
          reason: `no ${suite} transport in this repository; not faked`,
        });
      }
    }
    for (const id of scenarioIds) {
      const scenarioStarted = Date.now();
      try {
        const result = await runScenario(id, { origin: fixture.origin, processes });
        result.durationMs = Date.now() - scenarioStarted;
        results.push(result);
      } catch (error) {
        results.push({
          id,
          status: 'FAIL',
          durationMs: Date.now() - scenarioStarted,
          failures: [{ scenario: id, assertion: 'scenario execution', expected: 'complete', actual: error instanceof Error ? error.message : String(error) }],
        });
      }
    }

    status = results.some((item) => item.status === 'FAIL') ? 'FAIL' : 'PASS';
    if (!scenarioIds.length) status = 'PASS';
    const report = buildReport({
      status,
      selection: {
        changedPaths: changedPaths.length ? changedPaths : undefined,
        requestedSuites: args.suites.length ? args.suites : undefined,
        selectedSuites,
        reasons,
      },
      environment: {
        bunVersion: process.versions.bun ?? 'none',
        platform: process.platform,
        backend: 'in-process-fixture-tab',
        nodeVersion: process.version,
      },
      scenarios: results,
      durationMs: Date.now() - started,
    });
    await processes.shutdown();
    if (args.json) stdout.write(`${JSON.stringify(report)}\n`);
    else stderr.write(`${report.status} passed=${report.summary.passed} failed=${report.summary.failed}\n`);
    return exitCodeFor(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const infra = /EADDRINUSE|ENOENT|listen/i.test(message);
    status = infra ? 'INFRA_ERROR' : 'RUNNER_ERROR';
    try { await processes.shutdown(); } catch { /* ignore */ }
    const report = {
      schemaVersion: 1,
      status,
      suites: [],
      summary: { passed: 0, failed: 0, skipped: 0, durationMs: Date.now() - started },
      failures: [{ scenario: 'runner', assertion: status === 'INFRA_ERROR' ? 'environment' : 'runner', expected: 'start', actual: message }],
      artifacts: {},
    };
    if (argv.includes('--json')) stdout.write(`${JSON.stringify(report)}\n`);
    stderr.write(`${status}: ${message}\n`);
    return exitCodeFor(status);
  }
}
