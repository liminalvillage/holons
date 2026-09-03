// Task deletion with forward-cascade.
//
// holosphere.delete only prunes ONE direction: if the entry being deleted is
// itself a forward (a `{id, soul}` hologram), the store drops it from the
// source's backlinks. It does NOT walk the backlinks of the entry being
// deleted, so if you delete a SOURCE quest, every forward published from it
// stays as a dangling pointer that `resolveHologram` can't follow, surfacing
// as "Hologram at … did not resolve" warnings forever after.
//
// `deleteTaskWithCascade` reads the source's backlinks before deletion, then
// deletes the source, then best-effort deletes each forward. Cascade is
// best-effort because forwards may live in holons we don't have write
// permission for (other users' personal holons) — those are skipped silently
// and reported back as `forwardsFailed`.

import type { HoloSphere } from 'holosphere';

export interface DeleteCascadeResult {
	/** True when the source itself was successfully removed. */
	sourceDeleted: boolean;
	/** Number of forward souls discovered in the source's backlinks. */
	forwardsFound: number;
	/** Forwards we successfully tombstoned. */
	forwardsDeleted: number;
	/** Forwards we could not delete — write denied, parse error, etc. */
	forwardsFailed: number;
}

export interface DeleteCascadeOptions {
	/** Lens to delete from; defaults to `quests`. */
	lens?: string;
	/** @deprecated backlinks are read synchronously from the local store; kept for API compatibility. */
	readForwardsTimeoutMs?: number;
}

export async function deleteTaskWithCascade(
	holosphere: HoloSphere,
	holonId: string,
	questId: string,
	options: DeleteCascadeOptions = {}
): Promise<DeleteCascadeResult> {
	const lens = options.lens ?? 'quests';
	const appname = (holosphere as any).appname as string;
	const sourceSoul = `${appname}/${holonId}/${lens}/${questId}`;

	// Snapshot forwards BEFORE deletion: tombstoning the source does not touch
	// its backlinks, but reading first keeps the cascade independent of what
	// the delete does to the index.
	const forwards = await readForwardSouls(
		holosphere,
		sourceSoul,
		options.readForwardsTimeoutMs ?? 2000
	);

	let sourceDeleted = false;
	try {
		await (holosphere as any).delete(holonId, lens, questId);
		sourceDeleted = true;
	} catch (err) {
		// If the source delete failed, don't cascade — we'd orphan forwards
		// even though the original is still alive. Caller can retry.
		return {
			sourceDeleted: false,
			forwardsFound: forwards.length,
			forwardsDeleted: 0,
			forwardsFailed: 0
		};
	}

	let forwardsDeleted = 0;
	let forwardsFailed = 0;
	for (const forwardSoul of forwards) {
		const parsed = (holosphere as any).parseSoulPath(forwardSoul);
		if (!parsed || parsed.appname !== appname) {
			forwardsFailed++;
			continue;
		}
		try {
			await (holosphere as any).delete(parsed.holon, parsed.lens, parsed.key);
			forwardsDeleted++;
		} catch {
			// AuthorizationError on a foreign holon, network blip, etc.
			// Forward stays as a dangling pointer; a future GC pass can
			// pick it up.
			forwardsFailed++;
		}
	}

	return {
		sourceDeleted,
		forwardsFound: forwards.length,
		forwardsDeleted,
		forwardsFailed
	};
}

/**
 * Every live forward soul that points at a source soul — the store's
 * backlink index for that record (maintained from the hologram pointers it
 * holds). Resolves `[]` for a malformed soul or an instance without the
 * index.
 *
 * Exported for tests and for any future GC pass that wants to enumerate
 * forwards without deleting the source.
 */
export async function readForwardSouls(
	holosphere: HoloSphere,
	sourceSoul: string,
	_timeoutMs = 2000
): Promise<string[]> {
	try {
		const hs = holosphere as any;
		const parsed = typeof hs.parseSoulPath === 'function' ? hs.parseSoulPath(sourceSoul) : null;
		if (!parsed || typeof hs.getBacklinks !== 'function') return [];
		const souls = hs.getBacklinks(parsed.holon, parsed.lens, parsed.key);
		return Array.isArray(souls) ? souls.filter((x: unknown) => typeof x === 'string' && x) : [];
	} catch {
		return [];
	}
}
