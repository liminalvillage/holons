// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "Add to Home Screen". The kiosk is already an installable PWA (manifest +
// service worker); what was missing is a way to be TOLD so — browsers bury
// it, and each buries it somewhere else:
//
//  - Chromium (Android, desktop) hands the page a `beforeinstallprompt` event
//    it can replay from its own button → `prompt`: one tap installs.
//  - iOS has no API at all, in any browser: the only road is Share → "Add to
//    Home Screen" → `ios`: show those steps.
//  - Everything else that can install (Firefox on Android, Safari on a Mac)
//    does it from its own menu → `manual`: say where to look.
//  - Already running from the home screen, or inside Telegram's in-app
//    browser (which can't install anything) → `hidden`: offer nothing.

import { writable, type Readable } from "svelte/store";
import { showNotice } from "./stores";
import { tr } from "./i18n";

export type InstallMode = "hidden" | "prompt" | "ios" | "manual";

/** Chromium's install event — not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** Stashed by the inline script in app.html — the event can fire before
     *  the app bundle has hydrated, and it only fires once. */
    __installPrompt?: Event | null;
  }
}

export interface InstallEnv {
  /** Launched from the home screen (display-mode, or iOS's own flag). */
  standalone: boolean;
  /** Inside Telegram's in-app browser. */
  inTelegram: boolean;
  /** A `beforeinstallprompt` event is in hand. */
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
}

/** iPhone/iPod/iPad — an iPad asks for desktop sites, so it says "Macintosh"
 *  and only its touch screen gives it away. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function resolveInstallMode(env: InstallEnv): InstallMode {
  if (env.standalone || env.inTelegram) return "hidden";
  if (env.hasPrompt) return "prompt";
  if (isIos(env.userAgent, env.maxTouchPoints)) return "ios";
  return "manual";
}

const mode = writable<InstallMode>("hidden");
/** How this device can be offered the install, kept current by the watcher. */
export const installMode: Readable<InstallMode> = { subscribe: mode.subscribe };

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;

function isStandalone(): boolean {
  return (
    ["standalone", "fullscreen", "minimal-ui"].some(
      (m) => window.matchMedia(`(display-mode: ${m})`).matches,
    ) || (navigator as { standalone?: boolean }).standalone === true
  );
}

function refresh(): void {
  const tg = (window as { Telegram?: { WebApp?: { initData?: string } } })
    .Telegram;
  mode.set(
    resolveInstallMode({
      standalone: installed || isStandalone(),
      inTelegram: !!tg?.WebApp?.initData,
      hasPrompt: !!deferred,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    }),
  );
}

/** Start tracking installability. Returns a teardown function. */
export function startInstallWatcher(): () => void {
  if (typeof window === "undefined") return () => {};

  deferred = (window.__installPrompt as BeforeInstallPromptEvent) ?? null;

  const onPrompt = (e: Event) => {
    e.preventDefault(); // our button, not the browser's mini-infobar
    deferred = e as BeforeInstallPromptEvent;
    refresh();
  };
  const onInstalled = () => {
    deferred = null;
    window.__installPrompt = null;
    installed = true;
    refresh();
    showNotice(tr("install.done"));
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  refresh();

  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/**
 * Raise the browser's own install dialog (`prompt` mode). The event is
 * single-use: whatever the answer, it is spent, and the browser fires a fresh
 * one if the app is still installable. Resolves true when it was accepted.
 */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null;
  window.__installPrompt = null;
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  } finally {
    refresh();
  }
}
