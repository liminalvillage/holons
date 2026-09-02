// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Content operations: put / get / getAll / delete / deleteAll over the local
// store. Every write becomes a signed kind-30078 event applied to the store
// (and published by the relay transport when one is configured); every read
// is a synchronous lookup in the store. The hologram redirect and cascade
// rules in `put` are field-incident scar tissue and are kept verbatim.

import { warnHologramUnresolvedOnce, clearHologramUnresolvedWarning } from './hologram.js';
import { isTombstone } from './store/store.js';
import * as PrivateOps from './private-ops.js';

const isGlobalHolon = (holon) => holon === null || holon === undefined || holon === '';
const normHolon = (holon) => (isGlobalHolon(holon) ? null : holon);

/** Fresh copy of a stored item, so callers can mutate what they read. */
export const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** Canonical soul of a stored record (`app/holon/lens/key`, `_g` for globals). */
export function soulOf(holoInstance, holon, lens, key) {
    return holoInstance.store.soulOf(normHolon(holon), lens, key);
}

/**
 * Recursively sanitizes a value for storage.
 *
 * Drops keys whose values would not round-trip through JSON:
 *   - undefined, NaN, Infinity, -Infinity
 *   - functions, symbols, bigints
 * Preserves null (explicit empty value). Guards against circular references.
 * Logs one warning per dropped path so the caller can fix the producer.
 */
function sanitizeForStorage(value, path = '', seen = new WeakSet(), warnings = []) {
    if (value === null) return null;
    const t = typeof value;

    if (t === 'number') {
        if (!Number.isFinite(value)) {
            warnings.push(`${path || '<root>'}: ${value} (non-finite number)`);
            return undefined;
        }
        return value;
    }
    if (t === 'string' || t === 'boolean') return value;
    if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
        warnings.push(`${path || '<root>'}: ${t}`);
        return undefined;
    }

    if (t === 'object') {
        if (seen.has(value)) {
            warnings.push(`${path || '<root>'}: circular reference`);
            return undefined;
        }
        seen.add(value);

        if (Array.isArray(value)) {
            const out = [];
            for (let i = 0; i < value.length; i++) {
                const cleaned = sanitizeForStorage(value[i], `${path}[${i}]`, seen, warnings);
                out.push(cleaned === undefined ? null : cleaned);
            }
            return out;
        }

        const out = {};
        for (const k of Object.keys(value)) {
            const cleaned = sanitizeForStorage(value[k], path ? `${path}.${k}` : k, seen, warnings);
            if (cleaned !== undefined) out[k] = cleaned;
        }
        return out;
    }

    warnings.push(`${path || '<root>'}: unsupported type ${t}`);
    return undefined;
}

/**
 * Write `item` at (holon, lens, key): sign it when a signer is active, apply
 * it to the store, and hand the signed event to the transport. Returns the
 * signed event (or null for a raw local write).
 */
function commit(holoInstance, holon, lens, key, item, options = {}) {
    const store = holoInstance.store;
    const signer = holoInstance._signer;
    const transport = holoInstance._relayTransport;
    const local = !!options.local;
    let event = null;
    if (!options._skipSign && !local && signer) {
        try {
            event = signer.signEnvelope(holoInstance, holon, lens, item, { skipProjections: !!options._skipProjections });
        } catch (e) {
            console.warn('[signing] signEnvelope failed:', e?.message);
        }
    }
    if (event) {
        const r = store.apply(event, { origin: 'local' });
        if (!r.applied && r.reason !== 'seen') {
            console.warn(`[holosphere] local write at ${lens}/${key} was not applied (${r.reason})`);
        }
    } else {
        store.putRaw(holon, lens, String(key), item, { origin: options._skipSign ? 'remote' : 'raw' });
    }
    if (transport && !options._skipPublish && !local) {
        try {
            transport.publishWrite(holon, lens, item, {
                key: String(key),
                signedEvent: event,
                skipProjections: !!options._skipProjections,
            });
        } catch (e) {
            console.warn('[nostr] publish failed:', e?.message);
        }
    }
    return event;
}

