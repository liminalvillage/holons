// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Asking to join carries the DNA version the person agreed to; the holon
// reads it back from the request and its record, and only links a key on
// its own when that version is the current one.

import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere } from '../holosphere/factory.js';
import { signerFromSecretKey } from '../holosphere/signers.js';
import { putGene, readGenes } from '../dna/genes.js';
import { dnaHash } from '../dna/version.js';
import { DNA_TAG } from '../nostr/groups.js';
import { projectionOptionsFor } from '../nostr/projections.js';
import type { NostrEventLike } from '../nostr/types.js';
import { testKey } from '../protocol/testing.js';
import {
  DnaChanged,
  DnaNotAcknowledged,
  applyToHolon,
  createHolon,
  describeApplicant,
  joinReadiness,
  joinRequestRecords,
  mayLink,
  parseJoinRequest,
  recordJoinRequest,
  settleJoinRequest,
} from './index.js';
import { signJoinRequest } from './testing.js';

const founder = testKey();
const alice = testKey();
const APP = 'holons-apply-test';
const signer = (sk: Uint8Array) => signerFromSecretKey(bytesToHex(sk));

function instance(sk = founder.sk) {
  const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(sk), store: { adapter: 'memory' } });
  const published: NostrEventLike[] = [];
  const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
  h.publishNostrEvents = (e) => published.push(...((Array.isArray(e) ? e : [e]) as NostrEventLike[]));
  h.subscribeNostr = () => () => {};
  return { hs, published };
}

async function holonWithDna() {
  const { hs, published } = instance();
  const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
  await putGene(hs, holon, { kind: 'purpose', title: 'Purpose', blurb: 'Grow food together.' });
  await putGene(hs, holon, { kind: 'values', title: 'Values', alleles: [{ title: 'Care' }] });
  const hash = dnaHash(await readGenes(hs, holon))!;
  published.length = 0;
  return { hs, published, holon, hash };
}

describe('applyToHolon', () => {
  it('signs a 9021 carrying the DNA hash the person agreed to', async () => {
    const { hs, published, holon, hash } = await holonWithDna();
    const ev = await applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: hash, reason: 'Alice', telegramId: 4242 });
    expect(published).toEqual([ev]);
    expect(ev.tags).toContainEqual([DNA_TAG, hash]);
    expect(parseJoinRequest(ev, holon)).toMatchObject({ pubkey: alice.pk, reason: 'Alice', telegramId: '4242', dna: hash });
    // Case does not matter; the hash is stored lowercase.
    const upper = await applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: hash.toUpperCase() });
    expect(parseJoinRequest(upper)!.dna).toBe(hash);
    await hs.close();
  });

  it('refuses a request that agreed to no DNA, or to another version of it', async () => {
    const { hs, published, holon, hash } = await holonWithDna();
    await expect(applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: null })).rejects.toBeInstanceOf(DnaNotAcknowledged);
    await expect(applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: '' })).rejects.toBeInstanceOf(DnaNotAcknowledged);
    // The admin edits a gene: the hash read before no longer counts.
    await putGene(hs, holon, { id: 'values', alleles: [{ title: 'Care' }, { title: 'Courage' }] });
    const err = await applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: hash }).catch((e) => e);
    expect(err).toBeInstanceOf(DnaChanged);
    expect(err).toMatchObject({ holon, acknowledged: hash, current: dnaHash(await readGenes(hs, holon)) });
    expect(published).toEqual([]);
    await hs.close();
  });

  it('a holon without a DNA takes a request that agreed to none, and refuses one claiming a DNA', async () => {
    const { hs } = instance();
    const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP });
    const ev = await applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: null, reason: 'Alice' });
    expect(ev.tags.some((t) => t[0] === DNA_TAG)).toBe(false);
    expect(parseJoinRequest(ev)!.dna).toBeUndefined();
    await expect(applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: 'a'.repeat(64) })).rejects.toBeInstanceOf(DnaChanged);
    // Genes that ask for no agreement (roles, tools) are no DNA to agree to.
    await putGene(hs, holon, { kind: 'tools', title: 'Tools', alleles: [{ title: 'Kiosk' }] });
    await expect(applyToHolon(hs, holon, signer(alice.sk), { appName: APP, acknowledged: null })).resolves.toBeTruthy();
    await hs.close();
  });

  it('a malformed dna tag parses to no agreement', async () => {
    const { hs, holon } = await holonWithDna();
    const ev = signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, dna: 'not-a-hash' });
    expect(parseJoinRequest(ev)!.dna).toBeUndefined();
    await hs.close();
  });
});

