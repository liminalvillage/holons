// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import type { Gene } from './types.js';
import { dnaHash, geneHash } from './version.js';
import { acknowledgeStep, emptyWalkState, normalizeWalkState, unacknowledgeStep, walkProgress, walkSteps, type WalkState } from './walk.js';

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

const purpose = gene({ id: 'purpose', kind: 'purpose', title: 'Purpose', blurb: 'Why we are here.', order: 0, ack: 'read' });
const values = gene({ id: 'values', kind: 'values', title: 'Values', order: 1, ack: 'agree', alleles: [{ id: 'care', title: 'Care' }] });
const tools = gene({ id: 'tools', kind: 'tools', title: 'Tools', order: 2, ack: 'none' });
const terms = gene({ id: 'terms', kind: 'terms', title: 'Terms', order: 3, ack: 'agree', alleles: [{ id: 'rent', title: 'Rent', body: '10 a night.' }] });
const genes = [terms, tools, values, purpose];

describe('walkSteps', () => {
  it('is the genes that ask for an acknowledgement, in front-page order', () => {
    const steps = walkSteps(genes);
    expect(steps.map((s) => s.gene)).toEqual(['purpose', 'values', 'terms']);
    expect(steps[1]).toEqual({ gene: 'values', hash: geneHash(values), kind: 'values', title: 'Values', ack: 'agree' });
  });

  it('does not reorder its input', () => {
    const input = [terms, purpose];
    walkSteps(input);
    expect(input.map((g) => g.id)).toEqual(['terms', 'purpose']);
  });

  it('is empty when no gene asks for one', () => {
    expect(walkSteps([tools])).toEqual([]);
    expect(walkSteps([])).toEqual([]);
  });
});

describe('walkProgress', () => {
  const steps = walkSteps(genes);
  const hash = dnaHash(genes);
  const walkAll = (s: WalkState = emptyWalkState()) => steps.reduce(acknowledgeStep, s);

  it('starts on the first step', () => {
    expect(walkProgress(steps, emptyWalkState(), hash)).toEqual({ current: 'purpose', done: [], stale: [], complete: false, hash: null });
    expect(walkProgress(steps, null, hash).current).toBe('purpose');
  });

  it('moves to the first step not done, whatever order the steps were acknowledged in', () => {
    const state = acknowledgeStep(acknowledgeStep(emptyWalkState(), steps[2]), steps[0]);
    expect(walkProgress(steps, state, hash)).toEqual({ current: 'values', done: ['purpose', 'terms'], stale: [], complete: false, hash: null });
  });

  it('hands back the DNA hash only once every step is done', () => {
    const state = walkAll();
    expect(walkProgress(steps, state, hash)).toEqual({ current: null, done: ['purpose', 'values', 'terms'], stale: [], complete: true, hash });
    expect(walkProgress(steps, unacknowledgeStep(state, steps[1]), hash)).toMatchObject({ current: 'values', complete: false, hash: null });
  });

  it('marks a gene edited since it was acknowledged as stale, per gene hash', () => {
    const state = walkAll();
    const edited = { ...values, alleles: [{ id: 'care', title: 'Care', body: 'Now with a body.' }] };
    const now = [purpose, edited, tools, terms];
    const progress = walkProgress(walkSteps(now), state, dnaHash(now));
    expect(progress).toEqual({ current: 'values', done: ['purpose', 'terms'], stale: ['values'], complete: false, hash: null });
  });

  it('is not made stale by what the hash leaves out (order, colour, icons)', () => {
    const state = walkAll();
    const restyled = [{ ...purpose, order: 9, color: '#123456' }, values, tools, terms];
    expect(walkProgress(walkSteps(restyled), state, dnaHash(restyled))).toMatchObject({ complete: true, stale: [], hash });
  });

  it('a stale step done again is done', () => {
    const edited = { ...terms, blurb: 'Read again.' };
    const now = [purpose, values, edited];
    const nowSteps = walkSteps(now);
    const state = acknowledgeStep(walkAll(), nowSteps[2]);
    expect(walkProgress(nowSteps, state, dnaHash(now))).toEqual({ current: null, done: ['purpose', 'values', 'terms'], stale: [], complete: true, hash: dnaHash(now) });
  });

  it('is complete at once, with no hash, when nothing asks for an acknowledgement', () => {
    expect(walkProgress([], emptyWalkState(), null)).toEqual({ current: null, done: [], stale: [], complete: true, hash: null });
  });

  it('ignores acknowledgements of genes the walk no longer has', () => {
    const state = acknowledgeStep(walkAll(), { gene: 'gone', hash: 'a'.repeat(64) });
    expect(walkProgress(steps, state, hash)).toMatchObject({ complete: true, stale: [] });
  });
});

describe('walk state', () => {
  it('acknowledging returns a new state', () => {
    const s = emptyWalkState();
    const next = acknowledgeStep(s, { gene: 'values', hash: 'b'.repeat(64) });
    expect(s.acks).toEqual({});
    expect(next.acks).toEqual({ values: 'b'.repeat(64) });
    expect(unacknowledgeStep(next, { gene: 'values' }).acks).toEqual({});
  });

  it('normalizes what a device kept, dropping what is not a gene hash', () => {
    expect(normalizeWalkState(null)).toEqual({ acks: {} });
    expect(normalizeWalkState('junk')).toEqual({ acks: {} });
    expect(normalizeWalkState({ acks: [] })).toEqual({ acks: {} });
    expect(normalizeWalkState({ acks: { values: 'c'.repeat(64), terms: 'nope', tools: 7 } })).toEqual({ acks: { values: 'c'.repeat(64) } });
  });
});
