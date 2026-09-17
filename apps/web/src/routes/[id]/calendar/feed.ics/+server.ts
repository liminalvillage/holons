// iCal Feed Server Endpoint
// Serves the holon's calendar as an iCal feed for external subscription

import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { env } from "$env/dynamic/private";
import { generateICalFeed } from "$lib/services/icalGenerator";
import type { HoloSphere } from "holosphere";
import { createHoloSphere, resolveRelays } from "@holons/core/holosphere";
import { loadSettings } from "@holons/core/settings";
import { resolveFeedAppName } from "$lib/server/feedEnv";

// Lazy-initialized HoloSphere instance to avoid running during SvelteKit build analysis
let holosphere: HoloSphere;

function getHolosphere() {
  if (!holosphere) {
    // Single source of truth: HOLONS_APP / HOLOSPHERE_RELAYS from the monorepo
    // root .env, defaulting the way the web client does (production → Holons)
    // so a deployed function never reads an empty debug namespace. Read through
    // `$env/dynamic/private`: bare `process.env` never sees the root .env under
    // `vite dev`, which left the dev feed on a different namespace than the
    // dev client. A
    // serverless function has no durable disk, so the store is in memory and
    // each cold start catches the holon's lenses up from the relays (bounded
    // by the sync timeout).
    holosphere = createHoloSphere({
      appName: resolveFeedAppName(env),
      relays: resolveRelays(env.HOLOSPHERE_RELAYS),
      store: { adapter: "memory" },
    });
  }
  return holosphere;
}

/** Upper bound on the per-request relay catch-up (see `catchUp`). */
const RESYNC_TIMEOUT_MS = 4000;

/**
 * Re-read every lens this instance already follows before answering. A lens
 * is caught up from the relays only the first time it is read; afterwards the
 * in-memory store is fed by a live subscription that a frozen serverless
 * function may have lost. Without this, the request that thaws the instance
 * answers from the store as it stood at freeze time — and a calendar app that
 * only re-reads every several hours keeps a moved date stale for another
 * whole cycle. Bounded so an unreachable relay never blocks the feed.
 */
async function catchUp(holo: HoloSphere): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      holo.resyncSubscriptions(),
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

export const GET: RequestHandler = async ({ params }) => {
  const holonId = params.id;

  if (!holonId) {
    throw error(400, "Holon ID is required");
  }

  try {
    const holo = getHolosphere();
    await catchUp(holo);

    // The holon's own settings record is where every surface reads its name
    // (see `nameResolver`); it may come back as an array of entries on older
    // writes. The generator appends "Calendar", so the fallback is bare.
    const settings = await loadSettings(holo, holonId);
    const named = Array.isArray(settings)
      ? settings.find((e: { name?: unknown }) => e?.name)
      : settings;
    const holonName =
      typeof named?.name === "string" && named.name.trim()
        ? named.name.trim()
        : "Holon";

    // Fetch all quests/events from the holon
    const quests = await holo.getAll(holonId, "quests");

    // Filter events that have a 'when' field (are scheduled)
    const scheduledEvents = (quests || []).filter((quest: any) => quest.when);

    // Generate the iCal feed
    const icalContent = generateICalFeed(scheduledEvents, holonName, holonId);

    // Return the iCal feed with proper headers
    return new Response(icalContent, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${holonName.replace(/[^a-z0-9]/gi, "_")}.ics"`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err) {
    console.error("Error generating iCal feed:", err);
    throw error(500, "Failed to generate calendar feed");
  }
};
