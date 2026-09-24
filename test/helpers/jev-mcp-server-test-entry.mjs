import { startStdioMcpServer } from '../../src/mcp/server.mjs';
import { ChromeDevtoolsSession } from '../../src/chrome/session.mjs';
import { testPeerTransport } from './chrome-test-transport.mjs';
import { createScriptedDecisionSource } from './scripted-decision.mjs';

const scenario = process.env.JEV_CHROME_PEER_SCENARIO ?? 'task-default';
const allowedOrigin = process.env.JEV_PEER_ALLOWED_ORIGIN ?? 'https://allowed.test';

const decide = createScriptedDecisionSource([
  { choice: 'a0', confidence: 0.95 },
  { choice: 'DONE', confidence: 0.95 },
]);

await startStdioMcpServer({
  createSession: (request) =>
    new ChromeDevtoolsSession({
      allowedOrigins: request.allowedOrigins,
      transportOptions: testPeerTransport(scenario, { JEV_PEER_ALLOWED_ORIGIN: allowedOrigin }),
      startupTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    }),
  createDecisionSource: () => decide,
});
