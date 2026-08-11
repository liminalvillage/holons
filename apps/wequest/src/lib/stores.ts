// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// App state — a direct port of the design doc's DCLogic component state.

import { writable } from "svelte/store";

export type Screen =
  | "onb"
  | "home"
  | "list"
  | "quest"
  | "handoff"
  | "coop"
  | "barter"
  | "group"
  | "wallet"
  | "profile";

const ONBOARDED_KEY = "wequest_onboarded";
const seenOnboarding = (() => {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(ONBOARDED_KEY) === "1"
    );
  } catch {
    return false;
  }
})();

export const screen = writable<Screen>(seenOnboarding ? "home" : "onb");

/** The manifesto plays once — remember it was seen across launches. */
export function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* private mode — it replays, harmlessly */
  }
}
export const onbStep = writable(0);
export const mode = writable<"need" | "give">("need");
export const ring = writable(2);
export const composeOpen = writable(false);
/** What the compose sheet publishes: a need (default) or a standing offer. */
export const composeIntent = writable<"need" | "offer">("need");
/** The claim-your-cell overlay (HexPicker). */
export const hexPickerOpen = writable(false);
export const draft = writable("");
export const toast = writable<string | null>(null);

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Show a transient toast (2.6 s, matching the design). */
export function flash(msg: string): void {
  toast.set(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.set(null), 2600);
}

/**
 * One-shot navigation intent read by history.ts: `replace` swaps the current
 * history entry instead of pushing, for redirects the back button must not
 * revisit (Handoff → Wallet after settlement, Onboarding → Home).
 */
export const navIntent = { replace: false };

export function go(s: Screen, opts: { replace?: boolean } = {}): void {
  navIntent.replace = opts.replace === true;
  screen.set(s);
}

/** Screens that show the bottom nav. */
export const NAV_SCREENS: Screen[] = [
  "home",
  "list",
  "coop",
  "wallet",
  "profile",
];
