// Task deletion with forward-cascade.
//
// holosphere.delete only prunes ONE direction: if the entry being deleted is
// itself a forward (a `{id, soul}` hologram), the lib removes its soul from
// the source's `_holograms` set. It does NOT walk `_holograms` on the entry
// being deleted, so if you delete a SOURCE quest, every forward published
// from it stays as a dangling pointer that `resolveHologram` can't follow,
// surfacing as "Hologram at … did not resolve" warnings forever after.
//
// `deleteTaskWithCascade` reads `_holograms` on the source before deletion,
// then deletes the source, then best-effort deletes each forward. Cascade is
// best-effort because forwards may live in holons we don't have write
// permission for (other users' personal holons) — those are skipped silently
// and reported back as `forwardsFailed`.

import type { HoloSphere } from 'holosphere';

export interface DeleteCascadeResult {
	/** True when the source itself was successfully removed. */
	sourceDeleted: boolean;
	/** Number of forward souls discovered in the source's `_holograms` set. */
	forwardsFound: number;
	/** Forwards we successfully tombstoned. */
	forwardsDeleted: number;
	/** Forwards we could not delete — write denied, parse error, etc. */
	forwardsFailed: number;
}

export interface DeleteCascadeOptions {
	/** Lens to delete from; defaults to `quests`. */
	lens?: string;
	/**
	 * How long to wait for Gun to surface the `_holograms` set before giving
	 * up and assuming no forwards exist. Defaults to 2000ms.
	 */
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

	// Snapshot forwards BEFORE deletion. Doing it after would race against
	// holosphere.delete's own tombstone of the source node, which can wipe
	// the `_holograms` subtree on the wire before our walk completes.
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
 * Read every live forward soul from a node's `_holograms` set. Tombstoned
 * (null) entries are filtered out; the Gun metadata key `_` is skipped.
 *
 * Exported for tests and for any future GC pass that wants to enumerate
 * forwards without deleting the source.
 */
export function readForwardSouls(
	holosphere: HoloSphere,
	sourceSoul: string,
	timeoutMs = 2000
): Promise<string[]> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (out: string[]) => {
			if (settled) return;
			settled = true;
			resolve(out);
		};
		try {
			const ref = (holosphere as any).getNodeRef(sourceSoul).get('_holograms');
			ref.once((data: any) => {
				if (!data || typeof data !== 'object') return finish([]);
				const souls = Object.keys(data).filter(
					(k) => k !== '_' && k !== '#' && data[k] != null
				);
				finish(souls);
			});
		} catch {
			finish([]);
		}
		// Gun `.once()` can hang indefinitely on cold reads. The timeout is a
		// safety net so a delete never blocks on missing peers — empty result
		// just means no cascade, which is the same outcome we had before.
		setTimeout(() => finish([]), timeoutMs);
	});
}
