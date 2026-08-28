// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ledger behind the Sankey: one row per thing that actually happened.
 *
 * `buildValueFlows` answers "what is the shape of this holon's value?" by
 * summing entries into nodes. This module produces the entries themselves —
 * dated, named, described — so a person can read down the list and check the
 * diagram against reality.
 *
 * It is deliberately the SINGLE walker over the sources: `build.ts` aggregates
 * these entries rather than re-reading the expenses lens, the REA stream and
 * OpenCollective a second time. A diagram bar and the rows under it therefore
 * cannot drift apart — they are the same numbers, grouped differently.
 *
 * The same rules as `build.ts` apply and are enforced here, since this is where
 * they now live: shared expenses come from the expenses lens only (REA mirrors
 * them and would double-count), and units never mix — a row carries its own
 * unit and nothing is ever summed across tracks.
 *
 * Everything is pure: callers hand in plain arrays.
 */

import type { REAEvent } from '../rea/index.js';
import { normalizeCurrency, coerceSplitWith, type Expense } from '../expenses/index.js';
import { readTreasuryRate, splitHours, TREASURY_ID } from '../governance/index.js';
import type { BuildFlowsInput } from './build.js';
import type { OpenCollectiveSnapshot } from './opencollective.js';
import type { TrackId } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_LEDGER_WINDOW_DAYS = 90;

/** Money into the holon, or money out of it. */
export type LedgerDirection = 'in' | 'out';

/**
 * Which store the row came from. `derived` marks a row that no record states
 * outright — the treasury's cut of logged hours is a rule, not an entry — so a
 * reader is never told an inference is a receipt.
 */
export type LedgerSource = 'expenses' | 'rea' | 'opencollective' | 'derived';

/** One line of the ledger. */
export interface LedgerEntry {
	/** Unique within a build; stable for the same input. */
	id: string;
	/** Ms epoch of when it happened. */
	timestamp: number;
	track: TrackId;
	/** Currency code, 'hours', or 'kudos' — never mixed with another row's. */
	unit: string;
	direction: LedgerDirection;
	/** Always > 0; the direction carries the sign. */
	amount: number;
	/** The Sankey node this row rolls up into — the join between list and diagram. */
	nodeId: string;
	/** That node's label, as the diagram shows it. */
	nodeLabel: string;
	/** Who this row is with, resolved to a display name. */
	party: string;
	/** The agent id behind `party`, when there is one. */
	partyId?: string;
	/** Every name on the record — a shared expense names its payer and sharers. */
	participants: string[];
	/** What the payer, sender or platform wrote. */
	description: string;
	/** 'expense' | 'treasury' | 'library' | 'transfer' | 'opencollective' | … */
	kind: string;
	source: LedgerSource;
	/** Id of the underlying record (expense id, event id, transaction id). */
	reference: string;
	/** True when the row is computed from a rule rather than recorded as such. */
	derived?: boolean;
}

/** Entries plus the window they were read over. */
export interface LedgerResult {
	/** Ms epoch; 0 for an all-time window. */
	from: number;
	to: number;
	entries: LedgerEntry[];
}

/** The unit-coherent track a row belongs to, keyed as `id:unit`. */
export function ledgerTrackKey(entry: Pick<LedgerEntry, 'track' | 'unit'>): string {
	return `${entry.track}:${entry.unit}`;
}

interface Collector {
	push(entry: Omit<LedgerEntry, 'id'> & { id?: string }): void;
}

/**
 * Walk every source once and emit the rows behind a holon's value movement.
 *
 * Emission order is the order `build.ts` relies on to lay its tracks out:
 * expenses, then REA money, then OpenCollective, then time, then appreciation.
 */
