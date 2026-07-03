// OpenAI-compatible LLM provider (Chat Completions + function tool-calling).
//
// Talks to any OpenAI-compatible endpoint via fetch — notably a local
// `mlx_lm.server` (the local-inference swap). No SDK dependency: Node >=20
// ships a global fetch, keeping ai-ui's dependency surface minimal.

import type {
  AgentTool,
  HistoryMessage,
  LLMProvider,
  LLMTurnRunner,
  ToolResult,
  TurnOutput,
} from './types.js';

export interface OpenAICompatProviderOptions {
  /** Base URL incl. /v1, e.g. http://localhost:1234/v1 */
  baseUrl: string;
  /** API key; local servers accept any placeholder. */
  apiKey?: string;
  model: string;
  maxTokens?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

interface OpenAIToolCall {
  id: string;
  function: { name: string; arguments: string };
}
interface OpenAIMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name = 'openai-compat';

  constructor(private readonly opts: OpenAICompatProviderOptions) {}

  begin(params: {
    system: string;
    tools: AgentTool[];
    userPrompt: string;
    history?: HistoryMessage[];
  }): LLMTurnRunner {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const model = this.opts.model;
    const maxTokens = this.opts.maxTokens ?? 4096;
    const apiKey = this.opts.apiKey;

    const tools = params.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const messages: OpenAIMessage[] = [
      { role: 'system', content: params.system },
      ...(params.history ?? []).map(
        (m): OpenAIMessage => ({ role: m.role, content: m.content }),
      ),
      { role: 'user', content: params.userPrompt },
    ];
    let pending: ToolResult[] | null = null;

    return {
      transcript: () => messages,
      submitToolResults(results: ToolResult[]) {
        pending = results;
      },
      async step(): Promise<TurnOutput> {
        if (pending) {
          for (const r of pending) {
            messages.push({
              role: 'tool',
              tool_call_id: r.id,
              content: r.content,
            });
          }
          pending = null;
        }

        const doPost = () =>
          doFetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              temperature: 0,
              messages,
              tools: tools.length > 0 ? tools : undefined,
              tool_choice: tools.length > 0 ? 'auto' : undefined,
            }),
          });
        let resp: Response;
        try {
          resp = await doPost();
        } catch {
          // Simple local servers (mlx_lm.server) drop keep-alive sockets
          // between requests; one network-level failure is worth one retry.
          await new Promise((r) => setTimeout(r, 250));
          resp = await doPost();
        }
        if (!resp.ok) {
          throw new Error(
            `LLM HTTP ${resp.status}: ${await resp.text().catch(() => '')}`,
          );
        }

        const data = (await resp.json()) as {
          choices?: {
            message?: OpenAIMessage;
            finish_reason?: string;
          }[];
        };
        const choice = data.choices?.[0];
        const msg: OpenAIMessage = choice?.message ?? { role: 'assistant' };
        messages.push(msg);

        const text = typeof msg.content === 'string' ? msg.content : '';
        const toolCalls = (msg.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          input: parseArgs(tc.function.arguments),
        }));
        const done =
          choice?.finish_reason === 'stop' || toolCalls.length === 0;

        return {
          text,
          toolCalls,
          done,
          stopReason: choice?.finish_reason ?? null,
        };
      },
    };
  }
}