describe('joinReadiness and mayLink', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  it.each([
    [{ dna: A }, A, 'acknowledged', true],
    [{ dna: A.toUpperCase() }, A, 'acknowledged', true],
    [{ dna: B }, A, 'outdated', false],
    [{}, A, 'missing', false],
    [{ dna: null }, A, 'missing', false],
    [null, A, 'missing', false],
    [{ dna: A }, null, 'none-required', true],
    [{}, null, 'none-required', true],
    [{}, undefined, 'none-required', true],
  ] as const)('%j against %s → %s', (subject, current, readiness, link) => {
    expect(joinReadiness(subject, current)).toBe(readiness);
    expect(mayLink(subject, current)).toBe(link);
  });

  it('describeApplicant says where the request stands', async () => {
    const { hs, holon, hash } = await holonWithDna();
    const ok = parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice', dna: hash }))!;
    const none = parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice' }))!;
    expect((await describeApplicant(hs, ok)).dna).toBe('acknowledged');
    expect((await describeApplicant(hs, none)).dna).toBe('missing');
    expect((await describeApplicant(hs, ok, { dnaHash: 'c'.repeat(64) })).dna).toBe('outdated');
    await hs.close();
  });
});

describe('the record of a request', () => {
  it('keeps the DNA the request carried; a newer request on a pending record updates it', async () => {
    const { hs, holon, hash } = await holonWithDna();
    const first = parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice', now: () => 1_800_000_000 }))!;
    await recordJoinRequest(hs, holon, first, { messageId: 7, now: () => 1_800_000_001 });
    const rec = (await joinRequestRecords(hs, holon)).get(alice.pk)!;
    expect(rec).toMatchObject({ eventId: first.eventId, asked: 1_800_000_000, messageId: 7 });
    expect(rec.dna).toBeUndefined();
    // Onboarding progress on the record survives a re-ask.
    await hs.put(holon, 'joinrequests', { ...rec, home: alice.pk, step: 'call', confirmed: ['call/call'], blocked: 'dna' });

    const again = parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice B', dna: hash, now: () => 1_800_000_100 }))!;
    const updated = await recordJoinRequest(hs, holon, again, { now: () => 1_800_000_101 });
    expect(updated).toMatchObject({ eventId: again.eventId, dna: hash, asked: 1_800_000_100, at: 1_800_000_101, home: alice.pk, step: 'call', confirmed: ['call/call'], messageId: 7, name: 'Alice', status: 'pending' });
    expect(updated.blocked).toBeUndefined();
    expect((await joinRequestRecords(hs, holon)).get(alice.pk)).toMatchObject({ eventId: again.eventId, dna: hash });

    // An older request (a replay) and the same one change nothing.
    expect(await recordJoinRequest(hs, holon, first, { now: () => 1_800_000_200 })).toMatchObject({ eventId: again.eventId, dna: hash, at: 1_800_000_101 });
    expect(await recordJoinRequest(hs, holon, again, { now: () => 1_800_000_200 })).toMatchObject({ at: 1_800_000_101 });

    // A settled record is a new ask: recorded afresh.
    await settleJoinRequest(hs, holon, alice.pk, 'declined', { now: () => 1_800_000_300 });
    const later = parseJoinRequest(signJoinRequest(hs, holon, signer(alice.sk), { appName: APP, reason: 'Alice', now: () => 1_800_090_000 }))!;
    const fresh = await recordJoinRequest(hs, holon, later, { now: () => 1_800_090_001 });
    expect(fresh).toMatchObject({ eventId: later.eventId, status: 'pending' });
    expect(fresh.home).toBeUndefined();
    expect(fresh.dna).toBeUndefined();
    await hs.close();
  });
});

