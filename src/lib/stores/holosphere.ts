import { writable, derived, type Readable } from 'svelte/store';
import type { HoloSphere } from 'holosphere';

// The main holosphere store - updated when holosphere is initialized
export const holosphereStore = writable<HoloSphere | null>(null);

// Track if user is in public space mode (read-only, using service key)
// When true: do not create holons, federate, or grant capabilities with service key
export const isPublicSpaceMode = writable<boolean>(false);

// Helper function to get the current holosphere value (for non-reactive contexts)
export function getHolosphere(): HoloSphere | null {
	let value: HoloSphere | null = null;
	holosphereStore.subscribe(v => value = v)();
	return value;
}
