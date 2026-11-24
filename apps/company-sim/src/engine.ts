// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The simulation: people do their work day by day, tasks travel between
 * circles as holograms, money arrives on any holon's rails, and the core
 * engine says where every unit of it ends up.
 *
 * What this file owns is only the PLAY — who does what on which day, which
 * task is a hologram of which. Every number with meaning comes from core:
 *
 *   scores + shares   @holons/core/scoring  calculateAllUserScores
 *   one holon's split @holons/core/flows    allocate (inside resolveCascade)
 *   the cascade       @holons/core/flows    resolveCascade + cascadeRights
 *   what is claimable @holons/core/flows    claimCeilings
 *
 * Units never mix (the Flows board's rule): EUR, ETH, SATS and USDC each get
 * their own pot, their own ceilings and their own flow graph.
 *
 * Pot rail: a unit held in a holon's Pot is not claimed through the log —
 * `claimCeilings` gives it a ceiling of 0 — it is COLLECTED from the Pot once
 * the lunation's rights root is committed at the new moon. So Pot deposits
 * sit as "pending" until the commit, then become collectable.
 */

import {
  calculateAllUserScores,
  type ScoreEquation,
} from '@holons/core/scoring';
import {
  cascadeRights,
  claimCeilings,
  resolveCascade,
  type AllocationMember,
  type CascadeInputs,
  type CascadeNode,
  type CascadeResult,
} from '@holons/core/flows';
import {
  HOLONS,
  LUNATION_DAYS,
  PEOPLE,
  RAIL_LABEL,
  RAIL_UNIT,
  SCHEDULED_DEPOSITS,
  type HolonSpec,
  type Person,
  type Rail,
} from './scenario.js';

// ── State ────────────────────────────────────────────────────────────────

/** What each person has done, per circle — the inputs to that circle's equation. */
export interface Tally {
  initiated: number;
  completed: number;
  sent: number;
  received: number;
  /** Currency-like metrics: feature, view, edit, lead (singular: core's normalizeCurrency singularises units) … */
  metrics: Record<string, number>;
}

export type TaskStatus = 'open' | 'doing' | 'done';

export interface Task {
  id: string;
  title: string;
  /** The holon that owns the task (the source of every hologram of it). */
  holon: string;
  initiator: string;
  assignee: string | null;
  status: TaskStatus;
  /** Holons showing a hologram of this task (a pointer, not a copy). */
  holograms: string[];
  createdDay: number;
  doneDay: number | null;
  kind: 'feature-request' | 'feature' | 'infra' | 'article' | 'launch-post' | 'campaign' | 'ops' | 'goal';
  /** Article only: views so far. */
  views?: number;
}

export type EventKind =
  | 'task'
  | 'hologram'
  | 'complete'
  | 'article'
  | 'views'
  | 'appreciation'
  | 'deposit'
  | 'claim'
  | 'commit'
  | 'collect';

export interface SimEvent {
  seq: number;
  day: number;
  kind: EventKind;
  /** The holon the event happens in. */
  holon: string;
  /** For holograms / deposits: where it travels to. */
  to?: string;
  actor?: string;
  text: string;
  taskId?: string;
  rail?: Rail;
  unit?: string;
  amount?: number;
}

export interface Deposit {
  day: number;
  target: string;
  rail: Rail;
  unit: string;
  amount: number;
  from: string;
}

export interface SimState {
  day: number;
  seq: number;
  rand: () => number;
  /** circle id → person id → tally. */
  tallies: Record<string, Record<string, Tally>>;
  tasks: Record<string, Task>;
  events: SimEvent[];
  deposits: Deposit[];
  /** person/party → unit → amount claimed through the log. */
  claimed: Record<string, Record<string, number>>;
  /** Pot units: what each party may collect, frozen at each commit. */
  collectable: Record<string, Record<string, number>>;
  collected: Record<string, Record<string, number>>;
  /** holon → unit → Pot deposits not yet in a committed rights root. */
  potPending: Record<string, Record<string, number>>;
  lunation: number;
  nextTask: number;
}

// ── Seeded randomness, so a run is reproducible ─────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const zeroTally = (): Tally => ({ initiated: 0, completed: 0, sent: 0, received: 0, metrics: {} });

export const holonById = (id: string): HolonSpec | undefined => HOLONS.find((h) => h.id === id);
export const personById = (id: string): Person | undefined => PEOPLE.find((p) => p.id === id);
export const nameOf = (id: string): string => personById(id)?.name ?? holonById(id)?.name ?? id;

export function createSim(seed = 7): SimState {
  const tallies: SimState['tallies'] = {};
  for (const h of HOLONS) tallies[h.id] = {};
  for (const p of PEOPLE) for (const c of p.circles) tallies[c][p.id] = zeroTally();
  return {
    day: 0,
    seq: 0,
    rand: mulberry32(seed),
    tallies,
    tasks: {},
    events: [],
    deposits: [],
    claimed: {},
    collectable: {},
    collected: {},
    potPending: {},
    lunation: 1,
    nextTask: 1,
  };
}

// ── Recording helpers ────────────────────────────────────────────────────

function emit(s: SimState, e: Omit<SimEvent, 'seq' | 'day'>): SimEvent {
  const ev = { seq: ++s.seq, day: s.day, ...e };
  s.events.push(ev);
  return ev;
}

function tally(s: SimState, circle: string, person: string): Tally {
  const byPerson = (s.tallies[circle] ??= {});
  return (byPerson[person] ??= zeroTally());
}

function bump(s: SimState, circle: string, person: string, metric: string, by = 1): void {
  const t = tally(s, circle, person);
  t.metrics[metric] = (t.metrics[metric] ?? 0) + by;
}

function newTask(
  s: SimState,
  holon: string,
  initiator: string,
  kind: Task['kind'],
  title: string,
  assignee: string | null = null,
): Task {
  const task: Task = {
    id: `t${s.nextTask++}`,
    title,
    holon,
    initiator,
    assignee,
    status: assignee ? 'doing' : 'open',
    holograms: [],
    createdDay: s.day,
    doneDay: null,
    kind,
  };
  s.tasks[task.id] = task;
  tally(s, holon, initiator).initiated += 1;
  emit(s, { kind: 'task', holon, actor: initiator, taskId: task.id, text: `${nameOf(initiator)} opened “${title}” in ${nameOf(holon)}` });
  return task;
}

/** A task appears in another holon as a hologram — a live pointer to the source. */
function hologram(s: SimState, task: Task, to: string, why: string): void {
  if (task.holograms.includes(to) || task.holon === to) return;
  task.holograms.push(to);
  emit(s, {
    kind: 'hologram',
    holon: task.holon,
    to,
    taskId: task.id,
    text: `“${task.title}” travels ${nameOf(task.holon)} → ${nameOf(to)} as a hologram (${why})`,
  });
}

/** Completion is written once, at the source; every hologram shows it. */
function complete(s: SimState, task: Task, by: string, creditCircle = task.holon): void {
  task.status = 'done';
  task.assignee = by;
  task.doneDay = s.day;
  tally(s, creditCircle, by).completed += 1;
  const seen = task.holograms.length ? ` — visible in ${task.holograms.map(nameOf).join(', ')}` : '';
  emit(s, { kind: 'complete', holon: task.holon, actor: by, taskId: task.id, text: `${nameOf(by)} completed “${task.title}”${seen}` });
}

function appreciate(s: SimState, from: string, fromCircle: string, to: string, toCircle: string, why: string): void {
  tally(s, fromCircle, from).sent += 1;
  tally(s, toCircle, to).received += 1;
  emit(s, { kind: 'appreciation', holon: toCircle, actor: from, text: `${nameOf(from)} appreciates ${nameOf(to)} — ${why}` });
}

const pick = <T>(s: SimState, xs: T[]): T => xs[Math.floor(s.rand() * xs.length)];
const chance = (s: SimState, p: number) => s.rand() < p;

const FEATURES = [
  'CSV export', 'Dark mode', 'SSO login', 'Usage dashboard', 'Webhooks', 'Mobile offline mode',
  'Team permissions', 'Public API v2', 'Slack integration', 'Faster search', 'Bulk edit', 'Audit log',
];
const ARTICLES = [
  'Why we went local-first', 'A field guide to holacracy', 'Five lessons from our first year',
  'How our circles share revenue', 'Designing for slow internet', 'The case for open books',
  'What customers taught us about export', 'Building trust in a remote team', 'Notes on value equations',
];
const OPS = ['Renew office lease', 'Payroll run', 'Laptop refresh', 'Insurance review', 'Onboard new hire', 'Backup audit'];

// ── One simulated day ────────────────────────────────────────────────────

/** Advance one day. Returns the events that day produced. */
export function step(s: SimState): SimEvent[] {
  s.day += 1;
  const from = s.events.length;

  // Ana sets a goal at the start of each lunation; it shows in every circle.
  if (s.day % LUNATION_DAYS === 1) {
    const goal = newTask(s, 'meridian', 'ana', 'goal', `Lunation ${s.lunation} goal: ship 3 requested features`);
    for (const c of ['eng', 'content', 'mkt', 'ops']) hologram(s, goal, c, 'company goal');
  }

  // Marketing hears customers and files feature requests into Engineering.
  if (chance(s, 0.3)) {
    const title = pick(s, FEATURES);
    const req = newTask(s, 'mkt', 'priya', 'feature-request', `Request: ${title}`);
    hologram(s, req, 'eng', 'federated request');
  }

  // Engineering picks up open requests; some need the Platform sub-circle.
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'feature-request' || t.status !== 'open') continue;
    if (!chance(s, 0.35)) continue;
    const dev = pick(s, ['kai', 'mira']);
    t.status = 'doing';
    t.assignee = dev;
    emit(s, { kind: 'task', holon: 'eng', actor: dev, taskId: t.id, text: `${nameOf(dev)} picks up “${t.title}” (hologram from Marketing)` });
    if (chance(s, 0.4)) {
      const infra = newTask(s, 'eng', dev, 'infra', `Infra for ${t.title.replace('Request: ', '')}`);
      hologram(s, infra, 'platform', 'needs infra');
    }
  }
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'infra' || t.status === 'done') continue;
    if (chance(s, 0.4)) {
      const who = pick(s, ['theo', 'theo', 'kai']);
      complete(s, t, who, 'platform');
    }
  }
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'feature-request' || t.status !== 'doing' || !t.assignee) continue;
    const infraPending = Object.values(s.tasks).some(
      (i) => i.kind === 'infra' && i.status !== 'done' && i.title.endsWith(t.title.replace('Request: ', '')),
    );
    if (infraPending || !chance(s, 0.3)) continue;
    const dev = t.assignee;
    complete(s, t, dev, 'eng');
    bump(s, 'eng', dev, 'feature');
    // Platform people who unblocked it share the feature credit.
    const infra = Object.values(s.tasks).find((i) => i.kind === 'infra' && i.title.endsWith(t.title.replace('Request: ', '')));
    if (infra?.assignee && infra.assignee !== dev) bump(s, 'platform', infra.assignee, 'feature');
    appreciate(s, 'priya', 'mkt', dev, 'eng', `shipped ${t.title.replace('Request: ', '')}`);
    // The release asks Content for a launch post — a hologram the other way.
    const post = newTask(s, 'eng', dev, 'launch-post', `Launch post: ${t.title.replace('Request: ', '')}`);
    hologram(s, post, 'content', 'needs a write-up');
    hologram(s, post, 'mkt', 'campaign material');
  }

  // Writers publish; launch posts get picked up first.
  for (const writer of ['lena', 'omar']) {
    if (!chance(s, writer === 'lena' ? 0.3 : 0.22)) continue;
    const launch = Object.values(s.tasks).find((t) => t.kind === 'launch-post' && t.status !== 'done');
    let title: string;
    if (launch) {
      complete(s, launch, writer, 'content');
      title = launch.title.replace('Launch post: ', 'Introducing ');
    } else {
      title = pick(s, ARTICLES);
    }
    const art = newTask(s, 'content', writer, 'article', title, writer);
    tally(s, 'content', writer).initiated -= 1; // publishing is valued by views, not by opening
    art.status = 'done';
    art.doneDay = s.day;
    art.views = 0;
    emit(s, { kind: 'article', holon: 'content', actor: writer, taskId: art.id, text: `${nameOf(writer)} published “${title}”` });
    bump(s, 'content', 'sasha', 'edit');
  }

  // Readers keep reading: views decay with an article's age.
  let viewsToday = 0;
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'article' || t.views == null || !t.assignee) continue;
    const age = s.day - (t.doneDay ?? s.day);
    const v = Math.round((400 + s.rand() * 900) / (1 + age * 0.5));
    t.views += v;
    bump(s, 'content', t.assignee, 'view', v);
    viewsToday += v;
  }
  if (viewsToday > 0) emit(s, { kind: 'views', holon: 'content', text: `Articles read ${viewsToday.toLocaleString('en')} times today` });

  // Marketing runs campaigns off shipped features; leads come in.
  if (chance(s, 0.2)) {
    const c = newTask(s, 'mkt', 'jonas', 'campaign', `Campaign: ${pick(s, FEATURES)}`, 'jonas');
    complete(s, c, 'jonas', 'mkt');
    const leads = 1 + Math.floor(s.rand() * 6);
    bump(s, 'mkt', 'jonas', 'lead', leads);
    bump(s, 'mkt', 'priya', 'lead', Math.floor(leads / 2));
    emit(s, { kind: 'task', holon: 'mkt', actor: 'jonas', text: `Campaign brought ${leads} leads` });
  }

  // Operations: steady upkeep, split equally by choice.
  if (chance(s, 0.25)) {
    const who = pick(s, ['rosa', 'ben']);
    const op = newTask(s, 'ops', who, 'ops', pick(s, OPS), who);
    complete(s, op, who, 'ops');
  }

  // Cross-circle thanks.
  if (chance(s, 0.12)) appreciate(s, 'ana', 'meridian', pick(s, ['rosa', 'ben']), 'ops', 'smooth operations');
  if (chance(s, 0.1)) appreciate(s, 'mira', 'eng', 'sam', 'meridian', 'clear budget');
  if (chance(s, 0.08)) appreciate(s, 'jonas', 'mkt', 'ana', 'meridian', 'clear strategy');

  // Scheduled deposits.
  for (const d of SCHEDULED_DEPOSITS) {
    const lunationDay = ((s.day - 1) % LUNATION_DAYS) + 1;
    if (d.day === lunationDay) deposit(s, { target: d.target, rail: d.rail, amount: d.amount, from: d.from });
  }

  // New moon: the Pot commits this lunation's rights root.
  if (s.day % LUNATION_DAYS === 0) commitRightsRoot(s);

  return s.events.slice(from);
}

