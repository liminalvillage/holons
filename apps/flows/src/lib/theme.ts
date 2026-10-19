// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Day and night. `auto` follows the device's own setting (a phone in a pocket
// knows better than a sunset table); a pin from the menu overrides it. The
// palette itself is CSS: this only sets `data-theme` on <html>, which
// app.html also does before first paint so a reload never flashes.

import { writable } from "svelte/store";
import { resolveThemeMode, setThemeMode, type ThemeMode } from "./config";

export const themeMode = writable<ThemeMode>(resolveThemeMode());

const wantsDark = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;

/** Which palette a mode means on this device right now. */
export function resolveTheme(
  mode: ThemeMode,
  deviceDark: boolean,
): "light" | "dark" {
  return mode === "auto" ? (deviceDark ? "dark" : "light") : mode;
}

/** Keep `data-theme` on the mode and the device; returns the teardown. */
export function startTheme(): () => void {
  let mode: ThemeMode = "auto";
  const apply = () => {
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = resolveTheme(mode, wantsDark());
  };
  const off = themeMode.subscribe((m) => {
    mode = m;
    setThemeMode(m);
    apply();
  });
  const query =
    typeof window !== "undefined"
      ? window.matchMedia?.("(prefers-color-scheme: dark)")
      : undefined;
  query?.addEventListener?.("change", apply);
  return () => {
    off();
    query?.removeEventListener?.("change", apply);
  };
}
