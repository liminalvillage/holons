// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking the browser where we are — the one place the kiosk does it.
//
// A single `getCurrentPosition` call is not enough in practice. The precise
// path (Core Location on macOS, GPS on a tablet) routinely answers
// POSITION_UNAVAILABLE or nothing at all indoors, on a desktop, or on a
// display wired to ethernet — while the coarse, network-derived fix would
// have answered immediately. So this asks twice: precise first, then coarse,
// and only a real refusal (PERMISSION_DENIED) stops the retry.
//
// It also names WHY it failed. Collapsing every failure into "denied" told a
// caretaker to grant a permission they had already granted; the four reasons
// below map to four different things to do about it.
//
// And when the device simply cannot locate itself — a Mac on a phone hotspot
// or a screen on a 4G router asks Apple about a BSSID no positioning database
// has ever seen, and CoreLocation answers kCLErrorLocationUnknown forever —
// there is a last resort: ask where this IP is. That answer is a city, not a
// doorstep, so it comes back flagged `approximate` and every caller says so
// rather than pretending it picked a block. The lookup only ever runs after
// someone taps My-location AND the browser has already failed, and it sends
// nothing but the request itself (the public IP the service already sees).

import type { MessageKey } from "./i18n/en";

export type GeoFix = { lat: number; lng: number };

export type GeoReason =
  /** No geolocation API at all (an old or locked-down browser). */
  | "unsupported"
  /** Served over plain http from something other than localhost. */
  | "insecure"
  /** The person — or the OS — refused. */
  | "denied"
  /** The browser tried and could not get a fix. */
  | "unavailable"
  /** Nothing came back in time. */
  | "timeout";

export type GeoResult =
  | { ok: true; fix: GeoFix; approximate?: boolean }
  | { ok: false; reason: GeoReason; detail?: string };

/** First ask: the good fix, if it comes quickly. A minute-old one will do. */
const PRECISE: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 6000,
  maximumAge: 60_000,
};
/** Second ask: whatever the network knows, with room to answer. */
const COARSE: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10_000,
  maximumAge: 300_000,
};

/**
 * IP-to-place services, tried in order. Both are keyless and CORS-open; the
 * second only runs if the first is down or rate-limited.
 */
const IP_SERVICES: ReadonlyArray<{
  url: string;
  read: (j: Record<string, unknown>) => GeoFix | null;
}> = [
  {
    url: "https://ipwho.is/",
    read: (j) => (j.success === false ? null : coords(j.latitude, j.longitude)),
  },
  {
    url: "https://ipapi.co/json/",
    read: (j) => coords(j.latitude, j.longitude),
  },
];

/** A pair of numbers, or nothing — these services answer in either shape. */
function coords(lat: unknown, lon: unknown): GeoFix | null {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lon === "string" ? Number(lon) : lon;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  if (a === 0 && b === 0) return null; // null island — an unanswered lookup
  return { lat: a, lng: b };
}

/** Roughly where this network is, when the device itself cannot say. */
async function askTheNetwork(
  fetcher: typeof fetch = fetch,
): Promise<GeoFix | null> {
  for (const svc of IP_SERVICES) {
    try {
      const res = await fetcher(svc.url, {
        signal: AbortSignal.timeout(5000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) continue;
      const fix = svc.read((await res.json()) as Record<string, unknown>);
      if (fix) return fix;
    } catch {
      /* down, blocked or too slow — try the next one */
    }
  }
  return null;
}

/** What a caretaker should be told, per reason. */
const MESSAGES: Record<GeoReason, MessageKey> = {
  unsupported: "hex.noGeo",
  insecure: "hex.insecureGeo",
  denied: "hex.denied",
  unavailable: "hex.geoUnavailable",
  timeout: "hex.geoTimeout",
};

export function geoMessage(reason: GeoReason): MessageKey {
  return MESSAGES[reason];
}

function reasonOf(err: { code?: number } | null | undefined): GeoReason {
  switch (err?.code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    default:
      return "unavailable";
  }
}

/**
 * One `getCurrentPosition`, as a promise that always settles. The watchdog is
 * the point: some browsers never call either callback when the permission
 * prompt is dismissed rather than answered, which would leave the button
 * disabled — spinning on a fix that is never coming — until a reload.
 */
function ask(geo: Geolocation, opts: PositionOptions): Promise<GeoResult> {
  return new Promise((resolve) => {
    let settled = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const done = (r: GeoResult) => {
      if (settled) return;
      settled = true;
      if (guard) clearTimeout(guard);
      resolve(r);
    };
    guard = setTimeout(
      () => done({ ok: false, reason: "timeout" }),
      (opts.timeout ?? 10_000) + 2000,
    );
    try {
      geo.getCurrentPosition(
        (pos) =>
          done({
            ok: true,
            fix: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          }),
        (err) =>
          done({ ok: false, reason: reasonOf(err), detail: err?.message }),
        opts,
      );
    } catch (err) {
      done({ ok: false, reason: "unavailable", detail: String(err) });
    }
  });
}

/**
 * Where we are, or why not. Both call sites (the map's My-location button and
 * the hex picker) go through here so they fail the same way and say the same
 * thing about it.
 */
export async function requestPosition(env?: {
  geo?: Geolocation | null;
  secure?: boolean;
  /** Injected in tests; pass null to skip the IP last resort entirely. */
  fetcher?: typeof fetch | null;
}): Promise<GeoResult> {
  const secure =
    env?.secure ??
    (typeof window === "undefined" ? true : window.isSecureContext !== false);
  const geo =
    env?.geo ??
    (typeof navigator === "undefined" ? null : (navigator.geolocation ?? null));
  const fetcher =
    env?.fetcher === undefined
      ? typeof fetch === "undefined"
        ? null
        : fetch
      : env.fetcher;

  const lastResort = async (failure: GeoResult): Promise<GeoResult> => {
    if (!fetcher) return failure;
    const fix = await askTheNetwork(fetcher);
    return fix ? { ok: true, fix, approximate: true } : failure;
  };

  if (!geo)
    return lastResort({
      ok: false,
      reason: secure ? "unsupported" : "insecure",
    });
  // An insecure origin blocks the browser API, not a plain https lookup.
  if (!secure) return lastResort({ ok: false, reason: "insecure" });

  const precise = await ask(geo, PRECISE);
  if (precise.ok) return precise;
  // A refusal is an answer: someone said no, and going around it over the
  // network would be answering a question they declined.
  if (precise.reason === "denied") return precise;

  const coarse = await ask(geo, COARSE);
  if (coarse.ok) return coarse;
  // A retry that fails differently is less informative than the first try:
  // keep whichever names a cause over a bare timeout.
  const failure =
    coarse.reason === "timeout" && precise.reason !== "timeout"
      ? precise
      : coarse;
  return lastResort(failure);
}
