// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect } from 'vitest';
import {
  CLAIM_LENS,
  CLAIM_MAX_AGE_MS,
  CLAIM_NAMESPACE,
  claimFor,
  claimPayload,
  hubClaimFromChat,
  isClaimToken,
  isFreshClaim,
  isHubClaim,
  newClaimToken,
  parseClaimPayload,
  readHubClaim,
  recordHubClaim,
  type ClaimStore,
  type HubClaim,
} from './index.js';

function fakeStore(): ClaimStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    async get(holon, lens, key) {
      return rows.get(`${holon}/${lens}/${key}`) ?? null;
    },
    async put(holon, lens, data) {
      rows.set(`${holon}/${lens}/${(data as { id: string }).id}`, data);
    },
  };
}

const T0 = 1_760_000_000_000;

describe('claim tokens', () => {
  it('mints 22 url-safe characters from the random source', () => {
    const token = newClaimToken((n) => new Uint8Array(n).map((_, i) => i));
    expect(token).toHaveLength(22);
    expect(token).toBe('ABCDEFGHIJKLMNOPQRSTUV');
    expect(isClaimToken(token)).toBe(true);
  });

  it('mints distinct tokens from the platform random source', () => {
    const a = newClaimToken();
    const b = newClaimToken();
    expect(isClaimToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it('accepts only the token shape', () => {
    expect(isClaimToken('abcdefghijklmnop')).toBe(true);
    expect(isClaimToken('too-short')).toBe(false);
    expect(isClaimToken('has space in it xxxxx')).toBe(false);
    expect(isClaimToken('x'.repeat(49))).toBe(false);
    expect(isClaimToken(42)).toBe(false);
  });

  it('round-trips through the /start payload', () => {
    const token = 'ABCDEFGHIJKLMNOPQRSTUV';
    expect(claimPayload(token)).toBe('claim_ABCDEFGHIJKLMNOPQRSTUV');
    expect(parseClaimPayload('claim_ABCDEFGHIJKLMNOPQRSTUV')).toBe(token);
    expect(parseClaimPayload('/start claim_ABCDEFGHIJKLMNOPQRSTUV')).toBe(token);
    expect(parseClaimPayload('/start@HubsNetwork_bot claim_ABCDEFGHIJKLMNOPQRSTUV')).toBe(token);
    expect(() => claimPayload('nope')).toThrow();
  });

  it('ignores every other payload', () => {
    expect(parseClaimPayload('hub')).toBeNull();
    expect(parseClaimPayload('join_-1002282981272_quests_1')).toBeNull();
    expect(parseClaimPayload('/start')).toBeNull();
    expect(parseClaimPayload('claim_')).toBeNull();
    expect(parseClaimPayload('claim_short')).toBeNull();
    expect(parseClaimPayload(null)).toBeNull();
  });
});

describe('hubClaimFromChat', () => {
  it('reads a group as its title', () => {
    expect(hubClaimFromChat({ id: -1001234567890, type: 'supergroup', title: 'Liminal' })).toEqual({
      holon: '-1001234567890',
      kind: 'group',
      name: 'Liminal',
    });
  });

  it("reads a private chat as the person's name", () => {
    expect(hubClaimFromChat({ id: 235114395, type: 'private', first_name: 'Roberto', last_name: 'V' })).toEqual({
      holon: '235114395',
      kind: 'personal',
      name: 'Roberto V',
    });
    expect(hubClaimFromChat({ id: 1, type: 'private', username: 'rob' })).toEqual({
      holon: '1',
      kind: 'personal',
      name: 'rob',
    });
  });

  it('leaves the name out when there is none', () => {
    expect(hubClaimFromChat({ id: -100, type: 'group' })).toEqual({ holon: '-100', kind: 'group' });
  });
});

describe('recordHubClaim / readHubClaim', () => {
  const token = 'ABCDEFGHIJKLMNOPQRSTUV';

  it('writes the claim under the well-known namespace and reads it back', async () => {
    const store = fakeStore();
    const written = await recordHubClaim(
      store,
      token,
      { id: -1001234567890, type: 'supergroup', title: 'Liminal' },
      T0,
    );
    expect(written).toEqual({
      id: token,
      holon: '-1001234567890',
      kind: 'group',
      name: 'Liminal',
      at: T0,
    });
    expect(store.rows.get(`${CLAIM_NAMESPACE}/${CLAIM_LENS}/${token}`)).toEqual(written);
    expect(await readHubClaim(store, token, { now: T0 + 1000 })).toEqual(written);
  });

  it('refuses a bad token or a chat without an id', async () => {
    const store = fakeStore();
    expect(await recordHubClaim(store, 'nope', { id: -100 }, T0)).toBeNull();
    expect(await recordHubClaim(store, token, { id: '' }, T0)).toBeNull();
    // `getholonId` falls back to "0" when it cannot read the chat.
    expect(await recordHubClaim(store, token, { id: '0' }, T0)).toBeNull();
    expect(store.rows.size).toBe(0);
  });

  it('is null until the bot has redeemed the token', async () => {
    expect(await readHubClaim(fakeStore(), token)).toBeNull();
    expect(await readHubClaim(fakeStore(), 'nope')).toBeNull();
  });

  it('does not honour a stale claim', async () => {
    const store = fakeStore();
    await recordHubClaim(store, token, { id: -100, type: 'group' }, T0);
    expect(await readHubClaim(store, token, { now: T0 + CLAIM_MAX_AGE_MS + 1 })).toBeNull();
    expect(await readHubClaim(store, token, { now: T0 + CLAIM_MAX_AGE_MS })).not.toBeNull();
  });
});

describe('claimFor', () => {
  const claim: HubClaim = { id: 'ABCDEFGHIJKLMNOPQRSTUV', holon: '-100', kind: 'group', at: T0 };

  it('passes the claim for this token and nothing else', () => {
    expect(claimFor(claim, claim.id, { now: T0 })).toEqual(claim);
    expect(claimFor(claim, 'ABCDEFGHIJKLMNOPQRSTUW', { now: T0 })).toBeNull();
    expect(claimFor({ ...claim, holon: 'liminal' }, claim.id, { now: T0 })).toBeNull();
    expect(claimFor(null, claim.id)).toBeNull();
    expect(claimFor({ id: claim.id, _deleted: true }, claim.id)).toBeNull();
  });

  it('checks the record shape', () => {
    expect(isHubClaim(claim)).toBe(true);
    expect(isHubClaim({ ...claim, kind: 'other' })).toBe(false);
    expect(isHubClaim({ ...claim, at: 'yesterday' })).toBe(false);
  });

  it('tolerates a little clock skew but not a claim from the future', () => {
    expect(isFreshClaim(claim, T0 - 30_000)).toBe(true);
    expect(isFreshClaim(claim, T0 - 120_000)).toBe(false);
  });
});
