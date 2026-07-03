// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Per-turn UI context. Widget clients (kiosk, web) attach a small `context`
// object to each utterance/text frame describing what's on screen — the holon
// being displayed, the active view, the record open in an editor. It becomes a
// system-prompt suffix so "this holon" / "this task" resolve to what the user
// is looking at instead of their personal holon.

const MAX_ENTRIES = 12;
const MAX_VALUE_LEN = 200;

/** Render a client-supplied UI-context object as a system-prompt suffix. */
export function formatUiContext(ctx: unknown): string {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return '';
  const entries = Object.entries(ctx as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .slice(0, MAX_ENTRIES)
    .map(([k, v]) => `${k}: ${(v as string).slice(0, MAX_VALUE_LEN)}`);
  if (entries.length === 0) return '';
  return (
    '\n\nLive UI context (what the user is looking at right now) — ' +
    entries.join('; ') +
    '. When the user says "this holon", "here", "this page", "this task", or ' +
    'names no holon at all, act on the context holon above — not their ' +
    'personal holon — unless they explicitly ask for their own.'
  );
}
