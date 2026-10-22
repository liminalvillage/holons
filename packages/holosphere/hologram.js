// holo_hologram.js

/**
 * Creates a soul hologram object for a data item
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon where the original data is stored
 * @param {string} lens - The lens where the original data is stored
 * @param {object} data - The data to create a hologram for
 * @returns {object} - A hologram object with id and soul
 */
export function createHologram(holoInstance, holon, lens, data) {
    // Check if the input data is already a hologram
    if (isHologram(data)) {
        // If it is, just return its existing ID and Soul, ignoring the provided holon/lens
        return {
            id: data.id,
            soul: data.soul
        };
    }

    // Original logic: Input data is not a hologram, create a new soul path
    if (!holon || !lens || !data || !data.id) {
        throw new Error('createHologram: Missing required parameters for non-hologram data');
    }

    const soul = `${holoInstance.appname}/${holon}/${lens}/${data.id}`;
    return {
        id: data.id,
        soul: soul
    };
}

/**
 * Parses a soul path into its components.
 * @param {string} soul - The soul path (e.g., "app/holon/lens/key").
 * @returns {object|null} - An object with appname, holon, lens, key, or null if invalid.
 */
export function parseSoulPath(soul) {
    if (typeof soul !== 'string') return null;
    const parts = soul.split('/');
    if (parts.length < 4) return null; // Must have at least app/holon/lens/key

    // Reconstruct key if it contained slashes (though generally disallowed by getNodeRef validation)
    const key = parts.slice(3).join('/');

    return {
        appname: parts[0],
        holon: parts[1],
        lens: parts[2],
        key: key
    };
}

/**
 * Checks if an object is a hologram.
 * This function checks for the presence and type of `id` and `soul` properties,
 * suitable for identifying holograms represented as plain JavaScript objects.
 * It also performs a basic check that the `soul` contains '/' as expected for a path.
 * @param {object | null | undefined} data - The data to check.
 * @returns {boolean} - True if the object is considered a hologram.
 */
export function isHologram(data) {
    if (!data || typeof data !== 'object') {
        return false;
    }

    // Basic check: Does it have an 'id' and a 'soul' which is a non-empty string?
    if (data.id && typeof data.soul === 'string' && data.soul.length > 0) {
         // Optional stricter check: Does the soul look like a valid path?
         // This prevents objects like { id: 1, soul: "hello" } from being counted.
         // We can use a simplified check here or rely on parseSoulPath failing later.
         if (data.soul.includes('/')) { // Simple check for path structure
            return true;
         }
    }

    return false;
}

/**
 * Attaches the canonical `_hologram` envelope to data resolved from a soul reference.
 *
 * This is the SINGLE source of truth for resolved-hologram metadata in HoloSphere.
 * Every code path that returns "data resolved from a hologram reference" must go
 * through this helper so consumers can rely on one shape.
 *
 * @param {object} originalData - The data fetched from the source holon/lens/key.
 * @param {string} hologramSoul - The soul path the hologram pointed at.
 * @returns {object} - originalData merged with `_hologram: { isHologram, soul, sourceHolon, sourceLens, sourceKey, resolvedAt }`.
 */
export function attachHologramMeta(originalData, hologramSoul) {
    const parts = parseSoulPath(hologramSoul);
    return {
        ...originalData,
        _hologram: {
            isHologram: true,
            soul: hologramSoul,
            sourceHolon: parts?.holon ?? null,
            sourceLens: parts?.lens ?? null,
            sourceKey: parts?.key ?? null,
            resolvedAt: Date.now(),
        },
    };
}

/**
 * Outcome codes returned by {@link resolveHologramDetailed}.
 *
 * - `resolved`   – the soul's target was found and is live; `data` is populated.
 * - `deleted`    – the target was found but carries the `_deleted: true`
 *                  soft-tombstone. DEFINITIVE: the item is gone.
 * - `unresolved` – the target did not arrive within the network deadline.
 *                  AMBIGUOUS / TRANSIENT — latency, an offline peer, federation
 *                  in flight, OR a hard `put(null)` delete that left no
 *                  tombstone. Never a delete signal on its own.
 * - `circular`   – the soul chain loops back on itself (see `visited`).
 * - `depth`      – the chain exceeded `maxDepth`.
 * - `invalid`    – the soul isn't a valid `app/holon/lens/key` path.
 * - `error`      – an unexpected error was thrown while resolving.
 */
export const HOLOGRAM_STATUS = Object.freeze({
    RESOLVED: 'resolved',
    DELETED: 'deleted',
    UNRESOLVED: 'unresolved',
    CIRCULAR: 'circular',
    DEPTH: 'depth',
    INVALID: 'invalid',
    ERROR: 'error',
});

