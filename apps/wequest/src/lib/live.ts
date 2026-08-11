// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// WeQuest live data layer — every screen reads and writes through Holosphere
// via @holons/core, exactly like the web dashboard and kiosk:
//
//   list      → (holon, 'checklists', 'shopping')   @holons/core/shopping
//   needs     → (holon, 'quests') type:'need'       @holons/core/needs
//   map heat  → (cell, 'needs') holograms           publishNeedNearby
//   responses → embedded on the need, sourceRef-routed writes
//   wallet    → (holon, 'expenses') hour balance + rea_events scoring
//   coop      → (holon, 'users'), open-need demand, quests type:'proposal'
//   barter    → federation links (snapshot)
//
// Components render stores from here and call the exported actions; they
// never touch Holosphere directly.

import { derived, get, writable } from "svelte/store";
import type { HoloSphere } from "holosphere";
import {
  addItem as shoppingAddItem,
  toggleItem as shoppingToggleItem,
  normalizeChecklist,
  createEmptyChecklist,
  stampNeedId,
  needIdOf,
  CHECKLISTS_COLLECTION,
  SHOPPING_KEY,
  type ShoppingChecklist,
  type ShoppingItem,
} from "@holons/core/shopping";
import {
  needFromShoppingItem,
  normalizeNeed,
  respondToNeed,
  claimNeed,
  closeNeed,
  foldHandoffConfirmations,
  confirmNeedHandoff,
  settleNeedHandoff,
  publishNeedNearby,
  refreshPublishedNeed,
  foldNeedRatings,
  rateNeedHandoff,
  reputationByUser,
  reputationOf,
  NEEDS_LENS,
  NEED_RECORD_LENS,
  OPEN_NEED_STATUSES,
  type HandoffParty,
  type PublishedNeed,
} from "@holons/core/needs";
import {
  classifyMarketItem,
  createMarketItem,
  deleteTaskWithCascade,
} from "@holons/core/tasks";
import { REAEventStore } from "@holons/core/rea";
import { sourceRef } from "@holons/core/holosphere";
import {
  readSettingsHex,
  getFederationSnapshot,
  publishToFederation,
  setFederationPartner,
  removeFederationPartner,
} from "@holons/core/federation";
import {
  computeUserCurrencyBalance,
  type Expense,
} from "@holons/core/expenses";
import { REAAggregator, computeHolonUserScores } from "@holons/core/scoring";
import { ensureUserProfile } from "@holons/core/users";
import { getHolosphere, actingAs, putAs } from "./holosphere";
import { resolveHolon, resolveUserId, resolveUsername } from "./config";
import { neighborhood, projectCells, type ProjectedCell } from "./geomap";
import { flash } from "./stores";

// ── raw state ─────────────────────────────────────────────────────────────

export const holonId = writable<string>("");
export const holonName = writable<string>("");
export const settingsHex = writable<string | null>(null);
export const ready = writable(false);

export const rawQuests = writable<any[]>([]);
export const rawChecklists = writable<any[]>([]);
export const rawUsers = writable<any[]>([]);
export const rawExpenses = writable<any[]>([]);
export const partners = writable<Array<{ id: string; name: string }>>([]);
/** Open needs per hex cell of the neighbourhood — count, titles, and the
 *  resolved records themselves (tappable → answerable). */
export const cellHeat = writable<
  Record<string, { count: number; tags: string[]; needs: PublishedNeed[] }>
>({});
export const mapCells = writable<ProjectedCell[]>([]);
/** The need currently open in the quest screen. */
export const selectedNeed = writable<any | null>(null);

const subs: Array<{ unsubscribe: () => void }> = [];
let initedFor = "";
/** The quests stream, kept addressable so federation changes can re-attach it. */
let questsSub: {
  unsubscribe: () => void;
  setFederated?: (on: boolean) => void;
} | null = null;

// Keep the open quest screen fresh: when the live graph updates the record
// being looked at (a response arrives, the other side confirms the handoff),
// fold it into the selection — preserving the read-side envelopes that route
// foreign writes.
rawQuests.subscribe(($q) => {
  const cur = get(selectedNeed);
  if (!cur?.id) return;
  const upd = $q.find((r: any) => r && String(r.id) === String(cur.id));
  if (!upd) return;
  selectedNeed.set({
    ...upd,
    _federation: upd._federation ?? cur._federation,
    _hologram: upd._hologram ?? cur._hologram,
  });
});

// Deterministic finalizer. Confirmations replicate with a lag, so the side
// that confirms second may not yet SEE the other's — the REQUESTER's client
// (it owns the record's holon and always receives both confirm records)
// completes the handoff exactly once when both are present.
const finalized = new Set<string>();

rawQuests.subscribe(($q) => {
  const me = resolveUserId();
  if (!me) return;
  // Confirm records straight from this emit — self-contained on purpose (the
  // derived store isn't initialized when this subscription first fires).
  const confirms = foldHandoffConfirmations($q);
  for (const r of $q) {
    if (!r || r.type !== "need" || r.status !== "claimed") continue;
    if (isForeign(r)) continue;
    if (String(r.initiator?.id ?? "") !== me) continue;
    const key = String(r.id);
    const c = confirms[key];
    if (!c?.requesterAt || !c?.providerAt) continue;
    if (finalized.has(key)) continue;
    finalized.add(key);
    void (async () => {
      const hs = await getHolosphere();
      const need = normalizeNeed(r);
      if (need) await settleAndReport(hs, get(holonId), need);
    })();
  }
});

