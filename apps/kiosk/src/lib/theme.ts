// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Day/night theming for the kiosk. An entrance display runs unattended for
// weeks, so the palette should follow the room's light: warm paper by day, deep
// slate after sunset. In `auto` the switch happens at the *real* local sunset —
// computed offline from the device's coordinates with the US Naval Observatory
// almanac formula (no network; the kiosk is offline-first) — falling back to
// fixed evening hours when geolocation is denied. A caretaker can also pin the
// theme to light or dark from Settings.

import { writable, get } from "svelte/store";
import {
  type ThemeMode,
  resolveGeo,
  setGeo,
  setResolvedTheme,
  DARK_FALLBACK_START_HOUR,
  DARK_FALLBACK_END_HOUR,
} from "./config";

export type { ThemeMode };

/** Caretaker preference: `auto` (sunset-driven), or pinned `light` / `dark`. */
export const themeMode = writable<ThemeMode>("auto");
/** The palette actually on screen — mirrors `data-theme` on <html>. */
export const activeTheme = writable<"light" | "dark">("light");

const RAD = Math.PI / 180;

function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((today - start) / 86_400_000);
}

/** Positive modulo (JS `%` keeps the sign of the dividend). */
function mod(v: number, max: number): number {
  return ((v % max) + max) % max;
}

/**
 * Sunrise or sunset as a Date for the given day and coordinates, via the US
 * Naval Observatory almanac algorithm (official zenith 90.833°). Returns null on
 * polar days where the sun never crosses the horizon — the caller then uses the
 * fixed-hour fallback.
 */
function sunEvent(
  date: Date,
  lat: number,
  lng: number,
  rising: boolean,
): Date | null {
  const zenith = 90.833;
  const N = dayOfYear(date);
  const lngHour = lng / 15;
  const t = N + ((rising ? 6 : 18) - lngHour) / 24;
  const M = 0.9856 * t - 3.289;
  let L =
    M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
  L = mod(L, 360);
  let RA = mod(Math.atan(0.91764 * Math.tan(L * RAD)) / RAD, 360);
  // Put RA in the same quadrant as L.
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;
  const sinDec = 0.39782 * Math.sin(L * RAD);
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH =
    (Math.cos(zenith * RAD) - sinDec * Math.sin(lat * RAD)) /
    (cosDec * Math.cos(lat * RAD));
  if (cosH > 1 || cosH < -1) return null; // sun never rises / never sets here
  const H = (rising ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD) / 15;
  const T = H + RA - 0.06571 * t - 6.622;
  const UT = mod(T - lngHour, 24);
  const base = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return new Date(base + UT * 3_600_000);
}

function isNight(
  date: Date,
  mode: ThemeMode,
  geo: { lat: number; lng: number } | null,
): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  if (geo) {
    const sunrise = sunEvent(date, geo.lat, geo.lng, true);
    const sunset = sunEvent(date, geo.lat, geo.lng, false);
    if (sunrise && sunset) return date < sunrise || date >= sunset;
  }
  const h = date.getHours();
  return h >= DARK_FALLBACK_START_HOUR || h < DARK_FALLBACK_END_HOUR;
}

function apply(theme: "light" | "dark"): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  setResolvedTheme(theme);
  activeTheme.set(theme);
}

/**
 * Start the day/night controller. Applies the right palette now, re-checks every
 * minute (sunset drifts only minutes per day, so a coarse tick is ample) and
 * immediately whenever the caretaker changes the mode. In `auto` it asks the
 * browser for coordinates once, caching the fix so a later power-cycle still
 * tracks the real horizon even offline. Returns a teardown fn.
 */
export function startTheme(): () => void {
  let geo = resolveGeo();

  const evaluate = () =>
    apply(isNight(new Date(), get(themeMode), geo) ? "dark" : "light");

  // Fires immediately on subscribe (initial paint) and on every Settings change.
  const unsub = themeMode.subscribe(() => evaluate());
  const timer = setInterval(evaluate, 60_000);

  // One geolocation fix in auto mode; refine the palette once it lands.
  if (
    get(themeMode) === "auto" &&
    typeof navigator !== "undefined" &&
    navigator.geolocation
  ) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGeo(geo);
        evaluate();
      },
      () => {
        /* denied / unavailable — the fixed-hour fallback is already applied */
      },
      { timeout: 10_000, maximumAge: 6 * 3_600_000 },
    );
  }

  return () => {
    unsub();
    clearInterval(timer);
  };
}
