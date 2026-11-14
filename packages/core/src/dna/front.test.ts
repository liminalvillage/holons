// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { buildEvent } from 'holosphere/nostr-events.js';
import type { HoloSphere } from 'holosphere';
import frontSchema from '../../schemas/holon-front.schema.json' with { type: 'json' };
import { createHoloSphere } from '../holosphere/factory.js';
import { recordJoinRequest } from '../holons/requests.js';
import { addHolonMember, foundHolon } from '../protocol/founding.js';
import { testKey } from '../protocol/testing.js';
import {
  HOLON_FRONT_SCHEMA,
  HolonFrontUnreachable,
  buildHolonFront,
  countWords,
  readHolonFront,
  readingMinutes,
  teaserOf,
  type HolonFront,
  type HolonFrontInput,
} from './front.js';
import { GENES_LENS, putGene, readGenes } from './genes.js';
import { ALLELE_ICONS } from './icons.js';
import { ACK_MODES, GENE_KINDS, type Gene } from './types.js';
import { dnaHash, geneHash } from './version.js';
import { walkSteps } from './walk.js';

// The contract is checked with the real Ajv that holosphere already depends
// on (core has no direct dependency on it): resolved from holosphere's own
// install, so the website's ajv check and this one read the schema alike.
const fromHolosphere = createRequire(createRequire(import.meta.url).resolve('holosphere'));
const Ajv = fromHolosphere('ajv') as new (opts?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & { errors?: unknown[] | null };
};
const validate = new Ajv({ allErrors: true, strict: true }).compile(frontSchema);
const valid = (front: unknown) => {
  const ok = validate(front);
  if (!ok) throw new Error(`holon-front.schema.json rejects it: ${JSON.stringify(validate.errors, null, 2)}`);
  return ok;
};

const gene = (fields: Partial<Gene> & Pick<Gene, 'id'>): Gene => ({
  kind: 'custom',
  title: fields.id,
  blurb: '',
  order: 0,
  ack: 'read',
  alleles: [],
  lang: 'en',
  updated: '',
  ...fields,
});

const HOLON = '-1001234567890';

// A DNA shaped like the website's: a frameworks gene owns the cards with
// their detail, two others show them by ref.
const purpose = gene({
  id: 'purpose',
  kind: 'purpose',
  title: 'Purpose',
  blurb: 'A village that learns to live well together.',
  color: '#2a9d8f',
  order: 0,
  ack: 'read',
  links: [{ label: 'Manifesto', href: 'https://example.org/manifesto', icon: 'scroll' }],
  updated: '2026-11-01T10:00:00.000Z',
});
const frameworks = gene({
  id: 'frameworks',
  kind: 'practices',
  title: 'Frameworks',
  blurb: 'The ways we work.',
  order: 1,
  ack: 'agree',
  alleles: [
    {
      id: 'sociocracy',
      title: 'Sociocracy',
      kicker: 'Governance',
      body: 'Consent decisions in circles.',
      icon: 'compass',
      detail: { body: 'Circles decide by consent.', steps: ['Propose', 'Object', 'Consent'], links: [{ label: 'Guide', href: 'https://example.org/s3' }], image: { src: 'https://example.org/s.png', alt: 'Circles' } },
    },
    { id: 'nvc', title: 'Nonviolent communication', body: 'Needs before strategies.' },
  ],
  updated: '2026-11-03T08:00:00.000Z',
});
const values = gene({
  id: 'values',
  kind: 'values',
  title: 'Values',
  blurb: 'What we hold on to.',
  order: 2,
  ack: 'agree',
  alleles: [
    { id: 'care', title: 'Care', body: 'We look after each other.', link: { label: 'More', href: '/care' } },
    { id: 'how-we-decide', title: '', ref: 'frameworks/sociocracy' },
  ],
  updated: '2026-11-02T12:00:00.000Z',
});
const agreements = gene({
  id: 'agreements',
  kind: 'agreements',
  title: 'Agreements',
  blurb: 'What we promise.',
  order: 3,
  ack: 'agree',
  alleles: [
    { id: 'decide', title: '', ref: 'frameworks/sociocracy' },
    { id: 'talk', title: '', ref: 'frameworks/nvc' },
  ],
});
const tools = gene({ id: 'tools', kind: 'tools', title: 'Tools', blurb: 'What we use.', order: 4, ack: 'none', alleles: [{ id: 'kiosk', title: 'Kiosk', icon: 'chip' }] });
const roles = gene({ id: 'roles', kind: 'roles', title: 'Roles', blurb: 'Coming soon.', order: 5, ack: 'none' });
const terms = gene({
  id: 'terms',
  kind: 'terms',
  title: 'Terms',
  blurb: 'Money and time.',
  order: 6,
  ack: 'agree',
  alleles: [
    { id: 'stay', title: 'Staying', body: 'A night costs ten euros, shared meals included.' },
    { id: 'leave', title: 'Leaving', body: 'Tell us a week before you go.' },
  ],
});
const ALL = [purpose, frameworks, values, agreements, tools, roles, terms];

