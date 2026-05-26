// SPDX-License-Identifier: AGPL-3.0-or-later
import { readable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

// `navigator.onLine` reflects whether the browser has a network connection.
// It's a heuristic — true doesn't guarantee the Gun peer is reachable — but
// it's the right signal for "data flow is degraded" UX. SSR returns true so
// the banner doesn't flash during hydration.
export const online: Readable<boolean> = readable(true, (set) => {
	if (!browser) return;
	set(navigator.onLine);
	const handleOnline = () => set(true);
	const handleOffline = () => set(false);
	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);
	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
});
