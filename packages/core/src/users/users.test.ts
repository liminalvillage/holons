/**
 * Behavioural tests for `@holons/core/users`.
 * Uses an in-memory fake DB that mimics the holosphere shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultProfile,
  getUserProfile,
  ensureUserProfile,
  getUsers,
  saveUserProfile,
  addUserValues,
  addUserNeeds,
  joinHolon,
  leaveHolon,
  type TelegramUserLike,
  type UserDB,
  type UserProfile,
} from './index.js';

function makeFakeDB(): UserDB & { _store: Map<string, Map<string, unknown>> } {
  const store = new Map<string, Map<string, unknown>>();
  const keyFor = (holon: string, lens: string) => `${holon}::${lens}`;
  return {
    _store: store,
    async get(holon, lens, key) {
      return store.get(keyFor(holon, lens))?.get(String(key)) ?? null;
    },
    async put(holon, lens, data: any) {
      const k = keyFor(holon, lens);
      if (!store.has(k)) store.set(k, new Map());
      const id = String(data.id);
      store.get(k)!.set(id, data);
      return { ok: true };
    },
    async delete(holon, lens, key) {
      return store.get(keyFor(holon, lens))?.delete(String(key)) ?? false;
    },
    async getAll(holon, lens) {
      return Array.from(store.get(keyFor(holon, lens))?.values() ?? []);
    },
  };
}

const ALICE: TelegramUserLike = {
  id: 42,
  username: 'alice',
  first_name: 'Alice',
};

const BOT: TelegramUserLike = { id: 1, is_bot: true };

describe('createDefaultProfile', () => {
  it('falls back to id when no username present', () => {
    const p = createDefaultProfile({ id: 7, first_name: 'Anon' });
    expect(p.username).toBe('7');
    expect(p.values).toEqual([]);
    expect(p.needs).toEqual([]);
    expect(p.version).toBe('0.3');
  });

  it('uses telegram username when present', () => {
    expect(createDefaultProfile(ALICE).username).toBe('alice');
  });
});

describe('getUserProfile', () => {
  let db: ReturnType<typeof makeFakeDB>;
  beforeEach(() => { db = makeFakeDB(); });

  it('returns null for bots', async () => {
    expect(await getUserProfile(db, BOT, 'h1')).toBeNull();
  });

  it('returns null for missing holonId', async () => {
    expect(await getUserProfile(db, ALICE, '')).toBeNull();
  });

  it('creates and persists default profile when missing', async () => {
    const p = await getUserProfile(db, ALICE, 'h1');
    expect(p?.username).toBe('alice');
    const stored = await db.get('h1', 'users', '42');
    expect(stored).toBeTruthy();
  });

  it('returns existing profile on second call', async () => {
    const first = await getUserProfile(db, ALICE, 'h1');
    first!.values.push('seeded');
    await saveUserProfile(db, 'h1', first!);
    const second = await getUserProfile(db, ALICE, 'h1');
    expect(second?.values).toContain('seeded');
  });

  it('coerces numeric holonId to string', async () => {
    await getUserProfile(db, ALICE, 99);
    expect(await db.get('99', 'users', '42')).toBeTruthy();
  });
});

describe('ensureUserProfile', () => {
  it('is a no-op when profile already exists', async () => {
    const db = makeFakeDB();
    await getUserProfile(db, ALICE, 'h1');
    const before = await db.get('h1', 'users', '42');
    await ensureUserProfile(db, ALICE, 'h1');
    const after = await db.get('h1', 'users', '42');
    expect(after).toBe(before);
  });

  it('creates profile when absent', async () => {
    const db = makeFakeDB();
    await ensureUserProfile(db, ALICE, 'h1');
    expect(await db.get('h1', 'users', '42')).toBeTruthy();
  });

  it('skips bots and missing holon', async () => {
    const db = makeFakeDB();
    await ensureUserProfile(db, BOT, 'h1');
    await ensureUserProfile(db, ALICE, '');
    expect((await getUsers(db, 'h1')).length).toBe(0);
  });
});

describe('addUserValues / addUserNeeds', () => {
  it('appends and dedupes values', async () => {
    const db = makeFakeDB();
    await addUserValues(db, ALICE, 'h1', ['freedom', 'love']);
    const p = await addUserValues(db, ALICE, 'h1', ['love', 'trust']);
    expect(p?.values.sort()).toEqual(['freedom', 'love', 'trust']);
  });

  it('appends and dedupes needs', async () => {
    const db = makeFakeDB();
    await addUserNeeds(db, ALICE, 'h1', ['hugs']);
    const p = await addUserNeeds(db, ALICE, 'h1', ['hugs', 'food']);
    expect(p?.needs.sort()).toEqual(['food', 'hugs']);
  });

  it('returns null on empty input', async () => {
    const db = makeFakeDB();
    expect(await addUserValues(db, ALICE, 'h1', [])).toBeNull();
    expect(await addUserNeeds(db, ALICE, 'h1', [])).toBeNull();
  });

  it('returns null for bot users', async () => {
    const db = makeFakeDB();
    expect(await addUserValues(db, BOT, 'h1', ['x'])).toBeNull();
  });
});

describe('joinHolon / leaveHolon', () => {
  it('join ensures profile and reports username flag', async () => {
    const db = makeFakeDB();
    const r = await joinHolon(db, ALICE, 'h1');
    expect(r.profile?.username).toBe('alice');
    expect(r.hasUsername).toBe(true);
  });

  it('join flags missing username (no telegram username)', async () => {
    const db = makeFakeDB();
    const r = await joinHolon(db, { id: 99, first_name: 'NoName' }, 'h1');
    expect(r.hasUsername).toBe(false);
    // profile is still created with id-as-username fallback
    expect(r.profile?.username).toBe('99');
  });

  it('leave deletes the profile', async () => {
    const db = makeFakeDB();
    await getUserProfile(db, ALICE, 'h1');
    expect(await leaveHolon(db, 42, 'h1')).toBe(true);
    expect(await db.get('h1', 'users', '42')).toBeNull();
  });
});

describe('getUsers', () => {
  it('returns every stored profile', async () => {
    const db = makeFakeDB();
    await getUserProfile(db, ALICE, 'h1');
    await getUserProfile(db, { id: 2, username: 'bob' }, 'h1');
    const all = await getUsers(db, 'h1');
    expect(all.length).toBe(2);
  });
});