// Karma follows the ledger: when an hour expense lands (a settlement
// happened, possibly finalized by the other side), refresh the score.
let karmaTimer: ReturnType<typeof setTimeout> | undefined;
let lastExpenseCount = -1;
rawExpenses.subscribe(($e) => {
  if ($e.length === lastExpenseCount) return;
  lastExpenseCount = $e.length;
  clearTimeout(karmaTimer);
  karmaTimer = setTimeout(async () => {
    const holon = get(holonId);
    if (holon) void recomputeKarma(await getHolosphere(), holon);
  }, 2000);
});

// ── derived viewmodels ────────────────────────────────────────────────────

function isForeign(rec: any): boolean {
  return Boolean(rec?._federation?.origin || rec?._hologram?.isHologram);
}

function isOpen(need: PublishedNeed): boolean {
  return OPEN_NEED_STATUSES.includes(need.status);
}

/** This holon's own needs (the list's demand signal), newest first. */
export const myNeeds = derived(rawQuests, ($q) =>
  $q
    .filter((r) => !isForeign(r) && r?.type === "need")
    .map((r) => normalizeNeed(r))
    .filter((n): n is PublishedNeed => n != null)
    .sort((a, b) =>
      String(b.created ?? "").localeCompare(String(a.created ?? "")),
    ),
);

/** Open needs/requests from federation partners — "needs you could answer". */
export const foreignNeeds = derived(rawQuests, ($q): PublishedNeed[] =>
  $q
    .filter((r) => isForeign(r))
    .filter((r) => {
      const kind = classifyMarketItem(r);
      return kind === "need" || kind === "request";
    })
    .map((r): PublishedNeed | null => {
      const n = normalizeNeed({ ...r, type: "need" });
      if (!n) return null;
      return {
        ...n,
        _federation: r._federation,
        _hologram: r._hologram,
      } as PublishedNeed;
    })
    .filter((n): n is PublishedNeed => n != null && isOpen(n)),
);

/**
 * "I can provide", complete: partner-federated needs plus the ones sitting on
 * neighbouring hex cells — previously the map cells were the only way to
 * reach the latter. Own needs and duplicates are dropped.
 */
