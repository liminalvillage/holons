/**
 * Publish to Federation
 *
 * Single source of truth for "publish this item as a hologram" across the app.
 * Replaces the duplicated publishToFederatedChats() handlers in TaskModal,
 * Offers, and the older share-dialog flow in Tasks.svelte.
 *
 * Three target shapes:
 *   - 'all'     → propagate() to every federated partner (current default)
 *   - 'partner' → put(targetHolonId, lens, hologram) to one specific partner
 *   - 'hex'     → put(h3Cell, lens, hologram) to one H3 cell
 *
 * Always wraps the item in a hologram first so receivers' SourceBadge
 * sees correct provenance metadata. Stamping the source item with
 * `published`/`publishedAt`/`publishedTo` is the caller's responsibility.
 */

import { get } from 'svelte/store';
import type { HoloSphere } from 'holosphere';
import { nostrPublicKey } from '$lib/stores/nostr';
import { notifyWriteDenied } from '$lib/stores/writeNotifications';

export type PublishTarget =
	| { kind: 'all' }
	| { kind: 'partner'; holonId: string }
	| { kind: 'hex'; cell: string };

export interface PublishContext {
	holosphere: HoloSphere;
	holonId: string;
	lens: string;
	item: { id: string; [k: string]: any };
}

export interface PublishOptions {
	/** When true, also write to settings.hex if one is configured. Default true. */
	includeSettingsHex?: boolean;
	/** Override the federation source. Defaults to $nostrPublicKey || holonId. */
	federationSourceId?: string;
}

export interface PublishOutcome {
	publishedTo: number;
	destinations: string[];
	errors: string[];
	usedHolograms: boolean;
}

interface FederationSnapshot {
	federated: string[];
	partnerNames: Record<string, string>;
}

/** Read federation list + partner names for the current home holon. */
export async function getFederationSnapshot(
	holosphere: HoloSphere,
	holonId: string,
	federationSourceId?: string
): Promise<FederationSnapshot> {
	const sourceId = federationSourceId ?? get(nostrPublicKey) ?? holonId;
	const fedInfo = await holosphere.getFederation(sourceId);
	return {
		federated: Array.isArray(fedInfo?.federated) ? fedInfo!.federated : [],
		partnerNames: fedInfo?.partnerNames ?? {}
	};
}

/** Read settings.hex for a holon, returning null if absent or unreachable. */
export async function readSettingsHex(
	holosphere: HoloSphere,
	holonId: string
): Promise<string | null> {
	try {
		const settings = await holosphere.get(holonId, 'settings', holonId);
		return settings && typeof settings.hex === 'string' && settings.hex
			? settings.hex
			: null;
	} catch {
		return null;
	}
}

function isH3(holosphere: HoloSphere, holonId: string): boolean {
	try {
		return !!(holosphere as any).isValidH3?.(holonId);
	} catch {
		return false;
	}
}

function ensureItemHasId(item: { id?: string; [k: string]: any }): asserts item is { id: string } {
	if (!item || typeof item.id !== 'string' || !item.id) {
		throw new Error('publishToFederation: item.id is required to create a hologram');
	}
}

export async function publishToFederation(
	ctx: PublishContext,
	target: PublishTarget,
	opts: PublishOptions = {}
): Promise<PublishOutcome> {
	const { holosphere, holonId, lens, item } = ctx;
	ensureItemHasId(item);

	const hologram = await holosphere.createHologram(holonId, lens, item);
	const errors: string[] = [];
	const destinations: string[] = [];

	if (target.kind === 'partner') {
		try {
			await holosphere.put(target.holonId, lens, hologram);
			destinations.push(target.holonId);
		} catch (err: any) {
			handlePutError(err, lens, errors, target.holonId);
		}
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: true };
	}

	if (target.kind === 'hex') {
		try {
			await holosphere.put(target.cell, lens, hologram);
			destinations.push(target.cell);
		} catch (err: any) {
			handlePutError(err, lens, errors, target.cell);
		}
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: true };
	}

	// target.kind === 'all'
	const includeSettingsHex = opts.includeSettingsHex !== false;
	const settingsHex = includeSettingsHex ? await readSettingsHex(holosphere, holonId) : null;
	const snapshot = await getFederationSnapshot(holosphere, holonId, opts.federationSourceId);
	const hasFederated = snapshot.federated.length > 0;

	if (settingsHex) {
		try {
			await holosphere.put(settingsHex, lens, hologram);
			destinations.push(settingsHex);
		} catch (err: any) {
			handlePutError(err, lens, errors, settingsHex);
		}
	}

	if (hasFederated) {
		const h3 = isH3(holosphere, holonId);
		try {
			const result = await holosphere.propagate(holonId, lens, hologram, {
				useHolograms: true,
				propagateToParents: h3,
				maxParentLevels: h3 ? 1 : 0
			});

			const directSuccess = (result as any)?.success ?? 0;
			const parentSuccess = (result as any)?.parentPropagation?.success ?? 0;
			for (let i = 0; i < directSuccess + parentSuccess; i++) {
				destinations.push(`federated:${i}`);
			}

			const directMessages = (result as any)?.messages ?? (result as any)?.errorDetails ?? [];
			const parentMessages = (result as any)?.parentPropagation?.messages ?? [];
			for (const m of directMessages) errors.push(typeof m === 'string' ? m : m?.error ?? String(m));
			for (const m of parentMessages) errors.push(typeof m === 'string' ? m : m?.error ?? String(m));
		} catch (err: any) {
			errors.push(`Propagation error: ${err?.message ?? 'unknown'}`);
		}
	}

	return {
		publishedTo: destinations.length,
		destinations,
		errors,
		usedHolograms: true
	};
}

function handlePutError(err: any, lens: string, errors: string[], target: string) {
	if (err?.name === 'AuthorizationError' || err?.message?.includes('Write access denied')) {
		notifyWriteDenied(`Unable to publish to ${target.slice(0, 12)}… — no write permission for ${lens}`);
		errors.push(`${target.slice(0, 8)}…: write denied`);
		return;
	}
	errors.push(`${target.slice(0, 8)}…: ${err?.message ?? 'unknown error'}`);
}
