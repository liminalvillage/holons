// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The kiosk's side of a holon's DNA (@holons/core/dna owns the meaning):
// how the semantic icon keys a gene or allele carries are drawn here, what
// each thing core says reads like in the screen's language, the front page
// as this screen holds it (a thin store over core's readHolonFront, kept
// fresh by subscribeGenes), and where this device keeps a person's walk.
// Nothing here decides what is valid, what the front says, or where a walk
// stands — core does.

import { get, writable } from "svelte/store";
import {
  ALLELE_ICONS,
  GENE_LIMITS,
  STARTER_LANGS,
  normalizeWalkState,
  readHolonFront,
  subscribeGenes,
  type AlleleIcon,
  type Gene,
  type GeneIssueCode,
  type GeneKind,
  type HolonFront,
  type WalkState,
} from "@holons/core/dna";
import type { JoinReadiness } from "@holons/core/holons";
import { getHolosphere } from "./holosphere";
import type { MessageKey } from "./i18n";
import type { IconName } from "./icons";

/**
 * Every semantic icon key of a DNA, as the kiosk's SVG catalog draws it. The
 * `Record` makes a key core adds without a picture here a type error.
 */
export const ALLELE_ICON_NAME: Record<AlleleIcon, IconName> = {
  home: "home",
  map: "map",
  compass: "compass",
  earth: "globe",
  flag: "flag",
  book: "book",
  scroll: "scroll",
  link: "link",
  calendar: "calendar",
  clock: "clock",
  key: "key",
  lock: "lock",
  shield: "shield",
  food: "food",
  bed: "bed",
  tools: "tools",
  solar: "solar",
  bolt: "bolt",
  industry: "factory",
  chip: "chip",
  code: "code",
  robot: "robot",
  video: "video",
  chat: "chat",
  mail: "mail",
  send: "send",
  phone: "smartphone",
  person: "person",
  "person-check": "person-check",
  people: "users",
  community: "community",
  handshake: "handshake",
  hand: "hand",
  care: "care",
  teach: "teach",
  walk: "walk",
  travel: "travel",
  coins: "coins",
  gift: "gift",
  heart: "heart",
  star: "star",
  trophy: "trophy",
  balance: "scales",
  seedling: "seedling",
  leaf: "leaf",
  tree: "tree",
  water: "water",
  sun: "sun",
  moon: "moon",
  fire: "fire",
  spa: "spa",
  idea: "bulb",
  eye: "eye",
  search: "search",
  target: "target",
  network: "network",
  cycle: "repeat",
  lab: "lab",
  broom: "broom",
  pencil: "pencil",
  check: "check",
  info: "info",
  warning: "warning",
  dna: "dna",
};

export const alleleIconName = (key: AlleleIcon): IconName =>
  ALLELE_ICON_NAME[key];

/** An icon key as words, for a label: `person-check` → "person check". */
export const iconWords = (key: string): string => key.replace(/-/g, " ");

export const KIND_LABEL: Record<GeneKind, MessageKey> = {
  purpose: "dnaEdit.kind.purpose",
  values: "dnaEdit.kind.values",
  agreements: "dnaEdit.kind.agreements",
  practices: "dnaEdit.kind.practices",
  roles: "dnaEdit.kind.roles",
  tools: "dnaEdit.kind.tools",
  terms: "dnaEdit.kind.terms",
  custom: "dnaEdit.kind.custom",
};

export const ISSUE_LABEL: Record<GeneIssueCode, MessageKey> = {
  "bad-id": "dnaEdit.issue.bad-id",
  "duplicate-id": "dnaEdit.issue.duplicate-id",
  "missing-title": "dnaEdit.issue.missing-title",
  "duplicate-kind": "dnaEdit.issue.duplicate-kind",
  "too-many": "dnaEdit.issue.too-many",
  "too-long": "dnaEdit.issue.too-long",
  "too-large": "dnaEdit.issue.too-large",
  "duplicate-allele": "dnaEdit.issue.duplicate-allele",
  "bad-link": "dnaEdit.issue.bad-link",
  "ref-malformed": "dnaEdit.issue.ref-malformed",
  "ref-missing": "dnaEdit.issue.ref-missing",
  "ref-nested": "dnaEdit.issue.ref-nested",
  referenced: "dnaEdit.issue.referenced",
};

/** The language the starter genes are written in for a screen language: its own, else English. */
export function starterLang(lang: string): string {
  return (STARTER_LANGS as readonly string[]).includes(lang) ? lang : "en";
}

/** Bytes as "12.4 KB" (one decimal under 10 KB, none above). */
export function kb(bytes: number): string {
  const k = bytes / 1024;
  return k < 10 ? k.toFixed(1) : String(Math.round(k));
}

export type MeterLevel = "ok" | "warn" | "over";

/** How full a gene is against its byte cap: red over it, a warning from 80%. */
export function meterLevel(bytes: number): MeterLevel {
  return bytes > GENE_LIMITS.bytes
    ? "over"
    : bytes >= GENE_LIMITS.bytes * 0.8
      ? "warn"
      : "ok";
}