export const provideFeed = derived(
  [foreignNeeds, cellHeat],
  ([$foreign, $heat]): PublishedNeed[] => {
    const me = resolveUserId();
    const seen = new Set($foreign.map((n) => String(n.id)));
    const fromCells: PublishedNeed[] = [];
    for (const entry of Object.values($heat)) {
      for (const n of entry.needs) {
        const key = String(n.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (String(n.initiator?.id ?? "") === me) continue;
        if (!isOpen(n)) continue;
        fromCells.push(n);
      }
    }
    return [...$foreign, ...fromCells];
  },
);

/** The shopping checklist joined with its published needs. */
export const shoppingList = derived(
  [rawChecklists, myNeeds],
  ([$docs, $needs]) => {
    const doc = $docs.find(
      (d) =>
        d && !d._federation && (d.id === SHOPPING_KEY || d.type === "shopping"),
    );
    const list = normalizeChecklist(doc) ?? createEmptyChecklist();
    const byId = new Map<string, PublishedNeed>(
      $needs.map((n) => [String(n.id), n]),
    );
    return list.items.map((item) => ({
      item,
      need: needIdOf(item) ? (byId.get(needIdOf(item)!) ?? null) : null,
    }));
  },
);

export const proposals = derived(rawQuests, ($q) =>
  $q.filter((r) => !isForeign(r) && r?.type === "proposal" && !r._deleted),
);

/** Active solidarity runs — offers tagged 'solidarity-run', newest first. */
export const solidarityRuns = derived(rawQuests, ($q) =>
  $q
    .filter(
      (r) =>
        r &&
        !r._deleted &&
        r.type === "offer" &&
        Array.isArray(r.tags) &&
        r.tags.includes("solidarity-run") &&
        r.status !== "completed" &&
        r.status !== "stopped",
    )
    .sort((a, b) =>
      String(b.created ?? "").localeCompare(String(a.created ?? "")),
    ),
);

// Standing offers — the supply side. Solidarity runs are offers too but live
// on their own screen; everything here excludes them.
function isStandingOffer(r: any): boolean {
  return (
    r &&
    !r._deleted &&
    classifyMarketItem(r) === "offer" &&
    !(Array.isArray(r.tags) && r.tags.includes("solidarity-run")) &&
    r.status !== "completed" &&
    r.status !== "stopped" &&
    r.status !== "cancelled"
  );
}

const newestFirst = (a: any, b: any) =>
  String(b.created ?? "").localeCompare(String(a.created ?? ""));

/** The acting user's own standing offers (withdrawable). */
export const myOffers = derived(rawQuests, ($q) => {
  const me = resolveUserId();
  return $q
    .filter((r) => isStandingOffer(r) && !isForeign(r))
    .filter((r) => String(r.initiator?.id ?? "") === me)
    .sort(newestFirst);
});

/** Offers around the acting user: coop-mates' plus federated partners'. */
export const offersAround = derived(rawQuests, ($q) => {
  const me = resolveUserId();
  return $q
    .filter((r) => isStandingOffer(r))
    .filter((r) => String(r.initiator?.id ?? "") !== me)
    .sort(newestFirst);
});

/**
 * Handoff confirmations, one RECORD per side (`<needId>~handoff~<party>` on
 * the quests lens — see @holons/core/needs handoff). Separate records because
 * nested-field updates on a shared record don't replicate reliably across
 * devices — new records do.
 */
export const handoffConfirms = derived(rawQuests, ($q) =>
  foldHandoffConfirmations($q),
);

/** Per-need ratings each side has left (`<needId>~rating~<party>` records). */
export const needRatings = derived(rawQuests, ($q) => foldNeedRatings($q));

/**
 * Reputation per user, folded from every rating record visible in this graph
 * (own + federated + mirrored). Best-effort by design: a stranger's rating
 * history only travels as far as federation and the ratee-holon mirror do.
 */
export const peerReputation = derived(rawQuests, ($q) => reputationByUser($q));

/** The acting user's own reputation — mirrors land on their holon. */
export const myReputation = derived(rawQuests, ($q) =>
  reputationOf($q, resolveUserId()),
);

export const members = derived(rawUsers, ($u) =>
  $u.filter((u) => u && u.id != null && !u._federation),
);

/** Demand bars: open needs (ours + partners') grouped by category. */
export const demandBars = derived(
  [myNeeds, foreignNeeds],
  ([$mine, $foreign]) => {
    const counts = new Map<string, number>();
    for (const n of [...$mine, ...$foreign]) {
      if (!isOpen(n)) continue;
      const cat =
        (n.category as string) ||
        n.title?.split(" ").slice(0, 1).join(" ") ||
        "Other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  },
);

export interface WalletView {
  hours: number;
  hoursGiven: number;
  hoursReceived: number;
  karma: number;
  /** The user's share of the holon's total karma, 0–100. */
  standing: number;
  exchanges: number;
  ledger: Expense[];
}

// Karma comes from the shared scoring domain over the rea_events lens. It is
// recomputed on demand (init + after a handoff), not live-derived.
const karmaStore = writable(0);
const standingStore = writable(0);

export const wallet = derived(
  [rawExpenses, karmaStore, standingStore],
  ([$exp, $karma, $standing]): WalletView => {
    const me = resolveUserId();
    const expenses = $exp.filter(
      (e) => e && !e._deleted && !e._federation,
    ) as Expense[];
    const mine = expenses.filter(
      (e) =>
        String(e.paidBy) === me || (e.splitWith ?? []).map(String).includes(me),
    );
    const hours = computeUserCurrencyBalance(expenses, me, "hour");
    let given = 0;
    let received = 0;
    for (const e of mine) {
      if (e.currency !== "hour") continue;
      if (String(e.paidBy) === me) given += Number(e.amount) || 0;
      else received += Number(e.amount) || 0;
    }
    return {
      hours,
      hoursGiven: given,
      hoursReceived: received,
      karma: $karma,
      standing: $standing,
      exchanges: mine.length,
      ledger: mine
        .slice()
        .sort((a, b) =>
          String(b.created ?? "").localeCompare(String(a.created ?? "")),
        )
        .slice(0, 12),
    };
  },
);
export const karma = { subscribe: karmaStore.subscribe };
export const standing = { subscribe: standingStore.subscribe };

/** Hours that have moved through this holon's ledger — the current, summed. */
export const hoursCirculated = derived(rawExpenses, ($exp) =>
  ($exp as Expense[])
    .filter((e) => e && !(e as any)._deleted && !(e as any)._federation)
    .filter((e) => e.currency === "hour")
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
);

export const profileUser = derived(rawUsers, ($u) => {
  const me = resolveUserId();
  return $u.find((u) => u && String(u.id) === me) ?? null;
});

/**
 * Completed/fulfilled quests the acting user took part in — "the record".
 * Foreign records count too: a provider who answered another holon's need
 * gets the fulfilled quest mirrored back as a hologram at settlement.
 */
export const record = derived(rawQuests, ($q) => {
  const me = resolveUserId();
  return $q
    .filter(
      (r) =>
        r &&
        !r._deleted &&
        (r.status === "completed" || r.status === "fulfilled"),
    )
    .filter(
      (r) =>
        String(r.initiator?.id ?? "") === me ||
        (r.participants ?? []).some((p: any) => String(p?.id) === me),
    )
    .sort((a, b) =>
      String(b.created ?? "").localeCompare(String(a.created ?? "")),
    )
    .slice(0, 8);
});

// ── bootstrap ─────────────────────────────────────────────────────────────

function track(sub: { unsubscribe: () => void } | undefined) {
  if (sub) subs.push(sub);
}

/** HoloSphere as the minimal db surface core's stores expect, with actingAs. */
function hsDb(hs: HoloSphere) {
  return {
    put: (holon: string, lens: string, value: unknown) =>
      putAs(hs, holon, lens, value as object),
    get: (holon: string, lens: string, key?: string | number) =>
      (hs as any).get(holon, lens, key),
    getAll: (holon: string, lens: string) => (hs as any).getAll(holon, lens),
  };
}

async function recomputeKarma(hs: HoloSphere, holon: string): Promise<void> {
  const me = resolveUserId();
  if (!me) return;
  try {
    const eventStore = new REAEventStore(hsDb(hs) as any);
    const aggregator = new REAAggregator(eventStore as any);
    const scored = await computeHolonUserScores(aggregator as any, holon, [
      { id: me },
    ]);
    const meScored = scored.find((s) => s.userId === me);
    if (meScored) {
      karmaStore.set(Math.round(meScored.score));
      // The real number, not a mood: percentage of the holon's total karma.
      standingStore.set(Math.round(meScored.percentage));
    }
  } catch (err) {
    console.warn("[wequest] scoring unavailable:", err);
  }
}

// ── neighbourhood heat: one live index, fed by sweep + subscriptions ──────
//
// `cellItems` is the single source of truth for what each hex cell holds:
// the initial getAll sweep seeds it, and a live subscription per cell keeps
// it current — so a neighbour's need lights up without a reload. Claimed
// needs stay listed (the provider reaches the handoff through the cell card
// until both sides have confirmed); anything closed drops out.
const cellItems = new Map<string, Map<string, PublishedNeed>>();
let heatSubs: Array<{ unsubscribe: () => void }> = [];
let heatTimers: Array<ReturnType<typeof setTimeout>> = [];
let heatHex = "";

function teardownHeat(): void {
  for (const t of heatTimers.splice(0)) clearTimeout(t);
  for (const s of heatSubs.splice(0)) s.unsubscribe();
  cellItems.clear();
  heatHex = "";
}

function listedNeed(raw: any): PublishedNeed | null {
  const n = normalizeNeed(raw);
  if (!n || !(isOpen(n) || n.status === "claimed")) return null;
  // Preserve the read-side envelopes — they route foreign writes.
  return {
    ...n,
    _federation: raw._federation,
    _hologram: raw._hologram,
  } as PublishedNeed;
}

function republishHeat(cell: string): void {
  const items = cellItems.get(cell);
  const open = items ? [...items.values()] : [];
  cellHeat.update(($h) => ({
    ...$h,
    [cell]: {
      count: open.length,
      // Unique titles — duplicates would collide as keyed-each keys.
      tags: [...new Set(open.map((n) => String(n.title)))].slice(0, 3),
      needs: open,
    },
  }));
}

function ingestCellItem(cell: string, key: string, raw: any): void {
  const items = cellItems.get(cell);
  if (!items) return; // hex changed underneath a late callback
  const need = raw == null ? null : listedNeed(raw);
  if (need) items.set(key, need);
  else items.delete(key);
  republishHeat(cell);
  // Keep an open quest screen fresh when its record lives on a cell card.
  const cur = get(selectedNeed);
  if (cur?.id != null && String(cur.id) === key && need) {
    selectedNeed.set({
      ...need,
      _federation: (need as any)._federation ?? cur._federation,
      _hologram: (need as any)._hologram ?? cur._hologram,
    });
  }
}

async function refreshHeat(hs: HoloSphere, hex: string): Promise<void> {
  const cells = neighborhood(hex, 4);
  mapCells.set(projectCells(hex, cells, 358, 330));

  if (heatHex !== hex) {
    teardownHeat();
    heatHex = hex;
    for (const cell of cells) cellItems.set(cell, new Map());
    // Live per-cell subscriptions, attached in staggered batches so 61
    // simultaneous map().on() attaches don't stampede the relay.
    cells.forEach((cell, i) => {
      const timer = setTimeout(
        () => {
          heatSubs.push(
            (hs as any).subscribe(cell, NEEDS_LENS, (rec: any, key: string) => {
              if (key == null) return;
              ingestCellItem(cell, String(key), rec);
            }),
          );
        },
        Math.floor(i / 8) * 250,
      );
      heatTimers.push(timer);
    });
  }

  // Sweep: read each cell's needs lens with modest concurrency to seed (or
  // re-sync) the index — subscriptions keep it live afterwards.
  const queue = [...cells];
  const workers = Array.from({ length: 6 }, async () => {
    for (let cell = queue.shift(); cell; cell = queue.shift()) {
      try {
        const raw: any[] = (
          (await (hs as any).getAll(cell, NEEDS_LENS)) ?? []
        ).filter(Boolean);
        const items = cellItems.get(cell);
        if (!items) continue; // hex changed mid-sweep
        for (const r of raw) {
          const key = String(r?.id ?? "");
          if (!key) continue;
          const need = listedNeed(r);
          if (need) items.set(key, need);
          else items.delete(key);
        }
        republishHeat(cell);
      } catch {
        /* cell unreadable — leave whatever the subscription delivers */
      }
    }
  });
  await Promise.all(workers);
}

/** Boot the live layer for the configured holon. Idempotent per holon. */
export async function ensureInit(): Promise<void> {
  const holon = resolveHolon();
  if (!holon || initedFor === holon) return;
  initedFor = holon;
  holonId.set(holon);

  const hs = await getHolosphere();

  for (const s of subs.splice(0)) s.unsubscribe();
  teardownHeat();
  cellHeat.set({});

  questsSub = (hs as any).subscribeFederated(
    holon,
    "quests",
    (items: any[]) => rawQuests.set(items ?? []),
    {
      includeFederated: true,
    },
  );
  track(questsSub!);
  track(
    (hs as any).subscribeFederated(
      holon,
      CHECKLISTS_COLLECTION,
      (items: any[]) => rawChecklists.set(items ?? []),
      { includeFederated: false, dedupe: false },
    ),
  );
  track(
    (hs as any).subscribeFederated(
      holon,
      "users",
      (items: any[]) => rawUsers.set(items ?? []),
      {
        includeFederated: false,
      },
    ),
  );
  track(
    (hs as any).subscribeFederated(
      holon,
      "expenses",
      (items: any[]) => rawExpenses.set(items ?? []),
      {
        includeFederated: false,
      },
    ),
  );

  // Settings: display name + hex address.
  try {
    const s: any = await (hs as any).get(holon, "settings", holon);
    if (s?.name) holonName.set(String(s.name));
  } catch {
    /* name stays empty */
  }
  const hex = await readSettingsHex(hs, holon);
  settingsHex.set(hex);

  // Federation partners (the barter board + publish targets).
  await refreshPartners(hs, holon);

  ready.set(true);

  if (hex) void refreshHeat(hs, hex);
  void recomputeKarma(hs, holon);
  void ensureActingProfile();
}

// ── actions ───────────────────────────────────────────────────────────────

/**
 * Claim a home hex: persist it as `settings.hex` on the holon — the exact
 * field the web dashboard's HexPicker writes — merged over the existing
 * settings doc so name/federation/etc. survive. The map re-lights from it.
 */
export async function setHomeHex(cell: string): Promise<void> {
  const holon = get(holonId);
  if (!holon || !cell) return;
  const hs = await getHolosphere();
  let existing: any = {};
  try {
    const raw = await (hs as any).get(holon, "settings", holon);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) existing = raw;
  } catch {
    /* fresh settings */
  }
  await putAs(hs, holon, "settings", { ...existing, id: holon, hex: cell });
  settingsHex.set(cell);
  flash("Home hex claimed — the map is yours.");
  // Heat loads in the background — don't hold the picker open for a 61-cell scan.
  void refreshHeat(hs, cell);
}

/** Re-read the neighbourhood heat (after a publish, or on demand). */
export async function refreshMap(): Promise<void> {
  const hex = get(settingsHex);
  if (!hex) return;
  const hs = await getHolosphere();
  await refreshHeat(hs, hex);
}

function initiator() {
  const id = resolveUserId() || "wequest-guest";
  return { id, username: resolveUsername() || id };
}

// The Telegram bot's notify API: the writer says WHAT happened, the bot
// re-reads the need and DMs the party that must act next. Fire-and-forget —
// the graph write is the source of truth, the DM is a courtesy.
const BOT_API_URL = String(
  (import.meta as any).env?.VITE_BOT_API_URL ?? "",
).replace(/\/$/, "");

function notifyNeedBot(
  event: "responded" | "claimed" | "settled",
  ownerHolon: string,
  needId: string,
): void {
  if (!BOT_API_URL) return;
  void fetch(`${BOT_API_URL}/notify/need`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holon: ownerHolon, needId, event }),
  }).catch(() => {});
}

