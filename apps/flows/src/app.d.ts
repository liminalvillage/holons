// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

declare global {
  namespace App {}
  interface Window {
    /** Chromium's install event, stashed by app.html before hydration. */
    __installPrompt?: Event | null;
    ethereum?: unknown;
  }
}

export {};
