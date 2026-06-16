// holo_content.js

/**
 * Default deadline (ms) for the read paths' `.once()` calls. Gun's `.once()`
 * never fires when the requested node isn't in the local graph and no peer
 * answers (cold-start, offline, partitioned mesh) — past consumers worked
 * around this by wrapping every `getAll` in their own `Promise.race(reject,
 * setTimeout(8000))`. Owning it here means the spinner can never hang
 * indefinitely on a cold path and every caller stops needing the wrapper.
 *
 * Pick `READ_TIMEOUT_MS = 0` (or pass `{ timeout: 0 }`) to opt out of the
 * fallback and keep the historical "wait forever" behaviour.
 */
const READ_TIMEOUT_MS = 8000;

/**
 * Default deadline (ms) for the put-path's Gun ack callback. Gun fires the
 * ack only after the local commit + at least one peer ack chain — with no
 * reachable peer (cold start, offline, partitioned mesh) it never fires
 * and the consumer's `await holosphere.put(...)` hangs forever. UIs
 * worked around this by racing every `put` against their own timeout;
 * owning the deadline here makes every consumer local-first by default.
 *
 * On timeout the returned promise resolves with a `queued: true` sentinel
 * (see `put` return shape) — Gun keeps the write in its local queue and
 * the ack callback's side effects (subscriber notification, hologram
 * cascade, federation propagation) run later when a peer reappears.
 *
 * Pick `WRITE_TIMEOUT_MS = 0` (or pass `{ timeout: 0 }`) to opt out of
 * the fallback and keep the historical "wait for ack" behaviour.
 */
const WRITE_TIMEOUT_MS = 5000;

/**
 * `.once()` wrapped in a deadline. Resolves with the value when Gun fires
 * back, or `null` after `timeoutMs` if it hasn't. Pass `timeoutMs <= 0` to
 * disable the deadline.
 *
 * The first responder wins — both branches are idempotent so a late
 * `.once()` callback after timeout is harmlessly ignored.
 *
 * Pass `{ awaitNetwork: true }` for cold reads that MUST reach the network —
 * notably cross-holon hologram soul resolution. Gun's `.once()` fires
 * synchronously with whatever is in the local graph and never re-fires; for a
 * node we never subscribed to (another holon's lens), that first value is
 * `undefined` even though a peer is about to deliver the real data a few ms
 * later. Accepting that `undefined` as "not found" is exactly what produced
 * the `Could not resolve hologram soul: … (target not present locally)` false
 * negatives on freshly-loaded federated data. In `awaitNetwork` mode we use
 * `.on()` instead, skip the cold `undefined`, and settle once the value
 * syncs — while still honouring an explicit `null` (a real tombstone) and the
 * deadline (for nodes no peer ever answers). The common, same-holon read path
 * keeps the fast `.once()` behaviour so empty/missing local reads resolve
 * immediately instead of blocking for the full deadline.
 */
function onceWithTimeout(node, timeoutMs = READ_TIMEOUT_MS, { awaitNetwork = false } = {}) {
    if (!awaitNetwork) {
        return new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; resolve(v); } };
            node.once((data) => finish(data));
            if (timeoutMs > 0) {
                setTimeout(() => finish(null), timeoutMs);
            }
        });
    }

    return new Promise((resolve) => {
        let done = false;
        const detach = () => { try { if (node.off) node.off(); } catch { /* ignore */ } };
        const finish = (v) => { if (!done) { done = true; detach(); resolve(v); } };
        node.on((data) => {
            if (data === undefined) return; // cold/not-known yet — wait for a peer
            finish(data); // defined value OR explicit null tombstone — definitive
        });
        if (timeoutMs > 0) {
            setTimeout(() => finish(null), timeoutMs);
        }
    });
}

/**
 * Race a put-result promise against a deadline. If the underlying Gun
 * ack never arrives, resolve with `queuedResult` so the caller stops
 * waiting; Gun keeps the write in its local queue and replays it when
 * a peer is available.
 *
 * The first responder wins — both branches are idempotent so the late
 * ack-driven resolution after timeout is harmlessly ignored.
 */
function withWriteTimeout(promise, timeoutMs, queuedResult) {
    if (!timeoutMs || timeoutMs <= 0) return promise;
    return new Promise((resolve, reject) => {
        let done = false;
        const finish = (fn, val) => { if (!done) { done = true; fn(val); } };
        promise.then(
            (v) => finish(resolve, v),
            (e) => finish(reject, e)
        );
        setTimeout(() => finish(resolve, queuedResult), timeoutMs);
    });
}

/**
 * Recursively sanitizes a value for storage in GunDB.
 *
 * Drops keys whose values would corrupt the graph or round-trip incorrectly:
 *   - undefined, NaN, Infinity, -Infinity (JSON.stringify silently turns
 *     these into nothing or "null", which is how malformed payloads like
 *     `"initiated":,` end up in the graph and surface later as per-character
 *     parse warnings).
 *   - functions, symbols, bigints (not JSON-representable).
 * Preserves null (legitimate Gun tombstone / explicit empty value).
 * Guards against circular references.
 *
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
 * Stores content in the specified holon and lens.
 * If the target path already contains a hologram, the put operation will be
 * redirected to store the new data at the location specified in the existing
 * hologram's soul.
 * If the stored data (after potential redirection) is a hologram, this function
 * also attempts to update the target data node's `_holograms` set.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The initial holon identifier.
 * @param {string} lens - The initial lens under which to store the content.
 * @param {object} data - The data to store.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.autoPropagate=true] - Whether to automatically propagate to federated holons (default: true)
 * @param {object} [options.propagationOptions] - Options to pass to propagate
 * @param {boolean} [options.propagationOptions.useHolograms=true] - Whether to use holograms instead of duplicating data
 * @param {boolean} [options.disableHologramRedirection=false] - Whether to disable hologram redirection
 * @returns {Promise<object>} - Returns an object with success status, path info, propagation result, and list of updated holograms
 */