/**
 * Statuses for which the local hologram pointer is PROVABLY dead, so a garbage
 * collector can safely delete it. `unresolved` and `error` are deliberately
 * excluded — they're transient and deleting on them destroys real data on the
 * first network hiccup.
 */
export const PRUNABLE_HOLOGRAM_STATUSES = Object.freeze(new Set([
    HOLOGRAM_STATUS.DELETED,
    HOLOGRAM_STATUS.CIRCULAR,
    HOLOGRAM_STATUS.DEPTH,
    HOLOGRAM_STATUS.INVALID,
]));

/** True when `status` means the pointer is provably dead (vs. a transient miss). */
export function isPrunableHologramStatus(status) {
    return PRUNABLE_HOLOGRAM_STATUSES.has(status);
}

/**
 * Resolve a hologram and report WHY it did (or didn't) resolve.
 *
 * Unlike {@link resolveHologram}, which collapses every failure to `null`, this
 * returns a typed envelope so callers can finally tell a DELETION apart from
 * network LATENCY. The two used to be indistinguishable: a tombstoned target
 * was filtered to `null` before the resolver ever saw it, so it looked exactly
 * like a cold/offline miss. Here the target is read with `includeDeleted: true`,
 * so an explicit `_deleted: true` tombstone surfaces as `status: 'deleted'`
 * instead of masquerading as "not present".
 *
 * Note: only the IMMEDIATE target's tombstone is reported as `deleted`. A
 * deletion deeper in a hologram→hologram chain surfaces as `unresolved`
 * (the intermediate read returns `null`), which is the safe, conservative call.
 *
 * This function does NOT log — callers decide how to report each status.
 *
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} hologram - The hologram (`{ id, soul }`) to resolve.
 * @param {object} [options]
 * @param {boolean} [options.followHolograms=true] - Follow nested holograms.
 * @param {Set<string>} [options.visited] - Internal: souls seen on this path (cycle guard).
 * @param {number} [options.maxDepth=10] - Maximum resolution depth.
 * @param {number} [options.currentDepth=0] - Current resolution depth.
 * @returns {Promise<{status: string, data: object|null, soul: string|null, reason: string}>}
 */
export async function resolveHologramDetailed(holoInstance, hologram, options = {}) {
    if (!isHologram(hologram)) {
        // Not a hologram — pass the value straight through as already-resolved.
        return { status: HOLOGRAM_STATUS.RESOLVED, data: hologram, soul: null, reason: 'not-a-hologram' };
    }

    const {
        followHolograms = true,
        visited = new Set(),
        maxDepth = 10,
        currentDepth = 0,
    } = options;

    const soul = hologram.soul;

    // Structural guards first — these are definitive, not transient.
    if (currentDepth >= maxDepth) {
        return { status: HOLOGRAM_STATUS.DEPTH, data: null, soul, reason: `max depth ${maxDepth} reached` };
    }
    if (soul && visited.has(soul)) {
        return { status: HOLOGRAM_STATUS.CIRCULAR, data: null, soul, reason: 'circular soul chain' };
    }

    const soulInfo = parseSoulPath(soul);
    if (!soulInfo) {
        return { status: HOLOGRAM_STATUS.INVALID, data: null, soul, reason: 'invalid soul format' };
    }

    try {
        const nextVisited = new Set(visited);
        nextVisited.add(soul);

        // Read the target across the network (it's almost always a cold
        // cross-holon node) AND ask for tombstones. `includeDeleted: true` is
        // exactly what lets us tell a deletion from a miss — without it `get`
        // would filter a `_deleted: true` target to `null`. `awaitNetwork: true`
        // skips a cold synchronous `undefined` and waits (up to the read
        // deadline) for a peer to answer.
        const originalData = await holoInstance.get(
            soulInfo.holon,
            soulInfo.lens,
            soulInfo.key,
            null,
            {
                resolveHolograms: followHolograms,
                visited: nextVisited,
                maxDepth: maxDepth,
                currentDepth: currentDepth + 1,
                awaitNetwork: true,
                includeDeleted: true,
            }
        );

        // Null after the deadline: ambiguous (latency / offline / in-flight /
        // hard `put(null)` delete). Transient — never treat as a delete signal.
        if (originalData == null || originalData._invalidHologram) {
            return { status: HOLOGRAM_STATUS.UNRESOLVED, data: null, soul, reason: 'target not present within deadline' };
        }

        // Explicit soft-tombstone on the target: a DEFINITIVE deletion.
        if (originalData._deleted === true) {
            return { status: HOLOGRAM_STATUS.DELETED, data: null, soul, reason: 'target soft-deleted (_deleted:true)' };
        }

        // Resolved. Attach the canonical `_hologram` envelope, then stamp the
        // source holon's display name so consumers don't need a second round-trip.
        const withMeta = attachHologramMeta(originalData, soul);
        if (withMeta._hologram?.sourceHolon && typeof holoInstance.getHolonName === 'function') {
            try {
                const sourceHolonName = await holoInstance.getHolonName(withMeta._hologram.sourceHolon);
                if (sourceHolonName) {
                    withMeta._hologram = { ...withMeta._hologram, sourceHolonName };
                }
            } catch { /* best-effort — name lookup must not fail the resolve */ }
        }
        return { status: HOLOGRAM_STATUS.RESOLVED, data: withMeta, soul, reason: 'ok' };
    } catch (error) {
        if (error.message?.startsWith('CIRCULAR_REFERENCE')) {
            return { status: HOLOGRAM_STATUS.CIRCULAR, data: null, soul, reason: 'circular reference thrown mid-chain' };
        }
        console.error(`!!! Error resolving hologram: ${error.message}`, error);
        return { status: HOLOGRAM_STATUS.ERROR, data: null, soul, reason: error.message || 'resolve error' };
    }
}

