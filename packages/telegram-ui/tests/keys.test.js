// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi } from 'vitest';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { toNpub, toNsec } from '@holons/core/nostr';
import Keys, { keyLinkRelaysFromEnv } from '../src/Keys.js';

const SECRET = 'test-derivation-secret';
const OWN_PK = 'a'.repeat(64);
const OWN_NPUB = toNpub(OWN_PK);

function fakeDb() {
  const store = new Map();
  const k = (h, l) => `${h}::${l}`;
  return {
    store,
    async get(h, l, key) {
      return store.get(k(h, l))?.get(String(key)) ?? null;
    },
    async put(h, l, data) {
      if (!store.has(k(h, l))) store.set(k(h, l), new Map());
      store.get(k(h, l)).set(String(data.id), data);
    },
    async delete() {
      return true;
    },
    async getAll(h, l) {
      return [...(store.get(k(h, l))?.values() ?? [])];
    },
  };
}

function ctxFor({
  userId = 42,
  chatType = 'private',
  text = '/key',
  match,
} = {}) {
  return {
    chat: { id: userId, type: chatType },
    from: { id: userId, username: 'ann', first_name: 'Ann' },
    message: { text },
    match,
    callbackQuery: match
      ? { data: match[0], message: { chat: { id: userId, type: chatType } } }
      : undefined,
    reply: vi.fn(async () => ({ message_id: 1 })),
    answerCbQuery: vi.fn(async () => {}),
    editMessageText: vi.fn(async () => {}),
    editMessageReplyMarkup: vi.fn(async () => {}),
  };
}

function build(over = {}) {
  const db = fakeDb();
  const pool = { querySync: vi.fn(async () => []) };
  const changed = vi.fn();
  let t = 1_800_000_000;
  const keys = new Keys(null, db, {
    derivationSecret: SECRET,
    relays: ['wss://fake'],
    pool,
    onLinkedKeysChanged: changed,
    now: () => t,
    ...over,
  });
  return { keys, db, pool, changed, tick: s => (t += s) };
}

