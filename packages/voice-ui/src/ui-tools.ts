// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Client-side (UI) tools — synthetic tools declared to the LLM alongside the
// MCP tools but never forwarded to mcp-ui. They act on the user's screen: the
// server answers the tool call locally and pushes a frame over the WebSocket
// (e.g. { type: 'navigate', view }); the client owns the actual effect.
//
// Which views exist is the client's business: each client advertises its
// navigable views as a comma-separated `views` entry in the per-turn UI
// context, and the tool call is validated against that list.

import type { AgentTool } from '@holons/ai-ui';

export const UI_NAVIGATE = 'ui_navigate';

export const uiNavigateTool: AgentTool = {
  name: UI_NAVIGATE,
  description:
    "Switch the app on the user's screen to another view/tab. Purely visual — " +
    'it changes no data. Use it when the user asks to open, show, switch to, ' +
    'or go to a part of the app. The views available on this screen are ' +
    'listed in the live UI context under "views".',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        description:
          'Target view id, exactly as it appears in the UI context "views" list.',
      },
    },
    required: ['view'],
  },
};

/** The navigable views a client advertised in its UI context, if any. */
export function viewsFromContext(ctx: unknown): string[] | null {
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) return null;
  const raw = (ctx as Record<string, unknown>).views;
  if (typeof raw !== 'string') return null;
  const views = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return views.length > 0 ? views : null;
}

export type NavigateOutcome =
  | { ok: true; view: string; message: string }
  | { ok: false; message: string };

/**
 * Validate a ui_navigate call against the client's advertised views. Spoken
 * requests arrive loosely ("Calendar", "the library tab"), so matching is
 * case-insensitive and tolerates a trailing tab/view/page/screen word; the
 * returned view is always the client's exact id. Without an advertised list
 * (older client) the normalized view is forwarded as-is and the client
 * decides.
 *
 * On an unknown view the recovery instruction is derived from the USER's
 * utterance, not left to the model: a weak model told merely "retry with a
 * valid id" happily navigates somewhere the user never asked for. A retry is
 * suggested only when a valid view actually occurs in the utterance;
 * otherwise the model is ordered to admit the view doesn't exist.
 */
export function navigateOutcome(
  input: Record<string, unknown>,
  views: string[] | null,
  utterance = '',
): NavigateOutcome {
  const raw = typeof input.view === 'string' ? input.view.trim() : '';
  const listing = views ? ` The ONLY views on this screen: ${views.join(', ')}.` : '';
  if (!raw) {
    return { ok: false, message: `ui_navigate needs a "view" string.${listing}` };
  }
  const norm = raw
    .toLowerCase()
    .replace(/\s+(tab|view|page|screen)$/, '')
    .trim();
  if (!views) {
    return { ok: true, view: norm, message: `Switched the screen to ${norm}.` };
  }
  const match = views.find((v) => v.toLowerCase() === norm);
  if (!match) {
    const spoken = views.find((v) =>
      new RegExp(`\\b${v.replace(/[^a-z0-9]/gi, '')}\\b`, 'i').test(utterance),
    );
    return {
      ok: false,
      message:
        `View "${raw}" does not exist on this screen.${listing} ` +
        (spoken
          ? `The user's request mentions "${spoken}" — retry with exactly that id.`
          : 'The user did not ask for any of these, so do NOT call ui_navigate ' +
            'again with a different view. Tell the user that view is not ' +
            'available on this screen.'),
    };
  }
  return { ok: true, view: match, message: `Switched the screen to ${match}.` };
}
