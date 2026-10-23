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

/** Where Telegram's SDK keeps the launch params across reloads of the app. */
const SDK_PARAMS_KEY = "__telegram__initParams";

/**
 * A launch read straight from the URL Telegram opened (`#tgWebAppData=…`),
 * or from the SDK's copy of it when a reload dropped the fragment. The SDK
 * loads `defer` but SvelteKit boots from an inline `import()`, which doesn't
 * wait for it — so on a cached bundle `window.Telegram` is often not there
 * yet at mount, and the URL is the only reliable source.
 */
export function launchFromUrl(
  hash: string,
  stored: string | null = null,
): MiniAppLaunch | null {
  let initData = new URLSearchParams(hash.replace(/^#/, "")).get(
    "tgWebAppData",
  );
  if (!initData && stored) {
    try {
      const saved = JSON.parse(stored) as { tgWebAppData?: unknown };
      if (typeof saved?.tgWebAppData === "string")
        initData = saved.tgWebAppData;
    } catch {
      /* not the SDK's shape: no launch */
    }
  }
  if (!initData) return null;
  const fields = new URLSearchParams(initData);
  let userId: string | null = null;
  try {
    const user = JSON.parse(fields.get("user") ?? "null") as {
      id?: number;
    } | null;
    if (user?.id != null) userId = String(user.id);
  } catch {
    /* no readable user: routing falls back to the start param alone */
  }
  return {
    initData,
    startParam: fields.get("start_param")?.trim() || null,
    userId,
  };
}

let urlLaunch: MiniAppLaunch | null | undefined;

/** The current Mini App launch, or null when not opened inside Telegram. */
export function miniAppLaunch(): MiniAppLaunch | null {
  const app = webApp();
  if (app) {
    const unsafe = app.initDataUnsafe ?? {};
    return {
      initData: app.initData,
      startParam: unsafe.start_param?.trim() || null,
      userId: unsafe.user?.id != null ? String(unsafe.user.id) : null,
    };
  }
  if (typeof window === "undefined") return null;
  // Read once: later navigation may rewrite the fragment.
  if (urlLaunch === undefined) {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(SDK_PARAMS_KEY);
    } catch {
      /* storage blocked */
    }
    urlLaunch = launchFromUrl(location.hash, stored);
  }
  return urlLaunch;
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

/**
 * Tell Telegram the app is up: full height, and no swipe-to-close stealing
 * drags — now, or as soon as the deferred SDK arrives.
 */
export function settleMiniApp(): void {
  if (typeof document === "undefined") return;
  const settle = () => {
    const app = webApp();
    if (!app) return;
    app.ready();
    app.expand();
    app.disableVerticalSwipes?.();
  };
  if (webApp()) return settle();
  document
    .querySelector('script[src*="telegram-web-app.js"]')
    ?.addEventListener("load", settle, { once: true });
}
