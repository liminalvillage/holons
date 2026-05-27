// Pull-side cleanup for dangling federation pointers.
//
// When holosphere can't resolve a hologram (`resolveHologram` returns null),
// it logs `Hologram at <holon>/<lens>/<key> did not resolve (soul=<soul>); skipping.`
// and leaves the pointer in place. The library is right not to delete on its
// own — null fires for transient misses (peer offline, maxDepth, circular
// ref) as well as real tombstones, and the old "delete on first miss"
// behaviour permanently destroyed real data.
//
// We can do better than the library because we control one extra signal:
// access. The dangling pointer lives in OUR holon, which we always have
// write rights to. We re-check the source soul directly, and if Gun returns
// an explicit `null` (tombstone, not `undefined` which means "never seen
// here"), we drop the local pointer.
//
// Hooked via console.warn so we piggyback on holosphere's own detection
// without re-implementing hologram-shape detection or re-walking getAll
// results. Dedup by pointer key so the warning firing on every component
// that calls getAll doesn't trigger N parallel cleanups.

import type { HoloSphere } from "holosphere";

export interface ParsedWarning {
  holon: string;
  lens: string;
  key: string;
  sourceSoul: string;
}

const WARNING_PATTERN =
  /^Hologram at ([^/]+)\/([^/]+)\/([^ ]+) did not resolve \(soul=([^)]+)\); skipping\.$/;

export function parseHologramWarning(message: string): ParsedWarning | null {
  const m = WARNING_PATTERN.exec(message);
  if (!m) return null;
  return { holon: m[1], lens: m[2], key: m[3], sourceSoul: m[4] };
}

function readSourceOnce(
  holosphere: HoloSphere,
  soul: string,
  timeoutMs = 1500,
): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: unknown) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      (holosphere as any).getNodeRef(soul).once((d: unknown) => finish(d));
    } catch {
      finish(undefined);
    }
    setTimeout(() => finish(undefined), timeoutMs);
  });
}

export type CleanupOutcome =
  | "deleted"
  | "source-alive"
  | "source-unknown"
  | "delete-failed";

/**
 * Attempt to clean up a dangling local pointer. Re-reads the source soul:
 *   - `null`     → explicit tombstone; delete the local pointer.
 *   - `undefined`→ peer hasn't seen the soul; transient miss, skip.
 *   - object/str → source has data; the warning was spurious, skip.
 *
 * Exported for tests; production callers should use `installHologramJanitor`.
 */
export async function cleanupDanglingPointer(
  holosphere: HoloSphere,
  p: ParsedWarning,
  options: { readTimeoutMs?: number } = {},
): Promise<CleanupOutcome> {
  const source = await readSourceOnce(
    holosphere,
    p.sourceSoul,
    options.readTimeoutMs ?? 1500,
  );
  if (source === undefined) return "source-unknown";
  if (source !== null) return "source-alive";
  try {
    await (holosphere as any).delete(p.holon, p.lens, p.key);
    return "deleted";
  } catch {
    return "delete-failed";
  }
}

let installed = false;

export function installHologramJanitor(holosphere: HoloSphere): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // Dedup: the same warning fires N times during a getAll iteration and
  // across every component that loads the same lens. One cleanup is enough.
  const handled = new Set<string>();

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    origWarn(...(args as []));
    const first = args[0];
    if (typeof first !== "string") return;
    const parsed = parseHologramWarning(first);
    if (!parsed) return;
    const tag = `${parsed.holon}/${parsed.lens}/${parsed.key}`;
    if (handled.has(tag)) return;
    handled.add(tag);

    void cleanupDanglingPointer(holosphere, parsed)
      .then((outcome) => {
        if (outcome === "deleted") {
          console.info(
            `[hologramJanitor] cleaned ${tag} → ${parsed.sourceSoul} (source tombstoned)`,
          );
        }
        // `source-unknown` and `source-alive` should re-arm: a future
        // getAll may yield definitive info we couldn't read this time.
        if (outcome !== "deleted" && outcome !== "delete-failed") {
          handled.delete(tag);
        }
      })
      .catch((err) => {
        // Never throw out of the warn hook — we'd risk crashing whatever
        // chain was logging.
        origWarn("[hologramJanitor] cleanup failed", tag, err);
        handled.delete(tag);
      });
  };
}
