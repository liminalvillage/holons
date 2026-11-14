// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// /dna and the walk (src/HolonDna.js): a holon's front page as Telegram
// messages, one gene per message with "I've read this" / "I agree", a review
// with an explicit agreement, and Send — which signs the 9021 with the DNA
// hash through core. In-memory store, a fake Telegram, nothing published.

import { describe, it, expect, vi, afterEach } from 'vitest';
import i18next from 'i18next';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import {
  addHolonMember,
  holonMembers,
  syncMembersLog,
} from '@holons/core/protocol';
import { joinRequestRecords } from '@holons/core/holons';
import { dnaHash, putGene, readGenes } from '@holons/core/dna';
import HolonDna, {
  ONBOARD_PAYLOAD,
  pack,
  renderGene,
  splitText,
} from '../src/HolonDna.js';
import JoinRequests from '../src/JoinRequests.js';
import { setProjectionHostForTests } from '../src/createHoloSphere.js';
import enLocale from '../data/locales/en.json' with { type: 'json' };
import itLocale from '../data/locales/it.json' with { type: 'json' };

const B = (() => {
  const sk = generateSecretKey();
  return { sk: bytesToHex(sk), pk: getPublicKey(sk) };
})();
const T = '-1009876543210';
const APP = 'holon-dna-test';
const SECRET = 'holon-dna-test-secret';
const ADA = '4242';
const adaKey = () => deriveTelegramNostrKey(ADA, SECRET);

let open = [];
afterEach(async () => {
  vi.useRealTimers();
  setProjectionHostForTests(null);
  for (const hs of open) await hs.close();
  open = [];
});

const buttons = call =>
  (call.extra?.reply_markup?.inline_keyboard ?? call.markup ?? []).flat();

/**
 * The bot's instance with the chat founded, genes written, and the two
 * services over a fake Telegram. Nothing leaves the process.
 */
async function setup({ chatMember, language = 'en' } = {}) {
  const hs = createHoloSphere({
    appName: APP,
    privateKey: B.sk,
    store: { adapter: 'memory' },
  });
  open.push(hs);
  const published = [];
  hs.publishNostrEvents = ev => published.push(ev);
  await syncMembersLog(hs, T, new Map());
  await hs.put(T, 'settings', { id: T, name: 'Village' });
  const telegram = {
    sendMessage: vi.fn(async () => ({ message_id: 500 })),
    getChatMember: vi.fn(async () => {
      if (!chatMember) throw new Error('user not found');
      return chatMember();
    }),
  };
  const settings = { getLanguage: async () => language };
  const joinRequests = new JoinRequests(null, hs, settings, {
    derivationSecret: SECRET,
    signer: signerFromSecretKey(B.sk),
    isAdmin: async () => true,
  });
  joinRequests.bot = { telegram, botInfo: { username: 'DevBot' } };
  const botRegistry = {
    commands: {},
    actions: [],
    botInfo: { username: 'DevBot' },
  };
  const bot = {
    botInfo: botRegistry.botInfo,
    command: (name, fn) => (botRegistry.commands[name] = fn),
    action: (re, fn) => botRegistry.actions.push([re, fn]),
  };
  const dna = new HolonDna(bot, hs, settings, {
    joinRequests,
    derivationSecret: SECRET,
  });

  /** A ctx the way Telegraf builds one, recording every reply. */
  const session = {};
  const replies = [];
  const edits = [];
  const alerts = [];
  const ctxOf = (chat, { match, message, from } = {}) => ({
    chat,
    from: from ?? { id: Number(ADA), first_name: 'Ada' },
    session,
    message,
    match,
    reply: vi.fn(async (t, extra) => {
      replies.push({ text: t, extra });
      return { message_id: 700 + replies.length };
    }),
    answerCbQuery: vi.fn(async (t, o) => {
      if (t) alerts.push({ text: t, ...o });
    }),
    editMessageReplyMarkup: vi.fn(async m => edits.push(m)),
  });
  const group = { id: Number(T), type: 'supergroup' };
  const dm = { id: Number(ADA), type: 'private' };
  /** A tap on a callback button: the registered handler whose pattern matches. */
  const tap = async (data, chat = dm) => {
    for (const [re, fn] of botRegistry.actions) {
      const match = re.exec(data);
      if (match) {
        const ctx = ctxOf(chat, { match });
        await fn(ctx);
        return ctx;
      }
    }
    throw new Error(`no handler for ${data}`);
  };
  const command = async (name, line, chat) => {
    const ctx = ctxOf(chat, { message: { text: line } });
    await botRegistry.commands[name](ctx);
    return ctx;
  };
  const last = () => replies[replies.length - 1];
  const callbackOf = (label, from = last()) =>
    buttons(from).find(b => b.text.includes(label))?.callback_data;
  return {
    hs,
    published,
    telegram,
    joinRequests,
    dna,
    group,
    dm,
    ctxOf,
    tap,
    command,
    replies,
    edits,
    alerts,
    last,
    callbackOf,
    session,
  };
}