/**
 * Stores content in the specified holon and lens.
 * If the target path already contains a hologram, the put operation will be
 * redirected to store the new data at the location specified in the existing
 * hologram's soul. If the stored data (after potential redirection) is a
 * hologram, the store's backlink index records it for the update cascade.
 *
 * @param {HoloSphere} holoInstance
 * @param {string|null} holon - null/'' for a global table
 * @param {string} lens
 * @param {object} data - must carry (or receives) an `id`
 * @param {string} [password] - private lens password
 * @param {object} [options]
 * @param {boolean} [options.autoPropagate=false] - fan the write out to federation partners and parent hexagons
 * @param {object} [options.propagationOptions]
 * @param {boolean} [options.disableHologramRedirection=false]
 * @param {boolean} [options.preserveFederationMeta=false] - keep `_federation` (propagation only)
 * @param {boolean} [options.local=false] - store only; never sign or publish
 * @returns {Promise<object>} `{ success, isHologramAtPath, pathHolon, pathLens, pathKey, propagationResult, updatedHolograms }`
 */
export async function put(holoInstance, holon, lens, data, password = null, options = {}) {
    if (!data) { // Check data first as it's used for id generation
        throw new Error('put: Missing required data parameter');
    }
    if (!lens) {
        throw new Error('put: Missing required lens parameter');
    }
    if (password) return PrivateOps.put(holoInstance, holon, lens, data, password, options);

    const isGlobal = isGlobalHolon(holon);
    const { disableHologramRedirection = false } = options;

    let targetHolon = holon;
    let targetLens = lens;
    let targetKey = data.id; // Use data.id as the key

    if (!targetKey) {
        targetKey = holoInstance.generateId();
        data.id = targetKey; // Assign the generated ID back to the data
    }

    // --- Start: Source-Envelope Hologram Redirection Logic ---
    // When `data` is an item that was RESOLVED from a hologram, it still carries
    // the canonical `_hologram` envelope (sourceHolon/sourceLens/sourceKey parsed
    // from the original soul — see `attachHologramMeta`). A write of such an item
    // — e.g. a borrow/return that read a federated/mirrored item, mutated it, and
    // put it back — must land on the ORIGINAL in its owner's graph, never fork a
    // local copy. We redirect to the source up front, BEFORE any storage read.
    //
    // This is stronger than the path-based redirection below: it needs no local
    // hologram pointer at the destination, so it also handles an item surfaced by
    // a cross-holon read where nothing is stored locally. A bare `{ id, soul }`
    // hologram has NO `_hologram` envelope (its soul is top-level, not nested), so
    // deliberately CREATING a hologram (publishToFederation) is unaffected. The
    // envelope itself is stripped from the stored value further below, so the
    // source item is written clean.
    let redirectedBySourceEnvelope = false;
    if (!isGlobal && !disableHologramRedirection && data._hologram?.sourceHolon) {
        const env = data._hologram;
        const soulInfo = env.soul ? holoInstance.parseSoulPath(env.soul) : null;
        targetHolon = env.sourceHolon ?? soulInfo?.holon ?? targetHolon;
        targetLens = env.sourceLens ?? soulInfo?.lens ?? targetLens;
        targetKey = env.sourceKey ?? soulInfo?.key ?? targetKey;
        redirectedBySourceEnvelope = true;
    }
    // --- End: Source-Envelope Hologram Redirection Logic ---

    // --- Start: Target Path Hologram Redirection Logic ---
    // (skipped for global tables, and when the source-envelope redirect above
    // already pinned the destination to the item's true owner. ALSO skipped
    // when the payload being written is itself a bare `{ id, soul }` pointer:
    // a pointer is location-specific — re-publishing one to a destination
    // that already holds it used to redirect the write onto the pointer's own
    // soul, replacing the SOURCE with a hologram of itself. That husk then
    // resolves in a loop — the 2026-07-23 field incident.)
    if (!isGlobal && !redirectedBySourceEnvelope && !holoInstance.isHologram(data)) try {
        // Get the item at the original target path, WITHOUT resolving holograms
        const existingItemAtPath = await get(holoInstance, targetHolon, targetLens, targetKey, null, { resolveHolograms: false });

        if (!disableHologramRedirection && existingItemAtPath && holoInstance.isHologram(existingItemAtPath)) {
            const soulInfo = holoInstance.parseSoulPath(existingItemAtPath.soul);
            if (soulInfo) {
                if (soulInfo.appname !== holoInstance.appname) {
                    console.warn(`Existing hologram at ${targetHolon}/${targetLens}/${targetKey} has appname (${soulInfo.appname}) in its soul ${existingItemAtPath.soul} which does not match current HoloSphere instance appname (${holoInstance.appname}). Redirecting put to soul's holon/lens within this instance.`);
                }
                targetHolon = soulInfo.holon; // Redirect holon
                targetLens = soulInfo.lens;   // Redirect lens
                targetKey = soulInfo.key;     // Redirect key (important!)
                if (String(data.id) !== String(targetKey)) {
                    console.warn(`Data ID ('${data.id}') differs from redirected target key ('${targetKey}') derived from existing hologram's soul. Data will be stored under key '${targetKey}'.`);
                }
            } else {
                console.warn(`Existing item at ${targetHolon}/${targetLens}/${targetKey} (ID: ${existingItemAtPath.id}) is a hologram, but its soul ('${existingItemAtPath.soul}') is invalid. Proceeding with original target.`);
            }
        }
    } catch (error) {
        console.warn(`Error checking for existing hologram at ${targetHolon}/${targetLens}/${targetKey}: ${error.message}. Proceeding with original target.`);
    }
    // --- End: Target Path Hologram Redirection Logic ---

    // Where the caller originally aimed, kept ONLY when a redirect above moved
    // the write elsewhere. After the write we refresh the hologram pointer stored
    // there (bump `updated`), so the lens the caller is actually looking at
    // re-emits and re-resolves immediately — without depending on the source's
    // backlinks, which can predate the tracking logic.
    const originalPointerPath =
        !isGlobal &&
        (targetHolon !== holon || targetLens !== lens || String(targetKey) !== String(data.id))
            ? { holon, lens, key: String(data.id) }
            : null;

    // Check if the data *being put* is a hologram (used for schema and propagation)
    const isHologram = holoInstance.isHologram(data);

    // Never store a hologram that points at its own destination — it would
    // replace whatever lives there (usually the ORIGINAL the pointer was
    // minted from, when a publish targets its own source holon) with an
    // unresolvable self-loop. The path already holds the best possible value
    // for this soul, so the correct behaviour is a warned no-op, not a write.
    if (isHologram && !isGlobal &&
        data.soul === `${holoInstance.appname}/${targetHolon}/${targetLens}/${targetKey}`) {
        console.warn(`[put] refusing to write self-pointing hologram at ${data.soul} — the destination IS the soul's path; skipping write.`);
        return data;
    }

    // Get and validate schema only in strict mode for non-holograms (data being put).
    // The global `schemas` table is exempt: it's the infrastructure the schemas
    // themselves live in, so enforcing "schema required" on it recurses
    // put → getSchema → getGlobal → get → getSchema → … to a stack overflow.
    if (holoInstance.strict && !isHologram && !(targetHolon == null && targetLens === 'schemas')) {
        const schema = await holoInstance.getSchema(targetLens); // Use targetLens for schema
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
        const dataToValidate = JSON.parse(JSON.stringify(data)); // Validate the actual data
        const valid = holoInstance.validator.validate(schema, dataToValidate);

        if (!valid) {
            const errorMsg = `Schema validation failed: ${JSON.stringify(holoInstance.validator.errors)}`;
            throw new Error(errorMsg);
        }
    }

    try {
        // Sanitize before serialization so undefined/NaN/Infinity etc. can never
        // produce a malformed payload.
        const sanitizeWarnings = [];
        const dataToStore = sanitizeForStorage(data, '', new WeakSet(), sanitizeWarnings) || {};
        if (sanitizeWarnings.length > 0) {
            console.warn(
                `holosphere.put: sanitized ${sanitizeWarnings.length} field(s) at ${targetHolon}/${targetLens}/${targetKey} (id=${data.id}):`,
                sanitizeWarnings
            );
        }
        // Strip read-side envelopes that must never be persisted (they're
        // attached at resolution time).
        //
        // `_hologram` and `_meta` are always read-side-only.
        //
        // `_federation` is also read-side for ordinary writes — it describes
        // where data was fetched from, not where it currently lives. Two
        // legitimate carriers keep it:
        //   • hologram envelopes (top-level `id` + `soul`) tagged with
        //     `_federation` provenance — detected via isHologram(data);
        //   • full-copy propagation, which passes the internal
        //     `preserveFederationMeta` flag (Federation.propagate). Without it
        //     a propagated copy is byte-identical to a record the target holon
        //     wrote itself, so nothing can later tell them apart.
        if (dataToStore._meta !== undefined) delete dataToStore._meta;
        if (dataToStore._hologram !== undefined) delete dataToStore._hologram;
        if (!isHologram && !options.preserveFederationMeta && dataToStore._federation !== undefined) delete dataToStore._federation;
        // The record is addressed by its key — on the wire and in the store —
        // so the stored payload's id must be that key.
        if (String(dataToStore.id) !== String(targetKey)) dataToStore.id = targetKey;

        const wireHolon = normHolon(targetHolon);
        commit(holoInstance, wireHolon, targetLens, targetKey, dataToStore, options);

        // --- Start: Active Hologram Update Logic ---
        //
        // Walks this record's backlinks (every hologram pointer that references
        // it) and stamps each with `updated: now` so consumers re-resolve and
        // see the latest source data.
        //
        // Runs for BOTH original-data puts and hologram-update puts so updates
        // cascade through multi-hop forwards (A → B → C → …). Each hop's
        // pointers are indexed locally, and we walk that index on every put —
        // cycle-protected via `options._cascadeVisited`.
        const updatedHolograms = [];
        const currentDataSoul = soulOf(holoInstance, targetHolon, targetLens, targetKey);
        const cascadeVisited = new Set(options._cascadeVisited || []);
        if (!cascadeVisited.has(currentDataSoul)) {
            cascadeVisited.add(currentDataSoul);
            try {
                const hologramSouls = holoInstance.store.getBacklinks(currentDataSoul)
                    .filter((k) => !cascadeVisited.has(k));

                if (hologramSouls.length > 0) {
                    const updatePromises = hologramSouls.map(async (hologramSoul) => {
                        try {
                            const hologramSoulInfo = holoInstance.parseSoulPath(hologramSoul);
                            if (!hologramSoulInfo) return;
                            const currentHologram = await holoInstance.get(
                                hologramSoulInfo.holon,
                                hologramSoulInfo.lens,
                                hologramSoulInfo.key,
                                null,
                                { resolveHolograms: false }
                            );
                            if (!currentHologram) return;
                            const updatedHologram = { ...currentHologram, updated: Date.now() };
                            await holoInstance.put(
                                hologramSoulInfo.holon,
                                hologramSoulInfo.lens,
                                updatedHologram,
                                null,
                                {
                                    autoPropagate: false, // Don't auto-propagate hologram updates
                                    disableHologramRedirection: true, // Prevent redirection when updating holograms
                                    isHologramUpdate: true,
                                    // Carry the visited set forward so the recursive
                                    // put keeps cascading through this hop's pointers
                                    // without looping back through us.
                                    _cascadeVisited: cascadeVisited
                                }
                            );
                            updatedHolograms.push({
                                soul: hologramSoul,
                                holon: hologramSoulInfo.holon,
                                lens: hologramSoulInfo.lens,
                                key: hologramSoulInfo.key,
                                id: hologramSoulInfo.key,
                                timestamp: updatedHologram.updated
                            });
                        } catch (hologramUpdateError) {
                            console.warn(`Error updating hologram ${hologramSoul}:`, hologramUpdateError);
                        }
                    });
                    await Promise.all(updatePromises);
                }
            } catch (hologramUpdateError) {
                console.warn('Error checking for active holograms to update:', hologramUpdateError);
            }
        }
        // --- End: Active Hologram Update Logic ---

        // --- Start: Original-Pointer Refresh (redirected writes) ---
        // The redirect moved this write away from where the caller aimed; the
        // lens they are looking at holds only the untouched pointer, so its
        // subscribers hear nothing unless the cascade above happened to stamp
        // it. Refresh the pointer directly (bump `updated`): the caller's lens
        // re-emits and re-resolves. Only an EXISTING pointer is refreshed; a
        // source-envelope write with no local mirror must not materialize one.
        if (originalPointerPath) {
            const pointerSoul = `${holoInstance.appname}/${originalPointerPath.holon}/${originalPointerPath.lens}/${originalPointerPath.key}`;
            const alreadyStamped =
                updatedHolograms.some((h) => h.soul === pointerSoul) ||
                cascadeVisited.has(pointerSoul);
            if (!alreadyStamped) {
                try {
                    const pointer = await holoInstance.get(
                        originalPointerPath.holon,
                        originalPointerPath.lens,
                        originalPointerPath.key,
                        null,
                        { resolveHolograms: false }
                    );
                    if (pointer && holoInstance.isHologram(pointer)) {
                        await holoInstance.put(
                            originalPointerPath.holon,
                            originalPointerPath.lens,
                            { ...pointer, id: originalPointerPath.key, updated: Date.now() },
                            null,
                            {
                                autoPropagate: false,
                                disableHologramRedirection: true,
                                isHologramUpdate: true,
                                _cascadeVisited: cascadeVisited
                            }
                        );
                    }
                } catch (pointerRefreshError) {
                    console.warn(`Could not refresh local hologram pointer at ${pointerSoul}:`, pointerRefreshError.message);
                }
            }
        }
        // --- End: Original-Pointer Refresh ---

        // Auto-propagation is OPT-IN. It used to be on by default, which meant
        // every ordinary write fanned a copy into every outbound partner and up
        // the whole H3 ancestry — creating stored copies nobody asked for.
        // Callers that genuinely want fan-out say so with `autoPropagate: true`.
        // The local write is already committed, so propagation is a BACKGROUND
        // cascade that must not block the caller's save; callers that need the
        // result pass `{ awaitPropagation: true }`.
        const shouldPropagate = options.autoPropagate === true && !isHologram && !isGlobal;
        let propagationResult = null;

        if (shouldPropagate) {
            // Propagation emits HOLOGRAMS — soul pointers back to this holon —
            // not full copies. A copy is a second stored truth: it drifts from
            // the original and is indistinguishable from a record the target
            // authored once any write strips its `_federation` stamp. A pointer
            // reads through to the live original. Callers that truly need a
            // detached copy must ask with `propagationOptions.useHolograms: false`.
            const propagationOptions = {
                useHolograms: true,
                ...options.propagationOptions
            };
            const runPropagation = () => {
                return holoInstance.propagate(targetHolon, targetLens, data, propagationOptions)
                    .then((r) => {
                        if (r && r.errors > 0) console.warn('Auto-propagation had errors:', r);
                        return r;
                    })
                    .catch((propError) => { console.warn('Error in auto-propagation:', propError); return null; });
            };
            if (options.awaitPropagation) {
                propagationResult = await runPropagation();
            } else {
                runPropagation(); // Background — don't block the write.
            }
        }

        return {
            success: true,
            isHologramAtPath: isHologram, // whether the data *put* was a hologram
            pathHolon: targetHolon,
            pathLens: targetLens,
            pathKey: targetKey,
            propagationResult,
            updatedHolograms
        };
    } catch (error) {
        console.error('Error in put:', error);
        throw error;
    }
}