// ── Money ────────────────────────────────────────────────────────────────

export function deposit(
  s: SimState,
  d: { target: string; rail: Rail; amount: number; from?: string; unit?: string },
): Deposit {
  const unit = (d.unit || RAIL_UNIT[d.rail]).toUpperCase();
  const dep: Deposit = { day: s.day, target: d.target, rail: d.rail, unit, amount: d.amount, from: d.from ?? 'You' };
  s.deposits.push(dep);
  if (d.rail === 'pot') {
    const p = (s.potPending[d.target] ??= {});
    p[unit] = (p[unit] ?? 0) + d.amount;
  }
  emit(s, {
    kind: 'deposit',
    holon: d.target,
    rail: d.rail,
    unit,
    amount: d.amount,
    text: `${fmt(d.amount, unit)} arrives at ${nameOf(d.target)} via ${RAIL_LABEL[d.rail]} — from ${dep.from}${
      d.rail === 'pot' ? ' (collectable after the new-moon commit)' : ''
    }`,
  });
  return dep;
}

export function fmt(amount: number, unit: string): string {
  const digits = unit === 'ETH' ? 4 : unit === 'SAT' ? 0 : 2;
  return `${amount.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: unit === 'SAT' ? 0 : Math.min(2, digits) })} ${unit}`;
}