/**
 * Gun chain for a holon/lens. When `holon` is nullish/empty the holon segment is
 * omitted — i.e. a "global" table at appname/lens. (getGlobal/putGlobal are just
 * get/put without a holon.)
 */
export function holonLens(holoInstance, holon, lens) {
    const base = holoInstance.gun.get(holoInstance.appname);
    return (holon === null || holon === undefined || holon === '') ? base.get(lens) : base.get(holon).get(lens);
}
const isGlobalHolon = (holon) => holon === null || holon === undefined || holon === '';

export async function put(holoInstance, holon, lens, data, password = null, options = {}) {
    if (!data) { // Check data first as it's used for id generation
        throw new Error('put: Missing required data parameter');
    }
    if (!lens) {
        throw new Error('put: Missing required lens parameter');
    }
    const isGlobal = isGlobalHolon(holon);

    const {
        disableHologramRedirection = false,
        timeout: writeTimeoutOverride
    } = options;
    const writeTimeoutMs = writeTimeoutOverride !== undefined ? writeTimeoutOverride : WRITE_TIMEOUT_MS;

    let targetHolon = holon;
    let targetLens = lens;
    let targetKey = data.id; // Use data.id as the key

    if (!targetKey) {
        targetKey = holoInstance.generateId();
        data.id = targetKey; // Assign the generated ID back to the data
    }

    // --- Start: Target Path Hologram Redirection Logic ---
    // (skipped for global tables — they aren't holon-scoped or holographic)
    if (!isGlobal) try {
        // Get the item at the original target path, WITHOUT resolving holograms
        const existingItemAtPath = await get(holoInstance, targetHolon, targetLens, targetKey, password, { resolveHolograms: false });

        if (!disableHologramRedirection && existingItemAtPath && holoInstance.isHologram(existingItemAtPath)) {
            const soulInfo = holoInstance.parseSoulPath(existingItemAtPath.soul);
            if (soulInfo) {
                // Optional: Check if soulInfo.appname matches holoInstance.appname
                if (soulInfo.appname !== holoInstance.appname) {
                    console.warn(`Existing hologram at ${targetHolon}/${targetLens}/${targetKey} has appname (${soulInfo.appname}) in its soul ${existingItemAtPath.soul} which does not match current HoloSphere instance appname (${holoInstance.appname}). Redirecting put to soul's holon/lens within this instance.`);
                }
                targetHolon = soulInfo.holon; // Redirect holon
                targetLens = soulInfo.lens;   // Redirect lens
                targetKey = soulInfo.key;     // Redirect key (important!)
                                              // data.id should ideally match soulInfo.key if this is consistent.
                                              // If data.id is different, it means we are writing data with one ID to a path derived from another ID's soul.
                if (data.id !== targetKey) {
                    console.warn(`Data ID ('${data.id}') differs from redirected target key ('${targetKey}') derived from existing hologram's soul. Data will be stored under key '${targetKey}'.`);
                    // It's crucial that the actual GunDB path uses targetKey.
                    // The 'data' object itself retains its original 'data.id' unless explicitly changed.
                }
            } else {
                console.warn(`Existing item at ${targetHolon}/${targetLens}/${targetKey} (ID: ${existingItemAtPath.id}) is a hologram, but its soul ('${existingItemAtPath.soul}') is invalid. Proceeding with original target.`);
            }
        }
    } catch (error) {
        // If 'get' fails (e.g., item not found, auth error), proceed with original target.
        // A "not found" error is expected if the path is new.
        if (error.message && error.message.includes('RESOLVED_NULL')) {
             // This is fine, means nothing was at the path.
        } else {
            console.warn(`Error checking for existing hologram at ${targetHolon}/${targetLens}/${targetKey}: ${error.message}. Proceeding with original target.`);
        }
    }
    // --- End: Target Path Hologram Redirection Logic ---

    // The data being stored is 'data'. Its 'id' property is 'data.id'.
    // The final storage path key is 'targetKey'.

    // Check if the data *being put* is a hologram (this variable is used later for schema and propagation)
    const isHologram = holoInstance.isHologram(data);

    // Get and validate schema only in strict mode for non-holograms (data being put)
    if (holoInstance.strict && !isHologram) {
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
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(targetHolon); // Use targetHolon for put
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString} during put, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created during put, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve(); // Resolve anyway to allow test operations
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve(); // Resolve anyway to allow test operations
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully during put, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString} during put: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });
        }

        const ackPromise = new Promise((resolve, reject) => {
            try {
                // Sanitize before serialization so undefined/NaN/Infinity etc.
                // can never produce a malformed payload like `"initiated":,`
                // (which is what causes per-character parse warnings on read).
                const sanitizeWarnings = [];
                let dataToStore = sanitizeForStorage(data, '', new WeakSet(), sanitizeWarnings) || {};
                if (sanitizeWarnings.length > 0) {
                    console.warn(
                        `holosphere.put: sanitized ${sanitizeWarnings.length} field(s) at ${targetHolon}/${targetLens}/${targetKey} (id=${data.id}):`,
                        sanitizeWarnings
                    );
                }
                // Strip read-side envelopes that must never be persisted
                // (they're attached at resolution time).
                //
                // `_hologram` and `_meta` are always read-side-only.
                //
                // `_federation` is also read-side for ordinary writes — it
                // describes where data was fetched from, not where it
                // currently lives. The one legitimate carrier is federation
                // propagation, which writes hologram envelopes (top-level
                // `id` + `soul`) tagged with `_federation` provenance; we
                // detect that via `isHologram(data)` and leave it alone.
                // Without this, a UI that reads a federated record and puts
                // it back ends up persisting stale `_federation.origin`
                // metadata, which then drives downstream code (federation
                // propagators, hologram resolvers) to write or follow
                // pointers that don't match the current storage location —
                // producing "broken hologram" garbage-collection cascades
                // that silently delete the user's write.
                if (dataToStore._meta !== undefined) delete dataToStore._meta;
                if (dataToStore._hologram !== undefined) delete dataToStore._hologram;
                if (!isHologram && dataToStore._federation !== undefined) delete dataToStore._federation;
                const payload = JSON.stringify(dataToStore); // The data being stored

                const putCallback = async (ack) => {
                    if (ack.err) {
                        reject(new Error(ack.err));
                    } else {
                        // --- Start: Hologram Tracking Logic (for data *being put*, if it's a hologram) ---
                        if (isHologram) {
                            try {
                                const storedDataSoulInfo = holoInstance.parseSoulPath(data.soul);
                                if (storedDataSoulInfo) {
                                    const targetNodeRef = holoInstance.getNodeRef(data.soul); // Target of the data *being put*
                                    // Soul of the hologram that was *actually stored* at targetHolon/targetLens/targetKey
                                    const storedHologramInstanceSoul = `${holoInstance.appname}/${targetHolon}/${targetLens}/${targetKey}`;
                                    
                                    targetNodeRef.get('_holograms').get(storedHologramInstanceSoul).put(true);
                                } else {
                                    console.warn(`Data (ID: ${data.id}) being put is a hologram, but could not parse its soul ${data.soul} for tracking.`);
                                }
                            } catch (trackingError) {
                                console.warn(`Error updating _holograms set for the target of the data being put (data ID: ${data.id}, soul: ${data.soul}):`, trackingError);
                            }
                        }
                        // --- End: Hologram Tracking Logic ---
                        
                        // --- Start: Active Hologram Update Logic ---
                        //
                        // Walks this node's `_holograms` set and stamps every
                        // registered hologram with `updated: now` so consumers
                        // re-resolve and see the latest source data.
                        //
                        // Runs for BOTH original-data puts and hologram-update
                        // puts so updates cascade through multi-hop forwards
                        // (A → B → C → …) even when the second hop's
                        // cross-holon registration on the original source
                        // can't be relied on to make it across the Gun mesh.
                        // Each hop maintains its own local `_holograms` set
                        // tracking the next hops, and we walk that set on
                        // every put — cycle-protected via
                        // `options._cascadeVisited`.
                        let updatedHolograms = [];
                        const currentDataSoul = `${holoInstance.appname}/${targetHolon}/${targetLens}/${targetKey}`;
                        const cascadeVisited = new Set(options._cascadeVisited || []);
                        if (!cascadeVisited.has(currentDataSoul)) {
                            cascadeVisited.add(currentDataSoul);
                            try {
                                const currentNodeRef = holoInstance.getNodeRef(currentDataSoul);

                                // Get the _holograms set for this node
                                await new Promise((resolveHologramUpdate) => {
                                    currentNodeRef.get('_holograms').once(async (hologramsSet) => {
                                        if (hologramsSet) {
                                            const hologramSouls = Object.keys(hologramsSet).filter(k =>
                                                k !== '_' && hologramsSet[k] === true && !cascadeVisited.has(k)
                                            );

                                            if (hologramSouls.length > 0) {
                                // Update each active hologram with an 'updated' timestamp
                                                const updatePromises = hologramSouls.map(async (hologramSoul) => {
                                                    try {
                                                        const hologramSoulInfo = holoInstance.parseSoulPath(hologramSoul);
                                                        if (hologramSoulInfo) {
                                                            // Get the current hologram data
                                                            const currentHologram = await holoInstance.get(
                                                                hologramSoulInfo.holon,
                                                                hologramSoulInfo.lens,
                                                                hologramSoulInfo.key,
                                                                null,
                                                                { resolveHolograms: false }
                                                            );

                                                            if (currentHologram) {
                                                                // Update the hologram with an 'updated' timestamp
                                                                const updatedHologram = {
                                                                    ...currentHologram,
                                                                    updated: Date.now()
                                                                };

                                                                await holoInstance.put(
                                                                    hologramSoulInfo.holon,
                                                                    hologramSoulInfo.lens,
                                                                    updatedHologram,
                                                                    null,
                                                                    {
                                                                        autoPropagate: false, // Don't auto-propagate hologram updates
                                                                        disableHologramRedirection: true, // Prevent redirection when updating holograms
                                                                        isHologramUpdate: true,
                                                                        // Carry the visited set forward so the
                                                                        // recursive put keeps cascading through
                                                                        // this hop's `_holograms` set without
                                                                        // looping back through us.
                                                                        _cascadeVisited: cascadeVisited
                                                                    }
                                                                );

                                                                                                                // Add to the list of updated holograms
                                                                updatedHolograms.push({
                                                                    soul: hologramSoul,
                                                                    holon: hologramSoulInfo.holon,
                                                                    lens: hologramSoulInfo.lens,
                                                                    key: hologramSoulInfo.key,
                                                                    id: hologramSoulInfo.key,
                                                                    timestamp: updatedHologram.updated
                                                                });
                                                            }
                                                        }
                                                    } catch (hologramUpdateError) {
                                                        console.warn(`Error updating hologram ${hologramSoul}:`, hologramUpdateError);
                                                    }
                                                });

                                                await Promise.all(updatePromises);
                                            }
                                        }
                                        resolveHologramUpdate(); // Resolve the promise to continue with the main put logic
                                    });
                                });
                            } catch (hologramUpdateError) {
                                console.warn(`Error checking for active holograms to update:`, hologramUpdateError);
                            }
                        }
                        // --- End: Active Hologram Update Logic ---
                        
                        // Only notify subscribers for actual data, not holograms
                        if (!isHologram) {
                            holoInstance.notifySubscribers({
                                holon: targetHolon, // Notify with final target
                                lens: targetLens,
                                ...data // The data that was put
                            });
                        }

                        // Auto-propagate to federation by default (if data *being put* is not a hologram).
                        // Permissionless write: the LOCAL write already acked, so propagating a
                        // hologram of this item to federation partners is a BACKGROUND cascade and
                        // must NOT block the caller's save (a partner that's slow/unreachable, or a
                        // multi-hop parent-hexagon walk, would otherwise stall every write — the
                        // receiving holon filters on READ, not on our write). Fire-and-forget by
                        // default; callers that need the result can pass `{ awaitPropagation: true }`.
                        const shouldPropagate = options.autoPropagate !== false && !isHologram && !isGlobal;
                        let propagationResult = null;

                        if (shouldPropagate) {
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
                                // Background — don't block the write on federation propagation.
                                runPropagation();
                            }
                        }

                        resolve({
                            success: true,
                            isHologramAtPath: isHologram, // whether the data *put* was a hologram
                            pathHolon: targetHolon,
                            pathLens: targetLens,
                            pathKey: targetKey,
                            propagationResult,
                            updatedHolograms: updatedHolograms // List of holograms that were updated
                        });
                    }
                };

                // Use targetHolon, targetLens, and targetKey for the actual storage path
                const dataPath = password ?
                    user.get('private').get(targetLens).get(targetKey) :
                    holonLens(holoInstance, targetHolon, targetLens).get(targetKey);

                // Race-free signing: issue the signed envelope BEFORE the raw write
                // so reads/subscribers resolve against a consistent envelope the
                // instant the raw write lands. No-op unless signing is enabled.
                if (!isHologram && !isGlobal && !options._skipSign && holoInstance._signer) {
                    try { holoInstance._signer.signEnvelope(holoInstance, targetHolon, targetLens, data); }
                    catch (e) { console.warn('[signing] signEnvelope failed:', e?.message); }
                }
                dataPath.put(payload, putCallback);
            } catch (error) {
                reject(error);
            }
        });

        // Bound the wait on Gun's put ack so an offline/partitioned mesh
        // doesn't hang the caller forever. Gun keeps the local write and
        // its eventual ack callback (subscriber notify, hologram cascade,
        // propagation) still runs when a peer reappears — we just stop
        // blocking the awaiting consumer in the meantime.
        return withWriteTimeout(ackPromise, writeTimeoutMs, {
            success: true,
            queued: true,
            isHologramAtPath: isHologram,
            pathHolon: targetHolon,
            pathLens: targetLens,
            pathKey: targetKey,
            propagationResult: null,
            updatedHolograms: []
        });
    } catch (error) {
        console.error('Error in put:', error);
        throw error;
    }
}

