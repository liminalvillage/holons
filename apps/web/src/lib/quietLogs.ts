// Filter for a small, hard-coded set of third-party console messages that
// spam the devtools without telling us anything actionable. We do NOT add a
// catch-all silencer — every entry here is a known noisy line whose source
// we can't reach (holosphere library internals, mapbox-gl browser warnings).
//
// Keep the list narrow and prefix-matched: matching by exact prefix avoids
// accidentally swallowing similarly-named messages we DO want to see, and
// makes it trivial to remove an entry when the upstream lib fixes it.

const NOISY_PREFIXES: ReadonlyArray<string> = [
	// holosphere getFederated paths — emitted on every dashboard load even
	// when there's nothing the caller can do about it (we want all items).
	'getFederated: No queryIds provided',
	'Fetching ALL items from',
	'Resolving references for',
	'Found simple reference with soul:',
	// mapbox-gl emits this on Firefox/Brave Canvas2D fingerprinting blocks.
	// We don't enable terrain/hillshade anyway — the warning is incidental.
	'Terrain and hillshade are disabled'
];

let installed = false;

function isNoisy(args: unknown[]): boolean {
	const first = args[0];
	if (typeof first !== 'string') return false;
	for (const prefix of NOISY_PREFIXES) {
		if (first.startsWith(prefix)) return true;
	}
	return false;
}

export function installQuietLogs(): void {
	if (installed) return;
	if (typeof window === 'undefined') return;
	installed = true;

	const origLog = console.log.bind(console);
	const origWarn = console.warn.bind(console);

	console.log = (...args: unknown[]) => {
		if (isNoisy(args)) return;
		origLog(...(args as []));
	};

	console.warn = (...args: unknown[]) => {
		if (isNoisy(args)) return;
		origWarn(...(args as []));
	};
}
