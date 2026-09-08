// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The Shifts feed: community shifts in the Elinor format (NIP-52 style
// kind-31923 occurrences + kind-31925 signups, see docs/shifts-elinor.md).
//
// This IS a lens board now. The wires in `@holons/core/shifts` decode those
// events into Holosphere records, so the schedule comes from `shifts`,
// `shifts_rsvp` and the global `shift_identity` directory rather than from a
// relay subscription of this module's own. A signup or cancel made in Elinor
// lands as the relay pushes it into the lens, and a reload paints from
// IndexedDB instead of waiting on a round trip.
//
// Publishing a signup still speaks the protocol directly: its rule — newest
// across a person's linked keys — is not a per-address write, and the lens is
// read-only on its wire.
//
// The `groupId` of a shift IS the holon id (both are the Telegram chat id),
// so the feed simply follows the displayed holon.

import {
  SHIFTS_LENS,
  SHIFT_IDENTITY_LENS,
  SHIFT_RSVP_LENS,
  addDays,
  attestationIdentityMap,
  attestationNameMap,
  attestationsFrom,
  coverageOf,
  createShiftRelayClient,
  enrolledPubkeys,
  expectedShifts,
  latestRsvpFor,
  loadShiftPlan,
  localToUnix,
  reconcileSchedule,
  resolveRsvps,
  saveShiftPlan,
  sortOccurrences,
  toOccurrence,
  toRsvp,
  todayIn,
  type ExpectedShift,
  type ShiftCoverage,
  type ShiftCoverageSummary,
  type ShiftIdentityMap,
  type ShiftIdentityRecord,
  type ShiftOccurrence,
  type ShiftPlan,
  type ShiftRecord,
  type ShiftRelayClient,
  type ShiftRsvp,
  type ShiftRsvpRecord,
  type ShiftRsvpStatus,
} from "@holons/core/shifts";
import { signerFromSecretKey } from "@holons/core/holosphere";
import type { HoloSphere } from "holosphere";
import { get, writable } from "svelte/store";
import { currentUser } from "./auth";
import { resolveShiftCoordinator, resolveShiftRelays } from "./config";
import { getHolosphere, getReaStore, subscribeLens } from "./holosphere";
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

/**
 * The coordinator this deploy publishes occurrences as (see
 * /api/shifts/occurrence): its pubkey, and whether the logged-in session is
 * allowed to drive it. Null until asked, or when the server has no
 * derivation secret — the board is then read-only for the coordinator.
 */
export const shiftCoordinator = writable<{
  pubkey: string;
  allowed: boolean;
  reason?: string;
} | null>(null);

/**
 * The displayed holon's shift PLAN — the catalog its occurrences are
 * materialised from, kept on the settings record ($lib/shifts owns the
 * load; ShiftSettings edits and saves it). Null while unread or when the
 * holon has none yet.
 */
export const shiftPlan = writable<ShiftPlan | null>(null);
export const shiftPlanLoaded = writable<boolean>(false);

// Publishing only. The feed is lens data now; a signup still goes out through
// the protocol, because the rule behind it — newest across a person's linked
// keys — is not a per-address write and the generic path would get it wrong.
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
 * Start following the displayed holon's shift schedule LIVE.
 *
 * The schedule is now ORDINARY LENS DATA. Occurrences, signups and the
 * kind-31926 identity directory are decoded by the wires in
 * `@holons/core/shifts` and read through Holosphere like quests or roles, so
 * this holds no relay subscription of its own: the store is the source, a
 * reload paints from IndexedDB, and the same records are available to every
 * other surface. Only PUBLISHING a signup still speaks the protocol directly,
 * because the person-level rule behind it is not a per-address write.
 *
 * Re-established on holon change and every RESYNC_MS. An explicit caretaker
 * "off" for the tab stands the feed down entirely (the default `auto` keeps
 * it running so the tab's visibility can follow the content, like the
 * Library lens). Also resolves who the logged-in user can sign RSVPs as
 * (see `shiftSigner`). Returns a teardown function.
 */
