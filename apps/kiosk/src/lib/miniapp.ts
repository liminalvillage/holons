// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk as a Telegram Mini App — one service per app, the way Elinor is
// one app for shifts. Each service is registered with BotFather under its tab
// id and points at that tab's path (`t.me/<bot>/tasks` → hubs.network/tasks);
// the bot's buttons carry the holon as `startapp=<holon>`. Opened that way the
// kiosk shows just that view: no dock, no tab strip, no rotation, and the
// launch itself (`initData`, verified server-side) is the login.

import { parseHolonRef } from "./holons";

/** The slice of `window.Telegram.WebApp` the kiosk uses. */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number }; start_param?: string };
  ready: () => void;
  expand: () => void;
  disableVerticalSwipes?: () => void;
}

/** What a Mini App launch tells the kiosk before anything is verified. */
export interface MiniAppLaunch {
  /** Signed launch data, for the server to verify (the login). */
  initData: string;
  /** `startapp` from the button that opened the app, if any. */
  startParam: string | null;
  /** The launching Telegram user (unverified — routing only, never auth). */
  userId: string | null;
}

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const tg = (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram;
  return tg?.WebApp?.initData ? tg.WebApp : null;
}

/** The current Mini App launch, or null when not opened inside Telegram. */
export function miniAppLaunch(): MiniAppLaunch | null {
  const app = webApp();
  if (!app) return null;
  const unsafe = app.initDataUnsafe ?? {};
  return {
    initData: app.initData,
    startParam: unsafe.start_param?.trim() || null,
    userId: unsafe.user?.id != null ? String(unsafe.user.id) : null,
  };
}

/**
 * The holon a launch is about: the one its button named (`startapp=<holon>`,
 * any shape `parseHolonRef` reads — an id, a label, a founded id), else the
 * launching person's own holon — a bare `t.me/<bot>/tasks` from a private
 * chat opens your personal board.
 */
export function holonForLaunch(launch: MiniAppLaunch | null): string | null {
  if (!launch) return null;
  const named = launch.startParam ? parseHolonRef(launch.startParam) : null;
  return named ?? launch.userId;
}

/** Tell Telegram the app is up: full height, and no swipe-to-close stealing drags. */
export function settleMiniApp(): void {
  const app = webApp();
  if (!app) return;
  app.ready();
  app.expand();
  app.disableVerticalSwipes?.();
}
