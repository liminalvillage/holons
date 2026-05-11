import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getHoloSphere } from './holosphere.js';
import { resolveActor } from './identity.js';
import { registerAllTools, type ToolDeps } from './tools/index.js';

export async function createServer(): Promise<McpServer> {
  const server = new McpServer({
    name: 'holons-mcp-ui',
    version: '0.1.0',
    description:
      'MCP server exposing every @holons/core function as an independently-callable tool.',
  });
  const deps: ToolDeps = { getHoloSphere, resolveActor };
  await registerAllTools(server, deps);
  return server;
}