export function startShifts(): () => void {
  // No shift-relay gate any more: the feed is lens data over the ordinary
  // relays. `VITE_KIOSK_SHIFT_RELAYS` now governs only where a signup is
  // PUBLISHED, and `getClient` already degrades to a read-only board when it
  // is unset. The caretaker's `off` remains the way to stand the tab down.
  let seq = 0; // invalidates a replaced subscription's late callbacks
  let sub: { close(): void } | null = null;

  function stop() {
    sub?.close();
    sub = null;
  }

  function subscribe(id: string) {
    stop();
    const my = ++seq;
    const opts = { coordinatorPubkey: resolveShiftCoordinator() ?? undefined };

    let occurrences: ShiftRecord[] = [];
    let signups: ShiftRsvpRecord[] = [];
    let directory: ShiftIdentityRecord[] = [];
    // The lenses stream from the store the moment they are subscribed, so the
    // board would otherwise flash its empty state before the relay has been
    // reached. `loaded` flips only once the first sync settles.
    let loaded = false;

    const emit = () => {
      if (my !== seq) return;
      const nowSec = Math.floor(Date.now() / 1000);
      const until = nowSec + SHIFT_HORIZON_DAYS * 86_400;
      const atts = attestationsFrom(directory);
      rawShifts.set({
        // The horizon is applied here rather than in the subscription: a lens
        // holds the whole schedule, and re-filtering on every emission is what
        // lets past shifts drop off and new days slide in without
        // re-subscribing.
        occurrences: sortOccurrences(
          occurrences
            // A shift that is running now stays on the wall (the board
            // badges it "Now"); it drops off once it has ended.
            .filter((o) => o.end >= nowSec && o.start <= until)
            .map(toOccurrence),
        ),
        // A request published on someone's behalf is not occupancy — the real
        // signup follows under that member's own key.
        rsvps: signups.filter((r) => !r.request).map(toRsvp),
      });
      shiftNames.set(attestationNameMap(atts, opts));
      shiftIdentity.set(attestationIdentityMap(atts, opts));
      if (loaded) shiftsLoaded.set(true);
    };

    void (async () => {
      let hs;
      try {
        hs = await getHolosphere();
      } catch (err) {
        // An unreachable relay must not take the board down — the tab simply
        // stays hidden (auto) or shows its empty state (forced on).
        console.warn("[kiosk] shifts unavailable", err);
        if (my === seq) shiftsLoaded.set(true);
        return;
      }
      if (my !== seq) return;

      const subs = [
        subscribeLens<ShiftRecord>(hs, id, SHIFTS_LENS, (items) => {
          occurrences = items;
          emit();
        }),
        subscribeLens<ShiftRsvpRecord>(hs, id, SHIFT_RSVP_LENS, (items) => {
          signups = items;
          emit();
        }),
      ];
      sub = {
        close() {
          for (const s of subs) s.unsubscribe();
        },
      };

      try {
        // Awaiting a read is what waits for the relay sync. The identity
        // directory is global — one attestation serves every board a person
        // appears on — and changes rarely, so it is read rather than followed.
        directory = (await hs.getAllGlobal(
          SHIFT_IDENTITY_LENS,
        )) as ShiftIdentityRecord[];
      } catch (err) {
        console.warn("[kiosk] shift identities unavailable", err);
      }
      if (my !== seq) return;
      loaded = true;
      emit();
      void loadPlanFor(id, hs);
    })();
  }

  // The plan rides the holon's settings record: read once per subscription
  // (an edit here saves and re-sets the store itself).
  let planSeq = 0;
  async function loadPlanFor(id: string, hs: HoloSphere) {
    const my = ++planSeq;
    try {
      const plan = await loadShiftPlan(
        { get: (h, l, k) => hs.get(h, l, String(k ?? h)) },
        id,
      );
      if (my !== planSeq || get(holonId) !== id) return;
      shiftPlan.set(plan);
    } catch (err) {
      console.warn("[kiosk] shift plan unavailable", err);
    } finally {
      if (my === planSeq) shiftPlanLoaded.set(true);
    }
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
      // The coordinator is a service identity — a key login cannot drive it,
      // but the board still wants its pubkey to tell "ours" from foreign.
      void resolveCoordinator(my);
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
    void resolveCoordinator(my);
  }

  async function resolveCoordinator(my: number) {
    try {
      const res = await fetch("/api/shifts/occurrence");
      const body = res.ok ? await res.json() : null;
      if (my !== signerSeq) return;
      shiftCoordinator.set(
        body?.pubkey
          ? {
              pubkey: String(body.pubkey),
              allowed: body.allowed === true,
              ...(body.reason ? { reason: String(body.reason) } : {}),
            }
          : null,
      );
    } catch {
      if (my === signerSeq) shiftCoordinator.set(null);
    }
  }

  function clear() {
    seq++; // orphan the previous subscription's late callbacks
    planSeq++;
    stop();
    rawShifts.set({ occurrences: [], rsvps: [] });
    shiftNames.set(new Map());
    shiftIdentity.set(new Map());
    shiftsLoaded.set(false);
    shiftPlan.set(null);
    shiftPlanLoaded.set(false);
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
  const unsubUser = currentUser.subscribe((u) => {
    if (!u) shiftCoordinator.set(null);
    void resolveSigner(u);
  });
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
// The coordinator's actions — plan, publish, retract
// ---------------------------------------------------------------------------

/**
 * Save the displayed holon's plan onto its settings record (through the
 * REA store so the logged-in user is the acting identity) and reflect it.
 */
export async function saveShiftPlanFor(
  holon: string,
  plan: ShiftPlan,
): Promise<ShiftPlan> {
  const store = await getReaStore();
  const saved = await saveShiftPlan(
    {
      get: (h, l, k) => store.get(h, l, k),
      put: (h, l, v) => store.put(h, l, v),
    },
    holon,
    plan,
  );
  if (get(holonId) === holon) shiftPlan.set(saved);
  return saved;
}

/** What the server needs to publish one occurrence. */
export interface OccurrenceInput {
  groupId: string;
  date: string;
  code: string;
  title: string;
  start: number;
  end: number;
  tzid?: string;
  location?: string;
  capacity?: number;
  description?: string;
  timeRange?: string;
}

/** An expected slot as the publish payload. */
export function occurrenceInputOf(
  groupId: string,
  e: ExpectedShift,
): OccurrenceInput {
  return {
    groupId,
    date: e.date,
    code: e.code,
    title: e.title,
    start: e.start,
    end: e.end,
    tzid: e.tzid,
    ...(e.location ? { location: e.location } : {}),
    capacity: e.capacity,
    ...(e.description ? { description: e.description } : {}),
    timeRange: e.timeRange,
  };
}

/**
 * Publish (or republish — addressable events replace) occurrences as the
 * deployment's coordinator. The relay pushes them back into the lens;
 * meanwhile they are folded into `rawShifts` so the wall updates at once.
 * Resolves with what landed; throws when nothing did.
 */
export async function publishShiftOccurrences(
  inputs: OccurrenceInput[],
): Promise<{
  published: ShiftOccurrence[];
  failed: { key: string; error: string }[];
}> {
  if (!inputs.length) return { published: [], failed: [] };
  const res = await fetch("/api/shifts/occurrence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ occurrences: inputs }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(
      body?.error ||
        body?.failed?.[0]?.error ||
        `publishing failed (${res.status})`,
    );
  }
  const published = (body.published ?? []) as ShiftOccurrence[];
  rawShifts.update((s) => ({
    ...s,
    occurrences: mergeOccurrences(s.occurrences, published),
  }));
  refetchNow?.();
  return { published, failed: body.failed ?? [] };
}

/**
 * Retract occurrences (NIP-09) as the coordinator. They vanish from the
 * wall immediately; the relay's kind 5 turns the lens records into
 * tombstones when it comes back.
 */
export async function retractShiftOccurrences(
  occurrences: ShiftOccurrence[],
  reason?: string,
): Promise<void> {
  if (!occurrences.length) return;
  const res = await fetch("/api/shifts/occurrence", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      occurrences: occurrences.map((o) => ({ address: o.address, id: o.id })),
      ...(reason ? { reason } : {}),
    }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error || `retraction failed (${res.status})`);
  }
  const gone = new Set(occurrences.map((o) => o.address));
  rawShifts.update((s) => ({
    occurrences: s.occurrences.filter((o) => !gone.has(o.address)),
    rsvps: s.rsvps.filter((r) => !gone.has(r.address)),
  }));
  refetchNow?.();
}