describe('the group state follows the DNA', () => {
  const about = (e: NostrEventLike | undefined) => e?.tags.find((t) => t[0] === 'about')?.[1];

  it("an admin's gene write republishes the 39000 with the purpose gene as its about", async () => {
    const { hs, published } = instance();
    const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
    await hs.put(holon, 'settings', { ...((await hs.get(holon, 'settings', holon)) as object), id: holon, description: 'A garden', purpose: 'stale' });
    published.length = 0;
    await putGene(hs, holon, { kind: 'purpose', title: 'Purpose', blurb: 'Grow food together.' });
    const meta = published.filter((e) => e.kind === 39000);
    expect(meta).toHaveLength(1);
    expect(about(meta[0])).toBe('Grow food together.');
    expect(meta[0].pubkey).toBe(founder.pk);
    // A gene that changes nothing the state says publishes nothing.
    published.length = 0;
    await putGene(hs, holon, { kind: 'values', title: 'Values', alleles: [{ title: 'Care' }] });
    expect(published.filter((e) => e.kind === 39000)).toEqual([]);
    // The purpose gene gone: the description stands in again.
    await hs.delete(holon, 'genes', 'purpose');
    expect(about(published.filter((e) => e.kind === 39000).at(-1))).toBe('A garden');
    await hs.close();
  });

  it('a settings write after a purpose gene keeps the gene as the about (kiosk/MCP instance, projections on)', async () => {
    // Built like the kiosk and the MCP server build theirs: projections on, no host `about` knowledge.
    const nostr = projectionOptionsFor({ appName: APP, privateKey: bytesToHex(founder.sk) });
    const hs = createHoloSphere({ appName: APP, privateKey: bytesToHex(founder.sk), store: { adapter: 'memory' }, nostr });
    const published: NostrEventLike[] = [];
    const h = hs as unknown as { publishNostrEvents(e: unknown): void; subscribeNostr(): () => void };
    h.publishNostrEvents = (e) => published.push(...((Array.isArray(e) ? e : [e]) as NostrEventLike[]));
    h.subscribeNostr = () => () => {};
    const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
    const settingsOf = async () => (await hs.get(holon, 'settings', holon)) as Record<string, unknown>;
    await hs.put(holon, 'settings', { ...(await settingsOf()), id: holon, description: 'A garden' });
    await putGene(hs, holon, { kind: 'purpose', title: 'Purpose', blurb: 'Grow food together.' });
    const meta = () => published.filter((e) => e.kind === 39000);
    expect(about(meta().at(-1))).toBe('Grow food together.');

    // The settings projection sends no 39000 of its own: it could not know the gene.
    const settingsHook = nostr.projections!.find((p) => p.lens === 'settings')!;
    expect(settingsHook.project(holon, 'settings', { ...(await settingsOf()), name: 'Orto Nuovo' })).toBeNull();

    // A setting the group state does not say (the language) sends nothing.
    published.length = 0;
    await hs.put(holon, 'settings', { ...(await settingsOf()), language: 'it' });
    expect(meta()).toEqual([]);
    // A setting it does say (the name): republished whole, the about still the gene.
    await hs.put(holon, 'settings', { ...(await settingsOf()), name: 'Orto Nuovo' });
    expect(meta()).toHaveLength(1);
    expect(meta()[0].tags).toContainEqual(['name', 'Orto Nuovo']);
    expect(about(meta()[0])).toBe('Grow food together.');
    expect(meta()[0].pubkey).toBe(founder.pk);
    // Another record of the lens is not the holon: nothing.
    published.length = 0;
    await hs.put(holon, 'settings', { id: 'not-the-holon', name: 'x' });
    expect(meta()).toEqual([]);
    await hs.close();
  });

  it("a key that may not seat republishes nothing on a settings write", async () => {
    const { hs, published } = instance();
    const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP, name: 'Orto' });
    await hs.login(bytesToHex(alice.sk));
    published.length = 0;
    await hs.put(holon, 'settings', { ...((await hs.get(holon, 'settings', holon)) as object), id: holon, name: 'Taken over' });
    expect(published.filter((e) => e.kind === 39000)).toEqual([]);
    await hs.close();
  });

  it('a key that may not edit the DNA republishes nothing', async () => {
    const { hs, published } = instance();
    const { holon } = await createHolon(hs, signer(founder.sk), { appName: APP });
    await hs.login(bytesToHex(alice.sk));
    published.length = 0;
    await hs.put(holon, 'genes', { id: 'purpose', kind: 'purpose', title: 'Purpose', blurb: 'Forged', order: 0, ack: 'read', alleles: [], lang: 'en', updated: '' });
    expect(published.filter((e) => e.kind === 39000)).toEqual([]);
    await hs.close();
  });
});