export function buildLedger(input: BuildFlowsInput): LedgerResult {
	const now = input.now ?? Date.now();
	const windowDays =
		input.windowDays === undefined ? DEFAULT_LEDGER_WINDOW_DAYS : input.windowDays;
	const from = windowDays == null ? 0 : now - windowDays * DAY_MS;
	const nameOf = input.nameOf ?? (() => undefined);
	const label = (id: string, fallback?: string) => nameOf(id) || fallback || id;

	const inWindow = (ts: unknown) => {
		const t = Number(ts);
		if (!Number.isFinite(t)) return false;
		return t >= from && t <= now;
	};

	const entries: LedgerEntry[] = [];
	const collector: Collector = {
		push(entry) {
			if (!(entry.amount > 0)) return;
			entries.push({
				...entry,
				id: entry.id ?? `${entry.source}:${entry.reference}:${entry.direction}:${entry.nodeId}`,
			} as LedgerEntry);
		},
	};

	collectExpenses(collector, input.expenses ?? [], inWindow, label);
	const events = (input.events ?? []).filter((e) => e && inWindow(e.timestamp));
	collectReaMoney(collector, events, label);
	collectCollective(collector, input.collective ?? null, inWindow);
	collectTime(collector, events, input.settings, label, now);
	collectAppreciation(collector, events, label);

	return { from, to: now, entries };
}

/**
 * The expenses lens is canonical for shared money: `paidBy` funds the holon and
 * each sharer owes their split back out.
 */
function collectExpenses(
	out: Collector,
	expenses: Expense[],
	inWindow: (ts: unknown) => boolean,
	label: (id: string, fallback?: string) => string,
): void {
	for (const expense of expenses) {
		if (!expense) continue;
		const created = Date.parse(String(expense.created ?? ''));
		if (!inWindow(Number.isFinite(created) ? created : NaN)) continue;

		const amount = Number(expense.amount);
		if (!Number.isFinite(amount) || amount <= 0) continue;

		const unit = normalizeCurrency(expense.currency);
		const reference = String(expense.id ?? '');
		const description = String(expense.description ?? '');
		const payer = String(expense.paidBy ?? '');
		const splitWith = coerceSplitWith(expense.splitWith);
		const isTreasury = payer === TREASURY_ID;
		const payerName = isTreasury ? 'Treasury' : payer ? label(payer) : '';

		// Every name on the record, so a row can be read without opening it.
		const participants = [
			...(payerName ? [payerName] : []),
			...splitWith
				.map((id) => String(id))
				.filter((id) => id && id !== payer)
				.map((id) => label(id)),
		];

		if (payer) {
			out.push({
				timestamp: created,
				track: 'money',
				unit,
				direction: 'in',
				amount,
				nodeId: `paid-${payer}`,
				nodeLabel: payerName,
				party: payerName,
				partyId: isTreasury ? undefined : payer,
				participants,
				description,
				kind: isTreasury ? 'treasury' : 'expense',
				source: 'expenses',
				reference,
			});
		}

		const share = amount / (splitWith.length > 0 ? splitWith.length : 1);
		for (const memberId of splitWith) {
			const id = String(memberId);
			if (!id || id === payer) continue;
			out.push({
				timestamp: created,
				track: 'money',
				unit,
				direction: 'out',
				amount: share,
				nodeId: `owes-${id}`,
				nodeLabel: label(id),
				party: label(id),
				partyId: id,
				participants,
				description,
				kind: 'expense',
				source: 'expenses',
				reference,
			});
		}
	}
}