const onboarding = {
  enabled: true,
  steps: [
    { id: 'profile', title: 'Your profile', cards: [{ id: 'profile', title: 'Fill in your profile', confirm: 'profile' }] },
    { id: 'call', title: 'Onboarding call', cards: [{ id: 'call', title: 'Have your call', confirm: 'admin' }] },
  ],
};

const full = (over: Partial<HolonFrontInput> = {}): HolonFront =>
  buildHolonFront({
    holon: HOLON,
    settings: { id: HOLON, name: 'Orto Village', description: 'An ecovillage.', picture: 'https://example.org/l.png', color: '#123456', onboarding },
    genes: [...ALL].reverse(),
    members: 42,
    ...over,
  });

describe('buildHolonFront: an empty holon', () => {
  const front = buildHolonFront({ holon: HOLON, settings: { id: HOLON, name: 'Casa', description: 'A house in the hills.' }, genes: [] });

  it('is the hero alone, with the description as its about', () => {
    expect(front).toMatchObject({
      schema: 1,
      holon: HOLON,
      name: 'Casa',
      about: 'A house in the hills.',
      teaser: 'A house in the hills.',
      empty: true,
      genes: [],
      dna: { hash: null, short: null, updated: null },
      counts: { genes: 0, alleles: 0, parts: 0, words: 0, minutes: 0 },
      walk: [],
      after: [],
      members: 0,
      telegram: true,
      viewer: { cta: 'apply', edit: false },
    });
  });

  it('has no reading step in how joining works', () => {
    expect(front.how).toEqual([{ kind: 'send' }, { kind: 'linked' }]);
  });

  it('validates against the schema', () => {
    expect(valid(front)).toBe(true);
  });

  it('copes with nothing read at all', () => {
    const bare = buildHolonFront({ holon: 'holon_abcdefabcdefabcd', genes: [] });
    expect(bare).toMatchObject({ name: 'holon_abcdefabcdefabcd', about: '', teaser: '', telegram: false, members: 0 });
    expect(bare.color).toBeUndefined();
    expect(bare.picture).toBeUndefined();
    expect(valid(bare)).toBe(true);
  });
});

describe('buildHolonFront: the hero', () => {
  it('takes about from the purpose gene, before the description', () => {
    expect(full().about).toBe(purpose.blurb);
  });

  it('falls back to the description when the purpose gene has no blurb, or there is none', () => {
    expect(full({ genes: [{ ...purpose, blurb: '' }, values] }).about).toBe('An ecovillage.');
    expect(full({ genes: [values] }).about).toBe('An ecovillage.');
  });

  it('cuts a long about into a teaser at a word', () => {
    const long = `${'Living well together '.repeat(20)}ends here.`;
    const front = full({ genes: [{ ...purpose, blurb: long }] });
    expect(front.about).toBe(long);
    expect([...front.teaser].length).toBeLessThanOrEqual(280);
    expect(front.teaser.endsWith('together…')).toBe(true);
  });

  it('names the holon, else by its short id', () => {
    expect(full().name).toBe('Orto Village');
    expect(full({ settings: { name: 'unknown' } }).name).toBe(HOLON);
    expect(full({ settings: { name: `Holon ${HOLON}` } }).name).toBe(HOLON);
  });

  it('colours the band with the purpose gene, else the holon colour', () => {
    expect(full().color).toBe('#2a9d8f');
    expect(full({ genes: [values] }).color).toBe('#123456');
    expect(full({ genes: [values], settings: {} }).color).toBeUndefined();
  });

  it('shows only an http(s) picture', () => {
    expect(full().picture).toBe('https://example.org/l.png');
    expect(full({ settings: { picture: 'javascript:alert(1)' } }).picture).toBeUndefined();
  });

  it('counts members and knows a Telegram-born holon', () => {
    expect(full().members).toBe(42);
    expect(full({ members: -3 }).members).toBe(0);
    expect(full().telegram).toBe(true);
    expect(full({ holon: 'holon_abcdefabcdefabcd' }).telegram).toBe(false);
  });
});

