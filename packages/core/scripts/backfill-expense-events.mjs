#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Backfill `expense:paid` / `expense:share` REA events from the `expenses`
 * lens.
 *
 * Why
 * ---
 * Scoring now sources currency balances exclusively from the REA event stream
 * (`REAAggregator.getCurrencyBalance`). Historically only the Telegram bot
 * emitted expense events; the web app wrote to the `expenses` lens only. This
 * script makes the REA stream complete: for every expense it (re)writes the
 * canonical events so balances derived from REA match the ledger.
 *
 * Idempotency
 * -----------
 * `REAEventFactory.expenseEvents` now uses stable ids keyed on `expense.id`
 * (`<holon>_expense_<id>_paid` / `_share_<index>`). For each expense we first
 * delete any existing `rea_events` carrying that `context.expenseId` (clearing
 * older random-id events written before the stable scheme), then write the
 * canonical set — so re-running converges and never double-counts.
 *
 * Usage
 * -----
 *   node scripts/backfill-expense-events.mjs [--holon-id=demo123] [--app-name=HolonsDebug] [--dry-run]
 */

import { argv, exit, env } from 'node:process';
import { HoloSphere } from 'holosphere';
import { resolveRelays } from '../dist/holosphere/relays.js';
import { REAEventStore } from '../dist/rea/index.js';
import { REAEventFactory } from '../dist/rea/index.js';

function parseArgs(args) {
	const flags = { holonId: 'demo123', dryRun: false };
	for (const a of args) {
		if (a.startsWith('--holon-id=')) flags.holonId = a.slice(11);
		else if (a.startsWith('--app-name=')) flags.appName = a.slice(11);
		else if (a === '--dry-run') flags.dryRun = true;
		else if (a === '--help' || a === '-h') {
			console.log('Usage: backfill-expense-events.mjs [--holon-id=demo123] [--app-name=HolonsDebug] [--dry-run]');
			exit(0);
		}
	}
	return flags;
}

async function main() {
	const flags = parseArgs(argv.slice(2));
	const holonId = flags.holonId;
	const appName = flags.appName || env.HOLONS_APP || 'HolonsDebug';
	const privateKey = env.HOLOSPHERE_NSEC || null;

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

	const store = new REAEventStore(holosphere);

	const expenses = (await holosphere.getAll(holonId, 'expenses')) ?? [];
	const allEvents = (await holosphere.getAll(holonId, 'rea_events')) ?? [];
	console.log(`Holon "${holonId}": ${expenses.length} expenses, ${allEvents.length} existing rea_events.`);

	// Index existing events by their expenseId so we can clear stale ones.
	const byExpenseId = new Map();
	for (const e of allEvents) {
		const xid = e?.context?.expenseId;
		if (xid == null) continue;
		const key = String(xid);
		if (!byExpenseId.has(key)) byExpenseId.set(key, []);
		byExpenseId.get(key).push(e);
	}

	let written = 0;
	let deleted = 0;
	for (const expense of expenses) {
		if (!expense?.id) continue;
		const canonical = REAEventFactory.expenseEvents(holonId, expense);
		const canonicalIds = new Set(canonical.map((e) => e.id));

		// Delete pre-existing events for this expense that aren't part of the
		// canonical set (e.g. older random-id writes), to avoid double-counting.
		const existing = byExpenseId.get(String(expense.id)) ?? [];
		for (const ev of existing) {
			if (!canonicalIds.has(ev.id)) {
				if (flags.dryRun) console.log(`  would delete stale ${ev.id}`);
				else await holosphere.delete(holonId, 'rea_events', ev.id);
				deleted++;
			}
		}

		// Write the canonical events (upsert — stable ids).
		for (const ev of canonical) {
			if (flags.dryRun) console.log(`  would write ${ev.id} (${ev.eventType} ${ev.resource?.quantity} ${ev.resource?.unit})`);
			else await store.put(holonId, ev);
			written++;
		}
	}

	console.log(`${flags.dryRun ? '[dry-run] ' : ''}Done. wrote ${written} events, deleted ${deleted} stale events.`);
	if (!flags.dryRun) await new Promise((r) => setTimeout(r, 3000)); // let the relay publishes drain
	await holosphere.close();
}

main().then(
	() => exit(0),
	(err) => {
		console.error(err);
		exit(1);
	}
);