/**
 * Retrieves content from the specified holon and lens.
 * @param {HoloSphere} holoInstance
 * @param {string|null} holon
 * @param {string} lens
 * @param {string} key
 * @param {string} [password]
 * @param {object} [options]
 * @param {boolean} [options.resolveHolograms=true]
 * @param {boolean} [options.includeDeleted=false] - surface `_deleted: true` tombstones
 * @returns {Promise<object|null>}
 */
export async function get(holoInstance, holon, lens, key, password = null, options = {}) {
    if (!lens || !key) {
        console.error('get: Missing required parameters');
        return null;
    }

    const {
        resolveHolograms = true,
        visited,
        // `_deleted: true` is the soft-tombstone convention used by the bot,
        // the web dashboard, and the MCP council tools. `get` returns `null`
        // for tombstoned records by default; pass `includeDeleted: true` to
        // surface them (admin/debug views, history reconstruction, etc.).
        includeDeleted = false,
    } = options;

    // Get schema for validation if in strict mode. Reads of the global
    // `schemas` table itself are exempt — see the matching guard in `put`.
    let schema = null;
    if (holoInstance.strict && !(holon == null && lens === 'schemas')) {
        schema = await holoInstance.getSchema(lens);
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
    }

    if (password) return PrivateOps.get(holoInstance, holon, lens, key, password, options);

    try {
        const rec = holoInstance.store.get(normHolon(holon), lens, String(key));
        if (!rec) return null;
        let parsed = clone(rec.item);
        if (!parsed) return null;

        if (!includeDeleted && parsed._deleted === true) return null;

        // Check if this is a hologram that needs to be resolved
        if (resolveHolograms && holoInstance.isHologram(parsed)) {
            const res = await holoInstance.resolveHologramDetailed(parsed, {
                followHolograms: resolveHolograms,
                visited: visited,
                maxDepth: options.maxDepth || 10,
                currentDepth: options.currentDepth || 0
            });

            if (res.status === 'deleted') {
                // The pointer's target was soft-deleted — a DEFINITIVE deletion
                // (distinct from a transient miss). By default the item reads as
                // gone; `includeDeleted` surfaces a tombstone.
                warnHologramUnresolvedOnce(holon, lens, key, parsed.soul);
                if (includeDeleted) {
                    return { id: parsed.id, _deleted: true, _hologram: { isHologram: true, soul: res.soul, deleted: true } };
                }
                return null;
            }

            if (res.status !== 'resolved') {
                // unresolved/error are TRANSIENT (relay latency, federation in
                // flight); circular/depth/invalid are structural. Either way
                // DON'T delete here. Skip; a garbage collector keyed on this
                // janitor-parseable line owns cleanup.
                warnHologramUnresolvedOnce(holon, lens, key, parsed.soul);
                return null;
            }

            clearHologramUnresolvedWarning(holon, lens, key, parsed.soul);
            if (res.data !== parsed) {
                parsed = res.data;
            }
        }

        if (schema) {
            const valid = holoInstance.validator.validate(schema, parsed);
            if (!valid) {
                console.error('get: Invalid data according to schema:', holoInstance.validator.errors);
                if (holoInstance.strict) return null;
            }
        }

        return parsed;
    } catch (error) {
        if (error.message?.startsWith('CIRCULAR_REFERENCE')) {
            console.warn(`Caught circular reference during get for key ${key}. Resolving null.`);
            return null;
        }
        console.error('Error in get:', error);
        return null;
    }
}

