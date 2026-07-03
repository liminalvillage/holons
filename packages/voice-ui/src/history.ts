// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sliding-window conversation memory for a voice session. Each completed turn
// appends one user/assistant exchange; the window is trimmed oldest-first so
// the replayed history stays small — on the local leg the whole prompt is
// re-processed every turn, so an unbounded history would grow latency without
// bound. Individual messages are also clipped: a reply that read out a long
// list shouldn't dominate the window.

import type { HistoryMessage } from '@holons/ai-ui';

/** Max messages kept (6 exchanges). */
export const MAX_HISTORY_MESSAGES = 12;
/** Max total characters across the window (~1k tokens). */
export const MAX_HISTORY_CHARS = 4000;
/** Max characters stored per message. */
export const MAX_MESSAGE_CHARS = 600;

function clip(text: string): string {
  return text.length > MAX_MESSAGE_CHARS
    ? text.slice(0, MAX_MESSAGE_CHARS - 1) + '…'
    : text;
}

/**
 * Append one exchange to the window and trim oldest-first to the caps.
 * Returns a new array; the input is not mutated. An empty assistant reply
 * (pure tool turn that produced no text) still records the user side so a
 * follow-up like "and the second one too" keeps its referent.
 */
export function slideWindow(
  history: HistoryMessage[],
  user: string,
  assistant: string,
): HistoryMessage[] {
  const next: HistoryMessage[] = [
    ...history,
    { role: 'user', content: clip(user) },
  ];
  if (assistant.trim()) next.push({ role: 'assistant', content: clip(assistant) });

  let total = next.reduce((n, m) => n + m.content.length, 0);
  // Always keep at least the exchange just added.
  while (
    next.length > 2 &&
    (next.length > MAX_HISTORY_MESSAGES || total > MAX_HISTORY_CHARS)
  ) {
    total -= next[0].content.length;
    next.shift();
  }
  return next;
}
