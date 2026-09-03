#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seed `projects` from a Google MyMaps KML export.
 *
 * Why this script exists
 * ----------------------
 * The Map component highlights H3 cells that contain data at the current
 * zoom's resolution. Holosphere's auto-propagation already writes a hologram
 * pointer at every parent cell (res N → res 0, default maxParentLevels=15),
 * so a single `put` at a base resolution makes the project visible at every
 * zoom level above it. This script gives us a quick way to populate the map
 * with the 750+ regenerative-project markers in
 *   Regenerative Project Documentaries.kml
 * before any real production data is stored.
 *
 * Idempotency
 * -----------
 * Every Placemark maps to a stable `id` derived from its name + rounded
 * coordinates (`makeId`), so re-running the script writes the same item to
 * the same (cell, lens, id) triple — Holosphere treats that as an update,
 * not a duplicate. With `--skip-existing` (default ON) we also short-circuit
 * the work by reading the base cell first and skipping items already present.
 *
 * Resilience
 * ----------
 * Each `holosphere.put` is wrapped in `Promise.race(put, timeout)` because
 * Gun parent-propagation gossip can occasionally stall waiting for an ack —
 * a previous full-batch run wedged at item 125 because the script awaited
 * a put that never resolved. With a per-put timeout (`--timeout-ms`) the
 * stalled write moves on (the local Gun store still has the data; it will
 * sync over time) and the rest of the batch keeps progressing. A small
 * concurrency pool (`--concurrency`) overlaps network latency so the run
 * finishes in minutes rather than tens of minutes.
 *
 * Usage
 * -----
 *   node scripts/seed-kml-projects.mjs <path/to/file.kml> \
 *     [--res=9] [--dry-run] [--limit=N] [--app-name=Holons] \
 *     [--concurrency=4] [--timeout-ms=30000] [--no-skip-existing]
 *
 *   Env:
 *     HOLOSPHERE_PRIVATE_KEY  hex-encoded private key (optional — only needed
 *                             if you want writes attributable to a specific
 *                             pubkey; cell-based public puts go through GUN
 *                             without it)
 *     HOLONS_APP              fallback for --app-name (defaults to "HolonsDebug")
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv, exit, env } from 'node:process';
import * as h3 from 'h3-js';
import { HoloSphere } from 'holosphere';
import { resolveRelays } from '../dist/holosphere/relays.js';

const LENS = 'projects';
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 30_000;

function parseArgs(args) {
	const positional = [];
	const flags = {
		dryRun: false,
		skipExisting: true,
		concurrency: DEFAULT_CONCURRENCY,
		timeoutMs: DEFAULT_TIMEOUT_MS
	};
	for (const a of args) {
		if (a === '--dry-run') flags.dryRun = true;
		else if (a === '--skip-existing') flags.skipExisting = true;
		else if (a === '--no-skip-existing') flags.skipExisting = false;
		else if (a.startsWith('--res=')) flags.res = Number(a.slice(6));
		else if (a.startsWith('--limit=')) flags.limit = Number(a.slice(8));
		else if (a.startsWith('--app-name=')) flags.appName = a.slice(11);
		else if (a.startsWith('--concurrency=')) flags.concurrency = Number(a.slice(14));
		else if (a.startsWith('--timeout-ms=')) flags.timeoutMs = Number(a.slice(13));
		else if (a.startsWith('--')) {
			console.error(`Unknown flag: ${a}`);
			exit(2);
		} else positional.push(a);
	}
	return { positional, flags };
}

// Strip CDATA wrappers so the inner text is usable as plain content.
function unwrapCData(value) {
	if (!value) return '';
	const m = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
	return (m ? m[1] : value).trim();
}

// KML <Placemark> entries follow a regular structure (<name>, <description>,
// <Point><coordinates>lon,lat,alt</coordinates></Point>). A small regex pass
// is enough — bringing in a full XML parser as a script-only dep adds friction
// for a one-off seeder.
function parseKml(xml) {
	const placemarks = [];
	const pmRegex = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g;
	let match;
	while ((match = pmRegex.exec(xml)) !== null) {
		const inner = match[1];
		const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/);
		const descMatch = inner.match(/<description>([\s\S]*?)<\/description>/);
		const coordMatch = inner.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
		if (!coordMatch) continue;

		// Google MyMaps writes "lng,lat,alt" — note the order.
		const [lngStr, latStr] = coordMatch[1].trim().split(',');
		const lng = Number(lngStr);
		const lat = Number(latStr);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

		placemarks.push({
			name: unwrapCData(nameMatch?.[1]) || 'Untitled project',
			description: unwrapCData(descMatch?.[1]),
			lat,
			lng
		});
	}
	return placemarks;
}

// Stable id from name + coords so re-running the seeder is idempotent — the
// same KML row always lands on the same `id` and overwrites its prior write
// instead of creating a duplicate.
function makeId(name, lat, lng) {
	const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60).replace(/^-|-$/g, '');
	const coord = `${lat.toFixed(4)}_${lng.toFixed(4)}`.replace(/[.-]/g, '_');
	return `kml-${slug}-${coord}`;
}

/**
 * Race `promise` against a timeout. If the timeout fires first, the returned
 * promise rejects with `Error('timeout')` so the caller can log + continue.
 * The underlying Gun write started by `promise` is NOT cancelled — local
 * state has usually already been written; only the parent-propagation
 * gossip ack is what we're waiving on.
 */
