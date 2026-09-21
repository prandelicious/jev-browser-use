export const SCHEMA_VERSION = 1;

export const EXIT = {
  PASS: 0,
  FAIL: 1,
  INFRA_ERROR: 2,
  RUNNER_ERROR: 3,
};

export function buildReport({
  status,
  selection,
  environment,
  scenarios,
  artifacts = {},
  durationMs,
}) {
  const failed = scenarios.filter((item) => item.status === 'FAIL');
  const passed = scenarios.filter((item) => item.status === 'PASS');
  const skipped = scenarios.filter((item) => item.status === 'SKIPPED');
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    suites: selection.selectedSuites,
    selection,
    environment,
    summary: {
      passed: passed.length,
      failed: failed.length,
      skipped: skipped.length,
      durationMs,
    },
    scenarios,
    failures: failed.flatMap((item) => item.failures ?? []),
    artifacts,
  };
}

export function exitCodeFor(status) {
  return EXIT[status] ?? EXIT.RUNNER_ERROR;
}