/** REA carries what the expenses lens does not: library fees, deposits, transfers. */
function collectReaMoney(
	out: Collector,
	events: REAEvent[],
	label: (id: string, fallback?: string) => string,
): void {
	for (const event of events) {
		const type = String(event.eventType ?? '');
		const amount = Number(event.resource?.quantity);
		if (!Number.isFinite(amount) || amount <= 0) continue;
		if (event.resource?.type !== 'credit' && event.resource?.type !== 'money') continue;

		const unit = normalizeCurrency(
			String(event.resource?.unit ?? (event.resource?.type === 'credit' ? 'credits' : '')),
		);
		const note = String(event.context?.note ?? '');
		const reference = String(event.id ?? '');
		const provider = String(event.provider?.id ?? '');
		const base = {
			timestamp: Number(event.timestamp),
			track: 'money' as const,
			unit,
			amount,
			description: note,
			source: 'rea' as const,
			reference,
		};

		switch (type) {
			case 'item:fee_paid':
				out.push({
					...base,
					direction: 'in',
					nodeId: 'library-fees',
					nodeLabel: 'Library fees',
					party: provider ? label(provider) : 'Library fees',
					partyId: provider || undefined,
					participants: provider ? [label(provider)] : [],
					kind: 'library',
				});
				break;
			case 'item:deposit_held':
				// Held, not earned: owed back to the borrower, so it sits on the
				// outward side rather than counting as income.
				out.push({
					...base,
					direction: 'out',
					nodeId: 'deposits-held',
					nodeLabel: 'Deposits held',
					party: provider ? label(provider) : 'Deposits held',
					partyId: provider || undefined,
					participants: provider ? [label(provider)] : [],
					kind: 'library',
				});
				break;
			case 'item:deposit_returned':
				out.push({
					...base,
					direction: 'out',
					nodeId: 'deposits-returned',
					nodeLabel: 'Deposits returned',
					party: provider ? label(provider) : 'Deposits returned',
					partyId: provider || undefined,
					participants: provider ? [label(provider)] : [],
					kind: 'library',
				});
				break;
			case 'transfer:direct': {
				const to = String(event.receiver?.id ?? '');
				if (!to) break;
				out.push({
					...base,
					direction: 'out',
					nodeId: `transfer-${to}`,
					nodeLabel: label(to, note),
					party: label(to, note),
					partyId: to,
					participants: [
						...(provider ? [label(provider)] : []),
						label(to, note),
					],
					kind: 'transfer',
				});
				break;
			}
			default:
				break;
		}
	}
}

/**
 * A readable name for an OpenCollective transaction kind.
 *
 * The API returns SCREAMING_SNAKE kinds (`HOST_FEE`, `PAYMENT_PROCESSOR_FEE`),
 * which read badly on a wall display. The common case collapses to the plain
 * word the caller passes; anything else is unsnaked.
 */
export function collectiveLabel(kind: string | undefined, fallback: string): string {
	if (!kind || kind === 'CONTRIBUTION' || kind === 'EXPENSE') {
		return `OpenCollective ${fallback}`;
	}
	return `OpenCollective ${kind.toLowerCase().replace(/_/g, ' ')}`;
}

function collectCollective(
	out: Collector,
	collective: OpenCollectiveSnapshot | null,
	inWindow: (ts: unknown) => boolean,
): void {
	if (!collective) return;
	const unit = normalizeCurrency(collective.currency);

	for (const tx of collective.transactions ?? []) {
		if (!inWindow(tx.createdAt)) continue;
		if (!(tx.amount > 0)) continue;

		const credit = tx.type === 'CREDIT';
		const counterparty = String((credit ? tx.fromAccount : tx.toAccount) ?? '');
		const nodeLabel = collectiveLabel(tx.kind, credit ? 'contributions' : 'expenses');

		out.push({
			timestamp: Number(tx.createdAt),
			track: 'money',
			unit,
			direction: credit ? 'in' : 'out',
			amount: tx.amount,
			nodeId: credit
				? `oc-in-${tx.kind ?? 'contribution'}`
				: `oc-out-${tx.kind ?? 'expense'}`,
			nodeLabel,
			party: counterparty || nodeLabel,
			participants: counterparty ? [counterparty] : [],
			description: String(tx.description ?? ''),
			kind: 'opencollective',
			source: 'opencollective',
			reference: String(tx.id ?? ''),
		});
	}
}

/**
 * Logged hours in, and the settlement split out.
 *
 * The two outward rows are `derived`: they are the split every settlement
 * applies, computed off the window's total so the picture matches what the
 * treasury will actually hold — not something anybody recorded.
 */