describe('buildHolonFront: the genes', () => {
  const front = full();
  const byId = (id: string) => front.genes.find((g) => g.id === id)!;

  it('come in front-page order, normalized, whatever order they were read in', () => {
    expect(front.genes.map((g) => g.id)).toEqual(['purpose', 'frameworks', 'values', 'agreements', 'tools', 'roles', 'terms']);
    const raw = full({ genes: [{ ...values, _clock: { title: 3 }, _verified: true }, purpose, purpose] });
    expect(raw.genes.map((g) => g.id)).toEqual(['purpose', 'values']);
    expect(raw.genes[1]).not.toHaveProperty('_clock');
  });

  it('carry the hash of the gene as stored, refs and all', () => {
    for (const g of ALL) expect(byId(g.id).hash).toBe(geneHash(g));
  });

  it('show a ref as the card it names, saying where it lives', () => {
    const shown = byId('values').alleles.find((a) => a.id === 'how-we-decide')!;
    expect(shown).toEqual({
      id: 'how-we-decide',
      ref: 'frameworks/sociocracy',
      title: 'Sociocracy',
      kicker: 'Governance',
      body: 'Consent decisions in circles.',
      icon: 'compass',
      detail: frameworks.alleles[0].detail,
      from: { gene: 'frameworks', title: 'Frameworks' },
      expressedIn: [],
    });
  });

  it('list on each origin card the genes expressing it, in front-page order', () => {
    const [sociocracy, nvc] = byId('frameworks').alleles;
    expect(sociocracy.expressedIn).toEqual([
      { gene: 'values', title: 'Values' },
      { gene: 'agreements', title: 'Agreements' },
    ]);
    expect(nvc.expressedIn).toEqual([{ gene: 'agreements', title: 'Agreements' }]);
    expect(byId('frameworks').expressedIn).toEqual([
      { gene: 'values', title: 'Values' },
      { gene: 'agreements', title: 'Agreements' },
    ]);
    expect(byId('values').alleles[0].expressedIn).toEqual([]);
    expect(byId('values').expressedIn).toEqual([]);
  });

  it('drop a ref that names nothing, or another ref', () => {
    const broken = gene({ id: 'broken', title: 'Broken', order: 9, alleles: [{ id: 'x', title: '', ref: 'nowhere/x' }, { id: 'y', title: '', ref: 'values/how-we-decide' }, { id: 'z', title: 'Kept' }] });
    const g = full({ genes: [...ALL, broken] }).genes.find((x) => x.id === 'broken')!;
    expect(g.alleles.map((a) => a.id)).toEqual(['z']);
    expect(g.hash).toBe(geneHash(broken));
  });

  it('lay terms out as long-form text, a gene without alleles as its blurb, the rest as cards', () => {
    expect(byId('terms').layout).toBe('longform');
    expect(byId('roles').layout).toBe('blurb');
    expect(byId('values').layout).toBe('cards');
    expect(full({ genes: [{ ...terms, alleles: [] }] }).genes[0].layout).toBe('blurb');
  });

  it('count the words a reader reads in each', () => {
    // title + blurb + Care card (title, body); the ref card counts what it shows, detail included.
    const care = countWords('Care', 'We look after each other.');
    const sociocracy = countWords('Sociocracy', 'Governance', 'Consent decisions in circles.', 'Circles decide by consent.', 'Propose', 'Object', 'Consent');
    expect(byId('values').words).toBe(countWords('Values', 'What we hold on to.') + care + sociocracy);
  });
});

