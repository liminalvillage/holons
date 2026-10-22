// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Community applications: the web record's shape, and the rule that one is
// only ever written sealed. Runs on a real local-only instance from the core
// factory (no relays), the way the bot gets one.
import { describe, expect, it, vi } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import { createHoloSphere } from '../holosphere/factory.js';
import { isLocked } from '../privacy/audience.js';
import {
  APPLICATIONS_LENS,
  ApplicationsNotSealedError,
  MAX_APPLICATION_BYTES,
  ensureApplicationsSealed,
  parseProfileClaimPayload,
  parseWebApplication,
  profileFromApplication,
  findProfileClaim,
  spendProfileClaim,
  storeApplication,
} from './index.js';

const H = '-100555';

function body(over: Record<string, unknown> = {}) {
  return {
    id: '2026-10-22T10:11:12.345Z-a1b2c3',
    submittedAt: '2026-10-22T10:11:12.345Z',
    source: 'web',
    status: 'submitted',
    email: 'ada@example.com',
    name: 'Ada',
    data: {
      email: 'ada@example.com',
      name: 'Ada',
      location: 'Lisbon',
      age_range: '30-40',
      role: ['pollinator', 'other'],
      role_other: 'Beekeeper',
      wellbeing: 'private: knee surgery',
      visit: 'remote',
      tasks: ['tech'],
      contribution_preference: 'volunteering',
      capacity: '10h',
      watched: 'Yes, during the application',
    },
    ...over,
  };
}

function fresh() {
  return createHoloSphere({ appName: 'applications-test', privateKey: generateSecretKey(), store: { adapter: 'memory' } });
}

describe('parseWebApplication', () => {
  it('accepts the web record and drops unknown keys at both levels', () => {
    const r = parseWebApplication({ ...body(), extra: 1, data: { ...body().data, nope: 'x' } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.record).sort()).toEqual(['data', 'email', 'id', 'name', 'source', 'status', 'submittedAt']);
    expect(r.record.data).not.toHaveProperty('nope');
    expect(r.record.data.role).toEqual(['pollinator', 'other']);
    expect(r.record.data.watched).toBe('Yes, during the application');
  });

  it.each([
    ['no body', null],
    ['an array', []],
    ['a bad id', body({ id: '../etc' })],
    ['a missing id', body({ id: undefined })],
    ['a bad date', body({ submittedAt: 'yesterday' })],
    ['another source', body({ source: 'telegram' })],
    ['another status', body({ status: 'accepted' })],
    ['a bad e-mail', body({ email: 'not-an-email' })],
    ['an empty name', body({ name: '  ' })],
    ['data not an object', body({ data: 'x' })],
    ['an array where text belongs', body({ data: { capacity: ['10h'] } })],
    ['text where a list belongs', body({ data: { role: 'pollinator' } })],
    ['a non-string in a list', body({ data: { tasks: ['tech', 3] } })],
  ])('rejects %s with 400', (_label, input) => {
    const r = parseWebApplication(input);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a body over 64 KB with 413', () => {
    const r = parseWebApplication(body({ data: { background: 'x'.repeat(MAX_APPLICATION_BYTES) } }));
    expect(r).toMatchObject({ ok: false, status: 413 });
  });
});