/** Scores per circle, from core. */
export interface CircleScore {
  holon: string;
  equation: ScoreEquation;
  members: Array<{ id: string; name: string; role: string; score: number; percentage: number; tally: Tally }>;
}

export function circleScores(s: SimState, holon: string): CircleScore {
  const spec = holonById(holon)!;
  const ids = PEOPLE.filter((p) => p.circles.includes(holon)).map((p) => p.id);
  const users = ids.map((id) => {
    const t = tally(s, holon, id);
    return { id, username: nameOf(id), initiated: t.initiated, completed: t.completed, sent: t.sent, received: t.received };
  });
  const balances: Record<string, Record<string, number>> = {};
  for (const id of ids) balances[id] = { ...tally(s, holon, id).metrics };
  const scored = calculateAllUserScores(users, spec.equation, balances);
  return {
    holon,
    equation: spec.equation,
    members: scored.map((u) => ({
      id: u.userId,
      name: u.username,
      role: personById(u.userId)?.role ?? '',
      score: u.score,
      percentage: u.percentage,
      tally: tally(s, holon, u.userId),
    })),
  };
}

/** The split inputs of any holon that has one — a circle, or a person's own split. */
export function splitOf(s: SimState, id: string): CascadeInputs | null {
  const spec = holonById(id);
  if (spec && spec.kind !== 'outside') {
    const members: AllocationMember[] = circleScores(s, id).members.map((m) => ({ id: m.id, name: m.name, percentage: m.percentage }));
    return { name: spec.name, config: spec.config, members, zoned: spec.partners };
  }
  const person = personById(id);
  if (person?.split) {
    const keep = person.split.keepPercent;
    return {
      name: person.name,
      // The owner sits in their own contributors share (→ a `kept` leaf);
      // whoever they give to sits on ring 1.
      config: { interiorPercent: keep, steepness: 50, nzones: 1, interiorMode: 'equation' },
      members: [{ id: person.id, name: person.name, percentage: 100 }],
      zoned: person.split.givesTo.map((g) => ({ id: g.id, name: g.name, zone: 1, kind: g.kind })),
    };
  }
  return null;
}

