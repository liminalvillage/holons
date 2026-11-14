// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The kiosk's side of a holon's DNA (@holons/core/dna owns the meaning):
// how the semantic icon keys a gene or allele carries are drawn here, and
// what each thing core says is wrong with a draft reads like in the screen's
// language. Nothing here decides what is valid.

import {
  ALLELE_ICONS,
  GENE_LIMITS,
  STARTER_LANGS,
  type AlleleIcon,
  type GeneIssueCode,
  type GeneKind,
} from "@holons/core/dna";
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
