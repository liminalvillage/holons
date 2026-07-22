// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Self-updating for unattended screens.
//
// The service worker installs new builds eagerly (skipWaiting + claim), but
// the already-running page keeps executing its old JavaScript until a reload —
// and a wall kiosk is never reloaded by hand. Worse, browsers only check for a
// new service worker on navigation, which a kiosk also never does. Together
// that leaves deployed fixes sitting on the CDN while every screen runs
// whatever build was current when it was last power-cycled.
//
// This module closes both gaps: it polls for a new service worker on an hourly
// timer, and when one takes control it reloads the page — but only once the
// screen is idle, so an update never yanks the board out from under someone
// reading, editing, or mid-voice-conversation.

import { get } from "svelte/store";
import {
  idle,
  selection,
  settingsOpen,
  userMenuOpen,
  completionRequest,
} from "./stores";
import { loginOpen } from "./auth";
import {
  status as voiceStatus,
  bubbleOpen,
  typeOpen,
} from "./voice/controller";

/** How often to ask the browser to re-check the service worker script. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** How often to re-test "is the screen idle yet?" once an update is pending. */
const RELOAD_RETRY_MS = 30 * 1000;

/** True when nobody is using the screen and nothing user-facing is open. */
function safeToReload(): boolean {
  return (
    get(idle) &&
    get(selection) == null &&
    get(completionRequest) == null &&
    !get(settingsOpen) &&
    !get(userMenuOpen) &&
    !get(loginOpen) &&
    !get(bubbleOpen) &&
    !get(typeOpen) &&
    get(voiceStatus) === "ready"
  );
}

/**
 * Start the update watcher. Returns a teardown function (for symmetry with the
 * other layout-owned services; in practice the page reloads or closes).
 */
export function startSwAutoReload(): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => {};
  }

  // Only a page that ALREADY had a controller should reload on controllerchange
  // — on the very first visit the initial worker claiming the page fires the
  // same event, and reloading there would loop a fresh install.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let reloading = false;

  const tryReload = () => {
    reloadTimer = null;
    if (reloading) return;
    if (safeToReload()) {
      reloading = true;
      location.reload();
    } else {
      reloadTimer = setTimeout(tryReload, RELOAD_RETRY_MS);
    }
  };

  const onControllerChange = () => {
    if (hadController && !reloadTimer && !reloading) tryReload();
  };
  navigator.serviceWorker.addEventListener(
    "controllerchange",
    onControllerChange,
  );

  // A never-navigating page must poll, or the browser never fetches the new
  // service worker script and controllerchange never fires.
  const checkTimer = setInterval(() => {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update())
      .catch(() => {
        /* offline or no registration — try again next hour */
      });
  }, UPDATE_CHECK_MS);

  return () => {
    navigator.serviceWorker.removeEventListener(
      "controllerchange",
      onControllerChange,
    );
    clearInterval(checkTimer);
    if (reloadTimer) clearTimeout(reloadTimer);
  };
}
