// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// One short line at the bottom of the screen ("Link copied"), gone by itself.

import { writable } from "svelte/store";

export const notice = writable<string>("");

let timer: ReturnType<typeof setTimeout> | null = null;

export function showNotice(text: string, ms = 2600): void {
  if (timer) clearTimeout(timer);
  notice.set(text);
  timer = setTimeout(() => notice.set(""), ms);
}

/** Share a link the way the device shares, else copy it. True when it went somewhere. */
export async function shareLink(
  url: string,
  title: string,
): Promise<"shared" | "copied" | "failed"> {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      await navigator.share({ url, title });
      return "shared";
    }
  } catch (err) {
    // Dismissing the share sheet is not a failure to report.
    if ((err as Error)?.name === "AbortError") return "shared";
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
