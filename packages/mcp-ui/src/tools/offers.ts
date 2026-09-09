// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Thin MCP wrappers around @holons/core/offers — resources on the table,
// matched to needs. An offer's canonical record lives at (holon, 'quests',
// offerId); hex-cell map projections live under (cell, 'offers') as
// holograms. Matching runs the inventory transport plan with offers as
// supply and needs as demand.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  OFFER_RECORD_LENS,
  acceptMatch,
  createOffer,
  editOffer,
  matchCost,
  matchOffersToNeeds,
  normalizeOffer,
  publishOfferNearby,
  readCellMarket,
  refreshPublishedOffer,
  syncSurplusFromShelf,
  toMarketNeeds,
  toMarketOffers,
  withdrawPublishedOffer,
  type OfferMode,
} from '@holons/core/offers';
import { normalizeNeed, NEED_RECORD_LENS } from '@holons/core/needs';
import { getFederationSnapshot, readSettingsHex } from '@holons/core/federation';
import type { PartnerGraph } from '@holons/core/inventory';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2),
      },
    ],
  };
}

async function loadOffer(hs: any, holon: string, offerId: string) {
  if (typeof hs.get !== 'function') return null;
  return normalizeOffer(await hs.get(holon, OFFER_RECORD_LENS, offerId));
}

const MODE = z.enum(['give', 'lend', 'sell']);