export { ALLELE_ICONS };

// ── The front page on this screen ──────────────────────────────────────────

export type FrontState =
  | { status: "loading"; holon: string | null }
  | { status: "ready"; holon: string; front: HolonFront }
  | { status: "error"; holon: string };

/**
 * The front page of the holon on screen, as last read (`watchFront` keeps
 * it). Writable like the board's other stores, so a screen that already
 * holds a front can show it.
 */
export const frontState = writable<FrontState>({
  status: "loading",
  holon: null,
});
const state = frontState;

/** What a list of genes looks like, to tell a change from a replay. */
export const genesSignature = (
  genes: ReadonlyArray<Pick<Gene, "id" | "updated">>,
): string =>
  genes
    .map((g) => `${g.id}@${g.updated}`)
    .sort()
    .join("|");

let generation = 0;

/**
 * Read `holon`'s front page for `viewer` (the session key, or nobody) into
 * `frontState`, and read it again whenever its genes change. A failed
 * re-read keeps what shows; a failed first read says so (`error`). Returns
 * the stop. The same holon read again keeps showing its last front meanwhile.
 */
export function watchFront(holon: string, viewer: string | null): () => void {
  const mine = ++generation;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopGenes: (() => void) | null = null;
  const live = () => !stopped && mine === generation;
  const cur = get(state);
  if (cur.holon !== holon || cur.status === "error")
    state.set({ status: "loading", holon });

  const read = async () => {
    try {
      const hs = await getHolosphere();
      const front = await readHolonFront(hs, holon, { viewer });
      if (live()) state.set({ status: "ready", holon, front });
    } catch (err) {
      if (!live()) return;
      const now = get(state);
      if (now.status === "ready" && now.holon === holon) return;
      console.warn("[kiosk] front page read failed", err);
      state.set({ status: "error", holon });
    }
  };
  readNow = async () => {
    if (!live()) return;
    if (get(state).status === "error") state.set({ status: "loading", holon });
    await read();
  };
  void read();
  void getHolosphere()
    .then((hs) => {
      if (!live()) return;
      stopGenes = subscribeGenes(hs, holon, (genes) => {
        const now = get(state);
        if (
          now.status === "ready" &&
          now.holon === holon &&
          genesSignature(now.front.genes) === genesSignature(genes)
        )
          return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void read(), 600);
      });
    })
    .catch(() => {});
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    stopGenes?.();
  };
}

/** Read the front page of the watched holon again now (Retry, or after a refused request). */
export function reloadFront(): Promise<void> {
  return readNow?.() ?? Promise.resolve();
}

let readNow: (() => Promise<void>) | null = null;

// ── The walk on this device ────────────────────────────────────────────────

/** Where this device keeps a person's walk through a holon's DNA. */
export function walkKey(holon: string, person: string | null): string {
  return `dna-walk:${holon}:${person || "anon"}`;
}

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): KeyValue | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string, store: KeyValue | null): WalkState {
  try {
    const raw = store?.getItem(key);
    return normalizeWalkState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeWalkState(null);
  }
}

/**
 * The walk this device kept for `person` (a session key; null before a
 * login) in `holon`. A person who walked before logging in keeps what they
 * acknowledged: the anonymous walk is folded in under their key and
 * forgotten. Whatever was kept, core's `walkProgress` says what is stale.
 */
export function loadWalk(
  holon: string,
  person: string | null,
  store: KeyValue | null = storage(),
): WalkState {
  const own = readRaw(walkKey(holon, person), store);
  if (!person) return own;
  const anon = readRaw(walkKey(holon, null), store);
  if (!Object.keys(anon.acks).length) return own;
  const merged = { acks: { ...anon.acks, ...own.acks } };
  saveWalk(holon, person, merged, store);
  try {
    store?.removeItem(walkKey(holon, null));
  } catch {
    /* kept: harmless */
  }
  return merged;
}

/** Keep the walk on this device (best-effort: a private window forgets it). */
export function saveWalk(
  holon: string,
  person: string | null,
  walk: WalkState,
  store: KeyValue | null = storage(),
): void {
  try {
    store?.setItem(walkKey(holon, person), JSON.stringify(walk));
  } catch {
    /* not kept: the walk still works on this screen */
  }
}

/** The DNA hash a handoff link carries (`?dna=<64 hex>`), or null. */
export function handoffHash(search: string): string | null {
  const v = new URLSearchParams(search).get("dna")?.trim().toLowerCase();
  return v && /^[0-9a-f]{64}$/.test(v) ? v : null;
}

// ── Readiness, as admins read it ───────────────────────────────────────────

/** The badge an admin sees on a request; none when there is nothing to say. */
export const READINESS_LABEL: Record<JoinReadiness, MessageKey | null> = {
  acknowledged: "ready.acknowledged",
  outdated: "ready.outdated",
  missing: "ready.missing",
  "none-required": null,
  unknown: null,
};

/** Whether a readiness asks an admin to look twice before linking by hand. */
export const readinessWarns = (r: JoinReadiness): boolean =>
  r === "outdated" || r === "missing";