async function saveChecklist(
  hs: HoloSphere,
  holon: string,
  list: ShoppingChecklist,
) {
  await putAs(hs, holon, CHECKLISTS_COLLECTION, list);
}

function currentChecklist(): ShoppingChecklist {
  const doc = get(rawChecklists).find(
    (d: any) =>
      d && !d._federation && (d?.id === SHOPPING_KEY || d?.type === "shopping"),
  );
  return normalizeChecklist(doc) ?? createEmptyChecklist();
}

/** Ring dial → publish scope. */
const RING_PUBLISH = [
  { toPartners: false, upcastLevels: 0 }, // This cell
  { toPartners: false, upcastLevels: 2 }, // 2 rings
  { toPartners: true, upcastLevels: 5 }, // 5 rings
  { toPartners: true, upcastLevels: undefined }, // The world (full climb)
];

const KIND_ITEM_TYPE: Array<{
  itemType: "good" | "service";
  transactionTypes?: string[];
}> = [
  { itemType: "good" },
  { itemType: "service" },
  { itemType: "good", transactionTypes: ["borrow-lend"] },
];

/**
 * Add a list item and publish it as a geolocated need. The ring dial decides
 * how far it travels: cell-only hologram → limited upcast → partners + the
 * full parent climb.
 */
export async function addToList(
  text: string,
  kindIdx: number,
  ringIdx: number,
): Promise<void> {
  const holon = get(holonId);
  const trimmed = text.trim();
  if (!holon || !trimmed) return;
  const hs = await getHolosphere();

  const withItem = shoppingAddItem(currentChecklist(), trimmed, {
    createdBy: initiator().id,
  });
  const item = withItem.items[withItem.items.length - 1];
  await saveChecklist(hs, holon, withItem);

  const kind = KIND_ITEM_TYPE[kindIdx] ?? KIND_ITEM_TYPE[0];
  const need = needFromShoppingItem(item, {
    holonId: holon,
    initiator: initiator(),
  });
  need.item_type = kind.itemType;
  if (kind.transactionTypes) need.transaction_type = kind.transactionTypes;

  const ring = RING_PUBLISH[ringIdx] ?? RING_PUBLISH[1];
  const outcome = await publishNeedNearby(hs, holon, need, {
    toPartners: ring.toPartners,
    toHex: true,
    upcastLevels: ring.upcastLevels,
  });

  const stamped = stampNeedId(withItem, item.id, String(need.id));
  if (stamped) await saveChecklist(hs, holon, stamped);

  console.debug("[wequest] publish outcome", JSON.stringify(outcome));
  if (outcome.errors.length > 0) flash(outcome.errors[0]);
  else flash("On the ledger. Your rings can see it.");
  if (outcome.hexCell) void refreshMap();
}

