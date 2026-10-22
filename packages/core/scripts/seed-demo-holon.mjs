#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Seed the `demo123` holon with a full slice of community data.
 *
 * Why
 * ---
 * The demo holon is the public landing experience: when a visitor lands on
 * the error page or hits the "Try Demo Holon" button they get pushed to
 * `/demo123/dashboard`. If the holon is empty every page renders an empty
 * state, which makes the product feel hollow. This script populates every
 * lens the dashboard, calendar, tasks, library, expenses, shopping,
 * checklists, DNA, roles and announcements pages read from with a
 * cohesive snapshot of a lively regenerative community.
 *
 * Idempotency
 * -----------
 * Every record has a stable `id`. Re-running the script overwrites the
 * same records rather than producing duplicates (Holosphere treats same
 * (holonId, lens, id) as an update).
 *
 * Usage
 * -----
 *   node scripts/seed-demo-holon.mjs [--holon-id=demo123] [--app-name=HolonsDebug] [--timeout-ms=20000]
 *
 *   Env:
 *     HOLOSPHERE_NSEC  attribution key (optional; without it puts are
 *                             anonymous which is fine for the public demo)
 *     HOLONS_APP              fallback for --app-name (defaults to HolonsDebug)
 */

import { argv, exit, env } from 'node:process';
import { HoloSphere } from 'holosphere';
import { resolveRelays } from '../dist/holosphere/relays.js';
import { getAllDefaultChromosomes } from '../dist/dna/index.js';

const DEFAULT_HOLON = 'demo123';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CONCURRENCY = 3;

function parseArgs(args) {
	const flags = {
		holonId: DEFAULT_HOLON,
		timeoutMs: DEFAULT_TIMEOUT_MS,
		concurrency: DEFAULT_CONCURRENCY
	};
	for (const a of args) {
		if (a.startsWith('--holon-id=')) flags.holonId = a.slice(11);
		else if (a.startsWith('--app-name=')) flags.appName = a.slice(11);
		else if (a.startsWith('--timeout-ms=')) flags.timeoutMs = Number(a.slice(13));
		else if (a.startsWith('--concurrency=')) flags.concurrency = Number(a.slice(14));
		else if (a === '--help' || a === '-h') {
			console.log(
				'Usage: seed-demo-holon.mjs [--holon-id=demo123] [--app-name=HolonsDebug]'
			);
			exit(0);
		} else if (a.startsWith('--')) {
			console.error(`Unknown flag: ${a}`);
			exit(2);
		}
	}
	return flags;
}