// ---------------------------------------------------------------------------
// Pure view-model helpers (no Svelte, no I/O — tested in shifts.test.ts)
// ---------------------------------------------------------------------------

/** Fold freshly published occurrences into the set, newest per address. */
export function mergeOccurrences(
  occurrences: ShiftOccurrence[],
  next: ShiftOccurrence[],
): ShiftOccurrence[] {
  const byAddr = new Map(occurrences.map((o) => [o.address, o]));
  for (const o of next) {
    const prev = byAddr.get(o.address);
    if (!prev || o.createdAt >= prev.createdAt) byAddr.set(o.address, o);
  }
  return sortOccurrences([...byAddr.values()]);
}

/**
 * The plan lined up against the live schedule over the next `days` days
 * (from today in the plan's zone): every slot the plan expects, published
 * or not, plus published shifts the plan no longer expects. This is what
 * the configuration preview draws, so a caretaker sees exactly the wall
 * the kiosk will show — with the gaps.
 */
export function planCoverage(
  plan: ShiftPlan,
  groupId: string,
  occurrences: ShiftOccurrence[],
  rsvps: ShiftRsvp[],
  opts: {
    identity?: ShiftIdentityMap;
    coordinatorPubkey?: string;
    days?: number;
    now?: Date;
  } = {},
): { items: ShiftCoverage[]; summary: ShiftCoverageSummary; from: string } {
  const now = opts.now ?? new Date();
  const from = todayIn(plan.tzid, now);
  const days = opts.days ?? plan.horizonDays;
  const expected = expectedShifts(plan, groupId, from, days);
  const nowSec = Math.floor(now.getTime() / 1000);
  // The far side is midnight after the last day IN THE PLAN'S ZONE, so a
  // published shift beyond the slice is out of view rather than "stale".
  const untilSec = localToUnix(addDays(from, days), "00:00", plan.tzid) - 1;
  const { items, summary } = reconcileSchedule(expected, occurrences, rsvps, {
    identity: opts.identity,
    coordinatorPubkey: opts.coordinatorPubkey,
    // Slots already over are neither missing nor publishable.
    window: { since: nowSec, until: untilSec },
  });
  return { items, summary, from };
}

/** Coverage rows grouped into day rows, like the board. */
export function groupCoverageByDay(
  items: ShiftCoverage[],
): { iso: string; items: ShiftCoverage[] }[] {
  const byDay = new Map<string, ShiftCoverage[]>();
  for (const it of items) {
    const list = byDay.get(it.date);
    if (list) list.push(it);
    else byDay.set(it.date, [it]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([iso, list]) => ({ iso, items: list }));
}

/**
 * The wall's headline: across the shown occurrences, how many are still
 * short of hands and how many have nobody at all.
 */
export function boardSummary(
  occurrences: ShiftOccurrence[],
  rsvps: ShiftRsvp[],
  identity?: ShiftIdentityMap,
): { shifts: number; unstaffed: number; short: number; spotsOpen: number } {
  let unstaffed = 0;
  let short = 0;
  let spotsOpen = 0;
  for (const o of occurrences) {
    const c = coverageOf(o, rsvps, identity);
    if (c.state === "unstaffed") unstaffed++;
    else if (c.state === "short") short++;
    spotsOpen += c.missing;
  }
  return { shifts: occurrences.length, unstaffed, short, spotsOpen };
}

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
