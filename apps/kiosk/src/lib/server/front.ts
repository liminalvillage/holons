// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The public front page endpoint's logic — GET /api/front/<holon>.
//
// The route file (`routes/api/front/[holon]/+server.ts`) is a thin shell: a
// SvelteKit server route may export only HTTP verbs, so the behaviour lives
// here where a spec can drive it with an in-memory instance.
//
// What this answers is a holon's PUBLIC face: `@holons/core/dna`
// `readHolonFront` — name, about, genes, the DNA hash, how joining works —
// as JSON validated by `packages/core/schemas/holon-front.schema.json`. The
// website and any other site read it cross-origin, so:
//
//   • reads are ENFORCED, always. `enforce` is not taken from the
//     environment (`HOLOSPHERE_ENFORCE=off` is a tooling switch for the
//     open graph); with it off, a gene a member forged would be served as
//     the holon's word. `readHolonFront` also refuses an instance that
//     does not enforce, so a wrong instance fails loudly instead of lying.
//   • no viewer: the answer is the anonymous visitor's, identical for every
//     caller, so a shared cache may keep it. The instance never receives a
//     caller's key, and the `viewer` field is the anonymous one.
//   • nothing private can reach it: the instance holds no vault key, the
//     view model is a whitelist (it never copies a lens through), and the
//     `genes` lens is never private.
//   • the instance never writes: no ledger, roster mirror or registry
//     hooks, and nothing here puts a record.
//
// Netlify gives a function 10 s. A cold instance catches the holon up from
// the relays inside a bound (`ENDPOINT_CATCH_UP_MS`, below core's own
// default); past it — or when the holon's authority or genes have not
// arrived, which core will not present as "no DNA" — the answer is a 503
// that says to retry and is never cached, and the caught-up
// part stays in the in-memory store, so the retry is fast (best effort: a
// frozen lambda may not finish it).
//
// A caller can vary the id to get past the CDN; the cost is bounded by
// Netlify's concurrency and by `maxHolons` (a fresh instance per 100
// distinct ids). A per-IP limit would be the next step.

import type { HoloSphere } from "holosphere";
import { createHoloSphere } from "@holons/core/holosphere";
import { readHolonFront, HolonFrontUnreachable } from "@holons/core/dna";
import { resolveFeedAppName, resolveFeedRelays } from "$lib/server/feedEnv";

type Env = Record<string, string | undefined>;

/** A holon id as every surface spells one: a Telegram id, `holon_…`, a hex cell. */
export const HOLON_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Upper bound on one request's relay catch-up: inside Netlify's 10 s with room for the rest. */
export const ENDPOINT_CATCH_UP_MS = 5000;

/**
 * The CDN keeps an answer five minutes and may serve a stale one for an hour
 * while it re-reads: a DNA changes rarely and the front is read far more
 * often than it is edited. No `max-age`: a browser always asks the CDN.
 */
export const FRONT_CACHE = "public, s-maxage=300, stale-while-revalidate=3600";

/**
 * An answer without a DNA is either a holon that has none (or nobody who
 * speaks for it) or a read the relays did not fully answer (a refused
 * connection or an empty reply looks the same as "none"). The second must
 * not sit in the CDN for five minutes as if it were the holon's word, so any
 * empty front is kept only briefly, and never served stale.
 */
export const FRONT_CACHE_EMPTY = "public, s-maxage=30";

/** Seconds a client is asked to wait before retrying a cold read that ran out of time. */
const RETRY_SECONDS = 5;

/** Reads from any origin, never with credentials: a GET answer that is the same for everyone. */
const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
};

function reply(
  status: number,
  body: unknown,
  cache: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cache,
      "x-content-type-options": "nosniff",
      ...CORS,
      ...extra,
    },
  });
}

export interface FrontServiceOptions {
  /** Builds the instance a read uses. Called lazily, again after a rotation. */
  holosphere: () => HoloSphere;
  /** Bound on the relay catch-up of one read (default {@link ENDPOINT_CATCH_UP_MS}). */
  catchUpMs?: number;
  /**
   * Distinct holons one instance serves before it is replaced by a fresh
   * one, so a caller walking ids cannot grow a function's memory without
   * bound (default 100).
   */
  maxHolons?: number;
}

export interface FrontService {
  get(holon: string): Promise<Response>;
  options(): Response;
}

/** The endpoint: `get` answers a holon's front, `options` the CORS preflight. */
export function createFrontService(opts: FrontServiceOptions): FrontService {
  const catchUpMs = opts.catchUpMs ?? ENDPOINT_CATCH_UP_MS;
  const maxHolons = opts.maxHolons ?? 100;
  let current: HoloSphere | null = null;
  const served = new Set<string>();

  function instance(holon: string): HoloSphere {
    if (current && served.size >= maxHolons && !served.has(holon)) {
      const old = current;
      current = null;
      served.clear();
      // Requests still reading the old one finish before it closes.
      const timer = setTimeout(() => {
        void Promise.resolve(old.close?.()).catch(() => {});
      }, 30_000);
      (timer as { unref?: () => void }).unref?.();
    }
    current ??= opts.holosphere();
    served.add(holon);
    return current;
  }

  return {
    options: () =>
      new Response(null, {
        status: 204,
        headers: { ...CORS, "cache-control": "public, max-age=86400" },
      }),

    async get(holon) {
      const id = String(holon ?? "").trim();
      if (!HOLON_ID.test(id))
        return reply(
          400,
          { error: "bad-holon", message: "Not a holon id" },
          "public, s-maxage=60",
        );
      try {
        // No `viewer`: this answer is the anonymous visitor's, whoever asks.
        const front = await readHolonFront(instance(id), id, { catchUpMs });
        return reply(200, front, front.empty ? FRONT_CACHE_EMPTY : FRONT_CACHE);
      } catch (e) {
        if (e instanceof HolonFrontUnreachable)
          return reply(
            503,
            { error: "unreachable", holon: id, message: e.message },
            "no-store",
            { "retry-after": String(RETRY_SECONDS) },
          );
        console.error(
          "[api/front] failed:",
          e instanceof Error ? e.message : "unknown",
        );
        return reply(500, { error: "failed" }, "no-store");
      }
    },
  };
}

/**
 * The deployed instance: the screens' namespace and relays
 * (`$lib/server/feedEnv`), an in-memory store (a function has no durable
 * disk), enforced reads and no write hooks.
 */
export function deployedHolosphere(env: Env): HoloSphere {
  return createHoloSphere({
    appName: resolveFeedAppName(env),
    relays: resolveFeedRelays(env),
    store: { adapter: "memory" },
    // Hardcoded, never `resolveEnforce(env…)`: see the header.
    enforce: true,
    ledger: false,
    rosterMirror: false,
    registry: false,
  });
}
