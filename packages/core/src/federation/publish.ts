/**
 * Publish to Federation — UI-agnostic core.
 *
 * Single source of truth for "publish this item as a hologram" across UIs
 * (web, telegram, text, ai). Always wraps the item in a hologram first so
 * receivers' provenance metadata is correct. Stamping the source item with
 * `published`/`publishedAt`/`publishedTo` is the caller's responsibility.
 *
 * Three target shapes:
 *   - 'all'     → propagate() to every federated partner (current default)
 *                 + optional write to settings.hex if configured
 *   - 'partner' → put(targetHolonId, lens, hologram) to one specific partner
 *   - 'hex'     → put(h3Cell, lens, hologram) to one H3 cell
 *
 * UI-injected concerns (Svelte stores, nostr identity, toast notifications)
 * stay UI-side: pass `federationSourceId` explicitly and supply an
 * `onWriteDenied` callback if you want write-permission errors surfaced.
 */

import type { HoloSphere } from 'holosphere';
import { getFederationSnapshot } from './snapshot.js';
import { readSettingsHex } from './settings-hex.js';

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
	/** Federation source identity (e.g. nostr pubkey). Defaults to `holonId`. */
	federationSourceId?: string;
	/**
	 * Optional callback fired when a put is rejected by HoloSphere ACL
	 * (AuthorizationError / "Write access denied"). UIs can surface a toast.
	 */
	onWriteDenied?: (info: { target: string; lens: string; message: string }) => void;
}

export interface PublishOutcome {
	publishedTo: number;
	destinations: string[];
	errors: string[];
	usedHolograms: boolean;
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

/** Put a hologram at `target` and record the outcome in `destinations`/`errors`. */
async function putToTarget(
	holosphere: HoloSphere,
	target: string,
	lens: string,
	hologram: unknown,
	destinations: string[],
	errors: string[],
	onWriteDenied?: PublishOptions['onWriteDenied']
): Promise<void> {
	try {
		await (holosphere as any).put(target, lens, hologram);
		destinations.push(target);
	} catch (err: any) {
		if (err?.name === 'AuthorizationError' || err?.message?.includes('Write access denied')) {
			const message = `Unable to publish to ${target.slice(0, 12)}… — no write permission for ${lens}`;
			onWriteDenied?.({ target, lens, message });
			errors.push(`${target.slice(0, 8)}…: write denied`);
			return;
		}
		errors.push(`${target.slice(0, 8)}…: ${err?.message ?? 'unknown error'}`);
	}
}

function collectMessages(messages: any, errors: string[]): void {
	for (const m of messages ?? []) {
		errors.push(typeof m === 'string' ? m : (m?.error ?? String(m)));
	}
}

export async function publishToFederation(
	ctx: PublishContext,
	target: PublishTarget,
	opts: PublishOptions = {}
): Promise<PublishOutcome> {
	const { holosphere, holonId, lens, item } = ctx;
	ensureItemHasId(item);

	const hologram = await (holosphere as any).createHologram(holonId, lens, item);
	const errors: string[] = [];
	const destinations: string[] = [];
	const single = (t: string) =>
		putToTarget(holosphere, t, lens, hologram, destinations, errors, opts.onWriteDenied);

	if (target.kind === 'partner') {
		await single(target.holonId);
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: true };
	}

	if (target.kind === 'hex') {
		await single(target.cell);
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: true };
	}

	const includeSettingsHex = opts.includeSettingsHex !== false;
	const [settingsHex, snapshot] = await Promise.all([
		includeSettingsHex ? readSettingsHex(holosphere, holonId) : Promise.resolve(null),
		getFederationSnapshot(holosphere, holonId, opts.federationSourceId)
	]);

	if (settingsHex) {
		await single(settingsHex);
	}

	if (snapshot.federated.length > 0) {
		const h3 = isH3(holosphere, holonId);
		try {
			const result: any = await (holosphere as any).propagate(holonId, lens, hologram, {
				useHolograms: true,
				propagateToParents: h3,
				maxParentLevels: h3 ? 1 : 0
			});

			const directSuccess = result?.success ?? 0;
			const parentSuccess = result?.parentPropagation?.success ?? 0;
			for (let i = 0; i < directSuccess + parentSuccess; i++) {
				destinations.push(`federated:${i}`);
			}

			collectMessages(result?.messages ?? result?.errorDetails, errors);
			collectMessages(result?.parentPropagation?.messages, errors);
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