describe('storeApplication', () => {
  it('locks the lens before the first write, so the record is sealed on the wire', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    const r = parseWebApplication(body());
    if (!r.ok) throw new Error(r.error);

    expect(await isLocked(hs, { holon: H, lens: APPLICATIONS_LENS })).toBe(false);
    expect(await storeApplication(hs, H, r.record)).toEqual({ created: true });
    expect(await isLocked(hs, { holon: H, lens: APPLICATIONS_LENS })).toBe(true);

    const wire = hs.store.getEvents(H, APPLICATIONS_LENS, r.record.id)[0].content;
    expect(wire).not.toContain('ada@example.com');
    expect(wire).not.toContain('knee');
    expect(await hs.get(H, APPLICATIONS_LENS, r.record.id)).toMatchObject({ id: r.record.id, email: 'ada@example.com', data: { visit: 'remote' } });
  });

  it('is idempotent on a repeated id: the stored record is kept', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    const r = parseWebApplication(body());
    if (!r.ok) throw new Error(r.error);
    await storeApplication(hs, H, r.record);
    await hs.put(H, APPLICATIONS_LENS, { ...r.record, status: 'accepted' });   // a steward moved it on
    expect(await storeApplication(hs, H, r.record)).toEqual({ created: false });
    expect(await hs.get(H, APPLICATIONS_LENS, r.record.id)).toMatchObject({ status: 'accepted' });
  });

  it('never writes in the clear when the lens cannot be sealed', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    vi.spyOn(hs.privacy, 'lock').mockResolvedValue({ kid: null, rewritten: 0 });
    const put = vi.spyOn(hs, 'put');
    const r = parseWebApplication(body());
    if (!r.ok) throw new Error(r.error);
    await expect(storeApplication(hs, H, r.record)).rejects.toBeInstanceOf(ApplicationsNotSealedError);
    expect(put).not.toHaveBeenCalled();
    expect(hs.store.getEvents(H, APPLICATIONS_LENS, r.record.id)).toEqual([]);
  });

  it('ensureApplicationsSealed is idempotent', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    await ensureApplicationsSealed(hs, H);
    const lock = vi.spyOn(hs.privacy, 'lock');
    await ensureApplicationsSealed(hs, H);
    expect(lock).not.toHaveBeenCalled();
    expect(await isLocked(hs, { holon: H, lens: APPLICATIONS_LENS })).toBe(true);
  });
});

describe('profile claims', () => {
  const TOKEN = 'Zm9vYmFyYmF6cXV4MTIz';

  it('keeps a well-formed profileClaim and rejects a malformed one', () => {
    const r = parseWebApplication({ ...body(), profileClaim: TOKEN });
    expect(r.ok && r.record.profileClaim).toBe(TOKEN);
    expect(parseWebApplication({ ...body(), profileClaim: 'short' }).ok).toBe(false);
    expect(parseWebApplication({ ...body(), profileClaim: 'has spaces in it, nope' }).ok).toBe(false);
    const none = parseWebApplication(body());
    expect(none.ok && 'profileClaim' in none.record).toBe(false);
  });

  it('reads the token out of a /start payload', () => {
    expect(parseProfileClaimPayload(`profile_${TOKEN}`)).toBe(TOKEN);
    expect(parseProfileClaimPayload('profile_x')).toBeNull();
    expect(parseProfileClaimPayload('onboarding')).toBeNull();
    expect(parseProfileClaimPayload(undefined)).toBeNull();
  });

  it('takes only the answered profile fields', () => {
    expect(profileFromApplication({ ikigai: ' Healer ', linkedin: '', wellbeing: 'x' })).toEqual({ ikigai: 'Healer' });
    expect(profileFromApplication(undefined)).toEqual({});
  });

  it('finds a claim until it is spent, and the application stays sealed', async () => {
    const hs = fresh();
    await hs.ready();
    await hs.foundHolon(H);
    const r = parseWebApplication({
      ...body(),
      profileClaim: TOKEN,
      data: { ...body().data, ikigai: 'Bridge builder', linkedin: 'https://www.linkedin.com/in/ada', public_profile: 'yes' },
    });
    if (!r.ok) throw new Error(r.error);
    await storeApplication(hs, H, r.record);

    expect(await findProfileClaim(hs, H, 'not-the-token-at-all')).toBeNull();
    const claim = await findProfileClaim(hs, H, TOKEN);
    expect(claim?.profile).toEqual({ ikigai: 'Bridge builder', linkedin: 'https://www.linkedin.com/in/ada' });
    await spendProfileClaim(hs, H, claim!.application, 42);
    expect(await findProfileClaim(hs, H, TOKEN)).toBeNull();

    const stored = await hs.get(H, APPLICATIONS_LENS, r.record.id);
    expect(stored).toMatchObject({ profileClaimedBy: '42', data: { wellbeing: 'private: knee surgery' } });
    expect(stored).not.toHaveProperty('profileClaim');
    expect(await isLocked(hs, { holon: H, lens: APPLICATIONS_LENS })).toBe(true);
  });
});
