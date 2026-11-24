// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Meridian Works — an invented company, organised as nested circles.
 *
 * Every circle is a holon with its own members, its own value equation and
 * its own split (`AllocationConfig`). Sub-circles are federation partners of
 * the circle above them, placed on its zone rings, so money that lands on the
 * company passes down through the circles exactly as `resolveCascade` reads a
 * real federation. People are holons too (their personal holon): a few of
 * them have a split of their own, so value keeps flowing past them.
 *
 * Nothing here computes meaning — scores, shares, cascades and ceilings all
 * come from `@holons/core`. This file is only the cast and the knobs.
 */

import type { AllocationConfig, AllocationPartner } from '@holons/core/flows';
import type { ScoreEquation } from '@holons/core/scoring';

export type HolonKind = 'company' | 'circle' | 'personal' | 'outside';

/** Where money can be sent to a holon. Each rail carries one unit. */
export type Rail = 'opencollective' | 'pot' | 'eth' | 'nostr';

export const RAIL_UNIT: Record<Rail, string> = {
  opencollective: 'EUR',
  pot: 'USDC',
  eth: 'ETH',
  nostr: 'SAT',
};

export const RAIL_LABEL: Record<Rail, string> = {
  opencollective: 'Open Collective',
  pot: 'Pot (on-chain)',
  eth: 'Ethereum address',
  nostr: 'Nostr zap',
};

export interface Person {
  id: string;
  name: string;
  /** Their role in the circle(s) they sit in. */
  role: string;
  /** The circles they are a member of (by holon id). */
  circles: string[];
  /** A personal split, when what they receive does not stop with them. */
  split?: { keepPercent: number; givesTo: { id: string; name: string; kind: 'holon' | 'person' }[] };
  npub: string;
}

export interface HolonSpec {
  id: string;
  name: string;
  kind: HolonKind;
  /** The circle this one sits inside, if any. */
  parent: string | null;
  purpose: string;
  /** Short words for what this circle's equation rewards. */
  valuedFor: string;
  equation: ScoreEquation;
  config: AllocationConfig;
  /** Sub-circles and outside holons on this holon's zone rings. */
  partners: AllocationPartner[];
  rails: Partial<Record<Rail, string>>;
  color: string;
}

const eq = (partial: Partial<ScoreEquation>): ScoreEquation => ({
  initiated: 0,
  completed: 0,
  sent: 0,
  received: 0,
  collaboration: 0,
  participation: 0,
  coParticipants: 0,
  activity: 0,
  groupSize: 0,
  variance: 0,
  currencies: {},
  ...partial,
});

export const HOLONS: HolonSpec[] = [
  {
    id: 'meridian',
    name: 'Meridian Works',
    kind: 'company',
    parent: null,
    purpose: 'General circle — sets strategy and funds the circles',
    valuedFor: '2 per goal set · 1 per appreciation received',
    equation: eq({ initiated: 2, received: 1 }),
    // 20% to the general circle's own lead links, 80% down to the circles.
    config: { interiorPercent: 20, steepness: 50, nzones: 3, interiorMode: 'equation' },
    partners: [
      { id: 'eng', name: 'Engineering', zone: 1, kind: 'holon' },
      { id: 'content', name: 'Content', zone: 1, kind: 'holon' },
      { id: 'mkt', name: 'Marketing', zone: 2, kind: 'holon' },
      { id: 'ops', name: 'Operations', zone: 3, kind: 'holon' },
    ],
    rails: {
      opencollective: 'opencollective.com/meridian-works',
      pot: '0x7a3e…c41D (Pot)',
      eth: '0xMer1…dian (Safe)',
      nostr: 'npub1meridian…works',
    },
    color: '#6d5bd0',
  },
  {
    id: 'eng',
    name: 'Engineering',
    kind: 'circle',
    parent: 'meridian',
    purpose: 'Builds the product — satisfies feature requests',
    valuedFor: '10 per feature request satisfied · 1 per task done',
    equation: eq({ completed: 1, currencies: { feature: 10 } }),
    config: { interiorPercent: 75, steepness: 50, nzones: 2, interiorMode: 'equation' },
    partners: [{ id: 'platform', name: 'Platform', zone: 1, kind: 'holon' }],
    rails: { eth: '0xEng1…neer', nostr: 'npub1meridian…eng' },
    color: '#1f8a70',
  },
  {
    id: 'platform',
    name: 'Platform',
    kind: 'circle',
    parent: 'eng',
    purpose: 'Infrastructure sub-circle of Engineering',
    valuedFor: '2 per infra task · 10 per feature unblocked',
    equation: eq({ completed: 2, currencies: { feature: 10 } }),
    config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' },
    partners: [],
    rails: {},
    color: '#2aa198',
  },
  {
    id: 'content',
    name: 'Content',
    kind: 'circle',
    parent: 'meridian',
    purpose: 'Writes the articles that bring readers in',
    valuedFor: 'Σ articles × views (0.01 per view) · 5 per edit',
    equation: eq({ currencies: { view: 0.01, edit: 5 } }),
    config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' },
    partners: [],
    rails: { nostr: 'npub1meridian…content', opencollective: 'opencollective.com/meridian-content' },
    color: '#d0702b',
  },
  {
    id: 'mkt',
    name: 'Marketing',
    kind: 'circle',
    parent: 'meridian',
    purpose: 'Listens to customers, files feature requests, runs campaigns',
    valuedFor: '3 per request/campaign · 2 per lead · 1 per appreciation',
    equation: eq({ initiated: 3, received: 1, currencies: { lead: 2 } }),
    config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' },
    partners: [],
    rails: { eth: '0xMkt0…ing0' },
    color: '#c2417a',
  },
  {
    id: 'ops',
    name: 'Operations',
    kind: 'circle',
    parent: 'meridian',
    purpose: 'Keeps the lights on — equal split by choice',
    valuedFor: 'egalitarian (all weights 0 → equal shares)',
    equation: eq({}),
    config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' },
    partners: [],
    rails: {},
    color: '#5b7083',
  },
  {
    id: 'oss',
    name: 'Open-source commons',
    kind: 'outside',
    parent: null,
    purpose: 'An outside project Kai gives part of his share to',
    valuedFor: '—',
    equation: eq({}),
    config: { interiorPercent: 100, steepness: 50, nzones: 1, interiorMode: 'equation' },
    partners: [],
    rails: {},
    color: '#8a8f98',
  },
];