const values = {
  kind: 'values',
  title: 'Values',
  alleles: [
    { title: 'Care', body: 'We look after each other.' },
    { title: 'Honesty', kicker: 'always', body: 'We say what is so.' },
  ],
};
const terms = {
  kind: 'terms',
  title: 'House terms',
  alleles: [
    { title: 'Stay', body: 'A '.repeat(1500) },
    { title: 'Money', body: 'B & C <d> '.repeat(700) },
  ],
};
const purpose = {
  kind: 'purpose',
  title: 'Purpose',
  blurb: 'A village for care.',
};

async function seed(hs, { withTerms = false } = {}) {
  await putGene(hs, T, purpose);
  await putGene(hs, T, values);
  if (withTerms) await putGene(hs, T, terms);
  return dnaHash(await readGenes(hs, T));
}
const requests = t => t.published.filter(e => e.kind === 9021);

describe('text layout', () => {
  it('splits under the limit, never inside an entity, losing nothing', () => {
    const raw = 'Fish & chips <b> & more. '.repeat(700);
    const parts = splitText(raw, 1000);
    expect(parts.length).toBeGreaterThan(5);
    for (const p of parts) {
      const escaped = p
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      expect(escaped.length).toBeLessThanOrEqual(1000);
    }
    const squash = s => s.replace(/\s+/g, ' ').trim();
    expect(squash(parts.join(' '))).toBe(squash(raw));
  });

  it('packs blocks into messages and never past the limit', () => {
    const out = pack(['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)], 130);
    expect(out).toHaveLength(2);
    expect(out.every(m => m.length <= 130)).toBe(true);
  });

  it('renders a long terms gene as several messages, all under 4096 characters', () => {
    const gene = {
      id: 'terms',
      kind: 'terms',
      title: 'House terms',
      blurb: 'Read carefully.',
      ack: 'agree',
      layout: 'longform',
      alleles: [
        { id: 'a', title: 'Stay', body: 'word '.repeat(1600) },
        { id: 'b', title: 'Money', body: 'x & y '.repeat(1300) },
      ],
      expressedIn: [],
    };
    const labels = {
      kind: (k, d) => d,
      termsBadge: "You'll be asked to agree to this",
      expressedIn: 'Expressed in',
    };
    const chunks = renderGene(gene, labels);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4096);
    const all = chunks.join('\n');
    expect(all).toContain('House terms');
    expect(all).toContain("You'll be asked to agree to this");
    expect((all.match(/word/g) ?? []).length).toBe(1600);
    expect((all.match(/x &amp; y/g) ?? []).length).toBe(1300);
  });
});

describe('the deep link', () => {
  it('takes a holon, optionally with the first 16 hex of a DNA hash', () => {
    expect(ONBOARD_PAYLOAD.exec('onboard_-100123')[1]).toBe('-100123');
    const m = ONBOARD_PAYLOAD.exec('onboard_-100123_0123456789abcdef');
    expect([m[1], m[2]]).toEqual(['-100123', '0123456789abcdef']);
    for (const bad of [
      'onboard_-100123_0123',
      'onboard_-100123_0123456789ABCDEF',
      'onboard_-100123_0123456789abcdef0',
      'onboard_abc',
    ])
      expect(ONBOARD_PAYLOAD.exec(bad)).toBeNull();
  });
});

describe('/dna', () => {
  it('in a group shows the name, the purpose and a button per gene, with the way to ask', async () => {
    const t = await setup();
    const hash = await seed(t.hs, { withTerms: true });
    await t.command('dna', '/dna', t.group);
    const msg = t.last();
    expect(msg.text).toContain('<b>Village</b>');
    expect(msg.text).toContain('A village for care.');
    expect(msg.text).toMatch(/DNA [0-9a-f]{8}/);
    const bs = buttons(msg);
    expect(bs.map(b => b.callback_data).filter(Boolean)).toEqual([
      `dnag:${T}:0`,
      `dnag:${T}:1`,
      `dnag:${T}:2`,
    ]);
    // Agreement genes are marked; the ask is a deep link carrying the hash.
    expect(bs.find(b => b.text.includes('Values')).text).toMatch(/✍️/);
    const ask = bs.find(b => b.url);
    expect(ask.text).toBe('Ask to join');
    expect(ask.url).toBe(
      `https://t.me/DevBot?start=onboard_${T}_${hash.slice(0, 16)}`
    );
    expect(
      ONBOARD_PAYLOAD.test(new URL(ask.url).searchParams.get('start'))
    ).toBe(true);
  });

  it('in a private chat needs a holon id', async () => {
    const t = await setup();
    await t.command('dna', '/dna', t.dm);
    expect(t.last().text).toMatch(/Send \/dna in a group/);
    await seed(t.hs);
    await t.command('dna', `/dna ${T}`, t.dm);
    expect(t.last().text).toContain('<b>Village</b>');
    // There the ask is a button of the bot itself, not a link.
    expect(
      buttons(t.last()).find(b => b.callback_data === `dnas:${T}`)
    ).toBeTruthy();
  });

  it('a holon with no DNA says so', async () => {
    const t = await setup();
    await t.command('dna', '/dna', t.group);
    expect(t.last().text).toContain("Village hasn't written its DNA yet");
    expect(
      buttons(t.last()).filter(b => b.callback_data?.startsWith('dnag'))
    ).toEqual([]);
  });

  it('a tap on a gene shows it whole; terms arrive in messages under the limit', async () => {
    const t = await setup();
    await seed(t.hs, { withTerms: true });
    const ctx = await t.tap(`dnag:${T}:1`, t.group);
    expect(ctx.reply).toHaveBeenCalled();
    expect(t.replies.map(r => r.text).join('\n')).toContain(
      'We look after each other.'
    );
    t.replies.length = 0;
    await t.tap(`dnag:${T}:2`, t.group);
    expect(t.replies.length).toBeGreaterThan(2);
    for (const r of t.replies) expect(r.text.length).toBeLessThanOrEqual(4096);
    expect(t.replies[0].text).toContain("You'll be asked to agree to this");
  });

  it('shows the Edit DNA link to an admin of the holon', async () => {
    const t = await setup();
    await seed(t.hs);
    // The bot's own key is the holon's admin: ask as that identity.
    t.dna.secret = '';
    t.dna.viewerOf = () => B.pk;
    await t.command('dna', '/dna', t.group);
    expect(buttons(t.last()).find(b => b.text === 'Edit DNA').url).toBe(
      `https://hubs.network/${T}/dna?edit`
    );
  });

  it('answers in Italian when the chat is', async () => {
    await i18next.init({
      lng: 'it',
      resources: { en: enLocale, it: itLocale },
      interpolation: { escapeValue: false },
    });
    try {
      const t = await setup({ language: 'it' });
      await seed(t.hs, { withTerms: true });
      await t.command('dna', '/dna', t.group);
      const bs = buttons(t.last());
      expect(bs.find(b => b.url).text).toBe('Chiedi di unirti');
      expect(t.last().text).toMatch(/aggiornato il \d{4}-\d{2}-\d{2}/);
      await t.tap(`dnag:${T}:2`, t.group);
      expect(t.replies.some(r => r.text.includes('Condizioni'))).toBe(true);
    } finally {
      await i18next.init({ lng: 'en', resources: {} });
    }
  });
});

describe('the walk', () => {
  const walkToReview = async (t, { handoff } = {}) => {
    await t.dna.begin(t.ctxOf(t.dm), T, { handoff });
  };

  it('goes one gene per message: read, agree, review, an explicit agreement, Send', async () => {
    const t = await setup({
      chatMember: () => ({
        status: 'member',
        user: { id: 4242, first_name: 'Ada' },
      }),
    });
    const hash = await seed(t.hs);
    await walkToReview(t);

    // Intro, then the first gene on its own. Purpose asks to be read.
    expect(t.replies[0].text).toMatch(
      /Before asking to join Village, walk through its DNA: 2 parts/
    );
    expect(t.replies[1].text).toContain('1 of 2');
    expect(t.replies[1].text).toContain('A village for care.');
    const read = t.callbackOf("I've read this");
    expect(read).toMatch(/^dnaw:0:r:[0-9a-f]{8}$/);
    expect(Buffer.byteLength(read)).toBeLessThanOrEqual(64);
    expect(t.callbackOf('Back')).toBeUndefined();

    // Reading it moves to the next: values asks for an agreement.
    await t.tap(read);
    expect(t.edits.at(-1)).toEqual({ inline_keyboard: [] });
    const values_ = t.replies.at(-1);
    expect(values_.text).toContain('2 of 2');
    expect(values_.text).toContain('We look after each other.');
    const agree = t.callbackOf('I agree to Values', values_);
    expect(agree).toMatch(/^dnaw:1:a:/);
    expect(t.callbackOf('Back', values_)).toMatch(/^dnaw:1:back:/);

    // Back shows the first gene again.
    await t.tap(t.callbackOf('Back', values_));
    expect(t.replies.at(-1).text).toContain('1 of 2');
    await t.tap(t.callbackOf("I've read this"));
    await t.tap(agree);

    // Review: the walked genes and an agreement that is a button of its own.
    const review = t.replies.at(-1);
    expect(review.text).toContain('Ready to send');
    expect(review.text).toContain('✔️ Purpose');
    expect(review.text).toContain('✔️ Values');
    const consent = buttons(review).find(b =>
      b.text.includes('I agree to the DNA of Village')
    );
    expect(consent.text).toContain(`(${hash.slice(0, 8)})`);
    expect(buttons(review).some(b => b.text.includes('Send request'))).toBe(
      false
    );

    // Send before agreeing is refused where it is tapped (it is not even offered).
    const sendData = `dnaw:2:s:${hash.slice(0, 8)}`;
    await t.tap(sendData);
    expect(t.alerts.at(-1)).toMatchObject({
      text: 'Tick the agreement first.',
      show_alert: true,
    });
    expect(requests(t)).toHaveLength(0);

    // Agreeing offers Send; Send signs the 9021 with the hash and the bot links her.
    await t.tap(consent.callback_data);
    const marked = t.edits.at(-1).inline_keyboard.flat();
    expect(marked.find(b => b.text.startsWith('☑️'))).toBeTruthy();
    expect(marked.find(b => b.text.includes('Send request'))).toBeTruthy();
    await t.tap(sendData);

    expect(requests(t)).toHaveLength(1);
    const event = requests(t)[0];
    expect(event.kind).toBe(9021);
    expect(event.pubkey).toBe(adaKey().publicKey);
    expect(event.tags).toContainEqual(['dna', hash]);
    expect(event.tags).toContainEqual(['h', T]);
    expect(t.replies.at(-1).text).toContain('linked');
    expect((await holonMembers(t.hs, T)).get(adaKey().publicKey)).toBe(
      'member'
    );
  });

  it('a link with the current hash skips the reading, never the agreement', async () => {
    const t = await setup({
      chatMember: () => ({ status: 'member', user: { id: 4242 } }),
    });
    const hash = await seed(t.hs);
    await walkToReview(t, { handoff: hash.slice(0, 16) });
    expect(t.replies[0].text).toMatch(/brought the DNA/);
    const review = t.replies.at(-1);
    expect(review.text).toContain('Ready to send');
    // Pre-ticked genes, but the agreement is still to be given.
    expect(buttons(review).find(b => b.text.startsWith('☐'))).toBeTruthy();
    expect(buttons(review).some(b => b.text.includes('Send request'))).toBe(
      false
    );
    await t.tap(`dnaw:2:s:${hash.slice(0, 8)}`);
    expect(t.alerts.at(-1).text).toBe('Tick the agreement first.');
    expect(requests(t)).toHaveLength(0);
  });

  it('a stale hash in the link is walked again from the first gene', async () => {
    const t = await setup();
    await seed(t.hs);
    await walkToReview(t, { handoff: 'ffffffffffffffff' });
    expect(t.replies[0].text).toMatch(/changed\. Walk through it again/);
    expect(t.replies[1].text).toContain('1 of 2');
    expect(t.replies.some(r => r.text.includes('Ready to send'))).toBe(false);
  });

  it('a gene changed mid-walk is shown again; a button for the old text acknowledges nothing', async () => {
    const t = await setup();
    await seed(t.hs);
    await walkToReview(t);
    const oldRead = t.callbackOf("I've read this");
    await t.tap(oldRead);
    const oldAgree = t.callbackOf('I agree to Values');
    // An admin rewrites Values while she reads.
    await putGene(t.hs, T, {
      id: 'values',
      alleles: [
        { title: 'Care', body: 'We look after each other, and the land.' },
      ],
    });
    t.dna.fronts.clear();
    t.replies.length = 0;
    await t.tap(oldAgree);
    expect(t.replies[0].text).toMatch(/changed\. Walk through it again/);
    // Purpose she read stays done; the changed Values is the step she is on.
    const step = t.replies.at(-1);
    expect(step.text).toContain('the land');
    expect(step.text).toContain('2 of 2');
    expect(t.session.dnaWalk[T].acks.values).toBeUndefined();
  });

  it('a gene read before and changed since says so', async () => {
    const t = await setup();
    await seed(t.hs);
    await walkToReview(t);
    await t.tap(t.callbackOf("I've read this"));
    await t.tap(t.callbackOf('I agree to Values'));
    // She comes back later (a new /start) after the purpose changed.
    await putGene(t.hs, T, {
      id: 'purpose',
      blurb: 'A village for care and play.',
    });
    t.dna.fronts.clear();
    t.replies.length = 0;
    await walkToReview(t);
    expect(t.replies.at(-1).text).toContain(
      'Purpose changed since you read it'
    );
    expect(t.replies.at(-1).text).toContain('1 of 2');
  });

  it('a holon with no DNA asks for no agreement: Send, nothing to read', async () => {
    const t = await setup({
      chatMember: () => ({ status: 'member', user: { id: 4242 } }),
    });
    await walkToReview(t);
    expect(t.replies[0].text).toMatch(/asks for no agreement/);
    const review = t.replies.at(-1);
    expect(buttons(review).some(b => b.text.startsWith('☐'))).toBe(false);
    await t.tap(`dnaw:0:s:00000000`);
    expect(requests(t)).toHaveLength(1);
    expect(requests(t)[0].tags.some(x => x[0] === 'dna')).toBe(false);
  });

  it('a request made while the DNA changes is not signed: the walk starts again', async () => {
    const t = await setup();
    const hash = await seed(t.hs);
    await walkToReview(t);
    await t.tap(t.callbackOf("I've read this"));
    await t.tap(t.callbackOf('I agree to Values'));
    const review = t.replies.at(-1);
    await t.tap(
      buttons(review).find(b => b.text.includes('I agree to the DNA'))
        .callback_data
    );
    // The DNA changes after she ticked, before Send: the front cache is stale.
    await putGene(t.hs, T, {
      id: 'values',
      alleles: [{ title: 'Care', body: 'Different.' }],
    });
    t.dna.fronts.clear();
    // Force the stale hash through: send what she agreed to.
    t.replies.length = 0;
    const out = await t.dna.send(t.ctxOf(t.dm), T, hash);
    expect(out).toBe('dna');
    expect(requests(t)).toHaveLength(0);
    expect(t.replies[0].text).toMatch(/changed\. Walk through it again/);
  });

  it('a person who is already linked is told so', async () => {
    const t = await setup();
    await seed(t.hs);
    await addHolonMember(t.hs, T, adaKey().publicKey, 'member');
    // The seat counts from the next second on.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5000);
    await walkToReview(t);
    expect(t.replies.at(-1).text).toContain("You're linked");
  });

  it('refuses a holon that is not a Telegram group', async () => {
    const t = await setup();
    await t.dna.begin(
      t.ctxOf(t.dm),
      'some-keyed-holon'.replace(/\D/g, '') || '42'
    );
    expect(t.replies.at(-1).text).toMatch(/can't be joined from here/);
  });

  it('in a group it hands over to a private chat', async () => {
    const t = await setup();
    await seed(t.hs);
    await t.command('apply', `/apply ${T}`, t.group);
    expect(t.last().text).toMatch(/private chat/);
    expect(buttons(t.last())[0].url).toBe(
      `https://t.me/DevBot?start=onboard_${T}`
    );
  });

  it('/apply <holon> in a private chat is the walk', async () => {
    const t = await setup();
    await seed(t.hs);
    await t.command('apply', `/apply ${T}`, t.dm);
    expect(t.replies[0].text).toMatch(/walk through its DNA/);
  });
});

describe('a re-ask after the DNA changed', () => {
  it('updates the pending record and links the proven member', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let inChat = false;
    const t = await setup({
      chatMember: () => {
        if (!inChat) throw new Error('not here yet');
        return { status: 'member', user: { id: 4242, first_name: 'Ada' } };
      },
    });
    const first = await seed(t.hs);
    // She walked and asked, but Telegram could not place her: the admins decide.
    expect(await t.dna.send(t.ctxOf(t.dm), T, first)).toBe('posted');
    expect(
      (await joinRequestRecords(t.hs, T)).get(adaKey().publicKey)
    ).toMatchObject({
      status: 'pending',
      dna: first,
    });
    // The DNA changes; she is in the group now and walks it again.
    await putGene(t.hs, T, {
      id: 'values',
      alleles: [{ title: 'Care', body: 'Different.' }],
    });
    const second = dnaHash(await readGenes(t.hs, T));
    expect(second).not.toBe(first);
    inChat = true;
    t.dna.fronts.clear();
    vi.setSystemTime(Date.now() + 5000);
    expect(await t.dna.send(t.ctxOf(t.dm), T, second)).toBe('linked');
    expect(
      (await joinRequestRecords(t.hs, T)).get(adaKey().publicKey)
    ).toMatchObject({
      status: 'approved',
      dna: second,
    });
    expect((await holonMembers(t.hs, T)).get(adaKey().publicKey)).toBe(
      'member'
    );
  });
});
