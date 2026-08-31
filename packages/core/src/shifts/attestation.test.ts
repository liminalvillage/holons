// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import {
  IDENTITY_ATTESTATION_KIND,
  attestationFilter,
  attestationNameMap,
  buildAttestationTemplate,
  coordinatorDirectoryFilter,
  createShiftRelayClient,
  parseIdentifier,
  parseIdentityAttestation,
  resolveAttestations,
  telegramIdentifier,
  type IdentityAttestation,
  type NostrEventLike,
  type ShiftPoolLike,
} from './index.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const COORD = 'c'.repeat(64);
const PROVIDER = 'd'.repeat(64);

function attestationEvent(over: Partial<NostrEventLike> = {}): NostrEventLike {
  return {
    kind: IDENTITY_ATTESTATION_KIND,
    pubkey: PROVIDER,
    created_at: 100,
    id: 'att1',
    content: JSON.stringify({ name: 'Alice' }),
    tags: [
      ['d', 'telegram:123'],
      ['p', PK_A],
    ],
    ...over,
  };
}

describe('identifiers', () => {
  it('round-trips the telegram grammar', () => {
    expect(telegramIdentifier(123)).toBe('telegram:123');
    expect(parseIdentifier('telegram:123')).toEqual({ platform: 'telegram', id: '123' });
  });

  it('rejects malformed identifiers', () => {
    expect(parseIdentifier('telegram')).toBeNull();
    expect(parseIdentifier(':123')).toBeNull();
    expect(parseIdentifier('telegram:')).toBeNull();
  });
});

describe('parseIdentityAttestation', () => {
  it('parses a spec-shaped event', () => {
    const a = parseIdentityAttestation(
      attestationEvent({ tags: [['d', 'telegram:123'], ['p', PK_B.toUpperCase()], ['p', PK_A], ['p', PK_B]] }),
    );
    expect(a).toMatchObject({
      provider: PROVIDER,
      identifier: 'telegram:123',
      platform: 'telegram',
      platformId: '123',
      pubkeys: [PK_A, PK_B], // deduped, lowercased, sorted
      name: 'Alice',
      createdAt: 100,
      id: 'att1',
    });
  });

  it('tolerates an empty content object and drops junk p tags', () => {
    const a = parseIdentityAttestation(attestationEvent({ content: '{}', tags: [['d', 'telegram:1'], ['p', PK_A], ['p', 'nothex']] }));
    expect(a?.name).toBeUndefined();
    expect(a?.pubkeys).toEqual([PK_A]);
  });

  it('rejects wrong kind, missing/malformed d, broken JSON', () => {
    expect(parseIdentityAttestation(attestationEvent({ kind: 31925 }))).toBeNull();
    expect(parseIdentityAttestation(attestationEvent({ tags: [['p', PK_A]] }))).toBeNull();
    expect(parseIdentityAttestation(attestationEvent({ tags: [['d', 'telegram'], ['p', PK_A]] }))).toBeNull();
    expect(parseIdentityAttestation(attestationEvent({ content: '{broken' }))).toBeNull();
  });
});

describe('buildAttestationTemplate', () => {
  it('emits the spec shape with deduped sorted keys', () => {
    const t = buildAttestationTemplate({ telegramId: 123, pubkeys: [PK_B, PK_A, PK_A.toUpperCase()], name: ' Alice ', now: 42 });
    expect(t).toEqual({
      kind: IDENTITY_ATTESTATION_KIND,
      created_at: 42,
      tags: [['d', 'telegram:123'], ['p', PK_A], ['p', PK_B]],
      content: '{"name":"Alice"}',
    });
    expect(buildAttestationTemplate({ telegramId: 1, pubkeys: [PK_A], now: 1 }).content).toBe('{}');
  });

  it('refuses empty or malformed key sets', () => {
    expect(() => buildAttestationTemplate({ telegramId: 1, pubkeys: [] })).toThrow();
    expect(() => buildAttestationTemplate({ telegramId: 1, pubkeys: ['nope'] })).toThrow();
  });

  it('round-trips through the parser once signed', () => {
    const sk = generateSecretKey();
    const event = finalizeEvent(buildAttestationTemplate({ telegramId: 9, pubkeys: [PK_A], name: 'Bo', now: 7 }), sk);
    expect(verifyEvent(event)).toBe(true);
    expect(parseIdentityAttestation(event)).toMatchObject({
      provider: getPublicKey(sk),
      identifier: 'telegram:9',
      pubkeys: [PK_A],
      name: 'Bo',
    });
  });
});

