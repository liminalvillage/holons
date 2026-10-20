// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { createHoloSphere } from '../holosphere/factory.js';
import { isHolonAdmin } from '../holosphere/authority.js';
import { readMembersLog } from '../protocol/membership.js';
import { signedEntry, testKey } from '../protocol/testing.js';
import { lapsedSeats } from './buckets.js';
import { FLOW_PROJECT_CLAIMS_LENS, buildProjectClaim } from './project-claims.js';
import {
  approveProjectClaim,
  declineProjectClaim,
  loadProjectClaims,
  projectSeats,
  requestProjectClaim,
  withdrawProjectClaim,
} from './project-claims-load.js';
import {
  readAllocationBuckets,
  readAllocationClaimWindow,
  readAllocationClaimed,
  readAllocationCodes,
  saveAllocationCodes,
  saveAllocationConfig,
  seatClaim,
} from './settings.js';

const APP = 'project-claims-load-test';
const T0 = 1_760_000_000;
const POT = 'holon_pot';
const FUND = 'holon_fund';
const PROJECT = 'holon_alder';
const OTHER = 'holon_birch';
const UNTIL = Date.now() + 86_400_000;

/** A Pot seating a fund (kept) and two projects, founded by the master key, which also founded the project. */
async function pot(sk = testKey().sk) {
  const hs: any = createHoloSphere({ appName: APP, privateKey: sk, store: { adapter: 'memory' } });
  await hs.ready();
  await hs.foundHolon(POT, { at: T0 });
  await hs.foundHolon(PROJECT, { at: T0 });
  hs._readAuthority?.invalidate();
  await hs.put(POT, 'settings', { id: POT, allocation: { interiorPercent: 100, steepness: 50, nzones: 3 } });
  await saveAllocationConfig(hs, POT, {}, undefined, undefined, undefined, {
    buckets: [{ id: 'legacy', percent: 100, mode: 'custom', shares: { [FUND]: 400, [PROJECT]: 300, [OTHER]: 300 } }],
    claimWindow: { until: UNTIL, keep: [FUND] },
  });
  await hs.put(PROJECT, 'settings', { id: PROJECT });
  await saveAllocationCodes(hs, PROJECT, { ['a'.repeat(64)]: seatClaim(POT) });
  return hs;
}

/** A request signed by someone who is not the instance: as it arrives from a relay. */
const arrive = (hs: any, sk: Uint8Array, party: string, project: string, at: number) => {
  const c = buildProjectClaim({ project, party, evidence: 'https://alder.example/team', at: at * 1000 });
  const e = signedEntry({ sk, item: c.item as never, created_at: at, holon: POT, lens: FLOW_PROJECT_CLAIMS_LENS, app: APP });
  hs.store.apply(e.event, { origin: 'remote' });
  return e.id;
};

/** Copy a holon's signed roster from one instance to another, as a relay would. */
const mirrorMembers = async (from: any, to: any, holon: string) => {
  for (const e of await readMembersLog(from, holon)) to.store.apply(e, { origin: 'remote' });
  to._readAuthority?.invalidate();
};

describe('projectSeats', () => {
  it('reads every seat but the kept ones: claimed by alias or in place, closed past the window, else open', () => {
    const settings = {
      allocation: {
        buckets: [{ id: 'legacy', percent: 100, mode: 'custom', shares: { f: 1, a: 1, b: 1, c: 1 } }],
        aliases: { a: '-100' },
        claimed: ['b'],
        claimWindow: { until: 1000, keep: ['f'] },
      },
    };
    expect(projectSeats(settings, 999)).toEqual({ a: 'claimed', b: 'claimed', c: 'open' });
    expect(projectSeats(settings, 1000)).toEqual({ a: 'claimed', b: 'claimed', c: 'closed' });
  });
});