describe('/key', () => {
  it('refuses in a group and points to the private chat', async () => {
    const { keys } = build();
    const ctx = ctxFor({ chatType: 'group' });
    await keys.command(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/private chat/);
  });

  it('shows the derived npub, no linked keys, and the export/link buttons', async () => {
    const { keys } = build();
    const ctx = ctxFor();
    await keys.command(ctx);
    const [text, extra] = ctx.reply.mock.calls[0];
    const derived = deriveTelegramNostrKey(42, SECRET);
    expect(text).toContain(toNpub(derived.publicKey));
    expect(text).not.toContain(toNsec(derived.privateKey));
    expect(text).toMatch(/No other key linked/);
    const labels = extra.reply_markup.inline_keyboard.flat().map(b => b.text);
    expect(labels).toEqual(['📤 Export secret key', '🔗 Link a key I hold']);
  });

  it('says so when signing is not configured', async () => {
    const { keys } = build({ derivationSecret: '' });
    const ctx = ctxFor();
    await keys.command(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/NOSTR_DERIVATION_SECRET/);
  });

  it('exports the nsec as a spoiler, only in a private chat', async () => {
    const { keys } = build();
    const ctx = ctxFor();
    await keys.exportKey(ctx);
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain(
      `<tg-spoiler><code>${toNsec(deriveTelegramNostrKey(42, SECRET).privateKey)}</code></tg-spoiler>`
    );
    expect(text).toMatch(/Anyone with this key can act as you/);
    expect(extra.parse_mode).toBe('HTML');
    const group = ctxFor({ chatType: 'group' });
    await keys.exportKey(group);
    expect(group.reply).not.toHaveBeenCalled();
    expect(group.answerCbQuery.mock.calls[0][0]).toMatch(/private chat/);
  });

  it('links a key only after the proof note is found, then attests it', async () => {
    const { keys, db, pool, changed, tick } = build();
    // Junk, own key, then a real one.
    const junk = ctxFor({ text: '/key link nope' });
    await keys.command(junk);
    expect(junk.reply.mock.calls[0][0]).toMatch(
      /doesn't look like a public key/
    );
    const own = ctxFor({
      text: `/key link ${toNpub(deriveTelegramNostrKey(42, SECRET).publicKey)}`,
    });
    await keys.command(own);
    expect(own.reply.mock.calls[0][0]).toMatch(/already your Holons key/);

    const start = ctxFor({ text: `/key link ${OWN_NPUB}` });
    await keys.command(start);
    const [challengeText, extra] = start.reply.mock.calls[0];
    const code = challengeText.match(
      /<code>(holons-link-[a-z0-9]+)<\/code>/
    )[1];
    expect(extra.reply_markup.inline_keyboard[0].map(b => b.text)).toEqual([
      '✅ Verify',
      'Cancel',
    ]);

    // Verify before posting: nothing on the relays → not linked.
    const early = ctxFor();
    await keys.verify(early);
    expect(early.answerCbQuery.mock.calls[0][0]).toMatch(/Not found yet/);
    expect(pool.querySync).toHaveBeenCalledWith(
      ['wss://fake'],
      { authors: [OWN_PK], since: 1_800_000_000, limit: 50 },
      { maxWait: 6000 }
    );
    expect(changed).not.toHaveBeenCalled();

    // A note by someone else with the code, and an old note by the key: still no.
    pool.querySync.mockResolvedValueOnce([
      { pubkey: 'b'.repeat(64), created_at: 1_800_000_010, content: code },
      { pubkey: OWN_PK, created_at: 1_799_999_999, content: code },
    ]);
    const wrong = ctxFor();
    await keys.verify(wrong);
    expect(wrong.answerCbQuery.mock.calls[0][0]).toMatch(/Not found yet/);

    // The real proof.
    tick(30);
    pool.querySync.mockResolvedValueOnce([
      { pubkey: OWN_PK, created_at: 1_800_000_020, content: `hi ${code}` },
    ]);
    const ok = ctxFor();
    await keys.verify(ok);
    expect(ok.answerCbQuery.mock.calls[0][0]).toBe('Linked ✓');
    expect(changed).toHaveBeenCalledWith(42);
    const personal = await db.get('42', 'users', '42');
    expect(personal.linkedKeys).toEqual([OWN_PK]);
    // The overview now lists it with an unlink button.
    const overview = ok.reply.mock.calls.at(-1);
    expect(overview[0]).toContain(OWN_NPUB);
    const labels = overview[1].reply_markup.inline_keyboard
      .flat()
      .map(b => b.text);
    expect(labels[2]).toMatch(/^✕ Unlink aaaaaaaa…aaaa$/);

    // Linking again is a no-op message; verifying with nothing pending is refused.
    const again = ctxFor({ text: `/key link ${OWN_PK}` });
    await keys.command(again);
    expect(again.reply.mock.calls[0][0]).toMatch(/already linked/);
    const idle = ctxFor();
    await keys.verify(idle);
    expect(idle.answerCbQuery.mock.calls[0][0]).toMatch(/No link in progress/);
  });

  it('expires a challenge after the TTL', async () => {
    const { keys, pool, tick } = build();
    await keys.command(ctxFor({ text: `/key link ${OWN_NPUB}` }));
    tick(16 * 60);
    pool.querySync.mockResolvedValueOnce([
      {
        pubkey: OWN_PK,
        created_at: 1_800_000_900,
        content: 'holons-link-whatever',
      },
    ]);
    const late = ctxFor();
    await keys.verify(late);
    expect(late.answerCbQuery.mock.calls[0][0]).toMatch(/No link in progress/);
  });

  it('accepts a pasted npub after the Link button, and unlinks from the button or the command', async () => {
    const { keys, db, changed, pool } = build();
    await keys.askForKey(ctxFor());
    const pasted = ctxFor({ text: OWN_NPUB });
    await keys.onKeyText(pasted);
    expect(pasted.reply.mock.calls[0][0]).toMatch(/To prove you hold/);
    const code = pasted.reply.mock.calls[0][0].match(
      /<code>(holons-link-[a-z0-9]+)<\/code>/
    )[1];
    pool.querySync.mockResolvedValueOnce([
      { pubkey: OWN_PK, created_at: 1_800_000_001, content: code },
    ]);
    await keys.verify(ctxFor());
    expect((await db.get('42', 'users', '42')).linkedKeys).toEqual([OWN_PK]);

    // A stray npub with nothing pending is ignored.
    const stray = ctxFor({ userId: 7, text: OWN_NPUB });
    await keys.onKeyText(stray);
    expect(stray.reply).not.toHaveBeenCalled();

    const btn = ctxFor({ match: [`key_unlink_${OWN_PK}`, OWN_PK] });
    await keys.unlink(btn);
    expect(btn.answerCbQuery.mock.calls[0][0]).toBe('Unlinked');
    expect('linkedKeys' in (await db.get('42', 'users', '42'))).toBe(false);
    expect(changed).toHaveBeenLastCalledWith(42);
    expect(btn.editMessageText).toHaveBeenCalled();

    const cmd = ctxFor({ text: `/key unlink ${OWN_NPUB}` });
    await keys.command(cmd);
    expect(cmd.reply.mock.calls[0][0]).toMatch(/not linked to you/);
  });
});

describe('keyLinkRelaysFromEnv', () => {
  it('prefers KEY_LINK_RELAYS, else our relays plus the public ones', () => {
    expect(
      keyLinkRelaysFromEnv({ KEY_LINK_RELAYS: 'wss://a, wss://b' })
    ).toEqual(['wss://a', 'wss://b']);
    const list = keyLinkRelaysFromEnv({ SHIFTS_RELAYS: 'wss://mine' });
    expect(list[0]).toBe('wss://mine');
    expect(list).toContain('wss://relay.damus.io');
  });
});
