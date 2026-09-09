// Provider-neutral agent loop.
//
// Drives an LLMProvider: on each turn, collect any tool calls, dispatch them
// through the supplied ToolDispatcher, feed the results back, and repeat until
// the model is done or maxIterations is hit. The provider owns message shaping;
// this loop owns control flow and is identical for every backend/tool source.

import type {
  AgentTool,
  HistoryMessage,
  LLMProvider,
  ToolCall,
  ToolDispatcher,
} from './types.js';

export interface AgentLoopParams {
  provider: LLMProvider;
  tools: AgentTool[];
  dispatch: ToolDispatcher;
  system: string;
  prompt: string;
  /** Prior exchanges replayed before the prompt (short-term memory). */
  history?: HistoryMessage[];
  /** Hard cap on turns (defensive against runaway loops). Default 10. */
  maxIterations?: number;
  /** Streaming hook: assistant text as each turn produces it. */
  onText?: (text: string) => void;
  /** Streaming hook: each tool call before it is dispatched. */
  onToolCall?: (call: ToolCall) => void;
  /**
   * Dispatch a turn's tool calls one after another, in the order the model
   * emitted them, instead of concurrently. Needed when calls build on each
   * other's effect — a task created by the first call and joined by the
   * second — as with staged changes.
   */
  sequential?: boolean;
}

export interface AgentLoopResult {
  /** Final assistant text concatenated across the run. */
  text: string;
  /** Number of model turns executed. */
  iterations: number;
  /** Last stop/finish reason from the provider. */
  stopReason: string | null;
  /** Provider-native transcript for inspection. */
  transcript: unknown[];
}

export async function runAgentLoop(
  params: AgentLoopParams,
): Promise<AgentLoopResult> {
  const { provider, tools, dispatch, system, prompt } = params;
  const maxIterations = params.maxIterations ?? 10;

  const runner = provider.begin({
    system,
    tools,
    userPrompt: prompt,
    history: params.history,
  });
  const textChunks: string[] = [];
  let iterations = 0;
  let stopReason: string | null = null;

  while (iterations < maxIterations) {
    iterations++;
    const turn = await runner.step();
    stopReason = turn.stopReason;

    if (turn.text) {
      textChunks.push(turn.text);
      params.onText?.(turn.text);
    }

    if (turn.done || turn.toolCalls.length === 0) break;

    let results;
    if (params.sequential) {
      results = [];
      for (const call of turn.toolCalls) {
        params.onToolCall?.(call);
        results.push(await dispatch(call));
      }
    } else {
      results = await Promise.all(
        turn.toolCalls.map((call) => {
          params.onToolCall?.(call);
          return dispatch(call);
        }),
      );
    }
    runner.submitToolResults(results);
  }

  return {
    text: textChunks.join('\n'),
    iterations,
    stopReason,
    transcript: runner.transcript(),
  };
}