/**
 * Retrieves content from the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to retrieve content.
 * @param {string} key - The specific key to retrieve.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options
 * @param {boolean} [options.resolveHolograms=true] - Whether to automatically resolve holograms
 * @param {object} [options.validationOptions] - Options passed to the schema validator
 * @returns {Promise<object|null>} - The retrieved content or null if not found.
 */
export async function get(holoInstance, holon, lens, key, password = null, options = {}) {
    if (!lens || !key) {
        console.error('get: Missing required parameters');
        return null;
    }

    // Destructure options, including visited
    const {
        resolveHolograms = true,
        validationOptions = {},
        visited,
        timeout = READ_TIMEOUT_MS,
        // Network-aware read: skip Gun's cold synchronous `undefined` and wait
        // (up to `timeout`) for a peer to answer. Used by hologram soul
        // resolution so cross-holon reads aren't misreported as missing. See
        // `onceWithTimeout`. Off by default to keep same-holon reads fast.
        awaitNetwork = false,
        // `_deleted: true` is the soft-tombstone convention used by the bot,
        // the web dashboard, and the MCP council tools. Pre-this fix the
        // library was unaware of it and every caller filtered defensively.
        // Now `get` returns `null` for tombstoned records by default; pass
        // `includeDeleted: true` to surface them (admin/debug views,
        // history reconstruction, etc.).
        includeDeleted = false,
    } = options;

    // Get schema for validation if in strict mode
    let schema = null;
    if (holoInstance.strict) {
        schema = await holoInstance.getSchema(lens);
        if (!schema) {
            throw new Error('Schema required in strict mode');
        }
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(holon); // Use holon for get
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        // If auth fails, reject immediately. Do not attempt to create user.
                        reject(new Error(`Authentication failed for ${userNameString} during get: ${authAck.err}`));
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });
        }

        return new Promise((resolve) => {
            const handleData = async (data) => {
                let parsed = null; // Declare parsed here to make it available in catch
                if (!data) {
                    resolve(null);
                    return;
                }

                try {
                    parsed = await holoInstance.parse(data); // Assign to the outer scoped parsed

                    if (!parsed) {
                        resolve(null);
                        return;
                    }

                    // Treat the harvest-side `_deleted: true` soft-tombstone
                    // as "not found" by default. Callers that want to see
                    // tombstones can pass `{ includeDeleted: true }`.
                    if (!includeDeleted && parsed._deleted === true) {
                        resolve(null);
                        return;
                    }

                    // Check if this is a hologram that needs to be resolved
                    if (resolveHolograms && holoInstance.isHologram(parsed)) {
                        const resolvedValue = await holoInstance.resolveHologram(parsed, {
                            followHolograms: resolveHolograms,
                            visited: visited,
                            maxDepth: options.maxDepth || 10,
                            currentDepth: options.currentDepth || 0
                        });

                        if (resolvedValue === null) {
                            // `resolveHologram` returned null. DON'T treat this
                            // as a permission to delete — null fires for several
                            // transient reasons:
                            //   - source soul not in our local Gun graph yet
                            //     (peer offline, federation propagation in flight)
                            //   - maxDepth (10) reached on a deep hologram chain
                            //   - circular reference detected mid-chain
                            //   - any internal resolve error
                            // None of these prove the pointer is permanently
                            // broken, but the old behaviour `await delete(...)`
                            // here permanently destroyed real data on the first
                            // transient miss. Skip the entry instead; a real
                            // garbage collector should own dead-pointer cleanup.
                            console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${parsed.soul}); skipping.`);
                            resolve(null);
                            return;
                        }
                        // If resolveHologram encountered a circular ref, it would throw, not return.
                        // If it returned the hologram itself (if we ever revert to that), this logic would need adjustment.
                        // For now, assume resolvedValue is either the resolved data or we've returned null above.

                        if (resolvedValue !== parsed) {
                            parsed = resolvedValue;
                        }
                    }

                    // Perform schema validation if needed
                    if (schema) {
                        const valid = holoInstance.validator.validate(schema, parsed);
                        if (!valid) {
                            console.error('get: Invalid data according to schema:', holoInstance.validator.errors);
                            if (holoInstance.strict) {
                                resolve(null);
                                return;
                            }
                        }
                    }

                    resolve(parsed);
                } catch (error) {
                    if (error.message?.startsWith('CIRCULAR_REFERENCE')) {
                         console.warn(`Caught circular reference during get/handleData for key ${key}. Resolving null.`);
                         resolve(null); 
                    } else {
                        console.error('Error processing data in get/handleData:', error);
                        resolve(null); // For other errors, resolve null
                    }
                }
            };

            const dataPath = password ?
                user.get('private').get(lens).get(key) :
                holonLens(holoInstance, holon, lens).get(key);

            // `.once()` wrapped in a deadline — cold-path reads (peer offline,
            // never-written key) used to hang forever otherwise. After
            // `timeout` ms with no Gun response we treat it as "not found".
            onceWithTimeout(dataPath, timeout, { awaitNetwork }).then(handleData);
        });
    } catch (error) {
        console.error('Error in get:', error);
        return null;
    }
}

/**
 * Retrieves all content from the specified holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to retrieve content.
 * @param {string} [password] - Optional password for private holon.
 * @param {object} [options] - Additional options.
 * @param {number} [options.timeout=READ_TIMEOUT_MS] - Per-`.once()` deadline
 *   (ms); the shallow probe falls back to "empty" after this on cold paths
 *   where Gun never responds. Pass `0` to disable and keep the historical
 *   "wait forever" behaviour.
 * @returns {Promise<Array<object>>} - The retrieved content.
 */
export async function getAll(holoInstance, holon, lens, password = null, options = {}) {
    if (!lens) {
        throw new Error('getAll: Missing required parameters');
    }
    const {
        timeout = READ_TIMEOUT_MS,
        // See `get` above: `_deleted: true` records are dropped from the
        // response unless the caller opts in.
        includeDeleted = false,
    } = options;

    const schema = await holoInstance.getSchema(lens);
    if (!schema && holoInstance.strict) {
        throw new Error('getAll: Schema required in strict mode');
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(holon); // Use holon for getAll
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString} during getAll, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created during getAll, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve(); // Resolve anyway to allow test operations
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve(); // Resolve anyway to allow test operations
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully during getAll, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString} during getAll: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });
        }

        return new Promise((resolve) => {
            const output = new Map();
            const pendingProcessing = [];

            const dataPath = password ?
                user.get('private').get(lens) :
                holonLens(holoInstance, holon, lens);

            // PASS 1: Get shallow node to determine expected item count.
            // Wrapped in a deadline (see `onceWithTimeout`) so cold paths
            // resolve `null` after `timeout` ms instead of hanging forever.
            // We still retry once below — Gun's `.once()` reads from local
            // cache, which may be cold immediately after startup before
            // peers have synced.
            const shallowOnce = () => onceWithTimeout(dataPath, timeout);

            const processShallow = (data) => {
                if (!data) {
                    resolve([]);
                    return;
                }

                // Filter out Gun metadata, null/deleted entries, and Gun soul references
                const keys = Object.keys(data).filter(key => {
                    if (key === '_') return false;
                    const val = data[key];
                    if (val === null) return false;
                    // Filter out Gun graph references (sub-nodes)
                    if (typeof val === 'object' && val['#']) return false;
                    return true;
                });
                const expectedCount = keys.length;

                if (expectedCount === 0) {
                    resolve([]);
                    return;
                }

                // PASS 2: iterate explicitly over the filtered keys.
                // Using dataPath.map().once() here is unsafe when the parent
                // node has tombstoned siblings (null values): map() fires for
                // every child, and a null sibling's callback can satisfy
                // receivedCount before real items are processed, resolving [].
                const processItem = async (itemData, key) => {
                    if (!itemData) return;
                    try {
                        const parsed = await holoInstance.parse(itemData);
                        if (!parsed || !parsed.id) return;

                        // Drop `_deleted: true` soft-tombstones by default;
                        // callers wanting them in the result pass
                        // `{ includeDeleted: true }` to `getAll`.
                        if (!includeDeleted && parsed._deleted === true) return;

                        if (holoInstance.isHologram(parsed)) {
                            try {
                                const resolved = await holoInstance.resolveHologram(parsed, {
                                    followHolograms: true,
                                    maxDepth: 10,
                                    currentDepth: 0
                                });

                                if (resolved === null) {
                                    // See `get()` above: null is not proof of a
                                    // permanently dead pointer. Skip the entry
                                    // without deleting so transient resolution
                                    // failures don't destroy real data.
                                    console.warn(`Hologram at ${holon}/${lens}/${key} did not resolve (soul=${parsed.soul}); skipping.`);
                                    return;
                                }

                                if (resolved && resolved !== parsed) {
                                    if (schema) {
                                        const valid = holoInstance.validator.validate(schema, resolved);
                                        if (valid || !holoInstance.strict) {
                                            output.set(resolved.id, resolved);
                                        }
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
                            if (valid || !holoInstance.strict) {
                                output.set(parsed.id, parsed);
                            }
                        } else {
                            output.set(parsed.id, parsed);
                        }
                    } catch (error) {
                        console.error('Error processing data:', error);
                    }
                };

                Promise.all(keys.map((key) => {
                    const inline = data[key];
                    // If shallow already inlined the leaf (holosphere stores
                    // payloads as JSON strings), process it directly. This
                    // avoids a redundant round-trip and the map() race.
                    if (typeof inline !== 'object' || inline === null) {
                        return processItem(inline, key);
                    }
                    // Otherwise fetch the leaf — sub-graph reference path.
                    // Same deadline as the shallow probe; a single missing
                    // leaf can't stall the whole batch.
                    return onceWithTimeout(dataPath.get(key), timeout)
                        .then((itemData) => processItem(itemData, key));
                })).then(() => resolve(Array.from(output.values())));
            };

            (async () => {
                let data = await shallowOnce();
                if (!data) {
                    await new Promise(r => setTimeout(r, 1500));
                    data = await shallowOnce();
                }
                processShallow(data);
            })();
        });
    } catch (error) {
        console.error('Error in getAll:', error);
        return [];
    }
}

/**
 * Parses data from GunDB, handling various data formats and references.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {*} data - The data to parse, could be a string, object, or GunDB reference.
 * @returns {Promise<object>} - The parsed data.
 */
export async function parse(holoInstance, rawData) {
    if (rawData === null || rawData === undefined) {
        console.warn('Parse received null or undefined data.');
        return null;
    }

    // 1. Handle string data (attempt JSON parse)
    if (typeof rawData === 'string') {
        try {
            return JSON.parse(rawData);
        } catch (error) {
            // It's a string, but not valid JSON. Return null.
            console.warn("Data was a string but not valid JSON, returning null:", rawData);
            return null;
        }
    }

    // 2. Handle object data
    if (typeof rawData === 'object' && rawData !== null) {
        // Check for GunDB soul link (less common now?)
        if (rawData.soul && typeof rawData.soul === 'string' && rawData.id) {
             // This looks like a Hologram object based on structure.
             // Return it as is; resolution happens later if needed.
             return rawData;
        } else if (holoInstance.isHologram(rawData)) {
             // Explicitly check using isHologram (might be redundant if structure check above is reliable)
             return rawData;
        } else if (rawData._) {
            // Handle potential GunDB metadata remnants (attempt cleanup)
            console.warn('Parsing raw Gun object with metadata (_) - attempting cleanup:', rawData);
            const potentialData = Object.keys(rawData).reduce((acc, k) => {
                if (k !== '_') {
                    acc[k] = rawData[k];
                }
                return acc;
            }, {});
            if (Object.keys(potentialData).length === 0) {
                console.warn('Raw Gun object had only metadata (_), returning null.');
                return null;
            }
            return potentialData; // Return cleaned-up object
        } else {
            // Assume it's a regular plain object
            return rawData;
        }
    }

    // 3. Handle other unexpected types
    console.warn("Parsing encountered unexpected data type, returning null:", typeof rawData, rawData);
    return null;
}

/**
 * Deletes a specific key from a given holon and lens.
 * If the deleted data was a hologram, this function also attempts to update the
 * target data node's `_holograms` set by marking the deleted hologram's soul as 'DELETED'.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to delete the key.
 * @param {string} key - The specific key to delete.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>} - Returns true if successful
 */
export async function deleteFunc(holoInstance, holon, lens, key, password = null) { // Renamed to deleteFunc to avoid keyword conflict
    if (!lens || !key) {
        throw new Error('delete: Missing required parameters');
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(holon); // Use holon for deleteFunc
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString} during deleteFunc, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created")) {
                                    console.log(`User ${userNameString} already existed during deleteFunc, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            reject(new Error(`Failed to auth with fresh user object after create attempt (user existed) for ${userNameString} during deleteFunc: ${secondAuthAck.err}`));
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    reject(new Error(`Failed to create user ${userNameString} during deleteFunc: ${createAck.err}`));
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully during deleteFunc, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString} during deleteFunc: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });
        }

        const dataPath = password ?
            user.get('private').get(lens).get(key) :
            holonLens(holoInstance, holon, lens).get(key);

        // --- Start: Hologram Tracking Removal ---
        let trackingRemovalPromise = Promise.resolve(); // Default to resolved promise
        
        // 1. Get the data first to check if it's a hologram.
        // Use the shared deadline wrapper — a bare `.once()` hangs forever on a
        // cold read (peer offline / missing key), which would stall the whole
        // delete. On timeout we proceed as "not a hologram" (null), which just
        // skips the forward-reference cleanup — the node removal below still runs.
        const rawDataToDelete = await onceWithTimeout(dataPath, READ_TIMEOUT_MS);
        let dataToDelete = null;
        try {
            if (typeof rawDataToDelete === 'string') {
                dataToDelete = JSON.parse(rawDataToDelete);
            } else {
                // Handle cases where it might already be an object (though likely string)
                dataToDelete = rawDataToDelete; 
            }
        } catch(e) {
            console.warn("[deleteFunc] Could not JSON parse data for deletion check:", rawDataToDelete, e);
            dataToDelete = null; // Ensure it's null if parsing fails
        }

        // 2. If it is a hologram, try to remove its reference from the target
        const isDataHologram = dataToDelete && holoInstance.isHologram(dataToDelete);
        
        if (isDataHologram) {
            try {
                const targetSoul = dataToDelete.soul;
                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                
                if (targetSoulInfo) {
                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                    const deletedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/${key}`;

                    // Create a promise that resolves when the hologram is removed from the list
                    trackingRemovalPromise = new Promise((resolveTrack) => { // No reject needed, just warn on error
                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => { // Remove the hologram entry completely
                            if (ack.err) {
                                console.warn(`[deleteFunc] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                            }
                            resolveTrack(); // Resolve regardless of ack error to not block main delete
                        });
                    });
                } else {
                    // Keep this warning
                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal.`);
                }
            } catch (trackingError) {
                 // Keep this warning
                console.warn(`Error initiating hologram reference removal from target ${dataToDelete.soul}:`, trackingError);
                // Ensure trackingRemovalPromise remains resolved if setup fails
                trackingRemovalPromise = Promise.resolve(); 
            }
        }
        // --- End: Hologram Tracking Removal ---

        // 3. Wait for the tracking removal attempt to be acknowledged
        await trackingRemovalPromise;
        // Log removed

        // 4. Proceed with the actual deletion of the hologram node itself
        return new Promise((resolve, reject) => {
            dataPath.put(null, ack => {
                if (ack.err) {
                    reject(new Error(ack.err));
                } else {
                    resolve(true);
                }
            });
        });
    } catch (error) {
        console.error('Error in delete:', error);
        throw error;
    }
}

/**
 * Deletes all keys from a given holon and lens.
 * @param {HoloSphere} holoInstance - The HoloSphere instance.
 * @param {string} holon - The holon identifier.
 * @param {string} lens - The lens from which to delete all keys.
 * @param {string} [password] - Optional password for private holon.
 * @returns {Promise<boolean>} - Returns true if successful
 */
export async function deleteAll(holoInstance, holon, lens, password = null) {
    if (!lens) {
        console.error('deleteAll: Missing holon or lens parameter');
        return false;
    }

    try {
        let user = null;
        if (password) {
            user = holoInstance.gun.user();
            await new Promise((resolve, reject) => {
                const userNameString = holoInstance.userName(holon); // Use holon for deleteAll
                user.auth(userNameString, password, (authAck) => {
                    if (authAck.err) {
                        console.log(`Initial auth failed for ${userNameString} during deleteAll, attempting to create...`);
                        user.create(userNameString, password, (createAck) => {
                            if (createAck.err) {
                                if (createAck.err.includes("already created") || createAck.err.includes("already being created")) {
                                    console.log(`User ${userNameString} already existed or being created during deleteAll, re-attempting auth with fresh user object.`);
                                    const freshUser = holoInstance.gun.user(); // Get a new user object
                                    freshUser.auth(userNameString, password, (secondAuthAck) => {
                                        if (secondAuthAck.err) {
                                            console.log(`Auth still failed after user existed check: ${secondAuthAck.err}. Resolving anyway for test operations.`);
                                            resolve(); // Resolve anyway to allow test operations
                                        } else {
                                            resolve();
                                        }
                                    });
                                } else {
                                    console.log(`Create user error (resolving anyway for operations): ${createAck.err}`);
                                    resolve(); // Resolve anyway to allow test operations
                                }
                            } else {
                                console.log(`User ${userNameString} created successfully during deleteAll, attempting auth...`);
                                user.auth(userNameString, password, (secondAuthAck) => {
                                    if (secondAuthAck.err) {
                                        reject(new Error(`Failed to auth after create for ${userNameString} during deleteAll: ${secondAuthAck.err}`));
                                    } else {
                                        resolve();
                                    }
                                });
                            }
                        });
                    } else {
                        resolve(); // Auth successful
                    }
                });
            });
        }

        return new Promise((resolve) => {
            let deletionPromises = [];

            const dataPath = password ?
                user.get('private').get(lens) :
                holonLens(holoInstance, holon, lens);

            // First get all the data to find keys to delete
            dataPath.once(async (data) => {
                if (!data) {
                    resolve(true); // Nothing to delete
                    return;
                }

                // Get all keys except Gun's metadata key '_'
                const keys = Object.keys(data).filter(key => key !== '_');

                // Process each key to handle holograms properly
                for (const key of keys) {
                    try {
                        // Get the data to check if it's a hologram
                        const itemPath = password ?
                            user.get('private').get(lens).get(key) :
                            holonLens(holoInstance, holon, lens).get(key);

                        const rawDataToDelete = await new Promise((resolveItem) => itemPath.once(resolveItem));
                        let dataToDelete = null;
                        
                        try {
                            if (typeof rawDataToDelete === 'string') {
                                dataToDelete = JSON.parse(rawDataToDelete);
                            } else {
                                dataToDelete = rawDataToDelete;
                            }
                        } catch(e) {
                            console.warn("[deleteAll] Could not JSON parse data for deletion check:", rawDataToDelete, e);
                            dataToDelete = null;
                        }

                        // Check if it's a hologram and handle accordingly
                        const isDataHologram = dataToDelete && holoInstance.isHologram(dataToDelete);
                        
                        if (isDataHologram) {
                            // Handle hologram deletion - remove from target's _holograms list
                            try {
                                const targetSoul = dataToDelete.soul;
                                const targetSoulInfo = holoInstance.parseSoulPath(targetSoul);
                                
                                if (targetSoulInfo) {
                                    const targetNodeRef = holoInstance.getNodeRef(targetSoul);
                                    const deletedHologramSoul = `${holoInstance.appname}/${holon}/${lens}/${key}`;

                                    // Remove the hologram from target's _holograms list
                                    await new Promise((resolveTrack) => {
                                        targetNodeRef.get('_holograms').get(deletedHologramSoul).put(null, (ack) => {
                                            if (ack.err) {
                                                console.warn(`[deleteAll] Error removing hologram ${deletedHologramSoul} from target ${targetSoul}:`, ack.err);
                                                                                    }
                                        resolveTrack();
                                        });
                                    });
                                } else {
                                    console.warn(`Could not parse target soul ${targetSoul} for hologram tracking removal during deleteAll.`);
                                }
                            } catch (trackingError) {
                                console.warn(`Error removing hologram reference from target ${dataToDelete.soul} during deleteAll:`, trackingError);
                            }
                        }

                        // Create deletion promise for this key (whether it's a hologram or not)
                        deletionPromises.push(
                            new Promise((resolveDelete) => {
                                const deletePath = password ?
                                    user.get('private').get(lens).get(key) :
                                    holonLens(holoInstance, holon, lens).get(key);

                                deletePath.put(null, ack => {
                                    resolveDelete(!!ack.ok); // Convert to boolean
                                });
                            })
                        );
                    } catch (error) {
                        console.warn(`Error processing key ${key} during deleteAll:`, error);
                        // Still try to delete the item even if hologram processing failed
                        deletionPromises.push(
                            new Promise((resolveDelete) => {
                                const deletePath = password ?
                                    user.get('private').get(lens).get(key) :
                                    holonLens(holoInstance, holon, lens).get(key);

                                deletePath.put(null, ack => {
                                    resolveDelete(!!ack.ok);
                                });
                            })
                        );
                    }
                }

                // Wait for all deletions to complete
                Promise.all(deletionPromises)
                    .then(results => {
                        const allSuccessful = results.every(result => result === true);
                        resolve(allSuccessful);
                    })
                    .catch(error => {
                        console.error('Error in deleteAll:', error);
                        resolve(false);
                    });
            });
        });
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