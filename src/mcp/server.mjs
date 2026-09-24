import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  DEFAULT_MECHANICAL_ACTIONS,
  HOST_TOOL_NAME,
  TASK_REQUEST_FIELDS,
  TASK_STATUSES,
} from '../contract.mjs';
import { ChromeDevtoolsSession } from '../chrome/session.mjs';
import { runBrowserTask } from '../task/run.mjs';

const runBrowserTaskInputSchema = {
  goal: z.string().min(1),
  allowedOrigins: z.array(z.string().min(1)).min(1),
  page: z.string().optional(),
  maxActions: z.number().int().positive().optional(),
  maxDurationMs: z.number().positive().optional(),
  allowedMechanicalActions: z.array(z.string()).optional(),
};

export function createJevMcpServer({
  createSession = defaultCreateSession,
  createDecisionSource = defaultDecisionSource,
  runTask = runBrowserTask,
} = {}) {
  const server = new McpServer({ name: 'jev-browser-use', version: '0.0.0' }, { capabilities: { tools: {} } });

  server.registerTool(
    HOST_TOOL_NAME,
    {
      description:
        'Run one bounded browser task against an owned Chrome DevTools MCP session. Host retains verification.',
      inputSchema: runBrowserTaskInputSchema,
    },
    async (args) => {
      const session = createSession(args);
      const decide = createDecisionSource(args);
      const result = await runTask(args, { session, decide });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  return server;
}

function defaultCreateSession(request) {
  return new ChromeDevtoolsSession({ allowedOrigins: request.allowedOrigins });
}

function defaultDecisionSource() {
  return async () => {
    throw new Error('Decision provider is not configured on this server');
  };
}

export async function startStdioMcpServer(options = {}) {
  const server = createJevMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

export function runBrowserTaskToolSchemaSummary() {
  return {
    name: HOST_TOOL_NAME,
    fields: TASK_REQUEST_FIELDS,
    statuses: TASK_STATUSES,
    defaultMechanicalActions: DEFAULT_MECHANICAL_ACTIONS,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  startStdioMcpServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
