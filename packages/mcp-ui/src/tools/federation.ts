import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  publishToFederation,
  getFederationSnapshot,
  readSettingsHex,
  type PublishContext,
  type PublishOptions,
  type PublishTarget,
} from '@holons/core/federation';
import type { ToolDeps } from './index.js';

// ---- helpers ----------------------------------------------------------------

function ok(payload: Record<string, unknown>) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ success: true, ...payload }, null, 2) },
    ],
  };
}

function fail(error: string, extra: Record<string, unknown> = {}) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ success: false, error, ...extra }, null, 2) },
    ],
    isError: true,
  };
}

function parseJSON<T = unknown>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    throw new Error(`${label}: invalid JSON — ${(e as Error).message}`);
  }
}

/**
 * Coerce a tool-input `context` JSON into a partial PublishContext.
 * `holosphere` is injected at call-time (it isn't JSON-serializable).
 */
function coerceContext(raw: string): Omit<PublishContext, 'holosphere'> {
  const parsed = parseJSON<Record<string, unknown>>(raw, 'context');
  const holonId = typeof parsed.holonId === 'string' ? parsed.holonId : '';
  const lens = typeof parsed.lens === 'string' ? parsed.lens : '';
  const item = parsed.item;
  if (!holonId) throw new Error('context: holonId is required');
  if (!lens) throw new Error('context: lens is required');
  if (!item || typeof item !== 'object' || typeof (item as any).id !== 'string') {
    throw new Error('context: item with string id is required');
  }
  return { holonId, lens, item: item as PublishContext['item'] };
}

/**
 * Coerce a tool-input `options` JSON into `{ target, opts }`.
 * Accepts either a flat object with a `target` field or a wrapper
 * `{ target, ...publishOptions }`. Targets default to `{ kind: 'all' }`.
 *
 * `onWriteDenied` is intentionally dropped — callbacks can't cross the
 * MCP boundary; errors come back in the `PublishOutcome.errors[]`.
 */
function coerceOptions(raw: string): { target: PublishTarget; opts: PublishOptions } {
  const parsed = parseJSON<Record<string, unknown>>(raw, 'options');
  const rawTarget = parsed.target;
  let target: PublishTarget = { kind: 'all' };
  if (rawTarget && typeof rawTarget === 'object') {
    const t = rawTarget as Record<string, unknown>;
    if (t.kind === 'partner' && typeof t.holonId === 'string') {
      target = { kind: 'partner', holonId: t.holonId };
    } else if (t.kind === 'hex' && typeof t.cell === 'string') {
      target = { kind: 'hex', cell: t.cell };
    } else if (t.kind === 'all') {
      target = { kind: 'all' };
    } else {
      throw new Error(
        'options.target: expected { kind: "all" } | { kind: "partner", holonId } | { kind: "hex", cell }'
      );
    }
  }
  const opts: PublishOptions = {};
  if (typeof parsed.includeSettingsHex === 'boolean') {
    opts.includeSettingsHex = parsed.includeSettingsHex;
  }
  if (typeof parsed.federationSourceId === 'string') {
    opts.federationSourceId = parsed.federationSourceId;
  }
  return { target, opts };
}

// ---- registration -----------------------------------------------------------

export function registerFederationTools(server: McpServer, deps: ToolDeps): void {
  // 1. federation_publish ----------------------------------------------------
  server.tool(
    'federation_publish',
    'Publish an item as a hologram to the federation. Wraps the item in a hologram first, then routes to one of three targets: `all` (propagate to every federated partner + settings.hex if configured), `partner` (a single holon id), or `hex` (a single H3 cell). Stamping the source item with published/publishedAt/publishedTo is the caller\'s responsibility.',
    {
      context: z
        .string()
        .describe(
          'PublishContext JSON: { holonId, lens, item: { id, ... } }. holosphere is injected automatically.'
        ),
      options: z
        .string()
        .describe(
          'Publish options JSON: { target: { kind: "all" } | { kind: "partner", holonId } | { kind: "hex", cell }, includeSettingsHex?, federationSourceId? }. Defaults to target.kind = "all".'
        ),
    },
    async ({ context, options }) => {
      try {
        const ctxPartial = coerceContext(context);
        const { target, opts } = coerceOptions(options);
        const hs = await deps.getHoloSphere();
        const ctx: PublishContext = { holosphere: hs, ...ctxPartial };
        const outcome = await publishToFederation(ctx, target, opts);
        return ok({ outcome });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 2. federation_snapshot_get -----------------------------------------------
  server.tool(
    'federation_snapshot_get',
    "Read a holon's federation snapshot: the list of federated partner ids and a partnerId → name map. Pass `federationSourceId` to key federation off a nostr pubkey instead of the holon id.",
    {
      holon: z.string().describe('Holon id (home holon).'),
      federationSourceId: z
        .string()
        .optional()
        .describe('Federation source id (defaults to `holon`). Use this for nostr-keyed setups.'),
    },
    async ({ holon, federationSourceId }) => {
      try {
        const hs = await deps.getHoloSphere();
        const snapshot = await getFederationSnapshot(hs, holon, federationSourceId);
        return ok({ holon, snapshot });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  // 3. federation_settings_hex_read -----------------------------------------
  server.tool(
    'federation_settings_hex_read',
    "Read `settings.hex` for a holon. Returns the configured H3 cell string, or null if absent / unreachable.",
    {
      holon: z.string().describe('Holon id.'),
    },
    async ({ holon }) => {
      try {
        const hs = await deps.getHoloSphere();
        const hex = await readSettingsHex(hs, holon);
        return ok({ holon, hex });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}