/** Where 100% of what lands on `holon` ends up, by core's cascade. */
export function cascadeFrom(s: SimState, holon: string, total: number | null = null, unit = ''): CascadeResult {
  return resolveCascade({
    holonId: holon,
    total,
    unit,
    root: splitOf(s, holon)!,
    resolveChild: (party) => splitOf(s, party),
    maxDepth: 5,
  });
}

/** Totals deposited per target holon and unit, split by rail kind. */
function potsByTarget(s: SimState): Record<string, { log: Record<string, number>; pot: Record<string, number> }> {
  const out: Record<string, { log: Record<string, number>; pot: Record<string, number> }> = {};
  for (const d of s.deposits) {
    const o = (out[d.target] ??= { log: {}, pot: {} });
    const bucket = d.rail === 'pot' ? o.pot : o.log;
    bucket[d.unit] = (bucket[d.unit] ?? 0) + d.amount;
  }
  return out;
}

export interface PartyBalance {
  id: string;
  name: string;
  kind: 'person' | 'holon';
  /** unit → amounts */
  units: Record<
    string,
    {
      /** Their share of what arrived through Open Collective / ETH / Nostr (core claimCeilings). */
      right: number;
      claimed: number;
      available: number;
      /** Pot units: committed at the new moon, collectable from the Pot. */
      collectable: number;
      collected: number;
      /** Pot units deposited since the last commit — their share, if it were committed now. */
      pending: number;
    }
  >;
}