/**
 * Retrieves all content from the specified holon and lens.
 * @param {HoloSphere} holoInstance
 * @param {string|null} holon
 * @param {string} lens
 * @param {string} [password]
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @param {boolean} [options.resolveHolograms=true] - when false, pointers are returned as stored
 * @returns {Promise<Array<object>>}
 */
export async function getAll(holoInstance, holon, lens, password = null, options = {}) {
    if (!lens) {
        throw new Error('getAll: Missing required parameters');
    }
    const {
        includeDeleted = false,
        resolveHolograms = true,
    } = options;

    // The global `schemas` table is exempt from schema lookup/enforcement —
    // see the matching guards in `put`/`get`; it's where schemas live.
    const schema =
        holon == null && lens === 'schemas' ? null : await holoInstance.getSchema(lens);
    if (!schema && holoInstance.strict && !(holon == null && lens === 'schemas')) {
        throw new Error('getAll: Schema required in strict mode');
    }

    if (password) return PrivateOps.getAll(holoInstance, holon, lens, password, options);

    try {
        const output = new Map();
        const records = holoInstance.store.list(normHolon(holon), lens, { includeDeleted: true });

        const processItem = async (rec) => {
            const key = rec.id;
            try {
                const parsed = clone(rec.item);
                if (!parsed || parsed.id === undefined || parsed.id === null || parsed.id === '') return;

                if (!includeDeleted && parsed._deleted === true) return;

                if (resolveHolograms && holoInstance.isHologram(parsed)) {
                    try {
                        const res = await holoInstance.resolveHologramDetailed(parsed, {
                            followHolograms: true,
                            maxDepth: 10,
                            currentDepth: 0
                        });

                        if (res.status !== 'resolved') {
                            // A transient miss is not proof of a dead pointer, so we
                            // skip without deleting. A soft-deleted source (status
                            // 'deleted') is definitive; surface it as a tombstone
                            // only when the caller opted in.
                            warnHologramUnresolvedOnce(holon, lens, key, parsed.soul);
                            if (res.status === 'deleted' && includeDeleted) {
                                output.set(parsed.id, { id: parsed.id, _deleted: true, _hologram: { isHologram: true, soul: res.soul, deleted: true } });
                            }
                            return;
                        }

                        clearHologramUnresolvedWarning(holon, lens, key, parsed.soul);
                        const resolved = res.data;
                        if (resolved && resolved !== parsed) {
                            if (schema) {
                                const valid = holoInstance.validator.validate(schema, resolved);
                                if (valid || !holoInstance.strict) output.set(resolved.id, resolved);
                            } else {
                                output.set(resolved.id, resolved);
                            }
                            return;
                        }
                    } catch (hologramError) {
                        console.error(`Error resolving hologram for key ${key}:`, hologramError);
                        return;
                    }
                }

                if (schema) {
                    const valid = holoInstance.validator.validate(schema, parsed);
                    if (valid || !holoInstance.strict) output.set(parsed.id, parsed);
                } else {
                    output.set(parsed.id, parsed);
                }
            } catch (error) {
                console.error('Error processing data:', error);
            }
        };

        await Promise.all(records.map(processItem));
        return Array.from(output.values());
    } catch (error) {
        console.error('Error in getAll:', error);
        return [];
    }
}