describe('buildHolonFront: the walk, how joining works and the footer', () => {
  const front = full();

  it('walks the genes that ask for an acknowledgement', () => {
    expect(front.walk).toEqual(walkSteps(ALL));
    expect(front.walk.map((s) => s.gene)).toEqual(['purpose', 'frameworks', 'values', 'agreements', 'terms']);
  });

  it('counts parts, words and minutes over the walk only', () => {
    const walked = front.genes.filter((g) => g.ack !== 'none');
    const words = walked.reduce((n, g) => n + g.words, 0);
    expect(front.counts).toEqual({ genes: 7, alleles: 9, parts: 5, words, minutes: readingMinutes(words) });
    expect(words).toBeLessThan(front.genes.reduce((n, g) => n + g.words, 0));
  });

  it('estimates minutes at 200 words a minute, rounded up', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(1)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    const essay = gene({ id: 'essay', kind: 'purpose', title: 'Why', blurb: '', alleles: [{ id: 'a', title: 'A', body: Array(449).fill('word').join(' ') }] });
    expect(full({ genes: [essay] }).counts).toMatchObject({ parts: 1, words: 451, minutes: 3 });
  });

  it('takes the steps after the request from the onboarding config', () => {
    expect(front.after).toEqual([
      { id: 'profile', title: 'Your profile' },
      { id: 'call', title: 'Onboarding call' },
    ]);
    expect(front.how).toEqual([
      { kind: 'read', parts: 5, minutes: front.counts.minutes },
      { kind: 'send' },
      { kind: 'step', id: 'profile', title: 'Your profile' },
      { kind: 'step', id: 'call', title: 'Onboarding call' },
      { kind: 'linked' },
    ]);
  });

  it('has no steps after the request while the onboarding is off', () => {
    expect(full({ onboarding: { ...onboarding, enabled: false } }).after).toEqual([]);
    expect(full({ settings: { name: 'X' } }).after).toEqual([]);
  });

  it('prefers an onboarding config handed in over the one in the settings', () => {
    const own = { enabled: true, steps: [{ id: 'walk', title: 'Walk the land', cards: [{ title: 'Walk', confirm: 'self' }] }] };
    expect(full({ onboarding: own }).after).toEqual([{ id: 'walk', title: 'Walk the land' }]);
  });

  it('names the DNA in the footer: hash, short hash, last update', () => {
    const hash = dnaHash(ALL)!;
    expect(front.dna).toEqual({ hash, short: hash.slice(0, 8), updated: '2026-11-03T08:00:00.000Z' });
  });

  it('has no DNA hash when no gene asks for an acknowledgement', () => {
    const quiet = full({ genes: [tools, roles] });
    expect(quiet.dna.hash).toBeNull();
    expect(quiet.walk).toEqual([]);
    expect(quiet.how[0]).toEqual({ kind: 'send' });
    expect(quiet.empty).toBe(false);
  });
});

describe('buildHolonFront: the viewer', () => {
  const cta = (viewer: HolonFrontInput['viewer'], anchored?: boolean) => full({ viewer, anchored }).viewer;

  it('picks the call to action by where the person stands', () => {
    expect(cta(null)).toEqual({ cta: 'apply', edit: false });
    expect(cta({})).toEqual({ cta: 'apply', edit: false });
    expect(cta({ request: 'pending' })).toEqual({ cta: 'continue', edit: false });
    expect(cta({ request: 'blocked' })).toEqual({ cta: 'review', edit: false });
    expect(cta({ linked: true, request: 'pending' })).toEqual({ cta: 'linked', edit: false });
    expect(cta({ linked: true, admin: true })).toEqual({ cta: 'linked', edit: true });
  });

  it('offers no ask where nobody could answer it', () => {
    expect(cta(null, false)).toEqual({ cta: 'none', edit: false });
    expect(cta({ request: 'pending' }, false).cta).toBe('continue');
  });
});