/**
 * What every party may claim, per unit. For each holon that received money,
 * core cascades it and `claimCeilings` gives each leaf its ceiling; ceilings
 * from several holons add up per party.
 */
export function balances(s: SimState): PartyBalance[] {
  const byParty = new Map<string, PartyBalance>();
  const row = (id: string, label: string, unit: string) => {
    let b = byParty.get(id);
    if (!b) {
      b = { id, name: label, kind: personById(id) ? 'person' : 'holon', units: {} };
      byParty.set(id, b);
    }
    return (b.units[unit] ??= { right: 0, claimed: 0, available: 0, collectable: 0, collected: 0, pending: 0 });
  };

  for (const [target, pots] of Object.entries(potsByTarget(s))) {
    const shares = cascadeRights(cascadeFrom(s, target));
    // Log-claimed units (OC / ETH / Nostr): core ceilings.
    const ceilings = claimCeilings({ shares, pots: pots.log, usage: null, claims: null });
    const labels = new Map<string, string>();
    for (const sl of shares.interior) labels.set(sl.id, sl.label);
    for (const z of shares.exterior) for (const m of z.members ?? []) labels.set(m.id, m.label);
    for (const [party, units] of Object.entries(ceilings)) {
      for (const [unit, ceiling] of Object.entries(units)) row(party, labels.get(party) ?? nameOf(party), unit).right += ceiling;
    }
    // Pot units not yet committed: what each share would be right now.
    const pending = s.potPending[target] ?? {};
    const potCeilings = claimCeilings({ shares, pots: pending, usage: null, claims: null });
    for (const [party, units] of Object.entries(potCeilings)) {
      for (const [unit, v] of Object.entries(units)) row(party, labels.get(party) ?? nameOf(party), unit).pending += v;
    }
  }
  for (const [party, units] of Object.entries(s.collectable)) {
    for (const [unit, v] of Object.entries(units)) row(party, nameOf(party), unit).collectable += v;
  }
  for (const b of byParty.values()) {
    for (const [unit, u] of Object.entries(b.units)) {
      u.claimed = s.claimed[b.id]?.[unit] ?? 0;
      u.collected = s.collected[b.id]?.[unit] ?? 0;
      u.available = Math.max(0, round2(u.right - u.claimed));
      u.right = round2(u.right);
      u.pending = round2(u.pending);
      u.collectable = round2(u.collectable - u.collected);
    }
  }
  return [...byParty.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'person' ? -1 : 1));
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The new moon: Pot deposits of this lunation are divided by the shares as
 * they stand now and frozen into the rights root — from here they are
 * collectable from the Pot in one transfer, whatever scores do next.
 */
