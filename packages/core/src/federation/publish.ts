/**
 * Publish to Federation — UI-agnostic core.
 *
 * Single source of truth for "publish this item to the federation" across UIs
 * (web, telegram, text, ai). Holograms are **opt-in**: by default the receiver
 * gets a standalone full copy of the item; pass `useHolograms: true` to instead
 * write a bare `{ id, soul }` hologram that links back to this holon's storage.
 * Stamping the source item with `published`/`publishedAt`/`publishedTo` is the
 * caller's responsibility.
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
	/**
	 * For the `hex` target only: also propagate the hologram UP the parent cell
	 * chain so the item surfaces at coarser map zoom levels, not just the exact
	 * cell. Without this, a hex publish lands at a single cell and is invisible
	 * until the viewer zooms all the way in. Default false.
	 */
	upcast?: boolean;
	/**
	 * How many parent levels to climb when `upcast` is set. Defaults to a full
	 * climb to the top. Callers that know the target cell's level can pass it so
	 * the hologram reaches every coarser level above it.
	 */
	upcastLevels?: number;
	/**
	 * Opt-in hologram creation. When `true`, write a bare `{ id, soul }` hologram
	 * pointing back at this holon's storage (and propagate with holograms on).
	 * When `false` (the **default**), write the full item — a standalone copy on
	 * the receiver with no back-link. Holograms are deliberately opt-in so a
	 * publish doesn't implicitly spread soul pointers across the federation.
	 */
	useHolograms?: boolean;
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
	onWriteDenied?: PublishOptions['onWriteDenied'],
	forwarderRegistration?: { localHolonId: string; lens: string; itemId: string },
	putOptions?: object
): Promise<void> {
	try {
		// Keep the common path a 3-arg put; only pass options when upcasting so
		// we don't perturb callers/tests that match the bare signature.
		if (putOptions) {
			await (holosphere as any).put(target, lens, hologram, putOptions);
		} else {
			await (holosphere as any).put(target, lens, hologram);
		}
		destinations.push(target);

		// When forwarding an existing hologram (i.e. we're not the original
		// source), also register the new hop in OUR OWN `_holograms` set on
		// our local hologram of this item. holosphere.put already tries to
		// register at the source's `_holograms` set, but that write is
		// cross-holon and relies on Gun gossip making it across — which
		// often doesn't in real meshes. Adding the entry to our own local
		// set is a *local* write we control, and the cascade walk in
		// holosphere's put (which now also runs for hologram updates) will
		// pick it up so updates flow A → us → target on every hop.
		if (forwarderRegistration) {
			try {
				const { localHolonId, lens: regLens, itemId } = forwarderRegistration;
				const appname = (holosphere as any).appname;
				const ourSoul = `${appname}/${localHolonId}/${regLens}/${itemId}`;
				const newHopSoul = `${appname}/${target}/${regLens}/${itemId}`;
				(holosphere as any)
					.getNodeRef(ourSoul)
					.get('_holograms')
					.get(newHopSoul)
					.put(true);
			} catch {
				// Best-effort: cascade is a backup channel for the source-side
				// registration. If this fails the forward still went through.
			}
		}
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

	// Holograms are opt-in (default off). See `PublishOptions.useHolograms`.
	const useHolograms = opts.useHolograms === true;

	// Decide what gets persisted on the target holon:
	//
	//   • useHolograms === false (default) — write the *full item*, minus the
	//     read-side `_hologram` envelope, as a standalone copy. No `{ id, soul }`
	//     pointer, no `_holograms` cascade hop: the receiver owns its own record.
	//
	//   • useHolograms === true — write the *bare stored form* of a hologram,
	//     `{ id, soul }`, which links back to the source:
	//       – Fresh publish: `createHologram(holon, lens, item)` mints a new soul
	//         pointing at THIS holon's storage of the item.
	//       – Forwarding a resolved hologram: the item already carries
	//         `_hologram.soul` pointing at the original source, so hand-build the
	//         `{ id, soul }` pair from that. (createHologram only short-circuits
	//         on the *bare* stored shape, not the resolved shape from
	//         get()/getAll() where the soul lives in `_hologram.soul`; without
	//         this branch it would mint a fresh soul at the forwarder's storage
	//         and the receiver would resolve back to data we don't have.)
	let payload: unknown;
	// Only forwards (re-publishing an existing hologram) need the local
	// `_holograms` cascade registration — fresh publishes already register at the
	// source's `_holograms` set on the same local instance.
	let forwarderRegistration: { localHolonId: string; lens: string; itemId: string } | undefined;
	if (useHolograms) {
		const resolvedHologramSoul = (item as any)?._hologram?.isHologram
			? ((item as any)._hologram.soul as string | undefined)
			: undefined;
		payload = resolvedHologramSoul
			? { id: (item as any).id, soul: resolvedHologramSoul }
			: await (holosphere as any).createHologram(holonId, lens, item);
		forwarderRegistration = resolvedHologramSoul
			? { localHolonId: holonId, lens, itemId: item.id }
			: undefined;
	} else {
		const { _hologram, ...bare } = item as any;
		payload = bare;
		forwarderRegistration = undefined;
	}
	const errors: string[] = [];
	const destinations: string[] = [];
	const single = (t: string) =>
		putToTarget(
			holosphere,
			t,
			lens,
			payload,
			destinations,
			errors,
			opts.onWriteDenied,
			forwarderRegistration
		);

	if (target.kind === 'partner') {
		await single(target.holonId);
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: useHolograms };
	}

	if (target.kind === 'hex') {
		if (opts.upcast) {
			// Climb the parent chain so the hologram is discoverable at coarser
			// zoom levels, the same way a federation publish auto-propagates to
			// parents. maxParentLevels defaults to a full climb to the top.
			await putToTarget(
				holosphere,
				target.cell,
				lens,
				payload,
				destinations,
				errors,
				opts.onWriteDenied,
				forwarderRegistration,
				{
					autoPropagate: true,
					propagationOptions: {
						useHolograms,
						propagateToParents: true,
						maxParentLevels: opts.upcastLevels ?? 15
					}
				}
			);
		} else {
			await single(target.cell);
		}
		return { publishedTo: destinations.length, destinations, errors, usedHolograms: useHolograms };
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
			const result: any = await (holosphere as any).propagate(holonId, lens, payload, {
				useHolograms,
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
		usedHolograms: useHolograms
	};
}