// Wrap a put in a timeout — parent-propagation writes can occasionally stall waiting for a relay
// ack on the parent-cell propagation. Local data is already written; the
// timeout lets the batch move on rather than wedge mid-seed.
function withTimeout(promise, ms, label) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timeout ${ms}ms (${label})`)),
			ms
		);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

// ---------------------------------------------------------------------------
// Community fixture — twelve members of a fictional regenerative community
// in northern Italy. Numeric ids match the bot's user shape (Telegram-style)
// so the data lights up both web and bot UIs without extra translation.
// ---------------------------------------------------------------------------

const USERS = [
	{
		id: 100001,
		username: 'mira',
		first_name: 'Mira',
		last_name: 'Rossi',
		values: ['Soil Health', 'Open Knowledge', 'Slow Food'],
		needs: ['Mentorship in agroforestry', 'Hands for the cherry harvest']
	},
	{
		id: 100002,
		username: 'jonas',
		first_name: 'Jonas',
		last_name: 'Bauer',
		values: ['Mutual Aid', 'Bioregional Trade', 'Repair over Replace'],
		needs: ['Battery storage for the workshop', 'Italian conversation practice']
	},
	{
		id: 100003,
		username: 'ananya',
		first_name: 'Ananya',
		last_name: 'Patel',
		values: ['Sacred Reciprocity', 'Storytelling', 'Childcare Cooperatives'],
		needs: ['Quiet space to write Thursdays', 'A second-hand cargo bike']
	},
	{
		id: 100004,
		username: 'theo',
		first_name: 'Theo',
		last_name: 'Okafor',
		values: ['Permaculture Design', 'Water Sovereignty', 'Lifelong Learning'],
		needs: ['Help digging the new swale', 'Borrow a laser level']
	},
	{
		id: 100005,
		username: 'lina',
		first_name: 'Lina',
		last_name: 'Hassan',
		values: ['Trauma-Informed Care', 'Embodied Practice', 'Quiet Saturdays'],
		needs: ['Co-facilitator for the trauma circle', 'Lift to the train station Sundays']
	},
	{
		id: 100006,
		username: 'pawel',
		first_name: 'Paweł',
		last_name: 'Kowalczyk',
		values: ['Open Source Tooling', 'Energy Autonomy', 'Documentation'],
		needs: ['Reviewer for the solar wiring diagram', 'Spare 12V regulator']
	},
	{
		id: 100007,
		username: 'sora',
		first_name: 'Sora',
		last_name: 'Tanaka',
		values: ['Fermentation', 'Quiet Coordination', 'Care for Elders'],
		needs: ['Glass jars (any size)', 'Translator for the JP exchange visit']
	},
	{
		id: 100008,
		username: 'noah',
		first_name: 'Noah',
		last_name: 'Mendes',
		values: ['Music as Glue', 'Conflict Transformation', 'Rooting Ceremonies'],
		needs: ['Practice room Wednesday evenings', 'Strings for the double bass']
	},
	{
		id: 100009,
		username: 'frida',
		first_name: 'Frida',
		last_name: 'Lindqvist',
		values: ['Seed Saving', 'Forest Schools', 'Bicycle Logistics'],
		needs: ['Volunteers for Saturday seed library', 'Trailer for compost runs']
	},
	{
		id: 100010,
		username: 'omar',
		first_name: 'Omar',
		last_name: 'El-Sayed',
		values: ['Mesh Networks', 'Citizen Science', 'Hospitality'],
		needs: ['Rooftop access for the LoRa node', 'Cook for the new-arrivals dinner']
	},
	{
		id: 100011,
		username: 'kate',
		first_name: 'Kate',
		last_name: 'Murphy',
		values: ['Land Care', 'Sociocratic Governance', 'Outdoor Cooking'],
		needs: ['Second pair of pruning shears', 'Note-taker for the next plenary']
	},
	{
		id: 100012,
		username: 'rafa',
		first_name: 'Rafa',
		last_name: 'Mendoza',
		values: ['Carpentry', 'Beekeeping', 'Multilingual Welcome'],
		needs: ['Apprentice for the bee yard', 'Spanish-speaking visitors to host']
	}
];

const ID = Object.fromEntries(USERS.map((u) => [u.username, u.id]));

function pickUser(usernameOrIndex) {
	const u =
		typeof usernameOrIndex === 'string'
			? USERS.find((x) => x.username === usernameOrIndex)
			: USERS[usernameOrIndex];
	if (!u) throw new Error(`No user: ${usernameOrIndex}`);
	return { id: u.id, username: u.username, first_name: u.first_name, last_name: u.last_name };
}

// ---------------------------------------------------------------------------
// Time helpers — anchor everything off a fixed "now" so re-runs produce
// stable timestamps relative to the script invocation, but offset is
// deterministic per-record.
// ---------------------------------------------------------------------------
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function isoOffsetDays(days, hourOfDay = 9, minute = 0) {
	const d = new Date(NOW + days * DAY);
	d.setHours(hourOfDay, minute, 0, 0);
	return d.toISOString();
}

function isoMs(offsetMs) {
	return new Date(NOW + offsetMs).toISOString();
}

// ---------------------------------------------------------------------------
// Tasks / Quests / Events — covers ongoing/completed/scheduled, recurring
// markers, multiple categories, varied participants & appreciation.
// ---------------------------------------------------------------------------

function buildQuests() {
	const q = [];

	function task(id, title, opts = {}) {
		const initiator = pickUser(opts.initiator ?? 'mira');
		return {
			id,
			version: '0.1',
			holon: undefined, // filled per-holon at write time
			message_thread_id: null,
			initiator,
			title,
			description: opts.description ?? '',
			picture: null,
			type: opts.type ?? 'task',
			status: opts.status ?? 'ongoing',
			created: opts.created ?? isoOffsetDays(opts.createdDaysAgo ?? -3, 10),
			participants: (opts.participants ?? []).map(pickUser),
			appreciation: (opts.appreciation ?? []).map(pickUser),
			stoppers: [],
			dependencies: opts.dependencies ?? [],
			frequency: opts.frequency ?? null,
			recurringTaskId: null,
			timeTracking: {},
			checklistId: opts.checklistId ?? null,
			reminderId: null,
			activeHolograms: [],
			category: opts.category ?? '',
			document: opts.document ?? '',
			where: opts.where ?? { latitude: '', longitude: '' },
			when: opts.when ?? '',
			until: opts.until ?? '',
			completed: opts.completed ?? '',
			...(opts.ends ? { ends: opts.ends } : {}),
			...(opts.location ? { location: opts.location } : {})
		};
	}

	// ---- Garden & Land
	q.push(
		task('task-orchard-prune', 'Winter-prune the cherry orchard', {
			initiator: 'mira',
			category: 'Garden',
			description: 'Cut for an open vase, paint the larger cuts. Bring loppers + small handsaw.',
			participants: ['mira', 'theo', 'kate'],
			appreciation: ['frida'],
			createdDaysAgo: -8,
			when: isoOffsetDays(2, 9),
			ends: isoOffsetDays(2, 13)
		})
	);
	q.push(
		task('task-swale-dig', 'Dig third contour swale below the well', {
			initiator: 'theo',
			category: 'Garden',
			description: 'Mark with A-frame first; aim for a 1% fall. Lina brings the pickaxe.',
			participants: ['theo', 'jonas', 'lina', 'pawel'],
			createdDaysAgo: -5,
			when: isoOffsetDays(5, 8, 30),
			ends: isoOffsetDays(5, 13)
		})
	);
	q.push(
		task('task-seed-sort', 'Sort 2026 seed library by germination test', {
			initiator: 'frida',
			category: 'Garden',
			description: 'Toss anything below 60% germination. Re-bag the keepers.',
			participants: ['frida', 'ananya'],
			appreciation: ['mira', 'kate', 'noah'],
			createdDaysAgo: -14,
			status: 'completed',
			completed: isoOffsetDays(-2, 17),
			checklistId: 'task-seed-sort'
		})
	);

	// ---- Workshop & Repair
	q.push(
		task('task-fix-cargo-bike', 'Repair Ananya\'s cargo bike rear hub', {
			initiator: 'jonas',
			category: 'Workshop',
			description: 'Hub freewheel skips under load. Replace pawls; truing optional.',
			participants: ['jonas', 'rafa'],
			createdDaysAgo: -2,
			status: 'ongoing'
		})
	);
	q.push(
		task('task-solar-wiring', 'Document workshop solar wiring diagram', {
			initiator: 'pawel',
			category: 'Energy',
			description: 'Photograph each junction, draft schematic in KiCad, post for peer review.',
			participants: ['pawel', 'omar'],
			appreciation: ['jonas'],
			createdDaysAgo: -10,
			status: 'ongoing'
		})
	);
	q.push(
		task('task-mesh-node', 'Install LoRa relay on the granary roof', {
			initiator: 'omar',
			category: 'Tech',
			description: 'Need rooftop access (Kate has the key) and a 12V regulator (Paweł).',
			participants: ['omar', 'kate', 'pawel'],
			createdDaysAgo: -4,
			dependencies: ['task-solar-wiring']
		})
	);

	// ---- Kitchen & Care
	q.push(
		task('task-saturday-meal', 'Cook Saturday communal lunch (40 people)', {
			initiator: 'sora',
			category: 'Kitchen',
			description: 'Theme: late-winter ferments. Vegan + GF labelled. Two helpers from 9am.',
			participants: ['sora', 'noah', 'rafa'],
			appreciation: ['mira', 'frida', 'kate', 'lina', 'jonas'],
			createdDaysAgo: -1,
			when: isoOffsetDays(1, 9),
			ends: isoOffsetDays(1, 15),
			location: 'Main kitchen'
		})
	);
	q.push(
		task('task-trauma-circle', 'Co-facilitate Tuesday trauma-informed circle', {
			initiator: 'lina',
			category: 'Care',
			description: 'Closed group of 8. NVC-aligned. No phones in the room.',
			participants: ['lina', 'ananya'],
			createdDaysAgo: -6,
			when: isoOffsetDays(3, 19),
			ends: isoOffsetDays(3, 21),
			type: 'recurring',
			frequency: 'weekly'
		})
	);
	q.push(
		task('task-elders-visit', 'Weekly visit to Casa Serena (elders home)', {
			initiator: 'sora',
			category: 'Care',
			participants: ['sora', 'mira'],
			createdDaysAgo: -21,
			status: 'recurring',
			type: 'recurring',
			frequency: 'weekly',
			when: isoOffsetDays(2, 16),
			ends: isoOffsetDays(2, 18)
		})
	);

	// ---- Governance
	q.push(
		task('task-plenary-prep', 'Draft agenda for April plenary', {
			initiator: 'kate',
			category: 'Governance',
			description: 'Topics: bee yard expansion, new-arrival policy, budget Q2.',
			participants: ['kate', 'mira', 'theo'],
			createdDaysAgo: -3,
			checklistId: 'task-plenary-prep'
		})
	);
	q.push(
		task('task-budget-review', 'Quarterly budget review (sociocratic round)', {
			initiator: 'kate',
			category: 'Governance',
			participants: ['kate', 'jonas', 'pawel', 'mira'],
			createdDaysAgo: -16,
			status: 'completed',
			completed: isoOffsetDays(-9, 21)
		})
	);

	// ---- Outreach & Culture
	q.push(
		task('task-open-day', 'Host the Spring Open Day', {
			initiator: 'rafa',
			category: 'Outreach',
			description: 'Tours every hour, beekeeping demo at 11 and 14, bread oven on all day.',
			participants: ['rafa', 'omar', 'mira', 'noah', 'sora'],
			appreciation: ['ananya', 'frida'],
			createdDaysAgo: -20,
			when: isoOffsetDays(12, 10),
			ends: isoOffsetDays(12, 18),
			type: 'event',
			location: 'Main courtyard'
		})
	);
	q.push(
		task('task-storynight', 'Storytelling night around the fire', {
			initiator: 'ananya',
			category: 'Culture',
			description: 'Bring something to share — a story, a song, a silence. Tea provided.',
			participants: ['ananya', 'noah', 'lina', 'sora'],
			appreciation: ['mira'],
			createdDaysAgo: -7,
			when: isoOffsetDays(4, 20),
			ends: isoOffsetDays(4, 23),
			type: 'event',
			location: 'Fire ring by the pond'
		})
	);
	q.push(
		task('task-bee-yard-expand', 'Plan bee-yard expansion (3 → 5 hives)', {
			initiator: 'rafa',
			category: 'Garden',
			description: 'Mark new positions, order two top-bar hives, schedule with apprentice.',
			participants: ['rafa', 'frida'],
			createdDaysAgo: -2,
			status: 'pending'
		})
	);

	// ---- Already-completed odds and ends
	q.push(
		task('task-compost-turn', 'Turn the November compost pile', {
			initiator: 'frida',
			category: 'Garden',
			participants: ['frida', 'jonas', 'theo'],
			appreciation: ['mira', 'kate'],
			createdDaysAgo: -28,
			status: 'completed',
			completed: isoOffsetDays(-25, 12)
		})
	);
	q.push(
		task('task-jar-haul', 'Collect glass jars from the village bar', {
			initiator: 'sora',
			category: 'Kitchen',
			participants: ['sora', 'ananya'],
			createdDaysAgo: -10,
			status: 'completed',
			completed: isoOffsetDays(-8, 18)
		})
	);
	q.push(
		task('task-mesh-survey', 'Walk-test the existing mesh coverage', {
			initiator: 'omar',
			category: 'Tech',
			participants: ['omar', 'pawel'],
			createdDaysAgo: -19,
			status: 'completed',
			completed: isoOffsetDays(-14, 16)
		})
	);

	return q;
}

// ---------------------------------------------------------------------------
// Calendar events (stored in the `quests` lens too — type: 'event' is what
// distinguishes them in the calendar component).
// ---------------------------------------------------------------------------
function buildEvents() {
	function event(id, title, daysFromNow, hour, durationHours, opts = {}) {
		const start = new Date(NOW + daysFromNow * DAY);
		start.setHours(hour, opts.minute ?? 0, 0, 0);
		const end = new Date(start.getTime() + durationHours * HOUR);
		return {
			id,
			version: '0.1',
			initiator: pickUser(opts.initiator ?? 'kate'),
			title,
			description: opts.description ?? '',
			picture: null,
			type: 'event',
			status: 'scheduled',
			created: isoMs(-2 * DAY),
			participants: (opts.participants ?? []).map(pickUser),
			appreciation: [],
			stoppers: [],
			dependencies: [],
			frequency: opts.frequency ?? null,
			activeHolograms: [],
			category: opts.category ?? 'Event',
			document: '',
			where: { latitude: '', longitude: '' },
			when: start.toISOString(),
			ends: end.toISOString(),
			until: '',
			completed: '',
			location: opts.location ?? ''
		};
	}

	return [
		event('evt-monday-stand', 'Monday morning stand-up', -2, 9, 0.5, {
			initiator: 'kate',
			category: 'Governance',
			participants: ['kate', 'mira', 'theo', 'jonas', 'sora', 'pawel'],
			location: 'Common room',
			frequency: 'weekly'
		}),
		event('evt-plenary-april', 'April plenary (sociocratic)', 14, 18, 3, {
			initiator: 'kate',
			category: 'Governance',
			description: 'Agenda items collected in shared checklist. Snack rotation: Sora.',
			participants: ['kate', 'mira', 'theo', 'jonas', 'lina', 'pawel', 'omar', 'frida', 'rafa'],
			location: 'Common room'
		}),
		event('evt-seed-swap', 'Spring seed swap with neighbouring holons', 21, 14, 4, {
			initiator: 'frida',
			category: 'Garden',
			description: 'Bring labelled envelopes. Trade with intention.',
			participants: ['frida', 'mira', 'ananya', 'kate', 'theo'],
			location: 'Greenhouse + courtyard'
		}),
		event('evt-trauma-circle-recurring', 'Trauma-informed circle (weekly)', 3, 19, 2, {
			initiator: 'lina',
			category: 'Care',
			participants: ['lina', 'ananya'],
			frequency: 'weekly',
			location: 'Quiet room'
		}),
		event('evt-friday-music', 'Friday evening music jam', 5, 20, 3, {
			initiator: 'noah',
			category: 'Culture',
			participants: ['noah', 'rafa', 'omar', 'sora', 'mira'],
			location: 'Barn'
		}),
		event('evt-open-day', 'Spring Open Day', 12, 10, 8, {
			initiator: 'rafa',
			category: 'Outreach',
			description: 'Visitors welcome 10–18. Tours hourly.',
			participants: ['rafa', 'omar', 'mira', 'noah', 'sora', 'frida', 'kate'],
			location: 'Whole site'
		}),
		event('evt-natural-build', 'Natural-build workshop (cob bench)', 9, 9, 6, {
			initiator: 'theo',
			category: 'Workshop',
			description: 'Hands-on cob. Bring boots + a hat. Lunch provided.',
			participants: ['theo', 'jonas', 'rafa', 'kate', 'pawel'],
			location: 'East meadow'
		}),
		event('evt-jp-exchange', 'Japan exchange-visit welcome dinner', 28, 19, 3, {
			initiator: 'sora',
			category: 'Hospitality',
			description: '4 guests from a sister farm in Saitama. Translation help wanted.',
			participants: ['sora', 'mira', 'ananya', 'omar'],
			location: 'Long table, kitchen courtyard'
		}),
		event('evt-past-retro', 'March retrospective (held)', -7, 19, 2, {
			initiator: 'kate',
			category: 'Governance',
			description: 'What worked, what didn\'t, one experiment for April.',
			participants: ['kate', 'mira', 'theo', 'jonas', 'lina', 'frida'],
			location: 'Common room'
		})
	];
}

// ---------------------------------------------------------------------------
// Marketplace items — offers and requests. They share the `quests` lens with
// tasks and events, distinguished by `type` ('offer' | 'request'), so the web
// Offers & Requests page and the bot's /offer + /request commands all read one
// store (see @holons/core/tasks createMarketItem / classifyMarketItem). Kept
// out of the REA derivation: a marketplace listing isn't a quest a member
// "initiated", so it must not inflate scoring.
// ---------------------------------------------------------------------------

// One offer per member, hand-picked from their values so the board has variety.
const OFFERS = {
	mira: 'Pruning know-how for fruit trees',
	jonas: 'Workshop repairs Tuesdays + Fridays',
	ananya: 'Story circles for kids on request',
	theo: 'Permaculture design consultations',
	lina: 'NVC coaching sessions, sliding scale',
	pawel: 'Help wiring 12V solar setups',
	sora: 'Ferment-of-the-week starter cultures',
	noah: 'Double-bass lessons for beginners',
	frida: 'Seeds from the 2025 library, swap welcome',
	omar: 'Mesh node setup + first-month hosting',
	kate: 'Facilitation for small-group meetings',
	rafa: 'Carpentry and bee-yard apprenticeship'
};

function buildMarketItems() {
	const items = [];

	// Mirrors createTask()'s default field set + the marketplace fields, so a
	// seeded item is shaped exactly like one the bot/web produce via
	// createMarketItem. Stable ids keep re-seeds idempotent.
	function marketItem(id, kind, title, initiatorUsername, createdDaysAgo) {
		return {
			id,
			version: '0.1',
			holon: undefined, // filled per-holon at write time
			message_thread_id: null,
			initiator: pickUser(initiatorUsername),
			title,
			description: '',
			picture: null,
			type: kind,
			exchange_type: kind === 'offer' ? 'offer' : 'want',
			status: 'ongoing',
			created: isoOffsetDays(createdDaysAgo, 10),
			participants: [],
			appreciation: [],
			stoppers: [],
			dependencies: [],
			frequency: null,
			recurringTaskId: null,
			timeTracking: {},
			checklistId: null,
			reminderId: null,
			activeHolograms: [],
			category: '',
			document: '',
			where: { latitude: '', longitude: '' },
			when: '',
			until: '',
			completed: ''
		};
	}

	// Offers — one per member.
	Object.entries(OFFERS).forEach(([username, offer]) => {
		items.push(marketItem(`offer-${username}`, 'offer', offer, username, -20));
	});

	// Requests — derived 1:1 from each member's profile `needs`.
	for (const u of USERS) {
		(u.needs ?? []).forEach((need, i) => {
			items.push(marketItem(`request-${u.username}-${i}`, 'request', need, u.username, -(30 + i)));
		});
	}

	return items;
}

// ---------------------------------------------------------------------------
// Checklists — agenda, shopping (separate lens but written via checklists
// pattern below), plus a couple of task-linked subtask checklists.
// ---------------------------------------------------------------------------
function buildChecklists() {
	const created = isoMs(-5 * DAY);
	return [
		{
			id: 'agenda',
			type: 'agenda',
			created,
			creator: ID.kate,
			items: [
				{ text: 'Open with two minutes of silence', checked: true },
				{ text: 'Review March action items', checked: true },
				{ text: 'Bee-yard expansion (Rafa, 10 min)', checked: false },
				{ text: 'New-arrivals onboarding policy (Lina, 20 min)', checked: false },
				{ text: 'Q2 budget consent round (Kate, 15 min)', checked: false },
				{ text: 'Close with appreciations', checked: false }
			]
		},
		{
			id: 'task-seed-sort',
			type: 'quest',
			questId: 'task-seed-sort',
			parentTitle: 'Sort 2026 seed library by germination test',
			holonId: undefined, // filled in writer
			creator: ID.frida,
			created,
			items: [
				{ text: 'Inventory current packets', checked: true },
				{ text: 'Run paper-towel germ test on doubtful packets', checked: true },
				{ text: 'Compost <60% germ stock', checked: true },
				{ text: 'Re-label keepers with 2026 stamp', checked: true },
				{ text: 'Update spreadsheet', checked: true }
			]
		},
		{
			id: 'task-plenary-prep',
			type: 'quest',
			questId: 'task-plenary-prep',
			parentTitle: 'Draft agenda for April plenary',
			creator: ID.kate,
			created,
			items: [
				{ text: 'Collect items from working circles', checked: true },
				{ text: 'Time-box and order items', checked: false },
				{ text: 'Send pre-read 48h before', checked: false },
				{ text: 'Find a note-taker', checked: false }
			]
		},
		{
			id: 'list-welcome-pack',
			type: 'checklist',
			creator: ID.rafa,
			created,
			items: [
				{ text: 'House key + spare', checked: true },
				{ text: 'Wifi password card', checked: true },
				{ text: 'Site map with quiet hours marked', checked: true },
				{ text: 'Whatsapp/Signal group invite', checked: false },
				{ text: 'First-week meal rota', checked: false },
				{ text: 'Tour with current host', checked: false }
			]
		},
		{
			id: 'list-open-day-prep',
			type: 'checklist',
			creator: ID.rafa,
			created,
			items: [
				{ text: 'Print 50 site maps', checked: false },
				{ text: 'Set up parking signage at the road', checked: false },
				{ text: 'Brief tour guides (10am)', checked: false },
				{ text: 'Confirm bee-demo timing with Rafa', checked: true },
				{ text: 'Bread oven lit by 8am', checked: false }
			]
		}
	];
}

// ---------------------------------------------------------------------------
// Shopping list — stored at (holonId, 'checklists', 'shopping')
// per packages/core/src/shopping/types.ts.
// ---------------------------------------------------------------------------
function buildShoppingList() {
	return {
		id: 'shopping',
		type: 'shopping',
		title: 'Community shopping list',
		created: isoMs(-10 * DAY),
		items: [
			{ id: 'shop-1', text: 'Oat milk (8 cartons)', checked: false, category: 'Kitchen', createdBy: ID.sora },
			{ id: 'shop-2', text: 'Sourdough flour, 25kg', checked: false, category: 'Kitchen', createdBy: ID.sora },
			{ id: 'shop-3', text: 'Olive oil, 5L tin', checked: true, category: 'Kitchen', createdBy: ID.rafa },
			{ id: 'shop-4', text: 'Trash bags (compostable)', checked: false, category: 'Housekeeping', createdBy: ID.kate },
			{ id: 'shop-5', text: 'Beeswax foundation sheets', checked: false, category: 'Bees', createdBy: ID.rafa },
			{ id: 'shop-6', text: '12V battery regulator', checked: false, category: 'Workshop', createdBy: ID.pawel },
			{ id: 'shop-7', text: 'Pruning shears (second pair)', checked: false, category: 'Garden', createdBy: ID.kate },
			{ id: 'shop-8', text: 'Cherry-pitting tool', checked: true, category: 'Kitchen', createdBy: ID.mira },
			{ id: 'shop-9', text: 'Strings for double bass', checked: false, category: 'Music', createdBy: ID.noah },
			{ id: 'shop-10', text: 'A2 paper for the agenda board', checked: false, category: 'Housekeeping', createdBy: ID.kate },
			{ id: 'shop-11', text: 'Tea — chamomile, rooibos, mint', checked: false, category: 'Kitchen', createdBy: ID.lina },
			{ id: 'shop-12', text: 'Mason jars (any size, second-hand ok)', checked: false, category: 'Kitchen', createdBy: ID.sora }
		]
	};
}

// ---------------------------------------------------------------------------
// Library items — tools/books/equipment with realistic borrow/rating state.
// ---------------------------------------------------------------------------
function buildLibrary() {
	return [
		{
			id: 'Cordless drill (Makita 18V)',
			type: 'tool',
			borrowed: true,
			createdBy: ID.jonas,
			createdByUsername: 'jonas',
			borrower: 'Theo Okafor',
			borrowerId: ID.theo,
			borrowerInitials: 'TO',
			borrowedAt: isoOffsetDays(-2, 14),
			returnBy: isoOffsetDays(2, 18),
			category: 'Workshop',
			description: 'Two batteries + charger in the green case. Don\'t lose the small bits.',
			value: 220,
			created: isoOffsetDays(-180, 10),
			ratings: [
				{ user: 'mira', rating: 5, review: 'Workhorse.', date: isoOffsetDays(-90, 12) },
				{ user: 'rafa', rating: 4, review: 'Bring spare batteries — old one fades fast.', date: isoOffsetDays(-30, 17) }
			]
		},
		{
			id: 'Laser level (Bosch)',
			type: 'tool',
			borrowed: false,
			createdBy: ID.pawel,
			createdByUsername: 'pawel',
			borrower: null,
			category: 'Workshop',
			description: 'Self-levelling, 20m range. Tripod adapter in the lid.',
			value: 140,
			created: isoOffsetDays(-220, 10),
			ratings: [{ user: 'theo', rating: 5, review: 'Saved the swale layout.', date: isoOffsetDays(-12, 16) }]
		},
		{
			id: 'Loppers (long-handled, by-pass)',
			type: 'tool',
			borrowed: false,
			createdBy: ID.frida,
			createdByUsername: 'frida',
			borrower: null,
			category: 'Garden',
			description: 'Recently sharpened. Wipe blades after fruit-tree work.',
			value: 45,
			created: isoOffsetDays(-365, 9)
		},
		{
			id: 'Apiary suit (size L)',
			type: 'equipment',
			borrowed: true,
			createdBy: ID.rafa,
			createdByUsername: 'rafa',
			borrower: 'Frida Lindqvist',
			borrowerId: ID.frida,
			borrowerInitials: 'FL',
			borrowedAt: isoOffsetDays(-1, 10),
			returnBy: isoOffsetDays(6, 18),
			category: 'Bees',
			description: 'Zips intact. Smoker is in the same shelf.',
			value: 95,
			created: isoOffsetDays(-150, 11)
		},
		{
			id: 'Cargo bike (Bullitt, blue)',
			type: 'equipment',
			borrowed: false,
			createdBy: ID.jonas,
			createdByUsername: 'jonas',
			borrower: null,
			category: 'Transport',
			description: 'Rear hub being repaired (issue logged). Front brake adjusted last week.',
			value: 2200,
			created: isoOffsetDays(-400, 8),
			issues: [{ reporter: 'ananya', issue: 'Rear hub freewheel skips under load', date: isoOffsetDays(-3, 11), resolved: false }]
		},
		{
			id: 'PA system (small, bluetooth)',
			type: 'equipment',
			borrowed: false,
			createdBy: ID.noah,
			createdByUsername: 'noah',
			borrower: null,
			category: 'Music',
			description: 'Good for groups up to ~80. Two mics in the side pouch.',
			value: 380,
			created: isoOffsetDays(-200, 14)
		},
		{
			id: 'Permaculture: A Designer\'s Manual (Mollison)',
			type: 'book',
			borrowed: true,
			createdBy: ID.theo,
			createdByUsername: 'theo',
			borrower: 'Mira Rossi',
			borrowerId: ID.mira,
			borrowerInitials: 'MR',
			borrowedAt: isoOffsetDays(-20, 19),
			returnBy: isoOffsetDays(10, 19),
			category: 'Books',
			description: 'Heavy. The chapter on patterns is the one most people return to.',
			value: 80,
			created: isoOffsetDays(-300, 10),
			ratings: [{ user: 'mira', rating: 5, review: 'Reads like scripture, slowly.', date: isoOffsetDays(-5, 21) }]
		},
		{
			id: 'Sociocracy 3.0 practical guide',
			type: 'book',
			borrowed: false,
			createdBy: ID.kate,
			createdByUsername: 'kate',
			borrower: null,
			category: 'Books',
			description: 'Photocopied + bound — donate-back appreciated.',
			value: 18,
			created: isoOffsetDays(-260, 10)
		},
		{
			id: 'Trailer (1.5m, single axle)',
			type: 'equipment',
			borrowed: false,
			createdBy: ID.frida,
			createdByUsername: 'frida',
			borrower: null,
			category: 'Transport',
			description: 'Tow ball type 50. Indicators check before each trip.',
			value: 650,
			created: isoOffsetDays(-500, 10)
		},
		{
			id: 'Sewing machine (Singer, mechanical)',
			type: 'equipment',
			borrowed: false,
			createdBy: ID.ananya,
			createdByUsername: 'ananya',
			borrower: null,
			category: 'Workshop',
			description: 'Oil before use; manual is in the drawer.',
			value: 220,
			created: isoOffsetDays(-340, 11)
		}
	];
}

// ---------------------------------------------------------------------------
// Expenses — shared community costs split among real users.
// ---------------------------------------------------------------------------
function buildExpenses() {
	const splitAll = USERS.slice(0, 8).map((u) => u.id);
	return [
		{
			id: 'exp-1',
			created: isoOffsetDays(-2, 11),
			amount: 84.5,
			currency: 'eur',
			description: 'weekly veg from the cooperative',
			paidBy: ID.sora,
			splitWith: splitAll
		},
		{
			id: 'exp-2',
			created: isoOffsetDays(-5, 16),
			amount: 32.0,
			currency: 'eur',
			description: 'replacement bandsaw blade',
			paidBy: ID.jonas,
			splitWith: [ID.jonas, ID.theo, ID.pawel, ID.rafa]
		},
		{
			id: 'exp-3',
			created: isoOffsetDays(-9, 18),
			amount: 145.2,
			currency: 'eur',
			description: 'bulk olive oil + flour',
			paidBy: ID.rafa,
			splitWith: splitAll
		},
		{
			id: 'exp-4',
			created: isoOffsetDays(-1, 14),
			amount: 12.0,
			currency: 'eur',
			description: 'tea + chamomile',
			paidBy: ID.lina,
			splitWith: [ID.lina, ID.ananya, ID.sora]
		},
		{
			id: 'exp-5',
			created: isoOffsetDays(-12, 9),
			amount: 410.0,
			currency: 'eur',
			description: 'shared electricity bill, March',
			paidBy: ID.kate,
			splitWith: USERS.map((u) => u.id)
		},
		{
			id: 'exp-6',
			created: isoOffsetDays(-3, 20),
			amount: 22.5,
			currency: 'eur',
			description: 'strings for the double bass',
			paidBy: ID.noah,
			splitWith: [ID.noah]
		},
		{
			id: 'exp-7',
			created: isoOffsetDays(-7, 19),
			amount: 65.0,
			currency: 'eur',
			description: 'venue snacks for the seed swap',
			paidBy: ID.frida,
			splitWith: [ID.frida, ID.mira, ID.kate, ID.ananya, ID.theo]
		},
		{
			id: 'exp-8',
			created: isoOffsetDays(-15, 12),
			amount: 220.0,
			currency: 'eur',
			description: 'two top-bar hives (pre-order)',
			paidBy: ID.rafa,
			splitWith: [ID.rafa, ID.frida, ID.mira, ID.kate]
		},
		{
			id: 'exp-9',
			created: isoOffsetDays(-4, 10),
			amount: 18.4,
			currency: 'eur',
			description: 'fuel for the compost run',
			paidBy: ID.frida,
			splitWith: [ID.frida, ID.theo, ID.jonas]
		},
		{
			id: 'exp-10',
			created: isoOffsetDays(-22, 17),
			amount: 95.0,
			currency: 'eur',
			description: 'mesh-network components',
			paidBy: ID.omar,
			splitWith: [ID.omar, ID.pawel, ID.kate]
		},
		{
			id: 'exp-11',
			created: isoOffsetDays(-30, 14),
			amount: 200.0,
			currency: 'usd',
			description: 'replacement laptop charger (imported)',
			paidBy: ID.pawel,
			splitWith: [ID.pawel]
		},
		{
			id: 'exp-12',
			created: isoOffsetDays(-6, 13),
			amount: 28.0,
			currency: 'eur',
			description: 'paper for the agenda board',
			paidBy: ID.kate,
			splitWith: USERS.map((u) => u.id)
		}
	];
}

// ---------------------------------------------------------------------------
// Roles — used by the Roles page; rotating-leadership style.
// ---------------------------------------------------------------------------
function buildRoles() {
	const created = isoMs(-60 * DAY);
	return [
		{
			id: 'role-facilitator',
			title: 'Plenary Facilitator',
			description: 'Holds the agenda, runs the consent rounds, closes with appreciations. Rotates monthly.',
			participants: [pickUser('kate')],
			created
		},
		{
			id: 'role-finance',
			title: 'Finance Steward',
			description: 'Maintains shared accounts, prepares quarterly budget review.',
			participants: [pickUser('jonas')],
			created
		},
		{
			id: 'role-kitchen',
			title: 'Kitchen Coordinator',
			description: 'Owns the meal rota and the shopping list. Two-person role.',
			participants: [pickUser('sora'), pickUser('rafa')],
			created
		},
		{
			id: 'role-care',
			title: 'Care Circle Holder',
			description: 'Holds space for trauma-informed circles and well-being check-ins.',
			participants: [pickUser('lina'), pickUser('ananya')],
			created
		},
		{
			id: 'role-land',
			title: 'Land Steward',
			description: 'Long-range stewardship of orchard, gardens, swales, compost.',
			participants: [pickUser('mira'), pickUser('theo'), pickUser('frida')],
			created
		},
		{
			id: 'role-tech',
			title: 'Tech & Energy',
			description: 'Solar, mesh network, repairs, documentation.',
			participants: [pickUser('pawel'), pickUser('omar')],
			created
		},
		{
			id: 'role-welcome',
			title: 'Welcome & Hosting',
			description: 'First contact for visitors, new-arrivals onboarding, multilingual hosting.',
			participants: [pickUser('rafa'), pickUser('omar')],
			created
		},
		{
			id: 'role-culture',
			title: 'Culture & Ritual',
			description: 'Holds story nights, music jams, seasonal celebrations.',
			participants: [pickUser('noah'), pickUser('ananya')],
			created
		}
	];
}

// ---------------------------------------------------------------------------
// Announcements (stored in `announcements` lens, free shape — used by the
// Dashboard/Announcements panel).
// ---------------------------------------------------------------------------
function buildAnnouncements() {
	return [
		{
			id: 'ann-spring-open-day',
			title: 'Spring Open Day — save the date',
			body: 'We open the gates Saturday in 12 days. Tours hourly, bread oven on all day, bee demo at 11 and 14. Tell your friends.',
			author: pickUser('rafa'),
			created: isoOffsetDays(-3, 17),
			pinned: true
		},
		{
			id: 'ann-trauma-circle',
			title: 'Trauma-informed circle still has 2 seats',
			body: 'Tuesdays 19–21 in the quiet room. Closed group of 8. NVC-aligned. Reach Lina if you want in.',
			author: pickUser('lina'),
			created: isoOffsetDays(-2, 9)
		},
		{
			id: 'ann-budget',
			title: 'Q2 budget proposal posted',
			body: 'Draft is on the agenda for April plenary. Read it before the meeting; comments welcome in the shared doc.',
			author: pickUser('kate'),
			created: isoOffsetDays(-4, 12)
		},
		{
			id: 'ann-seed-swap',
			title: 'Seed swap — bring labelled envelopes',
			body: 'Three weeks out. We\'ll have a sorting table from 13:30; swap from 14:00. Cake welcome.',
			author: pickUser('frida'),
			created: isoOffsetDays(-1, 18),
			pinned: true
		},
		{
			id: 'ann-jp-exchange',
			title: 'Japan exchange visit — translators wanted',
			body: 'Four guests from our sister farm in Saitama arriving in 4 weeks. If you speak any Japanese, even a little, please flag Sora.',
			author: pickUser('sora'),
			created: isoOffsetDays(-2, 20)
		}
	];
}

// ---------------------------------------------------------------------------
// Settings (currencies, in particular — the Expenses page picks these up).
// ---------------------------------------------------------------------------
function buildSettings(holonId) {
	return {
		id: holonId,
		currencies: ['eur', 'usd', 'gbp'],
		description: 'A lively regenerative community in northern Italy — orchard, workshop, kitchen, care circles, mesh network, beekeeping.',
		mission: 'Steward land and culture so that what we build outlives us.',
		updated: new Date(NOW).toISOString()
	};
}

// ---------------------------------------------------------------------------
// DNA + chromosome library — uses the canonical defaults from
// @holons/core/dna, then pins ~12 of them into a DNA sequence.
// ---------------------------------------------------------------------------
function buildDNA(holonId) {
	const nowIso = new Date(NOW).toISOString();
	const seeds = getAllDefaultChromosomes();
	const library = {};
	const chromosomeIds = [];
	for (const s of seeds) {
		const id = `chr-${s.type}-${s.name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')}`;
		library[id] = {
			id,
			holonId,
			name: s.name,
			type: s.type,
			description: s.description,
			icon: s.icon ?? '',
			created: nowIso,
			updated: nowIso
		};
		chromosomeIds.push(id);
	}
	// Pin a curated DNA sequence (must stay <=20 per dna validation).
	const picks = [
		'chr-value-everyone-contributes',
		'chr-value-self-organization',
		'chr-value-commons-stewardship',
		'chr-value-gift-economy',
		'chr-value-local-wisdom',
		'chr-value-wholeness',
		'chr-tool-sociocracy-consent',
		'chr-tool-open-space-technology',
		'chr-tool-world-caf',
		'chr-tool-appreciative-inquiry',
		'chr-practice-weekly-community-calls',
		'chr-practice-monthly-retrospectives',
		'chr-practice-rotating-facilitation',
		'chr-practice-non-violent-communication',
		'chr-practice-celebration-rituals'
	].filter((id) => library[id]);

	const dna = {
		holonId,
		chromosomeIds: picks,
		created: nowIso,
		updated: nowIso,
		version: 1
	};

	return { library, dna };
}

