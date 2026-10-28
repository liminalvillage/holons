// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// Full screen: the board on screen alone, edge to edge — the header, the
// tab strip and the pills band fold away and the view takes the window.
// Not the browser's Fullscreen API (iPad Safari has none for a page): the
// kiosk window is already the whole screen, so it only drops its chrome.
//
// The chrome folds by animating its row to zero height, which needs it
// clipped; but the header lets its search suggestions and "+" menu hang
// below it, so it is clipped only while folded or moving (`fullscreenMotion`
// covers the unfold, until the row is open again).

import { get, writable } from "svelte/store";

/** How long the chrome takes to fold or unfold, in ms (matches the CSS). */
export const FULLSCREEN_MS = 450;

export const boardFullscreen = writable<boolean>(false);
/** True while the chrome is folding or unfolding. */
export const fullscreenMotion = writable<boolean>(false);

let settle: ReturnType<typeof setTimeout> | null = null;

export function setFullscreen(on: boolean): void {
  if (get(boardFullscreen) === on) return;
  fullscreenMotion.set(true);
  boardFullscreen.set(on);
  if (settle) clearTimeout(settle);
  settle = setTimeout(() => {
    settle = null;
    fullscreenMotion.set(false);
  }, FULLSCREEN_MS + 50);
}

export function toggleFullscreen(): void {
  setFullscreen(!get(boardFullscreen));
}
