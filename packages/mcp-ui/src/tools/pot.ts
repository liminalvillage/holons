// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Thin MCP wrappers around the Pot side of @holons/core/flows — a holon's
// value held on chain and divided by a rights table committed once per
// lunation. The MCP holds no wallet and reads no chain: it records the
// deployed Pot, cuts and publishes tables from what the caller read off the
// contract (`received`), hands back the exact commitment to sign and post,
// records the signatures that come back, and hands a party the arguments of
// their one-transaction collect. Every rule lives in core.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  FLOW_RIGHTS_LENS,
  POT_ROOT_TYPES,
  buildRightsEntry,
  buildRightsSignature,
  cutRights,
  loadPotRecord,
  loadRights,
  lunationAt,
  orderSignatures,
  payoutAddressOf,
  potClaimArgs,
  potCommitment,
  potDomain,
  potPostRootArgs,
  rightsByRef,
  rootSignatures,
  savePayoutAddress,
  savePotRecord,
  scoreAllocationMembers,
  type RightsTable,
} from '@holons/core/flows';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2) }] };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message, ...(extra ?? {}) }, null, 2) }],
  };
}

const receivedSchema = z
  .record(z.string(), z.string())
  .describe('Token address (zero address for the chain\'s coin) → the Pot\'s cumulative `received(token)` now, base units as a decimal string.');

const asReceived = (raw: Record<string, string>): Record<string, bigint> =>
  Object.fromEntries(Object.entries(raw).map(([token, v]) => [token, BigInt(v)]));

const tableOut = (t: RightsTable | null) =>
  t && {
    epoch: t.epoch,
    totals: Object.fromEntries(Object.entries(t.totals).map(([k, v]) => [k, v.toString()])),
    rows: t.rows.map((r) => ({ ...r, cumulative: r.cumulative.toString() })),
  };

