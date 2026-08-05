// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Static app copy — onboarding slides, compose options, navigation. All
// screen *content* is live from Holosphere (see live.ts).

import type { IconName } from "./icons";

export const ONB = [
  {
    t: "The economy already has everything you need.",
    b: "It just has no idea where you are standing. WeQuest starts from the need, not the shelf.",
    c: "Go on",
  },
  {
    t: "Your cell is your neighbourhood.",
    b: "The world is cut into hexagons of about 400 metres. Your holon claims one, and its needs light up the shared map.",
    c: "Claim your cell",
  },
  {
    t: "What do you already know how to do?",
    b: "Cooking · Cargo bike · Electrics · Childcare · Sourdough. Time is the one thing everyone is born with.",
    c: "Start with a list",
  },
] as const;

export interface HexCellInfo {
  key: string;
  name: string;
  dist: string;
  summary: string;
  tags: string[];
}

export const SUGGESTIONS = [
  "Sourdough ×2",
  "Passata ×6",
  "A hand drill",
  "2 h childcare",
];

export const KINDS: Array<{ label: string; icon: IconName }> = [
  { label: "Good", icon: "bag" },
  { label: "Time", icon: "clock" },
  { label: "Thing to borrow", icon: "repeat" },
];

export const RINGS = ["This cell", "2 rings", "5 rings", "The world"];

export const NAV: Array<{ label: string; k: string; to: string }> = [
  { label: "Hex", k: "home", to: "home" },
  { label: "List", k: "list", to: "list" },
  { label: "Coops", k: "coop", to: "coop" },
  { label: "Wallet", k: "wallet", to: "wallet" },
  { label: "You", k: "profile", to: "profile" },
];
