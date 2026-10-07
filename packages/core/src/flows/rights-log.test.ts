// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { bootstrapActors } from '../protocol/membership.js';
import { attestation } from '../protocol/events.js';
import { shuffled, signedEntry, testKey } from '../protocol/testing.js';
import { orderSignatures, potClaimArgs, potCommitment } from './pot-contract.js';
import { advanceRights, ZERO_ADDRESS } from './rights.js';
import { buildRightsEntry, buildRightsSignature, foldRights, isRights, latestRights, rightsByRef, rootSignatures, tableOf } from './rights-log.js';
import { rightsRoot, rowLeaf, verifyRightsProof } from './rights-tree.js';

const T0 = 1_760_000_000;
const holon = testKey();
const ada = testKey(); // a member
const treasurer = testKey(); // an admin
const steward = testKey(); // another admin

const actors = () => bootstrapActors({ members: [ada.pk], admins: [treasurer.pk, steward.pk, holon.pk], genesis: holon.pk });

const entry = <T extends Record<string, unknown>>(sk: Uint8Array, a: { item: T; refs?: Record<string, string | string[]> }, at: number) =>
  signedEntry<T>({ sk, item: a.item, refs: a.refs as never, created_at: at, lens: 'flow_rights' });

const EVO = '0x' + 'e'.repeat(40);
const POT = '0x' + '9'.repeat(40);
const wallets: Record<string, string> = { alice: '0x' + 'a'.repeat(40), bob: '0x' + 'b'.repeat(40) };
const addressOf = (p: string) => wallets[p] ?? null;

const first = advanceRights({ previous: null, epoch: 84, shares: { alice: 60, bob: 40 }, received: { [EVO]: 1000n }, addressOf });
const second = advanceRights({ previous: first, epoch: 85, shares: { alice: 20, bob: 80 }, received: { [EVO]: 1500n }, addressOf });

describe('buildRightsEntry / tableOf', () => {
  it('publishes the table as strings and reads it back whole', () => {
    const e = buildRightsEntry({ table: first, chainId: 11155111, pot: POT.toUpperCase().replace('0X', '0x'), sources: ['ev1'], memo: 'moon 84' });
    expect(isRights(e.item)).toBe(true);
    expect(e.item).toMatchObject({ kind: 'rights', epoch: 84, chainId: 11155111, pot: POT, root: rightsRoot(first.rows), totals: { [EVO]: '1000' }, sources: ['ev1'], memo: 'moon 84' });
    expect(e.item.rows[0]).toEqual({ party: 'alice', to: wallets.alice, token: EVO, cumulative: '600' });
    expect(tableOf(e.item)).toEqual(first);
    expect(tableOf({ ...e.item, rows: [{ party: 'x', to: 'nope', token: EVO, cumulative: '1' }] })).toBeNull();
  });
});

describe('foldRights', () => {
  it('commits an attester\'s tables in epoch order, latest per Pot; a member\'s is rejected', () => {
    const e1 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0);
    const e2 = entry(steward.sk, buildRightsEntry({ table: second, chainId: 1, pot: POT }) as never, T0 + 10);
    const byMember = entry(ada.sk, buildRightsEntry({ table: second, chainId: 1, pot: POT }) as never, T0 + 20);
    const f = foldRights({ entries: shuffled([e1, e2, byMember]), actors: actors() });
    expect(f.tables.map((t) => [t.epoch, t.status, t.reason ?? null])).toEqual([
      [84, 'committed', null],
      [85, 'committed', null],
      [85, 'rejected', 'not-attester'],
    ]);
    expect(latestRights(f, 1, POT)?.id).toBe(e2.id);
    expect(latestRights(f, 1, POT)?.table).toEqual(second);
    expect(latestRights(f, 2, POT)).toBeNull();
    expect(rightsByRef(f, '0x' + e1.id)?.epoch).toBe(84);
  });

  it('rejects a table that lowers a row, repeats an epoch, or lies about its root', () => {
    const e1 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0);
    const lowered = { ...second, rows: second.rows.map((r) => (r.party === 'alice' ? { ...r, cumulative: 100n } : r)), totals: { [EVO]: 900n } };
    const e2 = entry(treasurer.sk, buildRightsEntry({ table: lowered, chainId: 1, pot: POT }) as never, T0 + 10);
    const same = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0 + 20);
    const lying = buildRightsEntry({ table: second, chainId: 1, pot: POT });
    lying.item.root = '0x' + '1'.repeat(64);
    const e3 = entry(treasurer.sk, lying as never, T0 + 30);
    const f = foldRights({ entries: [e1, e2, same, e3], actors: actors() });
    expect(f.tables.map((t) => [t.status, t.reason ?? null])).toEqual([
      ['committed', null],
      ['rejected', 'regression: alice decreased in ' + EVO],
      ['rejected', 'regression: epoch 84 is not after 84'],
      ['rejected', 'root-mismatch'],
    ]);
    expect(latestRights(f, 1, POT)?.epoch).toBe(84);
  });

  it('a disputed table does not count, so the next one must follow the last committed', () => {
    const e1 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0);
    const e2 = entry(treasurer.sk, buildRightsEntry({ table: second, chainId: 1, pot: POT }) as never, T0 + 10);
    const dispute = entry(steward.sk, attestation(e2.id, 'dispute', 'wrong split') as never, T0 + 11);
    const f = foldRights({ entries: [e1, e2, dispute], actors: actors() });
    expect(f.tables[1].status).toBe('disputed');
    expect(latestRights(f, 1, POT)?.epoch).toBe(84);
  });

  it('two Pots keep separate chains of tables', () => {
    const other = '0x' + '8'.repeat(40);
    const e1 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0);
    const e2 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: other }) as never, T0 + 1);
    const f = foldRights({ entries: [e1, e2], actors: actors() });
    expect(f.tables.map((t) => t.status)).toEqual(['committed', 'committed']);
    expect(latestRights(f, 1, other)?.id).toBe(e2.id);
  });
});