/** Check off / restore a list item; checking off fulfils its need. */
export async function toggleListItem(item: ShoppingItem): Promise<void> {
  const holon = get(holonId);
  if (!holon) return;
  const hs = await getHolosphere();
  const updated = shoppingToggleItem(currentChecklist(), item.id);
  if (!updated) return;
  await saveChecklist(hs, holon, updated);
  const needId = needIdOf(item);
  if (!item.checked && needId) {
    const raw = await (hs as any).get(holon, NEED_RECORD_LENS, needId);
    const need = normalizeNeed(raw);
    if (need) {
      const closed = closeNeed(need, "fulfilled");
      if (closed.ok) await refreshPublishedNeed(hs, holon, closed.need);
    }
    flash("Fulfilled — the ring sees it instantly.");
    void refreshMap();
  }
}

/** A provider answers a need. Foreign writes land on the owner holon. */
export async function respondToSelected(
  message: string,
  price: number | null,
): Promise<void> {
  const holon = get(holonId);
  const item = get(selectedNeed);
  if (!holon || !item) return;
  const hs = await getHolosphere();
  const need = normalizeNeed(item);
  if (!need) return;
  const self = initiator();
  const result = respondToNeed(need, {
    responder: { id: self.id, name: self.username, holonId: holon },
    message: message || undefined,
    price: price ?? undefined,
    currency: price != null ? "hour" : undefined,
  });
  if (!result.ok) {
    flash(
      result.reason === "own_need"
        ? "This is your own need — your ring answers it."
        : "This need is already closed.",
    );
    return;
  }
  const ref = sourceRef(item, String(item.id));
  const target = ref?.holon ?? holon;
  const { _hologram, _federation, ...record } = result.need as any;
  if (ref?.key) record.id = ref.key;
  try {
    await putAs(hs, target, NEED_RECORD_LENS, record);
    notifyNeedBot("responded", target, String(record.id));
    selectedNeed.set({
      ...item,
      status: record.status,
      responses: record.responses,
    });
    flash("Response sent — the requester sees it live.");
  } catch (err: any) {
    flash(
      err?.name === "AuthorizationError"
        ? "This holon doesn't accept responses."
        : "Could not send the response.",
    );
  }
}