describe('project claims against the store', () => {
  it('a stranger\'s request is read off the Pot\'s log, and the seats say which projects are open', async () => {
    const hs = await pot();
    const ada = testKey();
    const id = arrive(hs, ada.sk, 'ada', PROJECT, T0 + 10);
    const ctx = await loadProjectClaims(hs, POT);
    expect(ctx.pending.map((c) => [c.id, c.project, c.party, c.pubkey])).toEqual([[id, PROJECT, 'ada', ada.pk]]);
    expect(ctx.seats).toEqual({ [PROJECT]: 'open', [OTHER]: 'open' });
  });

  it('approving seats the SIGNER as the project\'s admin, marks the seat claimed, consumes its code — once', async () => {
    const hs = await pot();
    const ada = testKey();
    const id = arrive(hs, ada.sk, 'ada', PROJECT, T0 + 10);
    expect(await isHolonAdmin(hs, PROJECT, ada.pk)).toBe(false);

    expect(await approveProjectClaim(hs, POT, id)).toEqual({ project: PROJECT, key: ada.pk, seated: true, codes: 1 });
    expect((await hs.getMembers(PROJECT)).get(ada.pk)).toBe('admin');
    expect(await isHolonAdmin(hs, PROJECT, ada.pk)).toBe(true);
    const settings = await hs.get(POT, 'settings', POT);
    expect(readAllocationClaimed(settings)).toEqual([PROJECT]);
    expect(readAllocationCodes(await hs.get(PROJECT, 'settings', PROJECT))).toEqual({});
    // The split and its window are untouched, and the seat no longer lapses.
    expect(readAllocationBuckets(settings)[0].shares).toEqual({ [FUND]: 400, [PROJECT]: 300, [OTHER]: 300 });
    expect(lapsedSeats({ window: readAllocationClaimWindow(settings), now: UNTIL + 1, buckets: readAllocationBuckets(settings), claimed: readAllocationClaimed(settings) })).toEqual([OTHER]);

    const ctx = await loadProjectClaims(hs, POT);
    expect(ctx.approved[PROJECT]?.id).toBe(id);
    expect(ctx.seats[PROJECT]).toBe('claimed');

    expect(await approveProjectClaim(hs, POT, id)).toEqual({ project: PROJECT, key: ada.pk, seated: false, codes: 0 });
  });

  it('a claimed project takes no more requests; a closed window none either', async () => {
    const hs = await pot();
    const id = arrive(hs, testKey().sk, 'ada', PROJECT, T0 + 10);
    await approveProjectClaim(hs, POT, id);
    await expect(requestProjectClaim(hs, POT, { project: PROJECT, party: 'bo' })).rejects.toThrow(/already claimed/);
    await expect(requestProjectClaim(hs, POT, { project: OTHER, party: 'bo' }, { now: UNTIL + 1 })).rejects.toThrow(/window/);
    await expect(requestProjectClaim(hs, POT, { project: FUND, party: 'bo' })).rejects.toThrow(/does not seat/);
    await expect(requestProjectClaim(hs, POT, { project: 'holon_nowhere', party: 'bo' })).rejects.toThrow(/does not seat/);
  });

  it('one waiting request per claimant and project; the claimant may take it back and ask again', async () => {
    const hs = await pot();
    const { id } = await requestProjectClaim(hs, POT, { project: OTHER, party: 'me', evidence: 'https://birch.example' });
    await expect(requestProjectClaim(hs, POT, { project: OTHER, party: 'me' })).rejects.toThrow(/already waiting/);
    await withdrawProjectClaim(hs, POT, id);
    expect((await loadProjectClaims(hs, POT)).claims[0].status).toBe('withdrawn');
    await expect(approveProjectClaim(hs, POT, id)).rejects.toThrow(/taken back/);
    await requestProjectClaim(hs, POT, { project: OTHER, party: 'me' });
    expect((await loadProjectClaims(hs, POT)).pending).toHaveLength(1);
  });

  it('declining says why and seats nobody', async () => {
    const hs = await pot();
    const ada = testKey();
    const id = arrive(hs, ada.sk, 'ada', PROJECT, T0 + 10);
    await expect(declineProjectClaim(hs, POT, id, ' ')).rejects.toThrow(/says why/);
    await declineProjectClaim(hs, POT, id, 'the link does not name you');
    expect((await loadProjectClaims(hs, POT)).claims[0]).toMatchObject({ status: 'declined', reason: 'the link does not name you' });
    expect((await hs.getMembers(PROJECT)).has(ada.pk)).toBe(false);
    expect(readAllocationClaimed(await hs.get(POT, 'settings', POT))).toEqual([]);
  });

  it('only an admin of the Pot answers, and only into a project with a member log', async () => {
    const hs = await pot();
    const id = arrive(hs, testKey().sk, 'ada', OTHER, T0 + 10);
    // Nobody founded OTHER: approving seats nobody and marks nothing.
    await expect(approveProjectClaim(hs, POT, id)).rejects.toThrow(/no member log/);
    expect(readAllocationClaimed(await hs.get(POT, 'settings', POT))).toEqual([]);
    expect((await loadProjectClaims(hs, POT)).claims[0].status).toBe('pending');

    // A stranger's instance that has read the Pot's roster and the request.
    const outsider: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
    await outsider.ready();
    await mirrorMembers(hs, outsider, POT);
    const theirs = arrive(outsider, testKey().sk, 'bo', PROJECT, T0 + 20);
    await expect(approveProjectClaim(outsider, POT, theirs)).rejects.toThrow(/Only an admin/);
  });

  it('a Pot admin who is not an admin of the project cannot seat in it', async () => {
    const master = testKey();
    const hs = await pot(master.sk);
    const other: any = createHoloSphere({ appName: APP, privateKey: testKey().sk, store: { adapter: 'memory' } });
    await other.ready();
    // Another key founds the project first; the master key is only on the Pot.
    await other.foundHolon(OTHER, { at: T0 - 100 });
    await mirrorMembers(other, hs, OTHER);
    const id = arrive(hs, testKey().sk, 'ada', OTHER, T0 + 10);
    hs._readAuthority?.invalidate();
    await expect(approveProjectClaim(hs, POT, id)).rejects.toThrow(/not an admin of the project|no member log/);
  });
});