function withTimeout(promise, ms, label = 'op') {
	let timer;
	return new Promise((resolveOuter, rejectOuter) => {
		timer = setTimeout(() => rejectOuter(new Error(`timeout after ${ms}ms (${label})`)), ms);
		promise.then(
			(v) => { clearTimeout(timer); resolveOuter(v); },
			(e) => { clearTimeout(timer); rejectOuter(e); }
		);
	});
}

/**
 * Run `worker(item, index)` for every entry in `items`, keeping at most
 * `concurrency` workers active at a time. Workers consume from a shared
 * cursor so a slow item doesn't block others.
 */
async function runPool(items, concurrency, worker) {
	let next = 0;
	async function pump() {
		while (true) {
			const i = next++;
			if (i >= items.length) return;
			await worker(items[i], i);
		}
	}
	const workers = Array.from({ length: Math.max(1, concurrency) }, pump);
	await Promise.all(workers);
}

async function main() {
	const { positional, flags } = parseArgs(argv.slice(2));
	if (positional.length !== 1) {
		console.error(
			'Usage: seed-kml-projects.mjs <file.kml> [--res=9] [--dry-run] [--limit=N] [--app-name=Holons] [--concurrency=4] [--timeout-ms=30000] [--no-skip-existing]'
		);
		exit(2);
	}

	const kmlPath = resolve(positional[0]);
	const resolution = Number.isFinite(flags.res) ? flags.res : 9;
	if (resolution < 0 || resolution > 15) {
		console.error(`Invalid --res=${flags.res}; H3 resolution must be 0–15.`);
		exit(2);
	}

	const xml = await readFile(kmlPath, 'utf8');
	const placemarks = parseKml(xml);
	if (placemarks.length === 0) {
		console.error('No <Placemark> entries with valid <coordinates> found.');
		exit(1);
	}
	const slice = Number.isFinite(flags.limit) ? placemarks.slice(0, flags.limit) : placemarks;

	console.log(`Parsed ${placemarks.length} placemark(s); processing ${slice.length}.`);
	console.log(
		`Base resolution: ${resolution} (parent upcasting will fill res ${resolution - 1} → 0 automatically).`
	);
	console.log(
		`Concurrency: ${flags.concurrency}; per-put timeout: ${flags.timeoutMs}ms; skip-existing: ${flags.skipExisting}.`
	);

	if (flags.dryRun) {
		console.log('\n--dry-run: no network writes. First 5 entries:');
		for (const p of slice.slice(0, 5)) {
			const cell = h3.latLngToCell(p.lat, p.lng, resolution);
			const id = makeId(p.name, p.lat, p.lng);
			console.log(`  ${cell}  ${id}  ←  ${p.name} (${p.lat}, ${p.lng})`);
		}
		return;
	}

	const privateKey = env.HOLOSPHERE_PRIVATE_KEY || null;
	const appName = flags.appName || env.HOLONS_APP || 'HolonsDebug';

	console.log(
		`Connecting to HoloSphere appName="${appName}"` +
			(privateKey ? ' with provided privateKey …' : ' anonymously (no privateKey) …')
	);
	// The relays are the wire (HOLOSPHERE_RELAYS, default: production);
	// the store is in memory for this one-shot process.
	const holosphere = new HoloSphere({
		appName,
		...(privateKey ? { privateKey } : {}),
		relays: resolveRelays(env.HOLOSPHERE_RELAYS),
		store: { adapter: 'memory' },
		logLevel: 'WARN'
	});
	await holosphere.ready();

	const total = slice.length;
	let ok = 0;
	let skipped = 0;
	let timedOut = 0;
	let failed = 0;
	let processed = 0;

	const t0 = Date.now();
	await runPool(slice, flags.concurrency, async (p) => {
		const cell = h3.latLngToCell(p.lat, p.lng, resolution);
		const id = makeId(p.name, p.lat, p.lng);

		// Idempotency: short-circuit when the base cell already has this id.
		// (Parent cells may or may not be fully populated, but holosphere's
		// auto-propagation is re-triggered on every put if we DID need to
		// repair gaps — so checking the base is enough for "don't redo".)
		if (flags.skipExisting) {
			try {
				const existing = await withTimeout(
					holosphere.get(cell, LENS, id),
					Math.min(10_000, flags.timeoutMs),
					'get'
				);
				if (existing && existing.id === id) {
					skipped++;
					processed++;
					if (processed % 25 === 0) logProgress();
					return;
				}
			} catch {
				// Get failed (timeout / not found / auth) — fall through to put.
			}
		}

		const item = {
			id,
			name: p.name,
			description: p.description,
			lat: p.lat,
			lng: p.lng,
			source: 'kml:Regenerative Project Documentaries'
		};

		try {
			await withTimeout(holosphere.put(cell, LENS, item), flags.timeoutMs, 'put');
			ok++;
		} catch (err) {
			const msg = err?.message ?? String(err);
			if (msg.startsWith('timeout')) timedOut++;
			else failed++;
			console.error(`  ! ${p.name}: ${msg}`);
		}
		processed++;
		if (processed % 25 === 0) logProgress();
	});

	function logProgress() {
		const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
		console.log(
			`  ${processed}/${total} processed — ok=${ok} skipped=${skipped} timeout=${timedOut} fail=${failed} (${elapsed}s)`
		);
	}

	logProgress();
	console.log(
		`\nDone. ok=${ok}, skipped=${skipped}, timeout=${timedOut}, fail=${failed} (of ${total}).`
	);
	console.log('Allowing 5s for the relay publishes to drain before exit …');
	await new Promise((r) => setTimeout(r, 5000));
	await holosphere.close();
}

main().then(
	() => exit(0),
	(err) => {
		console.error(err);
		exit(1);
	}
);