export const PEOPLE: Person[] = [
  { id: 'ana', name: 'Ana', role: 'Lead link (CEO)', circles: ['meridian'], npub: 'npub1ana…' },
  { id: 'sam', name: 'Sam', role: 'Secretary / finance', circles: ['meridian'], npub: 'npub1sam…' },
  {
    id: 'kai',
    name: 'Kai',
    role: 'Backend developer',
    circles: ['eng', 'platform'],
    split: { keepPercent: 85, givesTo: [{ id: 'oss', name: 'Open-source commons', kind: 'holon' }] },
    npub: 'npub1kai…',
  },
  { id: 'mira', name: 'Mira', role: 'Frontend developer', circles: ['eng'], npub: 'npub1mira…' },
  { id: 'theo', name: 'Theo', role: 'Platform lead', circles: ['platform'], npub: 'npub1theo…' },
  {
    id: 'lena',
    name: 'Lena',
    role: 'Writer',
    circles: ['content'],
    split: { keepPercent: 90, givesTo: [{ id: 'omar', name: 'Omar', kind: 'person' }] },
    npub: 'npub1lena…',
  },
  { id: 'omar', name: 'Omar', role: 'Writer', circles: ['content'], npub: 'npub1omar…' },
  { id: 'sasha', name: 'Sasha', role: 'Editor', circles: ['content'], npub: 'npub1sasha…' },
  { id: 'priya', name: 'Priya', role: 'Product marketer', circles: ['mkt'], npub: 'npub1priya…' },
  { id: 'jonas', name: 'Jonas', role: 'Growth / campaigns', circles: ['mkt'], npub: 'npub1jonas…' },
  { id: 'rosa', name: 'Rosa', role: 'Office & people ops', circles: ['ops'], npub: 'npub1rosa…' },
  { id: 'ben', name: 'Ben', role: 'IT & finance ops', circles: ['ops'], npub: 'npub1ben…' },
];

/** Deposits that arrive on their own as the simulation plays. */
export interface ScheduledDeposit {
  day: number;
  target: string;
  rail: Rail;
  amount: number;
  from: string;
}

export const SCHEDULED_DEPOSITS: ScheduledDeposit[] = [
  { day: 3, target: 'meridian', rail: 'opencollective', amount: 12000, from: 'Customer subscriptions' },
  { day: 9, target: 'content', rail: 'nostr', amount: 420000, from: 'Readers zapping articles' },
  { day: 14, target: 'eng', rail: 'eth', amount: 1.5, from: 'Protocol grant' },
  { day: 18, target: 'meridian', rail: 'pot', amount: 8000, from: 'Client invoice (USDC)' },
  { day: 24, target: 'meridian', rail: 'opencollective', amount: 6000, from: 'Customer subscriptions' },
];

/** Length of one simulated lunation, in days. The Pot commits its rights root at its end. */
export const LUNATION_DAYS = 29;