export function commitRightsRoot(s: SimState): void {
  let any = false;
  for (const [target, pending] of Object.entries(s.potPending)) {
    if (!Object.values(pending).some((v) => v > 0)) continue;
    const shares = cascadeRights(cascadeFrom(s, target));
    const ceilings = claimCeilings({ shares, pots: pending, usage: null, claims: null });
    for (const [party, units] of Object.entries(ceilings)) {
      for (const [unit, v] of Object.entries(units)) {
        const c = (s.collectable[party] ??= {});
        c[unit] = (c[unit] ?? 0) + v;
      }
    }
    s.potPending[target] = {};
    any = true;
  }
  emit(s, {
    kind: 'commit',
    holon: 'meridian',
    text: any
      ? `New moon — lunation ${s.lunation} rights root committed to the Pot; Pot funds are now collectable`
      : `New moon — lunation ${s.lunation} closes (nothing pending in the Pot)`,
  });
  s.lunation += 1;
}

/** A person claims from their available right (Open Collective / ETH / Nostr). */
export function claim(s: SimState, party: string, unit: string, amount?: number): number {
  const u = balances(s).find((b) => b.id === party)?.units[unit];
  if (!u) return 0;
  const take = round2(Math.min(u.available, amount ?? u.available));
  if (take <= 0) return 0;
  const c = (s.claimed[party] ??= {});
  c[unit] = (c[unit] ?? 0) + take;
  emit(s, { kind: 'claim', holon: party, actor: party, unit, amount: take, text: `${nameOf(party)} claims ${fmt(take, unit)}` });
  return take;
}

/** A person collects their committed Pot right in one transfer. */
export function collect(s: SimState, party: string, unit: string): number {
  const u = balances(s).find((b) => b.id === party)?.units[unit];
  if (!u || u.collectable <= 0) return 0;
  const c = (s.collected[party] ??= {});
  c[unit] = (c[unit] ?? 0) + u.collectable;
  emit(s, { kind: 'collect', holon: party, actor: party, unit, amount: u.collectable, text: `${nameOf(party)} collects ${fmt(u.collectable, unit)} from the Pot` });
  return u.collectable;
}