/** The requester accepts one response → the need is claimed. */
export async function claimResponse(responseId: string): Promise<boolean> {
  const holon = get(holonId);
  const item = get(selectedNeed);
  if (!holon || !item) return false;
  const hs = await getHolosphere();
  // My own need can arrive through the map with a read-side hologram
  // envelope — strip it so the claim persists a clean canonical record.
  const { _hologram, _federation, ...bare } = item as any;
  const need = normalizeNeed(bare);
  if (!need) return false;
  const result = claimNeed(need, responseId);
  if (!result.ok) {
    flash(
      result.reason === "not_offered"
        ? "Nothing to accept yet."
        : "That offer is gone.",
    );
    return false;
  }
  await refreshPublishedNeed(hs, holon, result.need);
  notifyNeedBot("claimed", holon, String(result.need.id));
  selectedNeed.set(result.need);
  return true;
}

/** The holon that owns the selected need's canonical record. */
function ownerHolonOf(item: any): string {
  return sourceRef(item, String(item.id))?.holon ?? get(holonId);
}

function acceptedResponse(need: PublishedNeed) {
  return (need.responses ?? []).find((r) => r.id === need.claimedResponseId);
}

/**
 * One side confirms the handoff. The requester confirms from the code screen;
 * the provider types the code in. Hours + karma move only when BOTH sides
 * have confirmed — the second confirmation runs the settlement.
 */
export async function confirmHandoffAs(
  party: HandoffParty,
  code?: string,
): Promise<{ ok: boolean; both: boolean }> {
  const item = get(selectedNeed);
  if (!item) return { ok: false, both: false };
  const hs = await getHolosphere();
  const local = normalizeNeed(item);
  if (!local) return { ok: false, both: false };

  const ref = sourceRef(item, String(item.id));
  const owner = ref?.holon ?? get(holonId);
  const key = ref?.key ?? String(item.id);

  // Core folds the replicated confirm records into the handoff view,
  // validates (claimed status, code match, per-side idempotency), and
  // persists this side's confirmation record on the owner holon.
  let result: Awaited<ReturnType<typeof confirmNeedHandoff>>;
  try {
    result = await confirmNeedHandoff(hsDb(hs), owner, local, party, {
      code,
      key,
      confirmations: get(handoffConfirms),
    });
  } catch {
    flash("Could not record the confirmation.");
    return { ok: false, both: false };
  }
  if (!result.ok) {
    flash(
      result.reason === "bad_code"
        ? "That code doesn't match — check the requester's screen."
        : "The handoff isn't ready yet.",
    );
    return { ok: false, both: false };
  }

  if (result.both) {
    const { _hologram, _federation, ...record } = result.need as any;
    record.id = key;
    await settleAndReport(hs, owner, record as PublishedNeed);
  } else {
    flash(
      party === "requester"
        ? "Confirmed — waiting for them to tap the code in."
        : "Code accepted — waiting for the requester's confirm.",
    );
  }
  selectedNeed.set({
    ...item,
    status: result.need.status,
    handoff: result.need.handoff,
  });
  return { ok: true, both: result.both };
}

/**
 * Both sides confirmed — settle through core: close fulfilled, REA events,
 * requester → provider hour expense, shopping-item checkoff, and the mirror
 * of the provider's side into their own holon (wallet/karma/record there).
 */
async function settleAndReport(
  hs: HoloSphere,
  owner: string,
  need: PublishedNeed,
): Promise<void> {
  const out = await settleNeedHandoff(
    { holosphere: hs, db: hsDb(hs) },
    owner,
    need,
  );
  if (out.errors.length) {
    console.warn("[wequest] settlement partial:", out.errors);
  }
  notifyNeedBot("settled", owner, String(need.id));
  void recomputeKarma(hs, get(holonId));
  void refreshMap();
  const accepted = acceptedResponse(out.need);
  flash(
    `Done. ${out.hours.toFixed(1)} h moved${accepted?.responder?.name ? " to " + accepted.responder.name : ""} — karma follows.`,
  );
}

/**
 * Rate the other side of a settled exchange — the whitepaper's reputation
 * pillar, attached to the settlement the handoff already owns. The record
 * lands on the owner holon (sourceRef-routed like every foreign write) and
 * core mirrors it to the ratee's holon so their reputation follows them.
 */
export async function rateSelected(
  party: HandoffParty,
  stars: number,
  comment?: string,
): Promise<boolean> {
  const holon = get(holonId);
  const item = get(selectedNeed);
  if (!holon || !item) return false;
  const hs = await getHolosphere();
  const { _hologram, _federation, ...bare } = item as any;
  const need = normalizeNeed(bare);
  if (!need) return false;

  const ref = sourceRef(item, String(item.id));
  const owner = ref?.holon ?? holon;
  const key = ref?.key ?? String(item.id);

  let result: Awaited<ReturnType<typeof rateNeedHandoff>>;
  try {
    result = await rateNeedHandoff(hsDb(hs), owner, need, party, stars, {
      comment: comment?.trim() || undefined,
      key,
    });
  } catch (err: any) {
    flash(
      err?.name === "AuthorizationError"
        ? "This holon doesn't accept ratings."
        : "Could not record the rating.",
    );
    return false;
  }
  if (!result.ok) {
    flash(
      result.reason === "not_fulfilled"
        ? "Rate after the handoff settles."
        : "Nothing to rate on this exchange.",
    );
    return false;
  }
  if (result.errors.length) {
    console.warn("[wequest] rating mirror partial:", result.errors);
  }
  flash("Rated — it's part of their record now.");
  return true;
}

