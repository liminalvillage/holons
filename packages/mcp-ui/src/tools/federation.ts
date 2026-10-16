import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  publishToFederation,
  getFederationSnapshot,
  readSettingsHex,
  answerFederationRequest,
  federationLinkState,
  laneState,
  pendingFederationRequests,
  type PublishContext,
  type PublishOptions,
  type PublishTarget,
} from '@holons/core/federation';
import type { ToolDeps } from './index.js';
import { gate } from './standing.js';

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
  // Federation holograms are opt-in at the core layer (default off). This tool's
  // contract is "publish as a hologram", so it defaults useHolograms to true and
  // lets the caller opt out with an explicit `useHolograms: false`.
  opts.useHolograms = parsed.useHolograms !== false;
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
          'Publish options JSON: { target: { kind: "all" } | { kind: "partner", holonId } | { kind: "hex", cell }, includeSettingsHex?, federationSourceId?, useHolograms? }. Defaults to target.kind = "all". useHolograms defaults to true (publish as a hologram); pass false to send a full standalone copy instead.'
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

  // 4. federation_requests ---------------------------------------------------
  server.registerTool(
    'federation_requests',
    {
      description:
        "Federation requests waiting for a holon's admins: partners that linked their half and ask this holon to match it (kind 'link', with the inbound/outbound lenses THIS holon is asked to receive/send) or to drop its half (kind 'unlink'). With `partner`, also returns where that one link stands: each side's counted half, the requests between them, and per lens and direction whether the flow is agreed, waiting for the partner, offered by the partner, or off.",
      inputSchema: {
        holon: z.string().describe('The holon whose incoming requests to list.'),
        partner: z.string().optional().describe('A partner holon id: also report the state of this one link.'),
      },
    },
    async ({ holon, partner }: { holon: string; partner?: string }) => {
      try {
        const hs = await deps.getHoloSphere();
        const requests = await pendingFederationRequests(hs, holon);
        if (!partner) return ok({ holon, requests });
        const state = await federationLinkState(hs, holon, partner);
        const lenses = [
          ...new Set([
            ...(state.ours?.inbound ?? []),
            ...(state.ours?.outbound ?? []),
            ...(state.theirs?.inbound ?? []),
            ...(state.theirs?.outbound ?? []),
          ]),
        ].sort();
        const lanes = Object.fromEntries(
          lenses.map((l) => [l, { receive: laneState(state, l, 'in'), send: laneState(state, l, 'out') }]),
        );
        return ok({ holon, requests, link: { partner, ...state, lanes } });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  // 5. federation_request_answer --------------------------------------------
  server.registerTool(
    'federation_request_answer',
    {
      description:
        "Accept or decline a partner's federation request as an admin of `holon`. Accepting writes this holon's own half of the link (or drops it, for an unlink request); pass `inbound`/`outbound` to accept with fewer or different lenses than asked. Declining leaves this holon's record unchanged.",
      inputSchema: {
        holon: z.string().describe('The asked holon (you must be its admin).'),
        from: z.string().describe('The asking partner holon id.'),
        decision: z.enum(['accept', 'decline']),
        inbound: z.array(z.string()).optional().describe('Override: lenses this holon receives from the partner.'),
        outbound: z.array(z.string()).optional().describe('Override: lenses this holon sends to the partner.'),
      },
    },
    async (args: { holon: string; from: string; decision: 'accept' | 'decline'; inbound?: string[]; outbound?: string[] }) => {
      try {
        const hs = await deps.getHoloSphere();
        const g = await gate(hs, args.holon, 'federation');
        if (g.refusal) return fail(g.refusal, { standing: g.standing });
        const override =
          args.inbound !== undefined || args.outbound !== undefined
            ? { directions: { inbound: args.inbound ?? [], outbound: args.outbound ?? [] } }
            : {};
        const request = await answerFederationRequest(hs, args.holon, args.from, args.decision, override);
        if (!request) return fail(`No federation request from ${args.from} is held in ${args.holon}.`);
        return ok({ holon: args.holon, request });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