describe('teaserOf and countWords', () => {
  it('leaves a short text alone and cuts a long one at a word', () => {
    expect(teaserOf('short')).toBe('short');
    expect(teaserOf('aaa bbb ccc ddd', 10)).toBe('aaa bbb…');
    expect(teaserOf('x'.repeat(20), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('counts tokens with a letter or digit', () => {
    expect(countWords('Hello, world — 2 times', undefined, null, '')).toBe(4);
    expect(countWords('Perché è così')).toBe(3);
  });
});

describe('holon-front.schema.json', () => {
  it('names the same kinds, acks and icons as core', () => {
    const defs = frontSchema.definitions;
    expect(defs.gene.properties.kind.enum).toEqual([...GENE_KINDS]);
    expect(defs.walkStep.properties.kind.enum).toEqual([...GENE_KINDS]);
    expect(defs.gene.properties.ack.enum).toEqual([...ACK_MODES]);
    expect(defs.icon.enum).toEqual([...ALLELE_ICONS]);
    expect(frontSchema.properties.schema.const).toBe(HOLON_FRONT_SCHEMA);
  });

  it('accepts every front built here', () => {
    expect(valid(full())).toBe(true);
    expect(valid(full({ viewer: { linked: true, admin: true }, anchored: false }))).toBe(true);
  });

  it('refuses what a reader must not take for a front', () => {
    const front = JSON.parse(JSON.stringify(full()));
    expect(validate({ ...front, schema: 2 })).toBe(false);
    expect(validate({ ...front, surprise: true })).toBe(false);
    const { genes: _g, ...noGenes } = front;
    expect(validate(noGenes)).toBe(false);
    expect(validate({ ...front, dna: { ...front.dna, hash: 'not-a-hash' } })).toBe(false);
    expect(validate({ ...front, how: [{ kind: 'dance' }] })).toBe(false);
  });

  // The committed examples are what the website (and anyone else reading
  // /api/front) can test against without running core.
  it('matches the committed examples, which validate', async () => {
    const examples: Record<string, HolonFront> = {
      full: full(),
      empty: buildHolonFront({ holon: 'holon_abcdefabcdefabcd', settings: { name: 'Casa', description: 'A house in the hills.' }, genes: [] }),
    };
    for (const [name, front] of Object.entries(examples)) {
      expect(valid(front)).toBe(true);
      await expect(`${JSON.stringify(front, null, 2)}\n`).toMatchFileSnapshot(`../../schemas/examples/holon-front.${name}.json`);
    }
  });
});

// ── readHolonFront ─────────────────────────────────────────────────────────

const founder = testKey();
const member = testKey();

function instance(opts: { enforce?: boolean } = {}) {
  const hs = createHoloSphere({ appName: 'front-test', privateKey: bytesToHex(founder.sk), store: { adapter: 'memory' }, ...opts });
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

describe('readHolonFront', () => {
  const H = 'holon_frontfrontfront1';

  async function founded() {
    const hs = instance();
    await foundHolon(hs, H, { name: 'Front Holon' });
    await addHolonMember(hs, H, member.pk, 'member');
    const settings = (await hs.get(H, 'settings', H)) as Record<string, unknown>;
    await hs.put(H, 'settings', { ...settings, description: 'A test holon.', onboarding });
    await putGene(hs, H, { ...values, alleles: [values.alleles[0]] }, { now: () => new Date('2026-11-10T00:00:00Z') });
    await putGene(hs, H, purpose, { now: () => new Date('2026-11-11T00:00:00Z') });
    return hs;
  }

  it('gathers genes, settings, onboarding and members into the front', async () => {
    const hs = await founded();
    const front = await readHolonFront(hs, H);
    expect(front).toMatchObject({
      holon: H,
      name: 'Front Holon',
      about: purpose.blurb,
      members: 2,
      telegram: false,
      after: [
        { id: 'profile', title: 'Your profile' },
        { id: 'call', title: 'Onboarding call' },
      ],
      dna: { updated: '2026-11-11T00:00:00.000Z' },
      viewer: { cta: 'apply', edit: false },
    });
    expect(front.genes.map((g) => g.id)).toEqual(['purpose', 'values']);
    expect(valid(front)).toBe(true);
    await hs.close();
  });

  it('picks the call to action for a named viewer', async () => {
    const hs = await founded();
    // A seat counts from its own second on; the member's was signed just after the genesis.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    expect((await readHolonFront(hs, H, { viewer: founder.pk })).viewer).toEqual({ cta: 'linked', edit: true });
    expect((await readHolonFront(hs, H, { viewer: member.pk })).viewer).toEqual({ cta: 'linked', edit: false });
    const asker = testKey();
    expect((await readHolonFront(hs, H, { viewer: asker.pk })).viewer).toEqual({ cta: 'apply', edit: false });
    // In, but agreed to no DNA: review it; agreed to the current one: continue.
    await recordJoinRequest(hs, H, { pubkey: asker.pk, at: 1, reason: 'Ada', eventId: 'e'.repeat(64), holon: H });
    expect((await readHolonFront(hs, H, { viewer: asker.pk })).viewer).toEqual({ cta: 'review', edit: false });
    const hash = dnaHash(await readGenes(hs, H))!;
    await recordJoinRequest(hs, H, { pubkey: asker.pk, at: 2, reason: 'Ada', eventId: 'f'.repeat(64), holon: H, dna: hash });
    expect((await readHolonFront(hs, H, { viewer: asker.pk })).viewer).toEqual({ cta: 'continue', edit: false });
    expect((await readHolonFront(hs, H)).viewer).toEqual({ cta: 'apply', edit: false });
    vi.useRealTimers();
    await hs.close();
  });

  it('shows a gene only from an admin: a member-signed gene never reaches the front', async () => {
    const hs = await founded();
    const store = (hs as unknown as { store: { apply(e: unknown, o: unknown): void } }).store;
    const forged = { ...terms, alleles: [{ id: 'free', title: 'Free', body: 'Everyone is in.' }], updated: '2026-11-12T00:00:00.000Z' };
    const evt = buildEvent({ holon: H, lens: GENES_LENS, item: forged, sk: member.sk, created_at: Math.floor(Date.now() / 1000) + 5, extraTags: [['n', 'front-test']] });
    store.apply(evt, { origin: 'remote' });
    const front = await readHolonFront(hs, H);
    expect(front.genes.map((g) => g.id)).toEqual(['purpose', 'values']);
    await hs.close();
  });

  it('shows no gene of a holon nobody speaks for: a stranger-signed gene is not its DNA', async () => {
    const hs = instance();
    const nobody = '-1009999999999';
    const store = (hs as unknown as { store: { apply(e: unknown, o: unknown): void } }).store;
    const forged = { ...terms, alleles: [{ id: 'free', title: 'Free', body: 'FORGED BY STRANGER' }], updated: '2026-11-12T00:00:00.000Z' };
    store.apply(buildEvent({ holon: nobody, lens: GENES_LENS, item: forged, sk: testKey().sk, created_at: Math.floor(Date.now() / 1000), extraTags: [['n', 'front-test']] }), { origin: 'remote' });
    const front = await readHolonFront(hs, nobody);
    expect(front).toMatchObject({ empty: true, genes: [], viewer: { cta: 'none' } });
    expect(JSON.stringify(front)).not.toContain('FORGED BY STRANGER');
    await hs.close();
  });

  it('refuses an instance that does not enforce reads', async () => {
    const hs = instance({ enforce: false });
    await expect(readHolonFront(hs, H)).rejects.toThrow(/enforces reads/);
    await hs.close();
  });

  it('gives up after the catch-up bound', async () => {
    const never = new Promise<never>(() => {});
    const stuck = { enforceActive: true, signingEnabled: true, getAll: () => never, get: () => never, getMembers: () => never, _relaySync: () => never } as unknown as HoloSphere;
    await expect(readHolonFront(stuck, H, { catchUpMs: 20 })).rejects.toBeInstanceOf(HolonFrontUnreachable);
  });
});
