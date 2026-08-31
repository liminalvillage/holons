// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Shifts feed: community shifts in the Elinor format (NIP-52 style
// kind-31923 occurrences + kind-31925 signups, see docs/shifts-elinor.md)
// read from a Nostr relay via `@holons/core/shifts`. Unlike the lens boards
// this data does not live in Holosphere — the relay is the source of truth
// shared with the Elinor bot — so the feed is a periodic fetch, not a live
// subscription: the schedule changes on the scale of hours, not seconds.
//
// The `groupId` of a shift IS the holon id (both are the Telegram chat id),
// so the feed simply follows the displayed holon.

import {
  attestationNameMap,
  createShiftRelayClient,
  enrolledPubkeys,
  resolveRsvps,
  sortOccurrences,
  type ShiftOccurrence,
  type ShiftRelayClient,
  type ShiftRsvp,
  type ShiftRsvpStatus,
} from "@holons/core/shifts";
import { signerFromSecretKey } from "@holons/core/holosphere";
import { get, writable } from "svelte/store";
import { currentUser } from "./auth";
import { resolveShiftCoordinator, resolveShiftRelays } from "./config";
import { getSessionSecret } from "./sessionKey";
import {
  holonId,
  rawShifts,
  shiftNames,
  shiftsLoaded,
  shiftsPref,
} from "./stores";

/** How far ahead the board looks. Two weeks reads as "the schedule". */
export const SHIFT_HORIZON_DAYS = 14;

/** Re-fetch cadence — shifts are published days ahead, minutes is plenty. */
const REFRESH_MS = 5 * 60_000;

/**
 * Who this session can sign shift RSVPs as, or null (read-only board):
 *  - `server`: a Telegram login — /api/shifts/rsvp derives the member key
 *    (same pubkey as the bot's /shifts and the web) and signs server-side,
 *    so the key never touches this shared screen.
 *  - `local`: a key login (nsec / wallet) — the adopted in-memory session
 *    key signs right here; gone after a reload, like every adopted key.
 */
export const shiftSigner = writable<{
  pubkey: string;
  mode: "server" | "local";
} | null>(null);

// One lazily-created relay client shared by the feed and RSVP publishing.
let client: ShiftRelayClient | null = null;
function getClient(): ShiftRelayClient | null {
  const relays = resolveShiftRelays();
  if (!relays.length) return null;
  return (client ??= createShiftRelayClient({
    relays,
    coordinatorPubkey: resolveShiftCoordinator() ?? undefined,
  }));
}

// The feed's reload hook, bound while startShifts is live — lets an RSVP
// trigger a re-fetch so the board converges on the relay's resolved truth.
let refetchNow: (() => void) | null = null;

/**
 * Start following the displayed holon's shift schedule. Fetches on every
 * holon change and every REFRESH_MS; an explicit caretaker "off" for the tab
 * stands the feed down entirely (the default `auto` keeps it running so the
 * tab's visibility can follow the content, like the Library lens). Also
 * resolves who the logged-in user can sign RSVPs as (see `shiftSigner`).
 * Returns a teardown function.
 */