export function registerPotTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'pot_record_set',
    {
      description:
        'Record a holon\'s deployed Pot (address + chain) on its settings document, so every surface reads the same contract. Deploying is a wallet\'s job (kiosk, web); this only records. Wraps @holons/core/flows savePotRecord.',
      inputSchema: {
        holon: z.string(),
        address: z.string().describe('0x address of the Pot.'),
        chainId: z.number().int().positive(),
        challenge: z.number().int().nonnegative().optional().describe('Challenge window in seconds, as deployed.'),
        txHash: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const pot = await savePotRecord(hs, args.holon, {
          address: args.address,
          chainId: args.chainId,
          ...(args.challenge != null ? { challenge: args.challenge } : {}),
          ...(args.txHash ? { txHash: args.txHash } : {}),
          deployedAt: Date.now(),
        });
        return ok({ success: true, holon: args.holon, pot });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_rights_state',
    {
      description:
        'The holon\'s Pot and its rights log folded: every published table judged (committed | pending | disputed | conflict | rejected), the latest committed table for the Pot, and the wallet signatures gathered for it. Wraps @holons/core/flows loadRights.',
      inputSchema: { holon: z.string() },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadRights(hs, args.holon);
        return ok({
          success: true,
          holon: args.holon,
          pot: ctx.pot,
          source: ctx.actors.source,
          policy: ctx.policy,
          myPubkey: hs.currentPubkey,
          myRole: ctx.actors.roleAt(hs.currentPubkey, Math.floor(Date.now() / 1000)),
          epochNow: lunationAt().index,
          latest: ctx.latest && { id: ctx.latest.id, epoch: ctx.latest.epoch, root: ctx.latest.root, status: ctx.latest.status, table: tableOut(ctx.latest.table) },
          signatures: ctx.signatures,
          tables: ctx.folded.tables.map((t) => ({ id: t.id, epoch: t.epoch, root: t.root, status: t.status, reason: t.reason ?? null, attests: t.attests, disputes: t.disputes, rows: t.table.rows.length, pubkey: t.pubkey, createdAt: t.createdAt })),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_rights_cut',
    {
      description:
        'Cut this lunation\'s rights table for the holon\'s Pot — the previous committed table carried forward, this lunation\'s income (the Pot\'s `received` less what the last table declared) divided by the flattened cascade — and, with publish=true, append it to the "flow_rights" log (attesters only; signed with this MCP key). Refuses to publish a table the walk could not complete. Wraps @holons/core/flows cutRights + buildRightsEntry.',
      inputSchema: {
        holon: z.string(),
        received: receivedSchema,
        epoch: z.number().int().optional().describe('The lunation index; default the current one (lunationAt).'),
        publish: z.boolean().optional().describe('Append the table to the log when it is complete. Default false: preview only.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadRights(hs, args.holon);
        if (!ctx.pot) return fail('This holon has no Pot recorded', { holon: args.holon });
        const epoch = args.epoch ?? lunationAt().index;
        const cut = await cutRights(hs, args.holon, {
          previous: ctx.latest?.table ?? null,
          epoch,
          chainId: ctx.pot.chainId,
          received: asReceived(args.received),
          scoreOf: (id) => scoreAllocationMembers(hs, id),
        });
        let published: { id: string } | null = null;
        if (args.publish) {
          if (!cut.complete || !cut.table) return fail('The table is not fit to publish', { problems: cut.problems, table: tableOut(cut.table) });
          const a = buildRightsEntry({ table: cut.table, chainId: ctx.pot.chainId, pot: ctx.pot.address });
          const event = await hs.append(args.holon, FLOW_RIGHTS_LENS, a.item, { refs: a.refs });
          published = { id: event.id };
        }
        return ok({ success: true, holon: args.holon, epoch, complete: cut.complete, problems: cut.problems, shares: cut.shares, table: tableOut(cut.table), published });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_rights_commitment',
    {
      description:
        'What a signer signs and what `postRoot` takes for a published table: the EIP-712 domain, types and message (sign with `signTypedData`), the positional postRoot arguments, and the signatures gathered so far in the order the contract walks them. Default: the latest committed table; or name a table entry id. Wraps @holons/core/flows potCommitment.',
      inputSchema: {
        holon: z.string(),
        tableId: z.string().optional().describe('A published table\'s entry id; default the latest committed one.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadRights(hs, args.holon);
        if (!ctx.pot) return fail('This holon has no Pot recorded', { holon: args.holon });
        const table = args.tableId ? rightsByRef(ctx.folded, args.tableId) : ctx.latest;
        if (!table) return fail('No such table', { holon: args.holon });
        const c = potCommitment(table.table, table.id);
        const signatures = args.tableId ? rootSignatures(ctx.entries, table.id) : ctx.signatures;
        return ok({
          success: true,
          holon: args.holon,
          tableId: table.id,
          status: table.status,
          domain: potDomain(ctx.pot.chainId, ctx.pot.address),
          types: POT_ROOT_TYPES,
          message: { epoch: c.epoch.toString(), root: c.root, tableRef: c.tableRef, tokens: c.tokens, totals: c.totals.map((t) => t.toString()) },
          postRootArgs: potPostRootArgs(c, orderSignatures(signatures)),
          signatures,
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_rights_sign_record',
    {
      description:
        'Record a wallet\'s EIP-712 signature over a published table: an attestation on the "flow_rights" log carrying the signer address and the signature. Counts toward the log\'s quorum like any attestation; the signatures are what `postRoot` takes. Wraps @holons/core/flows buildRightsSignature.',
      inputSchema: {
        holon: z.string(),
        tableId: z.string().describe('The published table\'s entry id.'),
        signer: z.string().describe('The wallet that signed, 0x address.'),
        signature: z.string().describe('The 65-byte signature, 0x hex.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const a = buildRightsSignature(args.tableId, { signer: args.signer, signature: args.signature });
        const event = await hs.append(args.holon, FLOW_RIGHTS_LENS, a.item, { refs: a.refs });
        return ok({ success: true, id: event.id, pubkey: event.pubkey, created_at: event.created_at });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_collect_args',
    {
      description:
        'The one-transaction collect for a party under a committed table: the positional `claim(partyId, to, token, cumulative, proof)` arguments of the Pot. Name the table the Pot\'s active root points at (its tableRef); default the latest committed table. Null when the table has no row for the party or the row has no payout address. Wraps @holons/core/flows potClaimArgs.',
      inputSchema: {
        holon: z.string(),
        party: z.string(),
        token: z.string().describe('Token address; the zero address for the chain\'s coin.'),
        tableId: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const ctx = await loadRights(hs, args.holon);
        if (!ctx.pot) return fail('This holon has no Pot recorded', { holon: args.holon });
        const table = args.tableId ? rightsByRef(ctx.folded, args.tableId) : ctx.latest;
        if (!table) return fail('No such table', { holon: args.holon });
        const a = potClaimArgs(table.table, args.party, args.token);
        return ok({ success: true, holon: args.holon, pot: ctx.pot, tableId: table.id, args: a && { ...a, cumulative: a.cumulative.toString() }, argList: a && [a.partyId, a.to, a.token, a.cumulative.toString(), a.proof] });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    'pot_payout_address',
    {
      description:
        'Read or set where a party is paid: the payout address on their own settings document (a holon with a Pot on the same chain is paid into it instead). With `address`, writes it; with address "" clears it. It applies at the next new moon. Wraps @holons/core/flows savePayoutAddress / payoutAddressOf.',
      inputSchema: {
        party: z.string().describe('The party (user id, personal holon id, or holon id).'),
        address: z.string().optional().describe('0x address to set; "" to clear; omit to read.'),
        chainId: z.number().int().positive().optional().describe('For reading: the chain a Pot of the party\'s own would count on.'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        if (args.address !== undefined) await savePayoutAddress(hs, args.party, args.address || null);
        const settings = await hs.get(args.party, 'settings', args.party).catch(() => null);
        const pot = await loadPotRecord(hs, args.party);
        return ok({ success: true, party: args.party, address: payoutAddressOf(settings, args.chainId ?? pot?.chainId ?? 0), pot });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
