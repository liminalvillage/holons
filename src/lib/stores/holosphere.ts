import { writable } from 'svelte/store';
import type { HoloSphere } from 'holosphere';

// The main holosphere store - updated when holosphere is initialized
export const holosphereStore = writable<HoloSphere | null>(null);

// Helper function to get the current holosphere value (for non-reactive contexts)
export function getHolosphere(): HoloSphere | null {
	let value: HoloSphere | null = null;
	holosphereStore.subscribe(v => value = v)();
	return value;
}