export function startShifts(): () => void {
  if (!resolveShiftRelays().length) return () => {};

  let seq = 0;

  async function load(id: string) {
    const my = ++seq;
    try {
      const c = getClient();
      if (!c) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const schedule = await c.fetchSchedule(id, {
        since: nowSec,
        until: nowSec + SHIFT_HORIZON_DAYS * 86_400,
      });
      // A newer load (holon switch, next tick) owns the store now.
      if (my !== seq || get(holonId) !== id) return;
      rawShifts.set(schedule);
      shiftsLoaded.set(true);
      // Participant names, from kind-31926 identity attestations (Elinor's
      // coordinator directory + any provider). Best-effort: a failed lookup
      // keeps the previous map and the view falls back to hex prefixes.
      const participants = [...new Set(schedule.rsvps.map((r) => r.pubkey))];
      if (participants.length) {
        try {
          const atts = await c.fetchAttestations({ participants });
          if (my !== seq) return;
          shiftNames.set(
            attestationNameMap(atts, {
              coordinatorPubkey: resolveShiftCoordinator() ?? undefined,
            }),
          );
        } catch (err) {
          console.warn("[kiosk] shift attestation fetch failed", err);
        }
      }
    } catch (err) {
      // A dead relay must not take the board down — the tab simply stays
      // hidden (auto) or shows its empty state (forced on).
      console.warn("[kiosk] shift schedule fetch failed", err);
      if (my === seq) shiftsLoaded.set(true);
    }
  }

  function refetch() {
    const id = get(holonId);
    if (id && get(shiftsPref) !== "off") void load(id);
  }
  refetchNow = refetch;

  // Resolve the RSVP signer whenever the identity changes. Key logins carry
  // their own in-memory secret (absent again after a reload — the board then
  // reads fine but can't sign); Telegram logins ask the server which derived
  // pubkey it would sign as, which doubles as "is signing configured here".
  let signerSeq = 0;
  async function resolveSigner(
    user: { id: number | string; provider: string } | null,
  ) {
    const my = ++signerSeq;
    if (!user) {
      shiftSigner.set(null);
      return;
    }
    if (user.provider !== "telegram") {
      shiftSigner.set(
        getSessionSecret() ? { pubkey: String(user.id), mode: "local" } : null,
      );
      return;
    }
    try {
      const res = await fetch("/api/shifts/rsvp");
      const body = res.ok ? await res.json() : null;
      if (my !== signerSeq) return;
      shiftSigner.set(
        body?.pubkey ? { pubkey: body.pubkey, mode: "server" } : null,
      );
    } catch {
      if (my === signerSeq) shiftSigner.set(null);
    }
  }

  const unsubHolon = holonId.subscribe((id) => {
    seq++; // invalidate any in-flight load for the previous holon
    rawShifts.set({ occurrences: [], rsvps: [] });
    shiftNames.set(new Map());
    shiftsLoaded.set(false);
    if (id && get(shiftsPref) !== "off") void load(id);
  });
  // Flipping the tab off clears the data (mirroring the lens subscriptions);
  // flipping it back on re-fetches.
  const unsubPref = shiftsPref.subscribe((pref) => {
    if (pref === "off") {
      seq++;
      rawShifts.set({ occurrences: [], rsvps: [] });
      shiftNames.set(new Map());
      shiftsLoaded.set(false);
    } else if (!get(shiftsLoaded)) {
      refetch();
    }
  });
  const unsubUser = currentUser.subscribe((u) => void resolveSigner(u));
  const timer = setInterval(refetch, REFRESH_MS);

  return () => {
    unsubHolon();
    unsubPref();
    unsubUser();
    clearInterval(timer);
    refetchNow = null;
    client?.close();
    client = null;
  };
}

/**
 * Sign and publish a signup/cancellation for the logged-in user, per the
 * resolved `shiftSigner`. The relay's resolved view lands with the next
 * fetch; meanwhile the new RSVP is folded into `rawShifts` optimistically so
 * the tap answers instantly. Throws with a human-readable message.
 */
export async function setShiftRsvp(
  occurrence: ShiftOccurrence,
  status: ShiftRsvpStatus,
): Promise<void> {
  const signer = get(shiftSigner);
  if (!signer) throw new Error("no signing identity for shifts");

  let pubkey = signer.pubkey;
  let createdAt = Math.floor(Date.now() / 1000);
  let id = `local-${createdAt}-${Math.random().toString(36).slice(2, 8)}`;

  if (signer.mode === "server") {
    const res = await fetch("/api/shifts/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: occurrence.address, status }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      throw new Error(body?.error || `signup failed (${res.status})`);
    }
    pubkey = body.pubkey;
    createdAt = body.createdAt ?? createdAt;
    id = body.id ?? id;
  } else {
    const secret = getSessionSecret();
    const c = getClient();
    if (!secret || !c) throw new Error("no signing identity for shifts");
    const { event, results } = await c.publishRsvp({
      occurrence,
      status,
      signer: signerFromSecretKey(secret),
    });
    if (!results.some((r) => r.status === "fulfilled")) {
      throw new Error("no relay accepted the signup");
    }
    createdAt = event.created_at;
    id = event.id;
  }

  rawShifts.update((s) => ({
    ...s,
    rsvps: mergeRsvps(s.rsvps, {
      pubkey,
      address: occurrence.address,
      dTag: occurrence.dTag.replace(/^shift-/, "rsvp-"),
      status,
      createdAt,
      id,
    }),
  }));
  refetchNow?.();
}