/**
 * The holon that published a record we can see — a map hologram's source or
 * a federated copy's origin. Null for our own records (nothing to link).
 */
export function publisherHolonOf(rec: any): string | null {
  const id = rec?._hologram?.sourceHolon || rec?._federation?.origin;
  if (id == null) return null;
  const s = String(id);
  return s && s !== get(holonId) ? s : null;
}

/** A display name for a publisher, from the read-side envelopes. */
export function publisherNameOf(rec: any): string {
  return (
    rec?._hologram?.sourceHolonName ||
    rec?._federation?.originName ||
    String(publisherHolonOf(rec) ?? "").slice(0, 8) + "…"
  );
}

/** Re-read the federation snapshot into the partners store. */
async function refreshPartners(hs: HoloSphere, holon: string): Promise<void> {
  try {
    const snap = await getFederationSnapshot(hs, holon);
    partners.set(
      snap.federated.map((id) => ({
        id,
        name: snap.partnerNames?.[id] || id.slice(0, 8) + "…",
      })),
    );
  } catch {
    partners.set([]);
  }
}

/**
 * Re-attach the federated quests stream. `setFederated(true)` alone never
 * detaches a partner that was just removed — bounce it off/on (the same
 * lesson the kiosk learned) so both added and removed partners take effect
 * without a reload.
 */
function bounceFederation(): void {
  questsSub?.setFederated?.(false);
  questsSub?.setFederated?.(true);
}

/**
 * Link a partner holon from inside the app. The needs network flows over
 * the `quests` lens, so the default is quests in both directions — their
 * needs and offers appear here, ours appear there.
 */
export async function addPartner(partnerId: string): Promise<boolean> {
  const holon = get(holonId);
  const target = partnerId.trim();
  if (!holon || !target) return false;
  if (target === holon) {
    flash("That's this holon — pick a partner.");
    return false;
  }
  const hs = await getHolosphere();
  // Best-effort display name from the partner's own settings.
  let partnerName: string | undefined;
  try {
    const s: any = await (hs as any).get(target, "settings", target);
    if (s?.name) partnerName = String(s.name);
  } catch {
    /* unnamed is fine */
  }
  try {
    await setFederationPartner(hs, holon, target, {
      inbound: ["quests"],
      outbound: ["quests"],
      partnerName,
    });
  } catch (err: any) {
    flash(
      err?.name === "AuthorizationError"
        ? "This holon doesn't let you edit federation."
        : "Could not link the partner.",
    );
    return false;
  }
  await refreshPartners(hs, holon);
  bounceFederation();
  flash(
    `Federated with ${partnerName || target.slice(0, 8) + "…"} — needs flow both ways.`,
  );
  return true;
}

/** Unlink a federation partner. */
export async function removePartner(partnerId: string): Promise<void> {
  const holon = get(holonId);
  const target = String(partnerId ?? "").trim();
  if (!holon || !target) return;
  const hs = await getHolosphere();
  try {
    await removeFederationPartner(hs, holon, target);
  } catch (err: any) {
    flash(
      err?.name === "AuthorizationError"
        ? "This holon doesn't let you edit federation."
        : "Could not unlink the partner.",
    );
    return;
  }
  await refreshPartners(hs, holon);
  bounceFederation();
  flash("Unlinked — their needs no longer flow here.");
}

/**
 * Publish a standing offer — the supply side of the network. The offer is a
 * `type:'offer'` marketplace record on the coop's quests lens (the same
 * record the web Offers board renders); `toPartners` additionally pushes
 * standalone copies to the federation.
 */
