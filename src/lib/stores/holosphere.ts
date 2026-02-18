import { writable, derived, type Readable } from 'svelte/store';
import type { HoloSphere } from 'holosphere';
import type { DualWriteAdapter } from '$lib/ad4m/dual-adapter';

/** The backend can be either a raw HoloSphere or a DualWriteAdapter (which wraps HoloSphere) */
export type HolosphereBackend = HoloSphere | DualWriteAdapter;

// The main holosphere store - updated when holosphere is initialized
export const holosphereStore = writable<HolosphereBackend | null>(null);

// Helper function to get the current holosphere value (for non-reactive contexts)
export function getHolosphere(): HolosphereBackend | null {
	let value: HolosphereBackend | null = null;
	holosphereStore.subscribe(v => value = v)();
	return value;
}