// ---------------------------------------------------------------------------
// Pure view-model helpers (no Svelte, no I/O — tested in shifts.test.ts)
// ---------------------------------------------------------------------------

/** One board row: a day and its shifts, in start order. */
export interface ShiftDay {
  /** `YYYY-MM-DD` of the occurrences' own (group-local) date. */
  iso: string;
  occurrences: ShiftOccurrence[];
}

/** Shifts that are still on: running now or yet to start. */
export function upcomingShifts(
  occurrences: ShiftOccurrence[],
  nowSec: number,
): ShiftOccurrence[] {
  return occurrences.filter((o) => o.end >= nowSec);
}

/**
 * Group occurrences into day rows, days ascending and each day's shifts in
 * start order. Keys on the occurrence's own `date` (from its d-tag) rather
 * than re-deriving a day from the timestamp, so a late shift never slides
 * onto the wrong row across a timezone edge.
 */
export function groupShiftsByDay(occurrences: ShiftOccurrence[]): ShiftDay[] {
  const byDay = new Map<string, ShiftOccurrence[]>();
  for (const occ of sortOccurrences(occurrences)) {
    const list = byDay.get(occ.date);
    if (list) list.push(occ);
    else byDay.set(occ.date, [occ]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([iso, occs]) => ({ iso, occurrences: occs }));
}

/**
 * Fold one fresh RSVP into a resolved set, newest-wins per (author,
 * address) — the same resolution the protocol applies, so the optimistic
 * update can never disagree with the next relay fetch.
 */
export function mergeRsvps(rsvps: ShiftRsvp[], next: ShiftRsvp): ShiftRsvp[] {
  return [...resolveRsvps([...rsvps, next]).values()];
}

/** Free spots on a shift, or null when it has no declared capacity. */
export function spotsLeft(
  occurrence: ShiftOccurrence,
  rsvps: Iterable<ShiftRsvp>,
): number | null {
  if (occurrence.capacity === undefined) return null;
  return Math.max(
    0,
    occurrence.capacity - enrolledPubkeys(occurrence, rsvps).length,
  );
}

/**
 * Display names of a shift's enrolled participants, capped for wall
 * readability: `shown` carries at most `max` entries (attested name or an
 * 8-hex prefix), `more` counts the rest.
 */
export function participantNames(
  occurrence: Pick<ShiftOccurrence, "address">,
  rsvps: Iterable<ShiftRsvp>,
  names: Map<string, string>,
  max = 4,
): { shown: string[]; more: number } {
  const enrolled = enrolledPubkeys(occurrence, rsvps);
  const shown = enrolled
    .slice(0, max)
    .map((pk) => names.get(pk) ?? `${pk.slice(0, 8)}…`);
  return { shown, more: Math.max(0, enrolled.length - max) };
}

/** Whether the shift is happening right now. */
export function isRunningNow(
  occurrence: Pick<ShiftOccurrence, "start" | "end">,
  nowSec: number,
): boolean {
  return occurrence.start <= nowSec && nowSec < occurrence.end;
}

/** Case-insensitive match of the header search over a shift's visible text. */
export function shiftMatchesQuery(
  occurrence: ShiftOccurrence,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [occurrence.title, occurrence.location ?? "", occurrence.code]
    .join(" ")
    .toLowerCase()
    .includes(q);
}