/**
 * Parses stored data, handling strings (JSON) and plain objects.
 * @param {HoloSphere} holoInstance
 * @param {*} rawData
 * @returns {Promise<object|null>}
 */
export async function parse(holoInstance, rawData) {
    if (rawData === null || rawData === undefined) {
        console.warn('Parse received null or undefined data.');
        return null;
    }

    if (typeof rawData === 'string') {
        try {
            return JSON.parse(rawData);
        } catch {
            console.warn('Data was a string but not valid JSON, returning null:', rawData);
            return null;
        }
    }

    if (typeof rawData === 'object' && rawData !== null) {
        if (rawData._) {
            // Legacy graph metadata remnants — strip them.
            const potentialData = Object.keys(rawData).reduce((acc, k) => {
                if (k !== '_') acc[k] = rawData[k];
                return acc;
            }, {});
            return Object.keys(potentialData).length === 0 ? null : potentialData;
        }
        return rawData;
    }

    console.warn('Parsing encountered unexpected data type, returning null:', typeof rawData, rawData);
    return null;
}

/**
 * Deletes a specific key from a given holon and lens by writing a signed
 * tombstone. If the deleted record was a hologram pointer, the store's
 * backlink index drops it automatically.
 * @param {object} [options]
 * @param {boolean} [options.autoPropagate=true] - retract copies from parent hexagons
 * @param {boolean} [options.awaitPropagation=false]
 * @param {object} [options.propagationOptions]
 * @returns {Promise<boolean>}
 */
