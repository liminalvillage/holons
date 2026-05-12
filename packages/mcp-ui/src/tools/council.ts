import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  agree,
  applyVote,
  block,
  castVote,
  createAndSaveProposal,
  createProposal,
  deleteProposal,
  deriveStatus,
  hasAgreed,
  hasBlocked,
  saveProposal,
  tallyVotes,
  PROPOSAL_LENS,
  type CreateProposalInput,
  type Proposal,
  type ProposalStore,
  type VoteEntry,
} from '@holons/core/council';
import type { ToolDeps } from './index.js';

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

function coerceVoter(raw: string): VoteEntry {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    return parseJSON<VoteEntry>(trimmed, 'voter');
  }
  const asNum = Number(trimmed);
  return Number.isFinite(asNum) && trimmed !== '' ? asNum : trimmed;
}

function entryIdOf(entry: VoteEntry): string | number | undefined {
  if (entry == null) return undefined;
  if (typeof entry === 'string' || typeof entry === 'number') return entry;
  if (typeof entry === 'object' && 'id' in entry) return (entry as { id: string | number }).id;
  return undefined;
}

/** Adapt a HoloSphere instance to the ProposalStore interface @holons/core expects. */
function holoSphereAsStore(hs: any): ProposalStore {
  return {
    put: (holonId, lens, data) => hs.put(holonId, lens, data),
    async get(holonId, lens, key) {
      const all = await hs.getAll(holonId, lens);
      if (all && typeof all === 'object' && key in all) return all[key] as Proposal;
      if (typeof hs.get === 'function') {
        try {
          const one = await hs.get(holonId, lens, key);
          return (one ?? null) as Proposal | null;
        } catch {
          return null;
        }
      }
      return null;
    },
    delete: (holonId, lens, key) =>
      typeof hs.delete === 'function'
        ? hs.delete(holonId, lens, key)
        : hs.put(holonId, lens, { id: key, _deleted: true }),
  };
}

async function withStore(deps: ToolDeps): Promise<ProposalStore> {
  return holoSphereAsStore(await deps.getHoloSphere());
}

