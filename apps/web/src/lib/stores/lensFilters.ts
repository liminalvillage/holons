import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

const KEY = 'lensFilters.shared.v1';

type Snapshot = { showFederated: boolean; showHolograms: boolean };

const DEFAULTS: Snapshot = { showFederated: false, showHolograms: true };

function readSnapshot(): Snapshot {
	if (!browser) return DEFAULTS;
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
		return {
			showFederated: typeof saved.showFederated === 'boolean' ? saved.showFederated : DEFAULTS.showFederated,
			showHolograms: typeof saved.showHolograms === 'boolean' ? saved.showHolograms : DEFAULTS.showHolograms
		};
	} catch {
		return DEFAULTS;
	}
}

function writeSnapshot(patch: Partial<Snapshot>) {
	if (!browser) return;
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
		localStorage.setItem(KEY, JSON.stringify({ ...saved, ...patch }));
	} catch {
		/* localStorage unavailable; ignore */
	}
}

const initial = readSnapshot();

/**
 * Shared lens filter toggles. Same instance across every lens view, so
 * the user only configures these once and the choice survives navigation.
 * Persisted to localStorage under `lensFilters.shared.v1`.
 */
export const showFederated: Writable<boolean> = writable(initial.showFederated);
export const showHolograms: Writable<boolean> = writable(initial.showHolograms);

if (browser) {
	showFederated.subscribe(value => writeSnapshot({ showFederated: value }));
	showHolograms.subscribe(value => writeSnapshot({ showHolograms: value }));
}

export interface LensFilterable {
	_hologram?: { isHologram?: boolean } | null;
	_federation?: unknown;
}

/**
 * Shared visibility gate used by every lens view (tasks, expenses, offers,
 * proposals, roles, shopping, library, checklists). Keeps the two toggles
 * in lockstep across lenses.
 */
export function passesLensFilters(
	item: LensFilterable | null | undefined,
	holograms: boolean,
	federated: boolean
): boolean {
	const isHologram = item?._hologram?.isHologram === true;
	const isFederated = !!item?._federation;
	if (!holograms && isHologram) return false;
	if (!federated && isFederated) return false;
	return true;
}