function collectTime(
	out: Collector,
	events: REAEvent[],
	settings: unknown,
	label: (id: string, fallback?: string) => string,
	now: number,
): void {
	let loggedHours = 0;

	for (const event of events) {
		if (String(event.eventType) !== 'quest:time_logged') continue;
		const hours = Number(event.resource?.quantity);
		if (!Number.isFinite(hours) || hours <= 0) continue;
		const provider = String(event.provider?.id ?? '');
		loggedHours += hours;
		if (!provider) continue;
		out.push({
			timestamp: Number(event.timestamp),
			track: 'time',
			unit: 'hours',
			direction: 'in',
			amount: hours,
			nodeId: `hours-${provider}`,
			nodeLabel: label(provider),
			party: label(provider),
			partyId: provider,
			participants: [label(provider)],
			description: String(event.context?.note ?? ''),
			kind: 'time',
			source: 'rea',
			reference: String(event.id ?? ''),
		});
	}

	if (loggedHours <= 0) return;
	const { toProvider, toTreasury } = splitHours(loggedHours, readTreasuryRate(settings));

	out.push({
		id: 'derived:hours-to-work',
		timestamp: now,
		track: 'time',
		unit: 'hours',
		direction: 'out',
		amount: toProvider,
		nodeId: 'hours-to-work',
		nodeLabel: 'To contributors',
		party: 'To contributors',
		participants: [],
		description: 'Contributors’ share of the hours logged in this window.',
		kind: 'time',
		source: 'derived',
		reference: 'hours-to-work',
		derived: true,
	});

	out.push({
		id: 'derived:hours-to-treasury',
		timestamp: now,
		track: 'time',
		unit: 'hours',
		direction: 'out',
		amount: toTreasury,
		nodeId: 'hours-to-treasury',
		nodeLabel: 'To treasury',
		party: 'To treasury',
		participants: [],
		description: 'Treasury’s share of the hours logged in this window.',
		kind: 'treasury',
		source: 'derived',
		reference: 'hours-to-treasury',
		derived: true,
	});
}

function collectAppreciation(
	out: Collector,
	events: REAEvent[],
	label: (id: string, fallback?: string) => string,
): void {
	for (const event of events) {
		const type = String(event.eventType ?? '');
		const amount = Number(event.resource?.quantity);
		if (!Number.isFinite(amount) || amount <= 0) continue;

		const base = {
			timestamp: Number(event.timestamp),
			track: 'appreciation' as const,
			unit: 'kudos',
			amount,
			description: String(event.context?.note ?? ''),
			source: 'rea' as const,
			reference: String(event.id ?? ''),
		};
		const provider = String(event.provider?.id ?? '');
		const receiver = String(event.receiver?.id ?? '');

		switch (type) {
			case 'appreciation:sent':
				if (!provider) break;
				out.push({
					...base,
					direction: 'in',
					nodeId: `kudos-from-${provider}`,
					nodeLabel: label(provider),
					party: label(provider),
					partyId: provider,
					participants: [
						label(provider),
						...(receiver ? [label(receiver)] : []),
					],
					kind: 'appreciation',
				});
				break;
			case 'appreciation:received':
				if (!receiver) break;
				out.push({
					...base,
					direction: 'out',
					nodeId: `kudos-to-${receiver}`,
					nodeLabel: label(receiver),
					party: label(receiver),
					partyId: receiver,
					participants: [
						...(provider ? [label(provider)] : []),
						label(receiver),
					],
					kind: 'appreciation',
				});
				break;
			case 'quest:initiated':
				if (!provider) break;
				out.push({
					...base,
					direction: 'in',
					nodeId: `initiative-${provider}`,
					nodeLabel: label(provider),
					party: label(provider),
					partyId: provider,
					participants: [label(provider)],
					kind: 'initiative',
				});
				break;
			case 'quest:completed':
				if (!provider) break;
				out.push({
					...base,
					direction: 'in',
					nodeId: `completion-${provider}`,
					nodeLabel: label(provider),
					party: label(provider),
					partyId: provider,
					participants: [label(provider)],
					kind: 'completion',
				});
				break;
			default:
				break;
		}
	}
}

