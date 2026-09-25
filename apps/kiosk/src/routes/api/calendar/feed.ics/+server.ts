// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/calendar/feed.ics?holon=…[&federated=1] — the holon's live calendar
// as an RFC 5545 feed, for anyone to subscribe to from Google/Apple/Nextcloud.
//
// A subscription is a URL a calendar app re-fetches on its own schedule, so
// this is deliberately anonymous and read-only: it says exactly what the
// kiosk's Calendar board already shows in public. `federated=1` widens it to
// the partners the holon federates `quests` with — the same aggregated read
// the board makes when the Scope pill is on the wider circle.
//
// Core owns the feed text (`@holons/core/calendar.generateICalFeed`); this
// route owns only the read and the headers.

import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import type { HoloSphere } from "holosphere";
import { createHoloSphere, resolveEnforce } from "@holons/core/holosphere";
import { resolveFeedAppName, resolveFeedRelays } from "$lib/server/feedEnv";
import { loadSettings } from "@holons/core/settings";
import { generateICalFeed, type HolonEvent } from "@holons/core/calendar";

/**
 * One lazily-built HoloSphere for the whole function instance. A serverless
 * function has no durable disk, so the store is in memory and each cold start
 * catches the holon's lenses up from the relays. The namespace and relays
 * resolve exactly as the screens do (`$lib/server/feedEnv`), so the feed says
 * what the kiosk's Calendar board shows even on a site that only set the
 * client's VITE_* variables.
 */
let holosphere: HoloSphere | null = null;
function getHolosphere(): HoloSphere {
  if (!holosphere) {
    holosphere = createHoloSphere({
      appName: resolveFeedAppName(env),
      relays: resolveFeedRelays(env),
      store: { adapter: "memory" },
      enforce: resolveEnforce(env.HOLOSPHERE_ENFORCE),
    });
  }
  return holosphere;
}

/** How long a calendar app may reuse the feed before re-reading it. */
const CACHE_SECONDS = 900;

/** Upper bound on the per-request relay catch-up (see `catchUp`). */
const RESYNC_TIMEOUT_MS = 4000;

/**
 * Re-read every lens this instance already follows before answering.
 *
 * A lens is caught up from the relays only the FIRST time it is read; after
 * that the in-memory store is fed by a live subscription. A serverless
 * function is frozen between invocations, so that socket may have been dropped
 * while nobody was looking — the request that thaws it would then answer from
 * the store as it stood at freeze time, and a calendar app that only re-reads
 * every several hours keeps a moved date stale for another whole cycle.
 * Bounded: an unreachable relay never blocks the feed, the read proceeds with
 * what is local. On a cold instance there is nothing to re-read yet and the
 * first `getAll` does the full backfill itself.
 */
async function catchUp(hs: HoloSphere): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      hs.resyncSubscriptions(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, RESYNC_TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* relay unreachable — read local */
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** A quest becomes a VEVENT only once it is scheduled. */
function toEvents(quests: unknown[]): HolonEvent[] {
  return (quests ?? [])
    .filter((q): q is Record<string, any> => !!q && typeof q === "object")
    .filter((q) => !!q.when)
    .map((q) => ({
      id: String(q.id ?? q.title ?? ""),
      title: String(q.title ?? "Untitled"),
      description: q.description,
      location: q.location,
      when: q.when,
      ends: q.ends ?? q.until,
      participants: q.participants,
      status: q.status,
      category: q.category,
    }));
}

export const GET: RequestHandler = async ({ url }) => {
  const holon = (url.searchParams.get("holon") || "").trim();
  if (!holon) throw error(400, "Missing holon query parameter");
  const federated = url.searchParams.get("federated") === "1";

  try {
    const hs = getHolosphere();
    await catchUp(hs);
    // The holon's own settings record is where every surface reads its name
    // (see `resolveHolonName` in $lib/holosphere); it may come back as an
    // array of entries on older writes. The generator appends "Calendar", so
    // the fallback is bare.
    const settings = await loadSettings(hs, holon);
    const named = Array.isArray(settings)
      ? settings.find((e: { name?: unknown }) => e?.name)
      : settings;
    const holonName =
      typeof named?.name === "string" && named.name.trim()
        ? named.name.trim()
        : "Holon";

    // Federated reads fold in the partners that share `quests` inbound; the
    // plain read is this holon alone. Either way a quest with no date is not
    // a calendar entry, so `toEvents` drops it.
    const quests = federated
      ? await hs.getFederated(holon, "quests", { includeLocal: true })
      : await hs.getAll(holon, "quests");

    const ical = generateICalFeed(toEvents(quests || []), holonName, holon);
    const fileName = holonName.replace(/[^a-z0-9]/gi, "_");

    return new Response(ical, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        // `inline`, not `attachment`: a subscribing client reads the body,
        // and a browser opening the link shouldn't be handed a download.
        "content-disposition": `inline; filename="${fileName}.ics"`,
        "cache-control": `public, max-age=${CACHE_SECONDS}`,
      },
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    console.error("[calendar/feed.ics] failed:", reason);
    throw error(500, "Failed to generate the calendar feed");
  }
};