export async function deleteFunc(holoInstance, holon, lens, key, password = null, options = {}) { // Renamed to deleteFunc to avoid keyword conflict
    if (!lens || !key) {
        throw new Error('delete: Missing required parameters');
    }
    if (password) return PrivateOps.deleteFunc(holoInstance, holon, lens, key, password);

    try {
        const wireHolon = normHolon(holon);
        const store = holoInstance.store;
        const existing = store.get(wireHolon, lens, String(key));
        const dataToDelete = existing ? existing.item : null;

        const tombstone = { id: String(key), _deleted: true };
        const event = (() => {
            const signer = holoInstance._signer;
            if (options._skipSign || options.local || !signer) return null;
            try { return signer.signEnvelope(holoInstance, wireHolon, lens, tombstone); }
            catch (e) { console.warn('[signing] tombstone failed:', e?.message); return null; }
        })();
        if (event) store.apply(event, { origin: 'local' });
        else store.putRaw(wireHolon, lens, String(key), tombstone, { origin: options._skipSign ? 'remote' : 'raw' });

        const transport = holoInstance._relayTransport;
        if (transport && !options._skipPublish && !options.local) {
            try { transport.publishDelete(wireHolon, lens, String(key), event); }
            catch (e) { console.warn('[nostr] publishDelete failed:', e?.message); }
        }

        // Mirror the write path. A put on an H3 holon fans full copies up the
        // whole parent ancestry (see Federation.propagate), so a delete that
        // stops at the original leaves the record readable at every coarser
        // scale — forever, since nothing else ever retracts it. Only the
        // ORIGINAL retracts: a propagated copy carries another holon's
        // `_federation.origin`, and deleting one of those must not cascade
        // into that holon's other copies. Fire-and-forget by default; callers
        // that need the result pass `{ awaitPropagation: true }`.
        const deletedCopyOrigin = dataToDelete?._federation?.origin;
        const wasPropagatedCopy = deletedCopyOrigin != null && String(deletedCopyOrigin) !== String(holon);
        const shouldPropagate = options.autoPropagate !== false && holon && !wasPropagatedCopy;
        if (shouldPropagate) {
            const runRetraction = () => holoInstance
                .propagateDeletion(holon, lens, key, options.propagationOptions)
                .then((r) => {
                    if (r && r.errors > 0) console.warn('Deletion propagation had errors:', r);
                    return r;
                })
                .catch((propError) => { console.warn('Error in deletion propagation:', propError); return null; });
            if (options.awaitPropagation) {
                await runRetraction();
            } else {
                runRetraction(); // Background — don't block the delete on the ancestry walk.
            }
        }
        return true;
    } catch (error) {
        console.error('Error in delete:', error);
        throw error;
    }
}