// ---------------------------------------------------------------------------
// Consulting the ledger: search, filter, sort, total.
// ---------------------------------------------------------------------------

export interface LedgerFilter {
	/** Free text; every whitespace-separated word must match somewhere. */
	query?: string;
	/** Track key as `ledgerTrackKey` returns it. Empty means every track. */
	track?: string;
	direction?: LedgerDirection | 'all';
	/** Restrict to the rows behind one Sankey node. */
	nodeId?: string;
	source?: LedgerSource | 'all';
}

/**
 * Lowercase and strip accents, so searching "jose" finds "José".
 *
 * Holons are multilingual by default; matching bytes would make the search box
 * useless for half the names in them.
 */
export function foldForSearch(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();
}

/** Everything about a row that free text should be able to reach. */
export function ledgerSearchText(entry: LedgerEntry): string {
	return foldForSearch(
		[
			entry.party,
			...entry.participants,
			entry.nodeLabel,
			entry.description,
			entry.kind,
			entry.source,
			entry.unit,
			entry.reference,
			entry.direction === 'in' ? 'in income received' : 'out spent paid',
		]
			.filter(Boolean)
			.join(' '),
	);
}

/**
 * Apply a filter. Words are ANDed: "ana venue" finds Ana's venue expense and
 * not everything of Ana's plus everything about venues.
 */
export function filterLedger(entries: LedgerEntry[], filter: LedgerFilter = {}): LedgerEntry[] {
	const words = foldForSearch(String(filter.query ?? '')).split(/\s+/).filter(Boolean);
	const track = filter.track ?? '';
	const direction = filter.direction ?? 'all';
	const nodeId = filter.nodeId ?? '';
	const source = filter.source ?? 'all';

	return entries.filter((entry) => {
		if (track && ledgerTrackKey(entry) !== track) return false;
		if (direction !== 'all' && entry.direction !== direction) return false;
		if (nodeId && entry.nodeId !== nodeId) return false;
		if (source !== 'all' && entry.source !== source) return false;
		if (!words.length) return true;
		const haystack = ledgerSearchText(entry);
		return words.every((word) => haystack.includes(word));
	});
}

/** Newest first, with a stable tiebreak so equal timestamps never shuffle. */
export function sortLedger(entries: LedgerEntry[], newestFirst = true): LedgerEntry[] {
	const dir = newestFirst ? -1 : 1;
	return [...entries].sort((a, b) => {
		if (a.timestamp !== b.timestamp) return (a.timestamp - b.timestamp) * dir;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** Per-track totals over a set of rows. */
export interface LedgerTotals {
	/** `ledgerTrackKey` of every row counted here. */
	key: string;
	track: TrackId;
	unit: string;
	count: number;
	totalIn: number;
	totalOut: number;
	/** In minus out, in this track's unit. */
	net: number;
}

/**
 * Total a filtered set, grouped by track.
 *
 * Grouped rather than reduced to one number on purpose: hours are not euros and
 * this repo holds no exchange rates, so a single "total" would be a fiction.
 */
export function summarizeLedger(entries: LedgerEntry[]): LedgerTotals[] {
	const totals = new Map<string, LedgerTotals>();

	for (const entry of entries) {
		const key = ledgerTrackKey(entry);
		let row = totals.get(key);
		if (!row) {
			row = { key, track: entry.track, unit: entry.unit, count: 0, totalIn: 0, totalOut: 0, net: 0 };
			totals.set(key, row);
		}
		row.count += 1;
		if (entry.direction === 'in') row.totalIn += entry.amount;
		else row.totalOut += entry.amount;
		row.net = row.totalIn - row.totalOut;
	}

	return [...totals.values()];
}