/**
 * Resolves a hologram to its actual data (backward-compatible shape).
 *
 * Returns the resolved data (with `_hologram` attached) on success, the input
 * unchanged when it isn't a hologram, or `null` for every failure — and
 * preserves the historical console warnings so existing log-scraping janitors
 * keep working. New code that needs to distinguish DELETION from LATENCY should
 * call {@link resolveHologramDetailed} instead.
 *
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {object} hologram - The hologram to resolve.
 * @param {object} [options] - See {@link resolveHologramDetailed}.
 * @returns {Promise<object|null>}
 */
export async function resolveHologram(holoInstance, hologram, options = {}) {
    const { maxDepth = 10 } = options;
    const result = await resolveHologramDetailed(holoInstance, hologram, options);
    switch (result.status) {
        case HOLOGRAM_STATUS.RESOLVED:
            return result.data;
        case HOLOGRAM_STATUS.DEPTH:
            console.warn(`!!! Maximum resolution depth (${maxDepth}) reached for soul: ${result.soul}. Stopping resolution.`);
            return null;
        case HOLOGRAM_STATUS.CIRCULAR:
            console.warn(`!!! CIRCULAR hologram detected for soul: ${result.soul}. Breaking loop.`);
            return null;
        case HOLOGRAM_STATUS.INVALID:
            console.warn(`Invalid soul format: ${result.soul}`);
            return null;
        case HOLOGRAM_STATUS.DELETED:
        case HOLOGRAM_STATUS.UNRESOLVED:
            // A tombstoned target and a never-present one both report the
            // historical message so existing janitors still match. Callers that
            // need to tell them apart use resolveHologramDetailed.
            console.warn(`Could not resolve hologram soul: ${result.soul} (target not present locally)`);
            return null;
        case HOLOGRAM_STATUS.ERROR:
        default:
            return null;
    }
}

/**
 * Session-scoped dedup for the janitor-parseable warning
 *
 *   Hologram at <holon>/<lens>/<key> did not resolve (soul=<soul>); skipping.
 *
 * The line is LOAD-BEARING — a console-hook garbage collector parses it for
 * the LOCAL pointer coordinates, and a regression test pins its shape — but
 * it used to be emitted on EVERY read attempt: each getAll, each get, each
 * subscribe fire and each timed re-resolve re-warned for the same pointer,
 * burying the console on a lens with a few cold or dead pointers. Warn once
 * per (local path, soul) pair per session; when the pointer later resolves,
 * the memo is cleared so a future regression warns again.
 */
const unresolvedWarned = new Set();

/** Emit the unresolved-hologram warning once per (path, soul) per session. */
export function warnHologramUnresolvedOnce(holon, lens, key, soul) {
    const memo = `${holon}/${lens}/${key}|${soul}`;
    if (unresolvedWarned.has(memo)) return;
    unresolvedWarned.add(memo);
    console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${soul}); skipping.`);
}

/** Forget a warned pointer — call on successful resolve so regressions re-warn. */
export function clearHologramUnresolvedWarning(holon, lens, key, soul) {
    unresolvedWarned.delete(`${holon}/${lens}/${key}|${soul}`);
}

// Export all hologram operations as default
export default {
    createHologram,
    parseSoulPath,
    isHologram,
    resolveHologram,
    resolveHologramDetailed,
    attachHologramMeta,
    HOLOGRAM_STATUS,
    PRUNABLE_HOLOGRAM_STATUSES,
    isPrunableHologramStatus,
    warnHologramUnresolvedOnce,
    clearHologramUnresolvedWarning,
};
