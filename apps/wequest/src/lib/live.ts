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
  handoffCode,
  recordHandoffConfirmation,
  publishNeedNearby,
  refreshPublishedNeed,
  NEEDS_LENS,
  NEED_RECORD_LENS,
  OPEN_NEED_STATUSES,
  type HandoffParty,
  type PublishedNeed,
} from "@holons/core/needs";
import {
  classifyMarketItem,
  planTaskCompletion,
  executeCompletionPlan,
} from "@holons/core/tasks";
import { REAEventStore } from "@holons/core/rea";
import { DEFAULT_EQUATION } from "@holons/core/scoring";
import { sourceRef } from "@holons/core/holosphere";
import {
  readSettingsHex,
  getFederationSnapshot,
} from "@holons/core/federation";
import {
  computeUserCurrencyBalance,
  createExpense,
  type Expense,
} from "@holons/core/expenses";
import { REAAggregator, computeHolonUserScores } from "@holons/core/scoring";
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
  const confirms: Record<string, { requester?: boolean; provider?: boolean }> =
    {};
  for (const rec of $q) {
    if (rec?.type === "handoff-confirm" && rec.needId && rec.party) {
      (confirms[String(rec.needId)] ??= {})[
        rec.party === "requester" ? "requester" : "provider"
      ] = true;
    }
  }
  for (const r of $q) {
    if (!r || r.type !== "need" || r.status !== "claimed") continue;
    if (isForeign(r)) continue;
    if (String(r.initiator?.id ?? "") !== me) continue;
    const key = String(r.id);
    const c = confirms[key];
    if (!c?.requester || !c?.provider) continue;
    if (finalized.has(key)) continue;
    finalized.add(key);
    void (async () => {
      const hs = await getHolosphere();
      const need = normalizeNeed(r);
      if (need) await finalizeHandoff(hs, get(holonId), need);
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

/**
 * Handoff confirmations, one RECORD per side (`<needId>~handoff~<party>` on
 * the quests lens). Separate records because nested-field updates on a shared
 * record don't replicate reliably across devices — new records do.
 */
export const handoffConfirms = derived(rawQuests, ($q) => {
  const map: Record<string, { requesterAt?: string; providerAt?: string }> = {};
  for (const r of $q) {
    if (!r || r.type !== "handoff-confirm" || !r.needId || !r.party) continue;
    const entry = (map[String(r.needId)] ??= {});
    if (r.party === "requester") entry.requesterAt = String(r.at ?? "");
    else if (r.party === "provider") entry.providerAt = String(r.at ?? "");
  }
  return map;
});

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

/** Hours held by the holon itself — the coop treasury. */
export const treasuryHours = derived([rawExpenses, holonId], ([$exp, $holon]) =>
  computeUserCurrencyBalance(
    $exp.filter((e) => e && !e._deleted && !e._federation) as Expense[],
    $holon,
    "hour",
  ),
);

export const profileUser = derived(rawUsers, ($u) => {
  const me = resolveUserId();
  return $u.find((u) => u && String(u.id) === me) ?? null;
});

/** Completed quests the acting user participated in — "the record". */
export const record = derived(rawQuests, ($q) => {
  const me = resolveUserId();
  return $q
    .filter((r) => !isForeign(r) && r?.status === "completed" && !r._deleted)
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
      standingStore.set(
        Math.round((3.5 + Math.min(1.5, meScored.percentage / 66)) * 10) / 10,
      );
    }
  } catch (err) {
    console.warn("[wequest] scoring unavailable:", err);
  }
}

async function refreshHeat(hs: HoloSphere, hex: string): Promise<void> {
  const cells = neighborhood(hex, 4);
  mapCells.set(projectCells(hex, cells, 358, 330));
  // Read each cell's needs lens with modest concurrency; count open needs.
  const heat: Record<
    string,
    { count: number; tags: string[]; needs: PublishedNeed[] }
  > = {};
  const queue = [...cells];
  const workers = Array.from({ length: 6 }, async () => {
    for (let cell = queue.shift(); cell; cell = queue.shift()) {
      try {
        const raw: any[] = (
          (await (hs as any).getAll(cell, NEEDS_LENS)) ?? []
        ).filter(Boolean);
        // Claimed needs stay listed — the provider reaches the handoff
        // through the cell card until both sides have confirmed.
        const open = raw
          .map((r) => normalizeNeed(r))
          .filter(
            (n): n is PublishedNeed =>
              n != null && (isOpen(n) || n.status === "claimed"),
          );
        heat[cell] = {
          count: open.length,
          // Unique titles — duplicates would collide as keyed-each keys.
          tags: [...new Set(open.map((n) => String(n.title)))].slice(0, 3),
          needs: open,
        };
      } catch {
        heat[cell] = { count: 0, tags: [], needs: [] };
      }
      cellHeat.set({ ...heat });
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

  track(
    (hs as any).subscribeFederated(
      holon,
      "quests",
      (items: any[]) => rawQuests.set(items ?? []),
      {
        includeFederated: true,
      },
    ),
  );
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

  ready.set(true);

  if (hex) void refreshHeat(hs, hex);
  void recomputeKarma(hs, holon);
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
    flash("This need is already closed.");
    return;
  }
  const ref = sourceRef(item, String(item.id));
  const target = ref?.holon ?? holon;
  const { _hologram, _federation, ...record } = result.need as any;
  if (ref?.key) record.id = ref.key;
  try {
    await putAs(hs, target, NEED_RECORD_LENS, record);
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
  const need = normalizeNeed(item);
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

function handoffHours(need: PublishedNeed): number {
  const accepted = acceptedResponse(need);
  return accepted && typeof accepted.price === "number" && accepted.price > 0
    ? accepted.price
    : 1;
}

/**
 * One side confirms the handoff. The requester confirms from the code screen;
 * the provider types the code in. Hours + karma move only when BOTH sides
 * have confirmed — the second confirmation runs the finalize pipeline.
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

  // Fold the replicated confirm RECORDS into the handoff view, then let core
  // validate (claimed status, code match, per-side idempotency).
  const confirms = get(handoffConfirms)[String(item.id)] ?? {};
  const merged: PublishedNeed = {
    ...local,
    handoff: {
      code: local.handoff?.code ?? handoffCode(key),
      ...(confirms.requesterAt ? { requesterAt: confirms.requesterAt } : {}),
      ...(confirms.providerAt ? { providerAt: confirms.providerAt } : {}),
    },
  };
  const result = recordHandoffConfirmation(merged, party, { code });
  if (!result.ok) {
    flash(
      result.reason === "bad_code"
        ? "That code doesn't match — check the requester's screen."
        : "The handoff isn't ready yet.",
    );
    return { ok: false, both: false };
  }

  // My confirmation as its own record — new records replicate reliably
  // across devices, nested-field updates on a shared record don't.
  try {
    await putAs(hs, owner, NEED_RECORD_LENS, {
      id: `${key}~handoff~${party}`,
      type: "handoff-confirm",
      needId: key,
      party,
      at: new Date().toISOString(),
    });
  } catch {
    flash("Could not record the confirmation.");
    return { ok: false, both: false };
  }

  if (result.both) {
    const { _hologram, _federation, ...record } = result.need as any;
    record.id = key;
    await finalizeHandoff(hs, owner, record as PublishedNeed);
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
 * Both sides confirmed: close the need fulfilled, record the REA completion
 * events (initiated / completed / hours — this is what makes karma real),
 * move the hours as an expense from the requester to the provider, and check
 * the originating shopping-list item off. All on the need's owner holon.
 */
async function finalizeHandoff(
  hs: HoloSphere,
  owner: string,
  need: PublishedNeed,
): Promise<void> {
  const closed = closeNeed(need, "fulfilled");
  const final = closed.ok ? closed.need : need;
  const accepted = acceptedResponse(final);
  const hours = handoffHours(final);
  const providerId = accepted?.responder?.id;

  // The fulfilled need, treated as a completed quest: the provider joins the
  // participants and logs the hours, so the shared completion planner emits
  // the same REA events the bot and web record.
  const participants = [...(final.participants ?? [])];
  if (
    providerId != null &&
    !participants.some((p: any) => String(p?.id) === String(providerId))
  ) {
    participants.push({
      id: providerId,
      username: accepted?.responder?.name,
    } as any);
  }
  const asTask: any = {
    ...final,
    participants,
    timeTracking: providerId != null ? { [String(providerId)]: hours } : {},
  };

  const db = hsDb(hs);
  const eventStore = new REAEventStore(db as any);
  const plan = planTaskCompletion(asTask, DEFAULT_EQUATION, {
    now: Date.now(),
    holonId: owner,
  });
  // The plan's own expense models "the holon reimburses hours" — WeQuest
  // moves them requester → provider instead, so we write that one ourselves.
  const outcome = await executeCompletionPlan(
    db as any,
    eventStore,
    owner,
    plan,
    {
      recordExpenses: false,
    },
  );
  if (outcome.errors.length) {
    console.warn("[wequest] completion partial:", outcome.errors);
  }
  await refreshPublishedNeed(hs, owner, asTask as PublishedNeed);

  const requesterId = String(final.initiator?.id ?? initiator().id);
  const expense = createExpense({
    // Stable id keyed on the need, so a double finalize upserts not stacks.
    id: `wq-${final.id}-handoff`,
    holonId: owner,
    amount: hours,
    currency: "hour",
    description: String(final.title ?? "handoff"),
    paidBy: providerId ?? "provider",
    splitWith: [requesterId],
  });
  if (expense) {
    try {
      await putAs(hs, owner, "expenses", expense);
    } catch {
      flash("Handoff recorded, but the hour transfer was denied.");
    }
  }

  // Close the loop: the originating shopping-list item gets checked off.
  if (final.source?.itemId) {
    try {
      const raw = await (hs as any).get(
        owner,
        CHECKLISTS_COLLECTION,
        SHOPPING_KEY,
      );
      const list = normalizeChecklist(raw);
      const entry = list?.items.find(
        (i) => String(i.id) === String(final.source!.itemId),
      );
      if (list && entry && !entry.checked) {
        const updated = shoppingToggleItem(list, entry.id);
        if (updated) await putAs(hs, owner, CHECKLISTS_COLLECTION, updated);
      }
    } catch {
      /* list write is best-effort */
    }
  }

  void recomputeKarma(hs, get(holonId));
  void refreshMap();
  flash(
    `Done. ${hours.toFixed(1)} h moved${accepted?.responder?.name ? " to " + accepted.responder.name : ""} — karma follows.`,
  );
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
    flash(
      already ? "Vote withdrawn." : "Vote cast — weighted by your standing.",
    );
  } catch {
    flash("Voting is closed to you on this holon.");
  }
}