// ── Flow graph (one per unit) ────────────────────────────────────────────

export interface FlowNode {
  id: string;
  label: string;
  /** source = a rail; holon = divides further; party = where value rests. */
  type: 'source' | 'holon' | 'party';
  color: string;
}
export interface FlowLink {
  source: string;
  target: string;
  value: number;
  /** interior = by the equation; exterior = to a ring partner; kept/retained = stays. */
  via: 'deposit' | 'interior' | 'exterior' | 'kept' | 'retained' | 'cycle';
}
export interface FlowGraph {
  unit: string;
  total: number;
  nodes: FlowNode[];
  links: FlowLink[];
}

const colorOf = (id: string): string => {
  const h = holonById(id);
  if (h) return h.color;
  const p = personById(id);
  return p ? holonById(p.circles[0])?.color ?? '#888' : '#888';
};

/**
 * Every unit's path from the rail it arrived on, through each holon that
 * divides it, to the party it rests with. Node ids: `src:<target>:<rail>`,
 * `h:<id>` for a holon that divides, `p:<id>` for where value rests — so the
 * same person reached by two paths is one node (a diamond, not a loop).
 */
export function flowGraph(s: SimState, unit: string): FlowGraph {
  const nodes = new Map<string, FlowNode>();
  const links = new Map<string, FlowLink>();
  const node = (n: FlowNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
    return n.id;
  };
  const link = (source: string, target: string, value: number, via: FlowLink['via']) => {
    if (!(value > 0)) return;
    const key = `${source}→${target}`;
    const l = links.get(key);
    if (l) l.value += value;
    else links.set(key, { source, target, value, via });
  };

  const walk = (n: CascadeNode, at: string, total: number) => {
    for (const child of n.children) {
      const amount = (child.percentage / 100) * total;
      if (child.reason) {
        const id = node({ id: `p:${child.id}`, label: child.label, type: 'party', color: colorOf(child.id) });
        const via = child.reason === 'kept' || child.reason === 'retained' ? child.reason : child.reason === 'cycle' ? 'cycle' : child.via === 'root' ? 'interior' : child.via;
        link(at, id, amount, via);
      } else {
        const id = node({ id: `h:${child.id}`, label: child.label, type: 'holon', color: colorOf(child.id) });
        link(at, id, amount, child.via === 'root' ? 'interior' : child.via);
        walk(child, id, total);
      }
    }
  };

  let grand = 0;
  const byTarget = new Map<string, Deposit[]>();
  for (const d of s.deposits) if (d.unit === unit) (byTarget.get(d.target) ?? byTarget.set(d.target, []).get(d.target)!).push(d);
  for (const [target, deps] of byTarget) {
    const total = deps.reduce((a, d) => a + d.amount, 0);
    grand += total;
    const cascade = cascadeFrom(s, target);
    const root = node({ id: `h:${target}`, label: nameOf(target), type: 'holon', color: colorOf(target) });
    const byRail = new Map<Rail, number>();
    for (const d of deps) byRail.set(d.rail, (byRail.get(d.rail) ?? 0) + d.amount);
    for (const [rail, amount] of byRail) {
      const src = node({ id: `src:${target}:${rail}`, label: `${RAIL_LABEL[rail]} → ${nameOf(target)}`, type: 'source', color: '#9aa3ad' });
      link(src, root, amount, 'deposit');
    }
    walk(cascade.root, root, total);
  }
  return { unit, total: grand, nodes: [...nodes.values()], links: [...links.values()] };
}

/** Units that have received any money so far. */
export const unitsSeen = (s: SimState): string[] => [...new Set(s.deposits.map((d) => d.unit))];

/** Tasks visible in a holon: its own, plus holograms of other holons' tasks. */
export function tasksIn(s: SimState, holon: string): Array<Task & { hologramOf?: string }> {
  return Object.values(s.tasks)
    .filter((t) => t.holon === holon || t.holograms.includes(holon))
    .map((t) => (t.holon === holon ? t : { ...t, hologramOf: t.holon }));
}