describe('resolveAttestations', () => {
  const att = (over: Partial<IdentityAttestation>): IdentityAttestation => ({
    provider: PROVIDER,
    identifier: 'telegram:123',
    platform: 'telegram',
    platformId: '123',
    pubkeys: [PK_A],
    createdAt: 100,
    id: 'x',
    ...over,
  });

  it('keeps the newest per (provider, identifier), smaller id on ties', () => {
    const winners = resolveAttestations([
      att({ createdAt: 100, id: 'old' }),
      att({ createdAt: 200, id: 'new' }),
      att({ createdAt: 200, id: 'aaa' }),
      att({ provider: COORD, createdAt: 50, id: 'coord' }),
      att({ identifier: 'telegram:9', platformId: '9', id: 'other-user' }),
    ]);
    expect(winners.size).toBe(3);
    expect(winners.get(`${PROVIDER} telegram:123`)?.id).toBe('aaa');
    expect(winners.get(`${COORD} telegram:123`)?.id).toBe('coord');
  });

  it('ranks the coordinator over other providers in the name map', () => {
    const names = attestationNameMap(
      [
        att({ provider: PROVIDER, name: 'From provider', createdAt: 999 }),
        att({ provider: COORD, name: 'From Elinor', createdAt: 1 }),
        att({ provider: 'e'.repeat(64), pubkeys: [PK_B], name: 'Bob', createdAt: 5 }),
      ],
      { coordinatorPubkey: COORD },
    );
    expect(names.get(PK_A)).toBe('From Elinor');
    expect(names.get(PK_B)).toBe('Bob');
  });

  it('skips blacklisted providers and nameless attestations', () => {
    const names = attestationNameMap(
      [att({ provider: PROVIDER, name: 'Spoofed' }), att({ provider: COORD, pubkeys: [PK_B] })],
      { blockedProviders: [PROVIDER] },
    );
    expect(names.size).toBe(0);
  });
});

describe('filters', () => {
  it('builds the REQ shapes', () => {
    expect(attestationFilter({ participants: [PK_A], identifiers: ['telegram:1'] })).toEqual({
      kinds: [IDENTITY_ATTESTATION_KIND],
      '#p': [PK_A],
      '#d': ['telegram:1'],
    });
    expect(coordinatorDirectoryFilter(COORD)).toEqual({ kinds: [IDENTITY_ATTESTATION_KIND], authors: [COORD] });
    expect(() => attestationFilter({})).toThrow();
  });
});

describe('fetchAttestations', () => {
  it('parses, resolves and re-filters against an injected pool', async () => {
    const store: NostrEventLike[] = [
      attestationEvent({ id: 'old', created_at: 10, content: '{"name":"Old"}' }),
      attestationEvent({ id: 'new', created_at: 20 }),
      // A relay that ignores `#p` might return this unrelated attestation:
      attestationEvent({ id: 'stranger', tags: [['d', 'telegram:9'], ['p', PK_B]] }),
      { ...attestationEvent(), kind: 1, id: 'note' },
    ];
    const pool: ShiftPoolLike = {
      querySync: async (_relays, filter) => {
        expect(filter.kinds).toEqual([IDENTITY_ATTESTATION_KIND]);
        return store as never[];
      },
      publish: () => [Promise.resolve('ok')],
    };
    const client = createShiftRelayClient({ relays: ['wss://example'], pool });
    const atts = await client.fetchAttestations({ participants: [PK_A] });
    expect(atts).toHaveLength(1);
    expect(atts[0]).toMatchObject({ id: 'new', name: 'Alice', pubkeys: [PK_A] });
  });
});
