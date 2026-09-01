// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Shifts feed: community shifts in the Elinor format (NIP-52 style
// kind-31923 occurrences + kind-31925 signups, see docs/shifts-elinor.md)
// read from a Nostr relay via `@holons/core/shifts`. Unlike the lens boards
// this data does not live in Holosphere — the relay is the source of truth
// shared with the Elinor bot — but it is still a LIVE feed: the board holds
// a relay subscription (`subscribeSchedule`), so a signup or cancel made in
// Elinor lands here the moment the relay pushes it. EVERYTHING the board
// shows rides that one subscription — occurrences, RSVPs, and the kind-31926
// attestations that yield participant names and the person-identity
// collapse. A slow re-subscribe heals anything a flaky connection missed.
//
// The `groupId` of a shift IS the holon id (both are the Telegram chat id),
// so the feed simply follows the displayed holon.

import {
  attestationIdentityMap,
  attestationNameMap,
  createShiftRelayClient,
  enrolledPubkeys,
  latestRsvpFor,
  resolveRsvps,
  sortOccurrences,
  type ShiftIdentityMap,
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
  shiftIdentity,
  shiftNames,
  shiftsLoaded,
  shiftsPref,
} from "./stores";

/** How far ahead the board looks. Two weeks reads as "the schedule". */
export const SHIFT_HORIZON_DAYS = 14;

/**
 * Belt-and-braces re-subscribe cadence. Updates arrive live over the relay
 * subscription; this only replays the backlog to heal anything a dropped
 * connection missed.
 */
const RESYNC_MS = 60 * 60_000;

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

// The feed's re-sync hook, bound while startShifts is live — lets an RSVP
// replay the backlog so the board converges on the relay's resolved truth
// even if the live push for it was missed.
let refetchNow: (() => void) | null = null;

/**
 * Start following the displayed holon's shift schedule LIVE: one relay
 * subscription per holon (see `subscribeSchedule` in @holons/core/shifts),
 * re-established on holon change and every RESYNC_MS. An explicit caretaker
 * "off" for the tab stands the feed down entirely (the default `auto` keeps
 * it running so the tab's visibility can follow the content, like the
 * Library lens). Also resolves who the logged-in user can sign RSVPs as
 * (see `shiftSigner`). Returns a teardown function.
 */
export function startShifts(): () => void {
  if (!resolveShiftRelays().length) return () => {};

  let seq = 0; // invalidates a replaced subscription's late callbacks
  let sub: { close(): void } | null = null;

  function stop() {
    sub?.close();
    sub = null;
  }

  function subscribe(id: string) {
    stop();
    const my = ++seq;
    const c = getClient();
    if (!c) return;
    sub = c.subscribeSchedule(id, {
      // Sliding window, re-evaluated at every emission: past shifts drop
      // off and newly published days slide in without re-subscribing.
      range: () => {
        const nowSec = Math.floor(Date.now() / 1000);
        return { since: nowSec, until: nowSec + SHIFT_HORIZON_DAYS * 86_400 };
      },
      onSchedule(schedule) {
        if (my !== seq) return;
        // Every store the board reads comes from this one emission:
        // occurrences and RSVPs, plus — from the kind-31926 attestations
        // riding the same subscription — participant names for the wall
        // and the person-identity collapse, so a cancel under the Elinor
        // key clears an accept under the Holons key the moment it lands.
        const opts = {
          coordinatorPubkey: resolveShiftCoordinator() ?? undefined,
        };
        rawShifts.set(schedule);
        shiftNames.set(attestationNameMap(schedule.attestations, opts));
        shiftIdentity.set(attestationIdentityMap(schedule.attestations, opts));
        shiftsLoaded.set(true);
      },
      onError(err) {
        // A dead relay must not take the board down — the tab simply stays
        // hidden (auto) or shows its empty state (forced on).
        console.warn("[kiosk] shift subscription failed", err);
        if (my === seq) shiftsLoaded.set(true);
      },
    });
  }

  function refetch() {
    const id = get(holonId);
    if (id && get(shiftsPref) !== "off") subscribe(id);
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

  function clear() {
    seq++; // orphan the previous subscription's late callbacks
    stop();
    rawShifts.set({ occurrences: [], rsvps: [] });
    shiftNames.set(new Map());
    shiftIdentity.set(new Map());
    shiftsLoaded.set(false);
  }

  const unsubHolon = holonId.subscribe((id) => {
    clear();
    if (id && get(shiftsPref) !== "off") subscribe(id);
  });
  // Flipping the tab off tears the subscription down and clears the data
  // (mirroring the lens subscriptions); flipping it back on re-subscribes.
  const unsubPref = shiftsPref.subscribe((pref) => {
    if (pref === "off") {
      clear();
    } else if (!get(shiftsLoaded)) {
      refetch();
    }
  });
  const unsubUser = currentUser.subscribe((u) => void resolveSigner(u));
  const timer = setInterval(refetch, RESYNC_MS);

  return () => {
    unsubHolon();
    unsubPref();
    unsubUser();
    clearInterval(timer);
    stop();
    refetchNow = null;
    client?.close();
    client = null;
  };
}

/**
 * Sign and publish a signup/cancellation for the logged-in user, per the
 * resolved `shiftSigner`. The live subscription will receive the event
 * back from the relay; meanwhile the new RSVP is folded into `rawShifts`
 * optimistically so the tap answers instantly, and a re-sync is kicked off
 * in case the push is missed. Throws with a human-readable message.
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
    // The subscription already holds the resolved truth — hand publishRsvp
    // the person's previous RSVP and the identity collapse from it, so no
    // extra relay round-trips are needed to out-timestamp a sibling key.
    const identity = get(shiftIdentity);
    const localSigner = signerFromSecretKey(secret);
    const { event, results } = await c.publishRsvp({
      occurrence,
      status,
      signer: localSigner,
      identity,
      previous: latestRsvpFor(
        occurrence,
        localSigner.pubkey,
        get(rawShifts).rsvps,
        identity,
      ),
    });
    if (!results.some((r) => r.status === "fulfilled")) {
      throw new Error("no relay accepted the signup");
    }
    createdAt = event.created_at;
    id = event.id;
  }

  rawShifts.update((s) => ({
    ...s,
    rsvps: mergeRsvps(
      s.rsvps,
      {
        pubkey,
        address: occurrence.address,
        dTag: occurrence.dTag.replace(/^shift-/, "rsvp-"),
        status,
        createdAt,
        id,
      },
      get(shiftIdentity),
    ),
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
 * Fold one fresh RSVP into a resolved set, newest-wins per person (per
 * author for unattested keys) — the same resolution the protocol applies,
 * so the optimistic update can never disagree with the next relay fetch.
 */
export function mergeRsvps(
  rsvps: ShiftRsvp[],
  next: ShiftRsvp,
  identity?: ShiftIdentityMap,
): ShiftRsvp[] {
  return [...resolveRsvps([...rsvps, next], identity).values()];
}

/** Free spots on a shift, or null when it has no declared capacity. */
export function spotsLeft(
  occurrence: ShiftOccurrence,
  rsvps: Iterable<ShiftRsvp>,
  identity?: ShiftIdentityMap,
): number | null {
  if (occurrence.capacity === undefined) return null;
  return Math.max(
    0,
    occurrence.capacity - enrolledPubkeys(occurrence, rsvps, identity).length,
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
  identity?: ShiftIdentityMap,
  max = 4,
): { shown: string[]; more: number } {
  const enrolled = enrolledPubkeys(occurrence, rsvps, identity);
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
