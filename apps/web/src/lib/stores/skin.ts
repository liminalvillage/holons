// Visual skin for harvest-web.
//
// The default "blackboard" is the dark theme baked into theme.css + Tailwind
// utilities. "whiteboard" is the light, paper-and-ink counterpart layered on
// top via styles/whiteboard.css, switched by a `data-skin` attribute on
// <html>. The choice is persisted in localStorage and applied as early as
// possible (an inline boot script in app.html) to avoid a flash.

import { writable, get } from "svelte/store";
import { browser } from "$app/environment";

export type Skin = "blackboard" | "whiteboard";

const STORAGE_KEY = "harvest_skin";

/** Built-in accent per skin (mirrors theme.css / whiteboard.css). Used as the
 *  colour-picker default before any custom override. */
export const DEFAULT_ACCENT: Record<Skin, string> = {
  blackboard: "#4f46e5",
  whiteboard: "#3b9ef5",
};

const accentKey = (s: Skin) => `harvest_accent_${s}`;

function stored(): Skin {
  if (!browser) return "blackboard";
  try {
    return localStorage.getItem(STORAGE_KEY) === "whiteboard"
      ? "whiteboard"
      : "blackboard";
  } catch {
    return "blackboard";
  }
}

export const skin = writable<Skin>(stored());

/** Reflect the skin onto <html> so the CSS scope kicks in. */
export function applySkin(value: Skin): void {
  if (browser) document.documentElement.setAttribute("data-skin", value);
}

/** Set, persist, and apply a skin (and re-apply that skin's accent override). */
export function setSkin(value: Skin): void {
  skin.set(value);
  if (!browser) return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* private mode — session-only */
  }
  applySkin(value);
  applyAccent();
}

/** Flip between the two skins. */
export function toggleSkin(): void {
  setSkin(get(skin) === "whiteboard" ? "blackboard" : "whiteboard");
}

// ── Custom accent override ───────────────────────────────────────────────---
//
// The accent is centralized to the --color-accent* tokens. A user can override
// them per skin via a colour picker; the chosen hex is stored per skin and
// applied as inline custom properties on <html> (which outrank the stylesheet).
// `null` means "use the skin's built-in accent". The same logic runs in the
// app.html boot script so there's no flash on reload.

function initialAccent(): string | null {
  if (!browser) return null;
  try {
    const a = localStorage.getItem(accentKey(stored()));
    return a && /^#[0-9a-fA-F]{6}$/.test(a) ? a : null;
  } catch {
    return null;
  }
}

/** The active skin's custom accent hex, or null when using the default. */
export const accentOverride = writable<string | null>(initialAccent());

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
/** Mix `hex` toward `target` ({r,g,b}) by `amt` (0..1) → "#rrggbb". */
function mix(hex: string, target: { r: number; g: number; b: number }, amt: number): string {
  const a = hexToRgb(hex);
  const c = [
    clampByte(a.r + (target.r - a.r) * amt),
    clampByte(a.g + (target.g - a.g) * amt),
    clampByte(a.b + (target.b - a.b) * amt),
  ];
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Read the stored override for the active skin and apply (or clear) the vars. */
export function applyAccent(): void {
  if (!browser) return;
  const s = get(skin);
  let hex: string | null = null;
  try {
    hex = localStorage.getItem(accentKey(s));
  } catch {
    /* ignore */
  }
  const st = document.documentElement.style;
  const tokens = [
    "--color-accent",
    "--color-accent-hover",
    "--color-accent-light",
    "--color-accent-subtle",
  ];
  if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    const { r, g, b } = hexToRgb(hex);
    st.setProperty("--color-accent", hex);
    st.setProperty("--color-accent-hover", mix(hex, { r: 0, g: 0, b: 0 }, 0.16));
    st.setProperty("--color-accent-light", mix(hex, { r: 255, g: 255, b: 255 }, 0.18));
    st.setProperty("--color-accent-subtle", `rgba(${r}, ${g}, ${b}, 0.14)`);
    accentOverride.set(hex);
  } else {
    for (const t of tokens) st.removeProperty(t);
    accentOverride.set(null);
  }
}

/** Set + persist a custom accent for the active skin. */
export function setAccent(hex: string): void {
  if (!browser || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  try {
    localStorage.setItem(accentKey(get(skin)), hex);
  } catch {
    /* ignore */
  }
  applyAccent();
}

/** Clear the active skin's custom accent (revert to the built-in default). */
export function clearAccent(): void {
  if (!browser) return;
  try {
    localStorage.removeItem(accentKey(get(skin)));
  } catch {
    /* ignore */
  }
  applyAccent();
}