describe('potCommitment / potClaimArgs', () => {
  it('orders tokens and signatures by address and turns a row into claim arguments that verify', () => {
    const two = advanceRights({ previous: null, epoch: 84, shares: { alice: 100 }, received: { [EVO]: 10n, [ZERO_ADDRESS]: 3n }, addressOf });
    const c = potCommitment(two, 'ab'.repeat(32));
    expect(c).toEqual({ epoch: 84n, root: rightsRoot(two.rows), tableRef: '0x' + 'ab'.repeat(32), tokens: [ZERO_ADDRESS, EVO], totals: [3n, 10n] });
    expect(() => potCommitment(two, 'short')).toThrow(/32 bytes/);

    const args = potClaimArgs(two, 'alice', EVO.toUpperCase().replace('0X', '0x'))!;
    expect(args).toMatchObject({ partyId: 'alice', to: wallets.alice, token: EVO, cumulative: 10n });
    expect(verifyRightsProof(c.root, rowLeaf({ party: 'alice', to: wallets.alice, token: EVO, cumulative: 10n }), args.proof)).toBe(true);
    expect(potClaimArgs(two, 'bob', EVO)).toBeNull();

    const unaddressed = advanceRights({ previous: null, epoch: 84, shares: { carol: 100 }, received: { [EVO]: 10n }, addressOf });
    expect(potClaimArgs(unaddressed, 'carol', EVO)).toBeNull();

    expect(
      orderSignatures([
        { signer: '0x' + 'f'.repeat(40), signature: 'sig-f' },
        { signer: '0x' + '1'.repeat(40), signature: 'sig-1' },
      ]),
    ).toEqual(['sig-1', 'sig-f']);
  });
});

describe('rootSignatures', () => {
  it('a signature rides on an attestation and counts once per signer, latest word', () => {
    const e1 = entry(treasurer.sk, buildRightsEntry({ table: first, chainId: 1, pot: POT }) as never, T0);
    const sig = (n: string) => '0x' + n.repeat(130);
    const s1 = entry(treasurer.sk, buildRightsSignature(e1.id, { signer: '0x' + 'F'.repeat(40), signature: sig('1') }) as never, T0 + 1);
    const s2 = entry(steward.sk, buildRightsSignature(e1.id, { signer: '0x' + '2'.repeat(40), signature: sig('2') }) as never, T0 + 2);
    const again = entry(treasurer.sk, buildRightsSignature(e1.id, { signer: '0x' + 'f'.repeat(40), signature: sig('3') }) as never, T0 + 3);
    const other = entry(treasurer.sk, buildRightsSignature('elsewhere', { signer: '0x' + '9'.repeat(40), signature: sig('4') }) as never, T0 + 4);
    const plain = entry(steward.sk, attestation(e1.id, 'attest') as never, T0 + 5);
    expect(rootSignatures([e1, s1, s2, again, other, plain], e1.id)).toEqual([
      { signer: '0x' + 'f'.repeat(40), signature: sig('3'), pubkey: treasurer.pk },
      { signer: '0x' + '2'.repeat(40), signature: sig('2'), pubkey: steward.pk },
    ]);
    // and the attestations still count toward the log's quorum
    const f = foldRights({ entries: [e1, s1, s2, plain], actors: actors(), policy: { quorum: 2 } });
    expect(f.tables[0].attests).toBe(2);
    expect(() => buildRightsSignature(e1.id, { signer: 'nope', signature: sig('1') })).toThrow(/0x/);
    expect(() => buildRightsSignature(e1.id, { signer: '0x' + '1'.repeat(40), signature: '0x12' })).toThrow(/65 bytes/);
  });
});
