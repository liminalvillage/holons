// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two-sided handoff, as shared domain machinery.
 *
 * A handoff confirmation is persisted as its OWN record on the owner holon's
 * quests lens (`<needId>~handoff~<party>`) rather than as a nested-field
 * update on the need: new records replicate reliably across devices, nested
 * merges on a shared record do not. Every surface that wants to participate
 * in a handoff — WeQuest, the web dashboard, MCP, the bot — folds these
 * records back into the need's `handoff` state with the helpers here, then
 * lets `recordHandoffConfirmation` validate (claimed status, code match,
 * per-side idempotency).
 */

import {
  NEED_RECORD_LENS,
  type HandoffState,
  type PublishedNeed,
} from './types.js';
import {
  handoffCode,
  recordHandoffConfirmation,
  type HandoffConfirmResult,
  type HandoffParty,
} from './responses.js';

export const HANDOFF_CONFIRM_TYPE = 'handoff-confirm';

export interface HandoffConfirmationRecord {
  id: string;
  type: typeof HANDOFF_CONFIRM_TYPE;
  needId: string;
  party: HandoffParty;
  /** ISO timestamp of the confirmation. */
  at: string;
}

/** Per-need view of which sides have confirmed, folded from the records. */
export type HandoffConfirmations = Record<
  string,
  { requesterAt?: string; providerAt?: string }
>;

/** Stable id of one side's confirmation record. */
export function handoffConfirmationId(needId: string, party: HandoffParty): string {
  return `${needId}~handoff~${party}`;
}

/** Build the confirmation record one side persists to the owner holon. */
export function buildHandoffConfirmation(
  needId: string,
  party: HandoffParty,
  now: number = Date.now()
): HandoffConfirmationRecord {
  return {
    id: handoffConfirmationId(needId, party),
    type: HANDOFF_CONFIRM_TYPE,
    needId,
    party,
    at: new Date(now).toISOString(),
  };
}

export function isHandoffConfirmation(rec: unknown): rec is HandoffConfirmationRecord {
  const r = rec as HandoffConfirmationRecord | null;
  return Boolean(
    r &&
      r.type === HANDOFF_CONFIRM_TYPE &&
      r.needId &&
      (r.party === 'requester' || r.party === 'provider')
  );
}

/**
 * Fold a lens's worth of records into per-need confirmation state. Non-confirm
 * records are ignored, so callers can pass the whole quests lens.
 */
export function foldHandoffConfirmations(records: unknown[]): HandoffConfirmations {
  const map: HandoffConfirmations = {};
  for (const rec of records ?? []) {
    if (!isHandoffConfirmation(rec)) continue;
    const entry = (map[String(rec.needId)] ??= {});
    if (rec.party === 'requester') entry.requesterAt = String(rec.at ?? '');
    else entry.providerAt = String(rec.at ?? '');
  }
  return map;
}

/**
 * Merge replicated confirmation records into the need's `handoff` state so
 * `recordHandoffConfirmation` can validate against the full picture. Needs
 * claimed before codes were minted at claim time fall back to the legacy
 * id-derived code so their in-flight handoffs still complete.
 */
export function withHandoffConfirmations(
  need: PublishedNeed,
  confirmations: HandoffConfirmations,
  opts: { key?: string } = {}
): PublishedNeed {
  const entry = confirmations[String(opts.key ?? need.id ?? '')] ?? {};
  const handoff: HandoffState = {
    code: need.handoff?.code ?? handoffCode(opts.key ?? need.id ?? ''),
    ...(need.handoff?.requesterAt ? { requesterAt: need.handoff.requesterAt } : {}),
    ...(need.handoff?.providerAt ? { providerAt: need.handoff.providerAt } : {}),
    ...(entry.requesterAt ? { requesterAt: entry.requesterAt } : {}),
    ...(entry.providerAt ? { providerAt: entry.providerAt } : {}),
  };
  return { ...need, handoff };
}

/** Minimal store surface for persisting a confirmation record. */
export interface HandoffStoreLike {
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}

export interface ConfirmNeedHandoffOptions {
  /** The code the provider typed (required for the provider side). */
  code?: string;
  now?: number;
  /**
   * Already-folded confirmation records for this lens (from
   * `foldHandoffConfirmations`). Optional — without it only the need's own
   * `handoff` state is considered.
   */
  confirmations?: HandoffConfirmations;
  /**
   * The need's key on the OWNER holon (`sourceRef(...).key` for a record
   * reached through federation/holograms). Defaults to `need.id`.
   */
  key?: string;
}

export interface ConfirmNeedHandoffResult extends HandoffConfirmResult {
  /** The confirmation record persisted for this side (when ok). */
  record?: HandoffConfirmationRecord;
}

/**
 * One side confirms the handoff: validate against the folded confirmation
 * state, then persist this side's confirmation record to the owner holon.
 * When `both` flips true the caller settles (see `settleNeedHandoff`).
 */
export async function confirmNeedHandoff(
  db: HandoffStoreLike,
  ownerHolonId: string,
  need: PublishedNeed,
  party: HandoffParty,
  opts: ConfirmNeedHandoffOptions = {}
): Promise<ConfirmNeedHandoffResult> {
  const key = String(opts.key ?? need.id ?? '');
  const merged = withHandoffConfirmations(need, opts.confirmations ?? {}, { key });
  const result = recordHandoffConfirmation(merged, party, {
    code: opts.code,
    now: opts.now,
  });
  if (!result.ok) return result;

  const record = buildHandoffConfirmation(key, party, opts.now);
  await db.put(ownerHolonId, NEED_RECORD_LENS, record);
  return { ...result, record };
}
