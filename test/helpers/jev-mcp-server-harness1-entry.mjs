/**
 * Harness 1 stdio entry: same createJevMcpServer path as src/mcp/server.mjs with
 * live pinned Chrome DevTools MCP and scripted decisions (test-only wiring).
 */
import { startStdioMcpServer } from '../../src/mcp/server.mjs';
import { ChromeDevtoolsSession } from '../../src/chrome/session.mjs';
import { createScriptedDecisionSource } from './scripted-decision.mjs';

const scenario = process.env.JEV_HARNESS_DECISION_SCENARIO ?? 'fixture-complete';
const navigateUrl = process.env.JEV_HARNESS_NAVIGATE_URL ?? '';

function decisionSequenceForScenario(name) {
  if (name === 'handoff-blocked') {
    return [{ choice: 'BLOCKED', confidence: 0.95 }];
  }
  return [
    { choice: 'a0', confidence: 0.95 },
    { choice: 'DONE', confidence: 0.95 },
  ];
}

const decide = createScriptedDecisionSource(decisionSequenceForScenario(scenario));

await startStdioMcpServer({
  createSession: (request) => {
    const session = new ChromeDevtoolsSession({
      allowedOrigins: request.allowedOrigins,
      startupTimeoutMs: 90_000,
      requestTimeoutMs: 45_000,
    });
    if (navigateUrl) {
      const originalStart = session.start.bind(session);
      session.start = async () => {
        await originalStart();
        await session.callTool('navigate_page', { pageId: 1, url: navigateUrl });
      };
    }
    return session;
  },
  createDecisionSource: () => decide,
});