export function registerCouncilTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'proposal_create',
    'Create a council proposal. If `persist` is true, also saves to holosphere under the shared `quests` lens.',
    {
      holon: z.string().describe('Holon id (chat id or holon address).'),
      title: z.string().describe('Proposal title.'),
      description: z.string().optional().describe('Optional proposal body.'),
      initiator: z
        .string()
        .describe('Voter JSON — either an object {id, first_name?, ...} or a bare id.'),
      proposalType: z
        .string()
        .optional()
        .describe('Optional proposal sub-type label (stored as `proposalType`).'),
      persist: z
        .boolean()
        .optional()
        .describe('If true, also save to holosphere. Defaults to false.'),
    },
    async ({ holon, title, description, initiator, proposalType, persist }) => {
      try {
        const base = createProposal({
          title,
          description,
          creator: coerceVoter(initiator),
        });
        const proposal: Proposal = proposalType ? { ...base, proposalType } : base;
        if (persist) {
          const store = await withStore(deps);
          await saveProposal(store, holon, proposal);
        }
        return ok({ proposal, persisted: Boolean(persist) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'proposal_save',
    'Persist a fully-formed proposal record to holosphere under the `quests` lens.',
    {
      holon: z.string().describe('Holon id.'),
      proposal: z.string().describe('Proposal JSON.'),
    },
    async ({ holon, proposal }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        const store = await withStore(deps);
        await saveProposal(store, holon, record);
        return ok({ holon, lens: PROPOSAL_LENS, id: record.id });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'proposal_delete',
    'Delete a proposal by id from holosphere.',
    {
      holon: z.string().describe('Holon id.'),
      proposalId: z.string().describe('Proposal id to delete.'),
    },
    async ({ holon, proposalId }) => {
      try {
        const store = await withStore(deps);
        await deleteProposal(store, holon, proposalId);
        return ok({ holon, proposalId, deleted: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'vote_cast',
    'Cast a vote on a proposal. Direction `agree` toggles support; `block` toggles a veto. `abstain` clears any prior vote from the voter (not natively supported by core — emulated by clearing both sides).',
    {
      holon: z.string().describe('Holon id.'),
      proposalId: z.string().describe('Target proposal id.'),
      voter: z.string().describe('Voter JSON or bare id.'),
      direction: z.enum(['agree', 'block', 'abstain']).describe('Vote direction.'),
      reason: z.string().optional().describe('Optional reason / comment.'),
    },
    async ({ holon, proposalId, voter, direction, reason }) => {
      try {
        const voterEntry = coerceVoter(voter);
        const store = await withStore(deps);
        let updated: Proposal | null;
        if (direction === 'abstain') {
          const current = await store.get(holon, PROPOSAL_LENS, proposalId);
          if (!current) return fail('proposal not found', { holon, proposalId });
          const targetId = entryIdOf(voterEntry);
          updated = {
            ...current,
            participants: (current.participants ?? []).filter((e) => entryIdOf(e) !== targetId),
            stoppers: (current.stoppers ?? []).filter((e) => entryIdOf(e) !== targetId),
          };
          await saveProposal(store, holon, updated);
        } else {
          updated = await castVote(store, holon, proposalId, voterEntry, direction);
        }
        if (!updated) return fail('proposal not found', { holon, proposalId });
        return ok({ proposal: updated, direction, reason: reason ?? null });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'vote_agree',
    'Convenience: cast an agree vote (toggles membership in `participants`).',
    {
      holon: z.string().describe('Holon id.'),
      proposalId: z.string().describe('Target proposal id.'),
      voter: z.string().describe('Voter JSON or bare id.'),
    },
    async ({ holon, proposalId, voter }) => {
      try {
        const store = await withStore(deps);
        const updated = await agree(store, holon, proposalId, coerceVoter(voter));
        if (!updated) return fail('proposal not found', { holon, proposalId });
        return ok({ proposal: updated });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'vote_block',
    'Convenience: cast a block (veto) vote (toggles membership in `stoppers`).',
    {
      holon: z.string().describe('Holon id.'),
      proposalId: z.string().describe('Target proposal id.'),
      voter: z.string().describe('Voter JSON or bare id.'),
      reason: z.string().optional().describe('Optional reason / comment.'),
    },
    async ({ holon, proposalId, voter, reason }) => {
      try {
        const store = await withStore(deps);
        const updated = await block(store, holon, proposalId, coerceVoter(voter));
        if (!updated) return fail('proposal not found', { holon, proposalId });
        return ok({ proposal: updated, reason: reason ?? null });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'vote_tally',
    'Pure tally — given a proposal JSON, return its current vote counts and derived status. No HoloSphere I/O.',
    {
      proposal: z.string().describe('Proposal JSON.'),
      quorum: z.number().int().positive().optional().describe('Quorum threshold (default 5).'),
    },
    async ({ proposal, quorum }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        const tally = tallyVotes(record, quorum);
        return ok({ tally });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_apply_vote',
    'Pure — apply a vote to a proposal JSON and return the updated record. Does not persist.',
    {
      proposal: z.string().describe('Proposal JSON.'),
      voter: z.string().describe('Voter JSON or bare id.'),
      direction: z.enum(['agree', 'block']).describe('Vote direction.'),
    },
    async ({ proposal, voter, direction }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        const next = applyVote(record, coerceVoter(voter), direction);
        return ok({ proposal: next });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_derive_status',
    'Pure — derive the lifecycle status (`ongoing` / `stopped` / `completed`) from a proposal JSON.',
    {
      proposal: z.string().describe('Proposal JSON.'),
    },
    async ({ proposal }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        return ok({ status: deriveStatus(record) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_has_agreed',
    'Pure predicate — has the given voter agreed to the proposal?',
    {
      proposal: z.string().describe('Proposal JSON.'),
      voter: z.string().describe('Voter JSON or bare id.'),
    },
    async ({ proposal, voter }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        return ok({ agreed: hasAgreed(record, coerceVoter(voter)) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_has_blocked',
    'Pure predicate — has the given voter blocked (vetoed) the proposal?',
    {
      proposal: z.string().describe('Proposal JSON.'),
      voter: z.string().describe('Voter JSON or bare id.'),
    },
    async ({ proposal, voter }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        return ok({ blocked: hasBlocked(record, coerceVoter(voter)) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_save_proposal',
    'Persist a fully-formed proposal record via the shared core helper (HoloSphere under the `quests` lens).',
    {
      holon: z.string().describe('Holon id.'),
      proposal: z.string().describe('Proposal JSON.'),
    },
    async ({ holon, proposal }) => {
      try {
        const record = parseJSON<Proposal>(proposal, 'proposal');
        const store = await withStore(deps);
        await saveProposal(store, holon, record);
        return ok({ holon, lens: PROPOSAL_LENS, id: record.id });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );

  server.tool(
    'council_create_and_save_proposal',
    'Create a proposal from a `CreateProposalInput` JSON and persist it in one call.',
    {
      holon: z.string().describe('Holon id.'),
      input: z
        .string()
        .describe('CreateProposalInput JSON ({title, description?, creator?, date?, id?}).'),
    },
    async ({ holon, input }) => {
      try {
        const parsed = parseJSON<CreateProposalInput>(input, 'input');
        const store = await withStore(deps);
        const proposal = await createAndSaveProposal(store, holon, parsed);
        return ok({ holon, lens: PROPOSAL_LENS, proposal });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  );
}
