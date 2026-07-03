// MCP client → holons mcp-ui (stdio).
//
// Launches the built mcp-ui server as a subprocess, lists its ~121 tools, and
// exposes them in ai-ui's neutral AgentTool shape plus a ToolDispatcher that
// routes calls back over MCP. This mirrors what the Python harness does, but
// in-process for the Node agent loop.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { AgentTool, ToolCall, ToolDispatcher } from '@holons/ai-ui';
import type { McpLaunch } from './config.js';

export interface HolonsMcp {
  tools: AgentTool[];
  dispatch: ToolDispatcher;
  close(): Promise<void>;
}

interface McpContentPart {
  type: string;
  text?: string;
}
interface McpToolResult {
  content?: McpContentPart[];
  isError?: boolean;
}

/** Flatten an MCP tool result's content blocks into a single string. */
function renderResult(res: McpToolResult): string {
  const parts = (res.content ?? [])
    .map((p) => (p.type === 'text' && p.text ? p.text : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join('\n') : JSON.stringify(res);
}

export async function connectHolonsMcp(launch: McpLaunch): Promise<HolonsMcp> {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    // Merge process env so PATH/etc. survive; overlay the forwarded HOLONS_*.
    env: { ...(process.env as Record<string, string>), ...launch.env },
    stderr: 'inherit',
  });

  const client = new Client(
    { name: 'holons-voice-ui', version: '0.1.0' },
    { capabilities: {} },
  );
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: AgentTool[] = listed.tools.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<
      string,
      unknown
    >,
  }));

  const dispatch: ToolDispatcher = async (call: ToolCall) => {
    try {
      const res = (await client.callTool({
        name: call.name,
        arguments: call.input,
      })) as McpToolResult;
      return {
        id: call.id,
        content: renderResult(res),
        isError: res.isError === true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: call.id, content: `error: ${msg}`, isError: true };
    }
  };

  return {
    tools,
    dispatch,
    close: () => client.close(),
  };
}
