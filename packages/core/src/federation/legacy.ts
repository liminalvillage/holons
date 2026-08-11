// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * One-shot migration of legacy settings-lens federation links.
 *
 * Before the federation write path was unified on the native record, web,
 * discord and mcp stored links as `federation[]` + `lensConfig` fields on the
 * settings lens — invisible to `subscribeFederated` and publishing. This folds
 * those legacy links into the native record and strips the fields (stamping
 * `federationLinksMigrated` so the check is a cheap no-op afterwards).
 *
 * Merge-only: a partner already present in the native record is never
 * overwritten — the native config is assumed newer than the legacy mirror.
 * Call it best-effort from federation UIs before reading the snapshot.
 */

import type { HoloSphere } from 'holosphere';
import { setFederationPartner } from './partners.js';
import { getFederationSnapshot } from './snapshot.js';

export interface LegacyFederationMigration {
	/** Partner ids folded into the native record. */
	migrated: string[];
	/** Legacy partner ids skipped because the native record already has them. */
	skipped: string[];
}

const NONE: LegacyFederationMigration = { migrated: [], skipped: [] };

export async function migrateLegacyFederationLinks(
	holosphere: HoloSphere,
	holonId: string
): Promise<LegacyFederationMigration> {
	const id = String(holonId ?? '').trim();
	if (!id) return NONE;

	let raw: any = null;
	try {
		raw = await holosphere.get(id, 'settings', id);
	} catch {
		return NONE;
	}
	if (!raw || raw.federationLinksMigrated) return NONE;

	const legacyLinks: any[] = Array.isArray(raw.federation) ? raw.federation : [];
	const legacyLensConfig: Record<string, any> =
		raw.lensConfig && typeof raw.lensConfig === 'object' ? raw.lensConfig : {};
	const targets = new Set<string>([
		...legacyLinks.map((l) => String(l?.targetId ?? '').trim()),
		...Object.keys(legacyLensConfig)
	]);
	targets.delete('');
	targets.delete(id);
	if (targets.size === 0) return NONE;

	const native = await getFederationSnapshot(holosphere, id);
	const result: LegacyFederationMigration = { migrated: [], skipped: [] };

	for (const target of targets) {
		if (native.federated.includes(target)) {
			result.skipped.push(target);
			continue;
		}
		const link = legacyLinks.find((l) => String(l?.targetId ?? '').trim() === target);
		const lenses = legacyLensConfig[target] ?? link?.lenses ?? {};
		await setFederationPartner(holosphere, id, target, {
			inbound: Array.isArray(lenses.inbound) ? lenses.inbound : [],
			outbound: Array.isArray(lenses.outbound) ? lenses.outbound : [],
			...(link?.targetName ? { partnerName: String(link.targetName) } : {})
		});
		result.migrated.push(target);
	}

	// Strip the legacy fields and stamp the marker — mutating the raw object so
	// unrelated settings fields (name, hex, federationZones, …) survive intact.
	// Explicit nulls (not `delete`): a merge-style put would otherwise keep the
	// old values alive in the graph.
	raw.federation = null;
	raw.lensConfig = null;
	raw.federationLinksMigrated = new Date().toISOString();
	await holosphere.put(id, 'settings', raw);

	return result;
}
