// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Namespace + relay resolution for the kiosk's server-side Holosphere reads
// (the calendar feed). Mirrors the client's `resolveAppName`/`resolveRelays`
// in $lib/config so a serverless function reads the SAME data the screens
// show: a deployed site that never set `HOLONS_APP` must still land on the
// production namespace, not an empty debug one — that gap is exactly how the
// hubs.network feed served an empty calendar (2026-09-13).

import { resolveRelays as coreResolveRelays } from "@holons/core/holosphere";

type Env = Record<string, string | undefined>;

/** The Holosphere app namespace a server route reads. */
export function resolveFeedAppName(env: Env): string {
  const pick = (v: string | undefined) => (v && String(v).trim()) || "";
  return (
    pick(env.HOLONS_APP) ||
    pick(env.VITE_KIOSK_APP) ||
    pick(env.VITE_HOLONS_APP) ||
    "Holons"
  );
}

/** The relay set a server route syncs over — same precedence as the client. */
export function resolveFeedRelays(env: Env): string[] {
  const raw =
    env.HOLOSPHERE_RELAYS ||
    env.VITE_KIOSK_RELAYS ||
    env.VITE_HOLOSPHERE_RELAYS ||
    "";
  return coreResolveRelays(String(raw));
}