export function registerOffersTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'offer_create',
    {
      description:
        "List an offer on a holon: a resource (a good, or a service in hours) with a quantity and unit, a category the matcher keys on, and a mode (give / lend / sell, price when selling). Persists at (holon, 'quests') as a type:'offer' quest with status 'open'. Not shared until offer_publish.",
      inputSchema: {
        holon: z.string(),
        title: z.string(),
        category: z.string().describe('What kind of thing; matching and contention are per category.'),
        quantity: z.number().positive(),
        unit: z.string().optional().describe("e.g. 'kg', 'one', 'hour'. Default 'one'."),
        mode: MODE.optional().describe('Default give.'),
        price: z.number().nonnegative().optional().describe('Per unit, when selling.'),
        currency: z.string().optional(),
        description: z.string().optional(),
        itemType: z.enum(['good', 'service']).optional(),
        tags: z.array(z.string()).optional(),
        expiresAt: z.number().optional().describe('ms since epoch'),
        id: z.string().optional().describe('Override the generated id.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const actor = deps.resolveActor();
        const offer = createOffer({
          holonId: args.holon,
          initiator: { id: actor.id, username: actor.username },
          title: args.title,
          category: args.category,
          supply: { quantity: args.quantity, unit: args.unit ?? 'one' },
          mode: (args.mode ?? 'give') as OfferMode,
          price: args.price,
          currency: args.currency,
          description: args.description,
          itemType: args.itemType,
          tags: args.tags,
          expiresAt: args.expiresAt,
          id: args.id,
        });
        await hs.put(args.holon, OFFER_RECORD_LENS, offer);
        return ok({ success: true, offer });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offer_edit',
    {
      description:
        'Change an open offer’s terms (title, description, category, quantity/unit, mode, price, expiry). Supply can never drop below what is already promised. Re-publishes to partners when the offer was shared with them.',
      inputSchema: {
        holon: z.string(),
        offerId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        quantity: z.number().positive().optional(),
        unit: z.string().optional(),
        mode: MODE.optional(),
        price: z.number().nonnegative().optional(),
        currency: z.string().optional(),
        expiresAt: z.number().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const offer = await loadOffer(hs, args.holon, args.offerId);
        if (!offer) return fail(`Offer ${args.offerId} not found on ${args.holon}.`);
        const out = editOffer(offer, {
          ...(args.title != null ? { title: args.title } : {}),
          ...(args.description != null ? { description: args.description } : {}),
          ...(args.category != null ? { category: args.category } : {}),
          ...(args.quantity != null || args.unit != null
            ? { supply: { ...offer.supply, ...(args.quantity != null ? { quantity: args.quantity } : {}), ...(args.unit ? { unit: args.unit } : {}) } }
            : {}),
          ...(args.mode ? { mode: args.mode as OfferMode } : {}),
          ...(args.price != null ? { price: args.price } : {}),
          ...(args.currency != null ? { currency: args.currency } : {}),
          ...(args.expiresAt != null ? { expires_at: args.expiresAt } : {}),
        });
        if (!out.ok) return fail(`Cannot edit: ${out.reason}`);
        const r = await refreshPublishedOffer(hs, args.holon, out.offer);
        return ok({ success: true, offer: r.offer, errors: r.errors });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offer_publish',
    {
      description:
        "Share an offer nearby: standalone copies to federation partners (toPartners, default true) and/or a live hologram at the holon's settings.hex cell under the 'offers' lens so the map's Offers layer lights at that cell and its parents (toHex, default false; needs a valid hex in settings).",
      inputSchema: {
        holon: z.string(),
        offerId: z.string(),
        toPartners: z.boolean().optional(),
        toHex: z.boolean().optional(),
        upcastLevels: z.number().int().min(0).max(15).optional().describe('How many parent cells the hologram climbs. Default: all.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const offer = await loadOffer(hs, args.holon, args.offerId);
        if (!offer) return fail(`Offer ${args.offerId} not found on ${args.holon}.`);
        const out = await publishOfferNearby(hs, args.holon, offer, {
          toPartners: args.toPartners !== false,
          toHex: args.toHex === true,
          upcastLevels: args.upcastLevels,
        });
        return ok({
          success: true,
          offer: out.offer,
          publishedToPartners: out.partners?.publishedTo ?? 0,
          publishedToHex: out.hexCell?.destinations ?? [],
          errors: out.errors,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offer_withdraw',
    {
      description:
        'Take an offer off the market everywhere it was published: status withdrawn, partner copies retracted, the cell hologram deleted. Refused while a reservation is live (someone is counting on it).',
      inputSchema: { holon: z.string(), offerId: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const offer = await loadOffer(hs, args.holon, args.offerId);
        if (!offer) return fail(`Offer ${args.offerId} not found on ${args.holon}.`);
        const out = await withdrawPublishedOffer(hs, args.holon, offer);
        if (!out.ok) return fail(`Cannot withdraw: ${out.reason}`);
        return ok({ success: true, offer: out.offer, retractedFrom: out.retracted?.destinations ?? [], errors: out.errors });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offer_sync_surplus',
    {
      description:
        "Bring the holon's automatic surplus offers in step with its shelf (@holons/core/inventory): one standing offer per stock item for what is on hand above the keep-back (max of min and target), shared with partners and the map; withdrawn when the surplus is gone and nothing is promised. Honours settings.stock.autoOffer unless `enabled` is given.",
      inputSchema: {
        holon: z.string(),
        enabled: z.boolean().optional().describe('Force the switch; false withdraws only.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const actor = deps.resolveActor();
        const out = await syncSurplusFromShelf(hs, args.holon, {
          initiator: { id: actor.id, username: actor.username },
          enabled: args.enabled,
        });
        return ok({
          success: true,
          created: out.created.map((o) => ({ id: o.id, supply: o.supply })),
          updated: out.updated.map((o) => ({ id: o.id, supply: o.supply })),
          withdrawn: out.withdrawn.map((o) => o.id),
          errors: out.errors,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offers_list_at_hex',
    {
      description:
        "List the offers visible at an H3 cell — what the map's Offers layer shows there (holograms resolved live from their owner holons, children included through upcast). Closed offers are filtered out unless includeClosed is true.",
      inputSchema: { cell: z.string(), includeClosed: z.boolean().optional() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const market = await readCellMarket(hs, args.cell, { includeClosed: args.includeClosed === true });
        return ok({ success: true, cell: args.cell, count: market.offers.length, offers: market.offers, holons: market.holons });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'market_match',
    {
      description:
        'Run the matcher: offers as supply, open needs as demand, one transport solve per category at the least cost (federation hops when partnered, hex distance otherwise). Scope is a holon (its own records plus partner copies on its quests lens) or a hex cell (everything published under it). Returns proposed legs, standing commitments, per-category contention, and each need’s price (its dual; UNMET_COST when nobody can serve it).',
      inputSchema: {
        holon: z.string().optional().describe('Read the market from this holon’s quests lens.'),
        cell: z.string().optional().describe('Read the market published under this H3 cell instead (or as well).'),
      },
    },
    async (args) => {
      try {
        if (!args.holon && !args.cell) return fail('Give a holon, a cell, or both.');
        const hs = await deps.getHoloSphere();
        const records: unknown[] = [];
        const partners: PartnerGraph = {};
        const hexOf: Record<string, string | undefined> = {};
        if (args.holon) {
          const all = (await hs.getAll(args.holon, OFFER_RECORD_LENS)) ?? [];
          records.push(...all);
          try {
            const snap = await getFederationSnapshot(hs, args.holon);
            partners[args.holon] = snap.federated ?? [];
            hexOf[args.holon] = (await readSettingsHex(hs, args.holon)) ?? undefined;
            for (const pid of snap.federated ?? []) {
              hexOf[pid] = (await readSettingsHex(hs, pid)) ?? undefined;
              try {
                partners[pid] = (await getFederationSnapshot(hs, pid)).federated ?? [];
              } catch {
                /* a partner with no federation record */
              }
            }
          } catch {
            /* no federation record */
          }
        }
        if (args.cell) {
          const market = await readCellMarket(hs, args.cell);
          records.push(...market.offers, ...market.needs);
        }
        for (const r of records) {
          const rec = r as { hex?: unknown; holon?: unknown; holonId?: unknown };
          const h = String(rec.holonId ?? rec.holon ?? '');
          if (h && typeof rec.hex === 'string' && !hexOf[h]) hexOf[h] = rec.hex;
        }
        const fallback = args.holon ?? args.cell!;
        const offers = toMarketOffers(records, fallback);
        const needs = toMarketNeeds(records, fallback);
        const plan = matchOffersToNeeds(offers, needs, matchCost({ partners, hexOf }));
        return ok({
          success: true,
          offers: offers.map((o) => ({ offerId: o.offerId, holonId: o.holonId, category: o.category, quantity: o.quantity, unit: o.unit })),
          needs: needs.map((n) => ({ needId: n.needId, holonId: n.holonId, category: n.category, quantity: n.quantity })),
          legs: plan.legs,
          committed: plan.committed,
          byCategory: plan.byCategory,
          needPrice: plan.needPrice,
          unmetNeeds: plan.unmetNeeds,
          unusedOffers: plan.unusedOffers,
          moved: plan.moved,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'offer_accept_match',
    {
      description:
        "One tap on a match, as the provider: answer the need from the standing offer (a need response carrying offerId, written on the need's owner holon) and reserve the units on the offer. The requester then claims (need_claim), both confirm the handoff (need_handoff_confirm), and settlement closes the reservation and records the movement as an REA event on both ledgers.",
      inputSchema: {
        offerHolon: z.string(),
        offerId: z.string(),
        needHolon: z.string().describe("The holon that OWNS the need (for a copy, its origin)."),
        needId: z.string(),
        quantity: z.number().positive(),
        message: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const offer = await loadOffer(hs, args.offerHolon, args.offerId);
        if (!offer) return fail(`Offer ${args.offerId} not found on ${args.offerHolon}.`);
        const need = normalizeNeed(await hs.get(args.needHolon, NEED_RECORD_LENS, args.needId));
        if (!need) return fail(`Need ${args.needId} not found on ${args.needHolon}.`);
        const actor = deps.resolveActor();
        const out = await acceptMatch(
          { holosphere: hs },
          {
            offer,
            offerHolonId: args.offerHolon,
            need,
            needHolonId: args.needHolon,
            quantity: args.quantity,
            actor: { id: actor.id, name: actor.username ?? actor.first_name },
            message: args.message,
          },
        );
        if (!out.ok) return fail(`Cannot accept: ${out.reason}`, { errors: out.errors });
        return ok({ success: true, responseId: out.responseId, reservationId: out.reservationId, need: out.need, offer: out.offer, errors: out.errors });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
