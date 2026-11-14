// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// How the dashboard draws the semantic icon keys a gene or allele carries
// (@holons/core/dna owns the set): Font Awesome, which this app bundles. The
// `Record` makes a key core adds without a picture here a type error. Never a
// glyph or an emoji: only as constant as the fonts of the device showing it.

import { ALLELE_ICONS, isAlleleIcon, type AlleleIcon } from "@holons/core/dna";

export const ALLELE_ICON_CLASS: Record<AlleleIcon, string> = {
  home: "fa-house",
  map: "fa-map",
  compass: "fa-compass",
  earth: "fa-earth-americas",
  flag: "fa-flag",
  book: "fa-book-open",
  scroll: "fa-scroll",
  link: "fa-link",
  calendar: "fa-calendar-check",
  clock: "fa-clock",
  key: "fa-key",
  lock: "fa-lock",
  shield: "fa-shield-halved",
  food: "fa-utensils",
  bed: "fa-bed",
  tools: "fa-screwdriver-wrench",
  solar: "fa-solar-panel",
  bolt: "fa-bolt",
  industry: "fa-industry",
  chip: "fa-microchip",
  code: "fa-laptop-code",
  robot: "fa-robot",
  video: "fa-video",
  chat: "fa-comments",
  mail: "fa-envelope-open-text",
  send: "fa-paper-plane",
  phone: "fa-mobile-screen",
  person: "fa-user",
  "person-check": "fa-user-check",
  people: "fa-people-group",
  community: "fa-people-roof",
  handshake: "fa-handshake",
  hand: "fa-hand",
  care: "fa-hand-holding-heart",
  teach: "fa-chalkboard-user",
  walk: "fa-shoe-prints",
  travel: "fa-person-walking-luggage",
  coins: "fa-coins",
  gift: "fa-gift",
  heart: "fa-heart",
  star: "fa-star",
  trophy: "fa-trophy",
  balance: "fa-scale-balanced",
  seedling: "fa-seedling",
  leaf: "fa-leaf",
  tree: "fa-tree",
  water: "fa-water",
  sun: "fa-sun",
  moon: "fa-moon",
  fire: "fa-fire",
  spa: "fa-spa",
  idea: "fa-lightbulb",
  eye: "fa-eye",
  search: "fa-magnifying-glass",
  target: "fa-bullseye",
  network: "fa-circle-nodes",
  cycle: "fa-arrows-rotate",
  lab: "fa-flask",
  broom: "fa-broom",
  pencil: "fa-pen-to-square",
  check: "fa-circle-check",
  info: "fa-circle-info",
  warning: "fa-triangle-exclamation",
  dna: "fa-dna",
};

/** The Font Awesome classes for an icon key (`fa-solid fa-…`); '' for no icon or a key this build does not know. */
export function iconClass(key: string | undefined | null): string {
  return isAlleleIcon(key) ? `fa-solid ${ALLELE_ICON_CLASS[key]}` : "";
}

/** Every key core knows, in core's order: what the spec checks against. */
export const ICON_KEYS: readonly AlleleIcon[] = ALLELE_ICONS;
