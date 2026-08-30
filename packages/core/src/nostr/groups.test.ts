import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import {
  GROUP_ADMINS_KIND, GROUP_JOIN_REQUEST_KIND, GROUP_MEMBERS_KIND, GROUP_METADATA_KIND, GROUP_PUT_USER_KIND, GROUP_REMOVE_USER_KIND,
  PROJECTION_CODECS, buildGroupState, groupStateHash, parseGroupMembers, wrapDirectMessage, unwrapDirectMessage, directMessageFilter,
  type ProjectionCtx,
} from './index.js';

const HOLON = '-1003864542239';
const PUB = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const ctx: ProjectionCtx = {
  appName: 'HolonsTest', holonPubkey: PUB, now: () => 1_800_000_000,
  pubkeyFor: (id) => (String(id) === '42' ? ALICE : String(id) === '7' || String(id) === 'bob' ? BOB : undefined),
};
const tag = (t: string[][], n: string) => t.find((x) => x[0] === n);

describe('NIP-29 group state (holon-authored)', () => {
  it('builds metadata, admins and members with a stable hash', () => {
    const [meta, admins, members] = buildGroupState(ctx, HOLON, { id: HOLON, name: 'Liminal', purpose: ['Grow', 'Share'], admin: '@bob', picture: 'https://x/p.png' }, [42, 7, 'nobody', 42]);
    expect(meta.kind).toBe(GROUP_METADATA_KIND);
    expect(tag(meta.tags, 'd')![1]).toBe(HOLON);
    expect(tag(meta.tags, 'name')![1]).toBe('Liminal');
    expect(tag(meta.tags, 'about')![1]).toBe('Grow\nShare');
    expect(meta.tags).toEqual(expect.arrayContaining([['public'], ['closed'], ['picture', 'https://x/p.png']]));
    expect(admins.kind).toBe(GROUP_ADMINS_KIND);
    expect(admins.tags.filter((t) => t[0] === 'p')).toEqual([[ 'p', PUB, 'admin' ], ['p', BOB, 'admin']]);
    expect(members.kind).toBe(GROUP_MEMBERS_KIND);
    expect(members.tags.filter((t) => t[0] === 'p').map((t) => t[1])).toEqual([ALICE, BOB]);
    expect(parseGroupMembers(members)).toEqual([ALICE, BOB]);
    const again = buildGroupState({ ...ctx, now: () => 1 }, HOLON, { id: HOLON, name: 'Liminal', purpose: ['Grow', 'Share'], admin: '@bob', picture: 'https://x/p.png' }, [7, 42]);
    expect(groupStateHash(again[2])).toBe(groupStateHash(members)); // order- and time-independent
    expect(groupStateHash(buildGroupState(ctx, HOLON, { id: HOLON, name: 'Liminal' }, [7])[2])).not.toBe(groupStateHash(members));
  });
  it('users codec emits put-user (holon) + join request (member) and remove-user on delete', () => {
    const users = PROJECTION_CODECS.users;
    const out = users.project(HOLON, { id: 42, username: 'alice' }, ctx)!;
    const kinds = out.companions!.map((c) => c.template.kind);
    expect(kinds).toEqual([GROUP_PUT_USER_KIND, GROUP_JOIN_REQUEST_KIND]);
    expect(out.companions![0].template.tags).toEqual(expect.arrayContaining([['h', HOLON], ['p', ALICE, 'member']]));
    expect(out.companions![0].authorHint).toBeUndefined();
    expect(out.companions![1].authorHint).toEqual({ userId: 42 });
    expect(out.companions![1].dedupe).toEqual({ key: `join|${HOLON}|${ALICE}`, state: 'in' });
    expect(users.project(HOLON, { id: 'nobody', username: 'x' }, ctx)!.companions).toEqual([]);
    const [rm] = users.retract(HOLON, '42', ctx);
    expect(rm.kind).toBe(GROUP_REMOVE_USER_KIND);
    expect(rm.tags).toEqual(expect.arrayContaining([['h', HOLON], ['p', ALICE]]));
    expect(users.retract(HOLON, 'nobody', ctx)).toEqual([]);
  });
  it('settings codec projects 39000/39001 for the holon doc only and folds 39000 back', () => {
    const settings = PROJECTION_CODECS.settings;
    expect(settings.project(HOLON, { id: 'other', name: 'x' }, ctx)).toBeNull();
    const out = settings.project(HOLON, { id: HOLON, name: 'Liminal', admin: '42' }, ctx)!;
    expect(out.primary.kind).toBe(GROUP_METADATA_KIND);
    expect(out.companions![0].template.kind).toBe(GROUP_ADMINS_KIND);
    const r = settings.parse!({ kind: GROUP_METADATA_KIND, pubkey: PUB, created_at: 1, content: '', tags: [['d', HOLON], ['name', 'Liminal Village'], ['about', 'Grow\nShare']] }, ctx)!;
    expect(r).toMatchObject({ lens: 'settings', holon: HOLON, id: HOLON });
    const next = settings.merge!({ id: HOLON, name: 'Liminal', purpose: ['Old'] }, r, ctx)!;
    expect(next).toMatchObject({ name: 'Liminal Village', purpose: ['Grow', 'Share'] });
    expect(settings.merge!({ id: HOLON, name: 'Liminal Village', purpose: ['Grow', 'Share'] }, r, ctx)).toBeNull();
  });
});

describe('NIP-17 direct messages', () => {
  it('wraps for the recipient, hides the sender on the wire, unwraps with the seal-authenticated sender', () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    const wrap = wrapDirectMessage(a, getPublicKey(b), 'reminder: garden day', 'Holons');
    expect(wrap.kind).toBe(1059);
    expect(wrap.pubkey).not.toBe(getPublicKey(a));
    expect(wrap.content).not.toContain('garden');
    expect(tag(wrap.tags, 'p')![1]).toBe(getPublicKey(b));
    const m = unwrapDirectMessage(wrap, b)!;
    expect(m).toMatchObject({ content: 'reminder: garden day', sender: getPublicKey(a), subject: 'Holons' });
    expect(unwrapDirectMessage(wrap, generateSecretKey())).toBeNull();
    expect(directMessageFilter(getPublicKey(b), 5)).toEqual({ kinds: [1059], '#p': [getPublicKey(b)], since: 5 });
  });
});