// ---------------------------------------------------------------------------
// REA events — Resource-Event-Agent log derived from the same fixtures used
// for tasks / expenses / library / users. Mirrors the shape produced by
// `@holons/core/rea`'s REAEventFactory but uses fully stable ids and
// fixture-derived timestamps so re-running the seeder upserts in place
// (the factory's `generateId` uses Math.random() — fine in production,
// but would duplicate on re-seed). Lens: `rea_events`.
// ---------------------------------------------------------------------------

function userAgent(username) {
	const u = USERS.find((x) => x.username === username);
	return { id: String(u.id), type: 'user', name: u.username };
}
function userAgentById(idNum) {
	const u = USERS.find((x) => x.id === idNum);
	return { id: String(idNum), type: 'user', name: u?.username ?? String(idNum) };
}
function holonAgent(holonId) {
	return { id: String(holonId), type: 'holon', name: String(holonId) };
}
function externalAgent(desc) {
	return { id: 'external', type: 'external', name: desc };
}

function buildREAEvents(holonId, tasks, events, expenses, libraryItems) {
	const out = [];

	// --- Quest initiated (every task and event)
	for (const q of [...tasks, ...events]) {
		const initiator = q.initiator;
		if (!initiator) continue;
		const ts = Date.parse(q.created) || NOW;
		out.push({
			id: `${holonId}_quest_initiated_${initiator.id}_${q.id}`,
			timestamp: ts,
			resource: { type: 'appreciation', quantity: 1, unit: 'initiative' },
			provider: userAgentById(initiator.id),
			receiver: holonAgent(holonId),
			context: { holonId: String(holonId), questId: String(q.id), note: q.title },
			eventType: 'quest:initiated',
			status: 'confirmed'
		});
	}

	// --- Quest completed (each participant of a completed task)
	for (const q of tasks) {
		if (q.status !== 'completed') continue;
		const ts = Date.parse(q.completed) || Date.parse(q.created) || NOW;
		for (const p of q.participants ?? []) {
			out.push({
				id: `${holonId}_quest_completed_${p.id}_${q.id}`,
				timestamp: ts,
				resource: { type: 'appreciation', quantity: 1, unit: 'completion' },
				provider: userAgentById(p.id),
				receiver: holonAgent(holonId),
				context: { holonId: String(holonId), questId: String(q.id), note: q.title },
				eventType: 'quest:completed',
				status: 'confirmed'
			});
		}
	}

	// --- Appreciation exchanged (each appreciation is a 1-kudo gift from
	//     the holon to the appreciator — modelled like the factory's
	//     dual-event pair so both perspectives aggregate).
	for (const q of tasks) {
		for (const appr of q.appreciation ?? []) {
			const ts = (Date.parse(q.completed) || Date.parse(q.created) || NOW) + 60_000;
			const baseId = `${holonId}_appreciation_${holonId}_${appr.id}_${q.id}`;
			const provider = holonAgent(holonId);
			const receiver = userAgentById(appr.id);
			const ctx = { holonId: String(holonId), questId: String(q.id), note: q.title };
			out.push({
				id: `${baseId}_sent`,
				timestamp: ts,
				resource: { type: 'appreciation', quantity: 1, unit: 'kudos' },
				provider,
				receiver,
				context: ctx,
				eventType: 'appreciation:sent',
				status: 'confirmed'
			});
			out.push({
				id: `${baseId}_received`,
				timestamp: ts,
				resource: { type: 'appreciation', quantity: 1, unit: 'kudos' },
				provider,
				receiver,
				context: ctx,
				eventType: 'appreciation:received',
				status: 'confirmed'
			});
		}
	}

	// --- Time logged — a deterministic hour count per task participant for
	//     completed tasks (gives statistics + scoring something to chew on).
	const HOURS_BY_CATEGORY = {
		Garden: 3,
		Workshop: 4,
		Kitchen: 5,
		Care: 2,
		Tech: 3,
		Energy: 4,
		Governance: 2,
		Outreach: 6,
		Culture: 3
	};
	for (const q of tasks) {
		if (q.status !== 'completed') continue;
		const hours = HOURS_BY_CATEGORY[q.category] ?? 2;
		const ts = Date.parse(q.completed) || NOW;
		for (const p of q.participants ?? []) {
			out.push({
				id: `${holonId}_quest_time_logged_${p.id}_${q.id}`,
				timestamp: ts,
				resource: { type: 'time', quantity: hours, unit: 'hours' },
				provider: userAgentById(p.id),
				receiver: holonAgent(holonId),
				context: { holonId: String(holonId), questId: String(q.id), note: q.title },
				eventType: 'quest:time_logged',
				status: 'confirmed'
			});
		}
	}

	// --- Expense events: one `expense:paid` to an external agent, then one
	//     `expense:share` per non-payer in the split. Stable per-expense ids
	//     keyed by expense.id + share index → idempotent across re-seeds.
	for (const e of expenses) {
		const ts = Date.parse(e.created) || NOW;
		const base = `${holonId}_expense_${e.id}`;
		out.push({
			id: `${base}_paid`,
			timestamp: ts,
			resource: { type: 'money', quantity: e.amount, unit: e.currency.toLowerCase() },
			provider: { id: String(e.paidBy), type: 'user' },
			receiver: externalAgent(e.description),
			context: { holonId: String(holonId), expenseId: String(e.id), note: e.description },
			eventType: 'expense:paid',
			status: 'confirmed'
		});
		const share = e.amount / e.splitWith.length;
		e.splitWith.forEach((userId, idx) => {
			if (String(userId) === String(e.paidBy)) return;
			out.push({
				id: `${base}_share_${idx}`,
				timestamp: ts,
				resource: { type: 'money', quantity: share, unit: e.currency.toLowerCase() },
				provider: { id: String(e.paidBy), type: 'user' },
				receiver: { id: String(userId), type: 'user' },
				context: { holonId: String(holonId), expenseId: String(e.id), note: e.description },
				eventType: 'expense:share',
				status: 'confirmed'
			});
		});
	}

	// --- Library item borrows: for every currently-borrowed item plus a
	//     synthetic "previous return" for items that have ratings/issues so
	//     the timeline has both halves of a borrow cycle.
	const PREV_BORROWS = [
		{ itemId: 'Cordless drill (Makita 18V)', borrowerUsername: 'mira', daysAgo: 90, returnedDaysAgo: 86, deposit: 10 },
		{ itemId: 'Cordless drill (Makita 18V)', borrowerUsername: 'rafa', daysAgo: 32, returnedDaysAgo: 30, deposit: 10 },
		{ itemId: 'Laser level (Bosch)', borrowerUsername: 'theo', daysAgo: 14, returnedDaysAgo: 12, deposit: 15 },
		{ itemId: 'Permaculture: A Designer\'s Manual (Mollison)', borrowerUsername: 'theo', daysAgo: 150, returnedDaysAgo: 90, deposit: 0 },
		{ itemId: 'Cargo bike (Bullitt, blue)', borrowerUsername: 'ananya', daysAgo: 4, returnedDaysAgo: 3, deposit: 30 }
	];
	for (const pb of PREV_BORROWS) {
		const item = libraryItems.find((x) => x.id === pb.itemId);
		if (!item) continue;
		const tsBorrow = NOW - pb.daysAgo * DAY;
		const tsReturn = NOW - pb.returnedDaysAgo * DAY;
		const base = `${holonId}_libcycle_${pb.borrowerUsername}_${pb.itemId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${pb.daysAgo}`;
		out.push({
			id: `${base}_borrow`,
			timestamp: tsBorrow,
			resource: { type: 'item', quantity: 1, unit: String(item.id), resourceId: item.id },
			provider: { id: String(item.createdBy), type: 'user' },
			receiver: userAgent(pb.borrowerUsername),
			context: { holonId: String(holonId), itemId: item.id },
			eventType: 'item:borrowed',
			status: 'confirmed'
		});
		if (pb.deposit > 0) {
			out.push({
				id: `${base}_deposit`,
				timestamp: tsBorrow,
				resource: { type: 'credit', quantity: pb.deposit, unit: 'credits' },
				provider: userAgent(pb.borrowerUsername),
				receiver: holonAgent(holonId),
				context: { holonId: String(holonId), itemId: item.id },
				eventType: 'item:deposit_held',
				status: 'confirmed'
			});
		}
		out.push({
			id: `${base}_return`,
			timestamp: tsReturn,
			resource: { type: 'item', quantity: 1, unit: String(item.id), resourceId: item.id },
			provider: userAgent(pb.borrowerUsername),
			receiver: { id: String(item.createdBy), type: 'user' },
			context: { holonId: String(holonId), itemId: item.id },
			eventType: 'item:returned',
			status: 'confirmed'
		});
		if (pb.deposit > 0) {
			out.push({
				id: `${base}_deposit_return`,
				timestamp: tsReturn,
				resource: { type: 'credit', quantity: pb.deposit, unit: 'credits' },
				provider: holonAgent(holonId),
				receiver: userAgent(pb.borrowerUsername),
				context: { holonId: String(holonId), itemId: item.id },
				eventType: 'item:deposit_returned',
				status: 'confirmed'
			});
		}
	}

	// Currently-borrowed items — open `item:borrowed` records (no return yet).
	for (const item of libraryItems) {
		if (!item.borrowed || !item.borrowerId) continue;
		const tsBorrow = Date.parse(item.borrowedAt) || NOW - DAY;
		const borrowerUser = USERS.find((u) => u.id === item.borrowerId);
		if (!borrowerUser) continue;
		const safeId = String(item.id).replace(/[^a-z0-9]+/gi, '_').toLowerCase();
		out.push({
			id: `${holonId}_libcurrent_${borrowerUser.username}_${safeId}_borrow`,
			timestamp: tsBorrow,
			resource: { type: 'item', quantity: 1, unit: String(item.id), resourceId: item.id },
			provider: { id: String(item.createdBy), type: 'user' },
			receiver: userAgentById(item.borrowerId),
			context: { holonId: String(holonId), itemId: item.id },
			eventType: 'item:borrowed',
			status: 'confirmed'
		});
	}

	// --- Mutual credit: a handful of credit issuances + transfers.
	const CREDITS = [
		{ from: 'kate', to: 'sora', amount: 12, note: 'Kitchen rota leadership' },
		{ from: 'kate', to: 'rafa', amount: 12, note: 'Kitchen rota leadership' },
		{ from: 'kate', to: 'pawel', amount: 8, note: 'Solar documentation' },
		{ from: 'kate', to: 'lina', amount: 10, note: 'Holding the trauma circle' },
		{ from: 'jonas', to: 'theo', amount: 6, note: 'Swale layout help' },
		{ from: 'sora', to: 'ananya', amount: 4, note: 'Jar haul' }
	];
	CREDITS.forEach((c, i) => {
		const sender = USERS.find((u) => u.username === c.from);
		const recipient = USERS.find((u) => u.username === c.to);
		out.push({
			id: `${holonId}_credit_issued_${i}`,
			timestamp: NOW - (5 + i) * DAY,
			resource: { type: 'credit', quantity: c.amount, unit: 'credits' },
			provider: userAgentById(sender.id),
			receiver: userAgentById(recipient.id),
			context: { holonId: String(holonId), note: c.note },
			eventType: 'credit:issued',
			status: 'confirmed'
		});
	});

	return out;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

async function putAll(holosphere, holonId, lens, items, timeoutMs, concurrency) {
	let ok = 0;
	let failed = 0;
	let next = 0;
	const total = items.length;

	async function pump() {
		while (next < total) {
			const i = next++;
			const item = items[i];
			try {
				await withTimeout(
					holosphere.put(String(holonId), lens, item),
					timeoutMs,
					`${lens}:${item.id ?? '?'}`
				);
				ok++;
			} catch (e) {
				failed++;
				console.error(`  ! ${lens}/${item.id ?? '?'}: ${e?.message ?? e}`);
			}
		}
	}
	const workers = Array.from({ length: Math.max(1, concurrency) }, pump);
	await Promise.all(workers);
	console.log(`  ${lens}: ${ok}/${total} written (${failed} failed)`);
}

async function main() {
	const flags = parseArgs(argv.slice(2));
	const holonId = flags.holonId;
	const appName = flags.appName || env.HOLONS_APP || 'HolonsDebug';
	const privateKey = env.HOLOSPHERE_NSEC || null;

	console.log(
		`Seeding holon "${holonId}" via appName="${appName}"` +
			(privateKey ? ' with provided privateKey' : ' anonymously')
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

	// 1) Users — profiles with values/needs. Stored at (holonId, 'users', <userId>).
	const userRecords = USERS.map((u) => ({
		id: u.id,
		version: '0.3',
		username: u.username,
		first_name: u.first_name,
		last_name: u.last_name,
		values: u.values,
		needs: u.needs,
		participated: {}
	}));

	console.log('\n[1/9] Users …');
	await putAll(holosphere, holonId, 'users', userRecords, flags.timeoutMs, flags.concurrency);

	// 2) DNA + chromosome library — single-doc writes via `holosphere.put`
	console.log('\n[2/9] DNA + chromosome library …');
	const { library, dna } = buildDNA(holonId);
	try {
		await withTimeout(
			holosphere.put(holonId, 'chromosome_library', { id: 'chromosome_library', ...library }),
			flags.timeoutMs,
			'chromosome_library'
		);
		console.log('  chromosome_library: 1 written');
	} catch (e) {
		console.error(`  ! chromosome_library: ${e?.message ?? e}`);
	}
	try {
		await withTimeout(
			holosphere.put(holonId, 'dna_sequence', { id: 'dna_sequence', ...dna }),
			flags.timeoutMs,
			'dna_sequence'
		);
		console.log('  dna_sequence: 1 written');
	} catch (e) {
		console.error(`  ! dna_sequence: ${e?.message ?? e}`);
	}

	// 3) Tasks + events — both stored in the `quests` lens
	console.log('\n[3/9] Tasks …');
	const tasks = buildQuests().map((q) => ({ ...q, holon: holonId }));
	await putAll(holosphere, holonId, 'quests', tasks, flags.timeoutMs, flags.concurrency);

	console.log('\n[4/9] Calendar events + marketplace offers/requests …');
	const events = buildEvents();
	await putAll(holosphere, holonId, 'quests', events, flags.timeoutMs, flags.concurrency);
	const marketItems = buildMarketItems().map((m) => ({ ...m, holon: holonId }));
	await putAll(holosphere, holonId, 'quests', marketItems, flags.timeoutMs, flags.concurrency);

	// 4) Checklists (including agenda + per-task subtask checklists)
	console.log('\n[5/9] Checklists …');
	const checklists = buildChecklists().map((c) => ({ ...c, holonId }));
	await putAll(holosphere, holonId, 'checklists', checklists, flags.timeoutMs, flags.concurrency);

	// Shopping list — same lens, special id 'shopping'
	console.log('\n[6/9] Shopping list …');
	const shopping = buildShoppingList();
	try {
		await withTimeout(
			holosphere.put(holonId, 'checklists', shopping),
			flags.timeoutMs,
			'shopping'
		);
		console.log('  shopping: 1 written');
	} catch (e) {
		console.error(`  ! shopping: ${e?.message ?? e}`);
	}

	// 5) Library / expenses / roles / announcements
	console.log('\n[7/9] Library + expenses + roles + announcements …');
	const library_items = buildLibrary();
	await putAll(holosphere, holonId, 'library', library_items, flags.timeoutMs, flags.concurrency);
	const expenses = buildExpenses();
	await putAll(holosphere, holonId, 'expenses', expenses, flags.timeoutMs, flags.concurrency);
	const roles = buildRoles();
	await putAll(holosphere, holonId, 'roles', roles, flags.timeoutMs, flags.concurrency);
	const anns = buildAnnouncements();
	await putAll(holosphere, holonId, 'announcements', anns, flags.timeoutMs, flags.concurrency);

	// 6) Settings (single-doc, id = holonId)
	console.log('\n[8/9] Settings …');
	const settings = buildSettings(holonId);
	try {
		await withTimeout(holosphere.put(holonId, 'settings', settings), flags.timeoutMs, 'settings');
		console.log('  settings: 1 written');
	} catch (e) {
		console.error(`  ! settings: ${e?.message ?? e}`);
	}

	// 7) REA events — derived from the same fixtures so the resource-event
	//    log is consistent with everything else we just wrote.
	console.log('\n[9/9] REA events …');
	const reaEvents = buildREAEvents(holonId, tasks, events, expenses, library_items);
	await putAll(holosphere, holonId, 'rea_events', reaEvents, flags.timeoutMs, flags.concurrency);

	console.log('\nAllowing 5s for the relay publishes to drain before exit …');
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
