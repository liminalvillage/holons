// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hardware/browser back-button support. Navigation lives in Svelte stores
// (stores.ts `screen`, plus the compose-sheet and hex-picker overlays); this
// module mirrors that state into the History API so pressing back:
//
//   1. closes the topmost open overlay (compose sheet / hex picker), else
//   2. returns to the previously visited screen, else
//   3. leaves the app (only from the root of the visited stack).
//
// Every screen change and overlay-open pushes one history entry; closing an
// overlay from its own ✕ button consumes that entry with history.back() so
// the stack never goes stale. All updates triggered BY popstate are guarded
// (`fromPop`) so they don't push again.

import { get } from "svelte/store";
import {
  screen,
  composeOpen,
  hexPickerOpen,
  navIntent,
  type Screen,
} from "./stores";

type Overlay = "compose" | "hexpicker";

interface NavState {
  wq: true;
  screen: Screen;
  overlay?: Overlay;
}

let fromPop = false;
let inited = false;

function state(): NavState | null {
  const s = history.state as NavState | null;
  return s && s.wq ? s : null;
}

function push(next: NavState): void {
  history.pushState(next, "");
}

export function initHistory(): void {
  if (typeof window === "undefined" || inited) return;
  inited = true;

  // Stamp the entry we were opened on as the root of the visited stack.
  history.replaceState(
    { wq: true, screen: get(screen) } satisfies NavState,
    "",
  );

  screen.subscribe((s) => {
    const replace = navIntent.replace;
    navIntent.replace = false;
    if (fromPop) return;
    const cur = state();
    if (!cur || cur.screen === s) return;
    if (replace)
      history.replaceState({ wq: true, screen: s } satisfies NavState, "");
    else push({ wq: true, screen: s });
  });

  const syncOverlay = (overlay: Overlay, open: boolean) => {
    if (fromPop) return;
    const cur = state();
    if (open) {
      if (cur?.overlay === overlay) return;
      push({ wq: true, screen: get(screen), overlay });
    } else if (cur?.overlay === overlay) {
      // Closed from its own ✕ — consume the entry the open pushed. The
      // resulting popstate re-applies an already-current state (no-op).
      history.back();
    }
  };
  composeOpen.subscribe((open) => syncOverlay("compose", open));
  hexPickerOpen.subscribe((open) => syncOverlay("hexpicker", open));

  window.addEventListener("popstate", (event) => {
    const target = (event.state as NavState | null)?.wq
      ? (event.state as NavState)
      : // An entry from before the app took over — treat it as the root.
        ({ wq: true, screen: get(screen) } satisfies NavState);
    fromPop = true;
    try {
      if (get(composeOpen) && target.overlay !== "compose") {
        composeOpen.set(false);
      }
      if (get(hexPickerOpen) && target.overlay !== "hexpicker") {
        hexPickerOpen.set(false);
      }
      if (get(screen) !== target.screen) screen.set(target.screen);
    } finally {
      fromPop = false;
    }
  });
}