/**
 * Deletes every key of a lens (tombstones each record, then retracts the
 * lens's propagated copies from the parent hexagons in one pass).
 * @returns {Promise<boolean>}
 */
export async function deleteAll(holoInstance, holon, lens, password = null, options = {}) {
    if (!lens) {
        console.error('deleteAll: Missing holon or lens parameter');
        return false;
    }
    if (password) return PrivateOps.deleteAll(holoInstance, holon, lens, password);

    try {
        const wireHolon = normHolon(holon);
        const store = holoInstance.store;
        // Every live record, plus ids that only exist as signed claims (so an
        // enforce-mode reader can't resurrect the lens from leftover envelopes).
        const ids = new Set(store.listKeys(wireHolon, lens));
        for (const id of store.listEventIds(wireHolon, lens)) {
            const rec = store.get(wireHolon, lens, id);
            if (!rec || !isTombstone(rec.item)) ids.add(id);
        }

        let allSuccessful = true;
        for (const id of ids) {
            try {
                await deleteFunc(holoInstance, holon, lens, id, null, {
                    autoPropagate: false,
                    _skipSign: options._skipSign,
                    _skipPublish: options._skipPublish,
                    local: options.local,
                });
            } catch (error) {
                console.warn(`Error deleting key ${id} during deleteAll:`, error);
                allSuccessful = false;
            }
        }

        // Same retraction as deleteFunc, but lens-wide: one pass over each
        // parent hexagon removing every copy this holon propagated, instead of
        // an ancestry walk per record. Copies may sit at the parents even when
        // the local lens was already empty, so always walk.
        if (options.autoPropagate !== false && holon) {
            const retract = () => holoInstance
                .propagateDeletion(holon, lens, null, options.propagationOptions)
                .then((r) => {
                    if (r && r.errors > 0) console.warn('Deletion propagation had errors:', r);
                    return r;
                })
                .catch((propError) => { console.warn('Error in deletion propagation:', propError); return null; });
            if (options.awaitPropagation) await retract();
            else retract();
        }
        return allSuccessful;
    } catch (error) {
        console.error('Error in deleteAll:', error);
        return false;
    }
}

// Export all content operations as default
export default {
    put,
    get,
    getAll,
    parse,
    delete: deleteFunc,
    deleteAll
};
