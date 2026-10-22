// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey } from 'nostr-tools';
import { createHoloSphere } from '@holons/core/holosphere';
import { isLocked } from '@holons/core/privacy';
import {
  applicationsHandler,
  bearerMatches,
} from '../src/ApplicationsIntake.js';

const H = '-100321';
const TOKEN = 's3cret-token';

const body = (over = {}) => ({
  id: '2026-10-22T10:11:12.345Z-a1b2c3',
  submittedAt: '2026-10-22T10:11:12.345Z',
  source: 'web',
  status: 'submitted',
  email: 'ada@example.com',
  name: 'Ada',
  data: {
    name: 'Ada',
    email: 'ada@example.com',
    wellbeing: 'knee surgery last spring',
    visit: 'visit',
    transportation: ['train', 'other'],
    transportation_other: 'Sailing boat',
  },
  ...over,
});

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function founded() {
  const hs = createHoloSphere({
    appName: 'intake-test',
    privateKey: generateSecretKey(),
    store: { adapter: 'memory' },
  });
  await hs.ready();
  await hs.foundHolon(H);
  return hs;
}

/** Call the handler like Express would; resolve with { status, body }. */
async function call(handler, { headers = {}, json = body() } = {}) {
  let status = 200;
  let sent;
  const res = {
    status(s) {
      status = s;
      return res;
    },
    json(b) {
      sent = b;
      return res;
    },
  };
  await handler({ headers, body: json }, res);
  return { status, body: sent };
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe('POST /applications', () => {
  it('compares the bearer token exactly', () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}`, '')).toBe(false);
  });

  it('refuses everything while APPLICATIONS_TOKEN is unset', async () => {
    const getDb = vi.fn();
    const h = applicationsHandler({ getDb, env: {}, log: silent });
    expect((await call(h, { headers: auth })).status).toBe(503);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('refuses a wrong or missing token', async () => {
    const getDb = vi.fn();
    const h = applicationsHandler({
      getDb,
      env: { APPLICATIONS_TOKEN: TOKEN },
      log: silent,
    });
    expect((await call(h)).status).toBe(401);
    expect(
      (await call(h, { headers: { authorization: 'Bearer nope' } })).status
    ).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('refuses a malformed or oversized body', async () => {
    const h = applicationsHandler({
      getDb: () => ({}),
      env: { APPLICATIONS_TOKEN: TOKEN },
      log: silent,
    });
    expect(
      (await call(h, { headers: auth, json: body({ email: 'x' }) })).status
    ).toBe(400);
    expect(
      (
        await call(h, {
          headers: { ...auth, 'content-length': String(65 * 1024) },
        })
      ).status
    ).toBe(413);
  });

  it('stores the application sealed in the holon, once', async () => {
    const hs = await founded();
    const h = applicationsHandler({
      getDb: () => hs,
      env: { APPLICATIONS_TOKEN: TOKEN, APPLICATIONS_HOLON: H },
      log: silent,
    });
    const first = await call(h, { headers: auth, json: { ...body(), x: 1 } });
    expect(first).toEqual({
      status: 200,
      body: { ok: true, holon: H, lens: 'applications', id: body().id },
    });
    expect(await isLocked(hs, { holon: H, lens: 'applications' })).toBe(true);
    const wire = hs.store.getEvents(H, 'applications', body().id);
    expect(wire).toHaveLength(1);
    expect(wire[0].content).not.toContain('ada@example.com');
    expect(wire[0].content).not.toContain('knee');
    const stored = await hs.get(H, 'applications', body().id);
    expect(stored).toMatchObject({
      source: 'web',
      email: 'ada@example.com',
      data: { transportation: ['train', 'other'] },
    });
    expect(stored).not.toHaveProperty('x');

    const again = await call(h, { headers: auth });
    expect(again.status).toBe(200);
    expect(hs.store.getEvents(H, 'applications', body().id)).toHaveLength(1);
  });

  it('answers 503 and writes nothing when the lens cannot be sealed', async () => {
    const hs = await founded();
    vi.spyOn(hs.privacy, 'lock').mockResolvedValue({ kid: null, rewritten: 0 });
    const put = vi.spyOn(hs, 'put');
    const h = applicationsHandler({
      getDb: () => hs,
      env: { APPLICATIONS_TOKEN: TOKEN, APPLICATIONS_HOLON: H },
      log: silent,
    });
    expect((await call(h, { headers: auth })).status).toBe(503);
    expect(put).not.toHaveBeenCalled();
    expect(silent.error).toHaveBeenCalled();
  });
});
