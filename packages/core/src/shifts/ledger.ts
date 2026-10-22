// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Shift signups in the REA ledger.
//
// A shift RSVP is a kind-31925 event published straight to the relays — it
// never passes through a HoloSphere lens, so the ledger projection behind
// `holosphere.put` cannot see it. This is the one explicit call a UI makes
// after a successful `publishRsvp`: an accepted signup is a `vf:Commitment`
// of the shift's hours (`shift:accepted`), and a cancellation retracts it.
// Stable per (occurrence, member), so a re-tap upserts.

import { REAEventFactory } from '../rea/event-factory.js';
import { REAEventStore } from '../rea/event-store.js';
import type { ShiftOccurrence, ShiftRsvpStatus } from './types.js';

/** The store surface the helper needs — a HoloSphere instance qualifies. */
export interface ShiftLedgerDB {
  put(holonId: string, lens: string, value: any, options?: any): Promise<unknown>;
  delete(holonId: string, lens: string, key: string, password?: any, options?: any): Promise<unknown>;
  get?(holonId: string, lens: string, key?: string): Promise<unknown>;
}

export interface ShiftRsvpLedgerInput {
  occurrence: Pick<ShiftOccurrence, 'dTag' | 'title' | 'start' | 'end'>;
  member: { id: string | number; username?: string; first_name?: string };
  status: ShiftRsvpStatus;
  /** Instant of the signup (ms); defaults to now. */
  at?: number;
}

/** Ledger id of the commitment for (occurrence, member). */
export function shiftCommitmentId(
  holonId: string | number,
  occurrence: Pick<ShiftOccurrence, 'dTag'>,
  memberId: string | number,
): string {
  return REAEventFactory.stableEventId(holonId, 'shift_accepted', occurrence.dTag, memberId);
}

/**
 * Record (or retract) a member's signup for a shift occurrence. Best-effort
 * like the rest of the ledger: failures are returned, never thrown, so the
 * relay publish that already succeeded stays the user-visible outcome.
 */
export async function recordShiftRsvp(
  db: ShiftLedgerDB,
  holonId: string | number,
  input: ShiftRsvpLedgerInput,
): Promise<{ ok: boolean; id: string; error?: string }> {
  const holon = String(holonId);
  const id = shiftCommitmentId(holon, input.occurrence, input.member.id);
  try {
    if (input.status === 'accepted') {
      const event = REAEventFactory.shiftAccepted(
        holon,
        input.member,
        {
          id: input.occurrence.dTag,
          title: input.occurrence.title,
          start: input.occurrence.start,
          end: input.occurrence.end,
        },
        { at: input.at },
      );
      await new REAEventStore(db as never).put(holon, event);
    } else {
      await db.delete(holon, 'rea_events', id);
    }
    return { ok: true, id };
  } catch (err) {
    return { ok: false, id, error: (err as Error)?.message ?? String(err) };
  }
}