export async function publishOffer(
  text: string,
  kindIdx: number,
  toPartners: boolean,
): Promise<boolean> {
  const holon = get(holonId);
  const trimmed = text.trim();
  if (!holon || !trimmed) return false;
  const hs = await getHolosphere();
  const kind = KIND_ITEM_TYPE[kindIdx] ?? KIND_ITEM_TYPE[0];
  const offer = createMarketItem({
    holonId: holon,
    initiator: initiator(),
    kind: "offer",
    title: trimmed,
    itemType: kind.itemType,
    transactionTypes: kind.transactionTypes,
  });
  const record = {
    ...offer,
    id: `offer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
  };
  try {
    await putAs(hs, holon, "quests", record);
  } catch {
    flash("Could not publish the offer.");
    return false;
  }
  if (toPartners) {
    try {
      const out = await publishToFederation(
        { holosphere: hs, holonId: holon, lens: "quests", item: record },
        { kind: "all" },
        { includeSettingsHex: false },
      );
      flash(
        out.publishedTo > 0
          ? `Offer live — shared with ${out.publishedTo} partner holon${out.publishedTo === 1 ? "" : "s"}.`
          : "Offer live on your coop's board.",
      );
    } catch {
      flash("Offer live here — sharing with partners failed.");
    }
  } else {
    flash("Offer live on your coop's board.");
  }
  return true;
}

/**
 * Withdraw one of my standing offers. Tombstones the record (and any
 * hologram forwards) via core's cascade delete; standalone partner copies
 * are overwritten as deleted best-effort.
 */
export async function withdrawOffer(offer: any): Promise<void> {
  const holon = get(holonId);
  if (!holon || !offer?.id) return;
  const hs = await getHolosphere();
  try {
    await deleteTaskWithCascade(hs, holon, String(offer.id));
  } catch {
    flash("Could not withdraw the offer.");
    return;
  }
  try {
    await publishToFederation(
      {
        holosphere: hs,
        holonId: holon,
        lens: "quests",
        item: { ...offer, _deleted: true, status: "cancelled" },
      },
      { kind: "all" },
      { includeSettingsHex: false },
    );
  } catch {
    /* partner copies go stale — best-effort */
  }
  flash("Offer withdrawn.");
}

/** Withdraw the selected need: cancel it everywhere and drop the list item. */
export async function cancelSelectedNeed(): Promise<boolean> {
  const holon = get(holonId);
  const item = get(selectedNeed);
  if (!holon || !item) return false;
  const hs = await getHolosphere();
  const { _hologram, _federation, ...bare } = item as any;
  const need = normalizeNeed(bare);
  if (!need) return false;
  const result = closeNeed(need, "cancelled");
  if (!result.ok) {
    flash("Already settled — nothing to withdraw.");
    return false;
  }
  await refreshPublishedNeed(hs, holon, result.need);
  // Retraction, as documented: the originating list item goes too, and the
  // hex hologram resolves to the cancelled record, unlighting the map.
  if (need.source?.itemId) {
    const list = currentChecklist();
    const remaining = list.items.filter(
      (i) => String(i.id) !== String(need.source!.itemId),
    );
    if (remaining.length !== list.items.length) {
      await saveChecklist(hs, holon, { ...list, items: remaining });
    }
  }
  selectedNeed.set(null);
  flash("Withdrawn — the ring no longer sees it.");
  void refreshMap();
  return true;
}

/** Remove a list item; an open published need for it is cancelled first. */
export async function removeListItem(entry: {
  item: ShoppingItem;
  need: PublishedNeed | null;
}): Promise<void> {
  const holon = get(holonId);
  if (!holon) return;
  const hs = await getHolosphere();
  if (entry.need && isOpen(entry.need)) {
    const result = closeNeed(entry.need, "cancelled");
    if (result.ok) await refreshPublishedNeed(hs, holon, result.need);
  }
  const list = currentChecklist();
  const remaining = list.items.filter(
    (i) => String(i.id) !== String(entry.item.id),
  );
  if (remaining.length === list.items.length) return;
  await saveChecklist(hs, holon, { ...list, items: remaining });
  flash("Removed from the list.");
  void refreshMap();
}

/** Put a proposal on the coop's table — a `type:'proposal'` quest. */
export async function createProposal(
  title: string,
  description: string,
): Promise<boolean> {
  const holon = get(holonId);
  const t = title.trim();
  if (!holon || !t) return false;
  const hs = await getHolosphere();
  const proposal = {
    id: `prop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type: "proposal",
    title: t,
    ...(description.trim() ? { description: description.trim() } : {}),
    initiator: initiator(),
    participants: [],
    created: new Date().toISOString(),
  };
  try {
    await putAs(hs, holon, "quests", proposal);
    flash("On the table — the coop votes now.");
    return true;
  } catch {
    flash("Could not create the proposal.");
    return false;
  }
}

/**
 * Make sure the acting user exists on the holon's `users` lens — Profile
 * (values/needs) and member counts read from there, and a WeQuest-only user
 * otherwise never appears in them.
 */
export async function ensureActingProfile(user?: {
  id: string | number;
  username?: string;
  first_name?: string;
  last_name?: string;
}): Promise<void> {
  const holon = get(holonId) || resolveHolon();
  const u = user ?? { id: resolveUserId(), username: resolveUsername() };
  if (!holon || u.id == null || u.id === "") return;
  try {
    const hs = await getHolosphere();
    await ensureUserProfile(hsDb(hs) as never, u as never, holon);
  } catch {
    /* best-effort — the profile appears on the next successful write */
  }
}

/** Join or leave a solidarity run — participant toggle on the run offer. */
export async function toggleRunParticipation(run: any): Promise<void> {
  const holon = get(holonId);
  if (!holon || !run) return;
  const hs = await getHolosphere();
  const me = initiator();
  const already = (run.participants ?? []).some(
    (p: any) => String(p?.id) === me.id,
  );
  const participants = already
    ? (run.participants ?? []).filter((p: any) => String(p?.id) !== me.id)
    : [...(run.participants ?? []), { id: me.id, username: me.username }];
  try {
    await putAs(hs, holon, "quests", { ...run, participants });
    flash(already ? "You left the run." : "You're in — the carrier sees you.");
  } catch {
    flash("Could not update the run.");
  }
}

/** The carrier ends their run — the offer completes and leaves the board. */
export async function endRun(run: any): Promise<void> {
  const holon = get(holonId);
  if (!holon || !run) return;
  const hs = await getHolosphere();
  try {
    await putAs(hs, holon, "quests", {
      ...run,
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    flash("Run completed — thanks for carrying.");
  } catch {
    flash("Could not complete the run.");
  }
}

/** Cast a vote on a coop proposal — participant toggle on the proposal quest. */
export async function voteOnProposal(proposal: any): Promise<void> {
  const holon = get(holonId);
  if (!holon || !proposal) return;
  const hs = await getHolosphere();
  const me = initiator();
  const already = (proposal.participants ?? []).some(
    (p: any) => String(p?.id) === me.id,
  );
  const participants = already
    ? (proposal.participants ?? []).filter((p: any) => String(p?.id) !== me.id)
    : [...(proposal.participants ?? []), { id: me.id, username: me.username }];
  try {
    await putAs(hs, holon, "quests", { ...proposal, participants });
    flash(already ? "Vote withdrawn." : "Vote cast.");
  } catch {
    flash("Voting is closed to you on this holon.");
  }
}
