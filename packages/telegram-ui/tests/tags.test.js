// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi, afterEach } from 'vitest';
import Tags from '../src/Tags.js';

const CHAT = -1001;

function fakeDb() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (h, l, key) => store.get(`${h}/${l}/${key}`) ?? null),
    put: vi.fn(async (h, l, data) => store.set(`${h}/${l}/${data.id}`, data)),
  };
}

function build({ transcribe } = {}) {
  let t = 1_000_000;
  const db = fakeDb();
  const commands = new Map();
  const bot = {
    command: vi.fn((name, handler) => commands.set(name, handler)),
  };
  const read =
    transcribe ?? vi.fn(async () => ({ text: ' Be kind\nto yourself ' }));
  const tags = new Tags(bot, db, { transcribe: read, now: () => t });
  return { tags, db, bot, commands, transcribe: read, tick: s => (t += s) };
}

function ctxFor({
  userId = 42,
  message = {},
  path = 'photos/file_1.jpg',
} = {}) {
  return {
    chat: { id: CHAT, type: 'supergroup' },
    from: { id: userId, username: 'ann' },
    message: { message_id: 10, chat: { id: CHAT }, ...message },
    telegram: {
      getFileLink: vi.fn(
        async () => new URL(`https://api.telegram.org/file/botTOKEN/${path}`)
      ),
    },
    reply: vi.fn(async () => ({ message_id: 99 })),
  };
}

const photo = id => [{ file_id: `${id}-small` }, { file_id: `${id}-large` }];
const cards = db => db.store.get(`${CHAT}/tags/cards`);

function stubFetch(ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('/card', () => {
  it('registers the command', () => {
    const { bot } = build();
    expect(bot.command).toHaveBeenCalledWith('card', expect.any(Function));
  });

  it('asks for the photo, then files the next one from that user under cards', async () => {
    stubFetch();
    const { tags, db, commands, transcribe } = build();

    const ask = ctxFor({ message: { text: '/card' } });
    await commands.get('card')(ask);
    expect(ask.reply.mock.calls[0][0]).toMatch(/photo of the card/);
    expect(cards(db)).toBeUndefined();
    expect(tags.isWaitingForCard(CHAT, 42)).toBe(true);
    // someone else's photo is not taken for the card
    expect(tags.isWaitingForCard(CHAT, 7)).toBe(false);

    const sent = ctxFor({ message: { message_id: 11, photo: photo('card') } });
    await tags.handleCardPhoto(sent);

    expect(sent.telegram.getFileLink).toHaveBeenCalledWith('card-large');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'image/jpeg');
    expect(cards(db)).toEqual({
      id: 'cards',
      content: [
        {
          holonId: String(CHAT),
          messageId: 11,
          messageContent: 'Be kind\nto yourself',
          picture: 'card-large',
        },
      ],
    });
    expect(sent.reply.mock.calls[0][0]).toContain('Be kind');
    expect(sent.reply.mock.calls[0][1]).toEqual({
      reply_parameters: { message_id: 11 },
    });
    expect(tags.isWaitingForCard(CHAT, 42)).toBe(false);
  });

  it('stops waiting after 15 minutes', async () => {
    const { tags, commands, tick } = build();
    await commands.get('card')(ctxFor({ message: { text: '/card' } }));
    tick(15 * 60);
    expect(tags.isWaitingForCard(CHAT, 42)).toBe(true);
    tick(1);
    expect(tags.isWaitingForCard(CHAT, 42)).toBe(false);
  });

  it('reads the photo it replies to', async () => {
    stubFetch();
    const { tags, db, commands } = build();
    const ctx = ctxFor({
      message: {
        text: '/card',
        reply_to_message: { message_id: 5, photo: photo('old') },
      },
      path: 'photos/file_2.png',
    });
    await commands.get('card')(ctx);

    expect(cards(db).content[0]).toMatchObject({
      messageId: 5,
      picture: 'old-large',
    });
    expect(tags.transcribe).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/png'
    );
    expect(tags.isWaitingForCard(CHAT, 42)).toBe(false);
  });

  it('appends to the cards already filed', async () => {
    stubFetch();
    const { tags, db } = build();
    await tags.handleCardPhoto(
      ctxFor({
        message: { message_id: 1, photo: photo('a'), caption: '/card' },
      })
    );
    await tags.handleCardPhoto(
      ctxFor({
        message: { message_id: 2, photo: photo('b'), caption: '/card' },
      })
    );
    expect(cards(db).content.map(c => c.picture)).toEqual([
      'a-large',
      'b-large',
    ]);
  });

  it('saves nothing when the writing cannot be read', async () => {
    stubFetch();
    const failing = build({
      transcribe: vi.fn(async () => ({
        text: '',
        error: 'The image analysis service is temporarily unavailable.',
      })),
    });
    const ctx = ctxFor({ message: { photo: photo('x') } });
    await failing.tags.handleCardPhoto(ctx);
    expect(failing.db.put).not.toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toMatch(/temporarily unavailable/);

    const blank = build({ transcribe: vi.fn(async () => ({ text: '  ' })) });
    const ctx2 = ctxFor({ message: { photo: photo('y') } });
    await blank.tags.handleCardPhoto(ctx2);
    expect(blank.db.put).not.toHaveBeenCalled();
    expect(ctx2.reply.mock.calls[0][0]).toMatch(/could not read/);
  });

  it('saves nothing when the image cannot be fetched or is not a supported format', async () => {
    stubFetch(false);
    const { tags, db, transcribe } = build();
    const ctx = ctxFor({ message: { photo: photo('x') } });
    await tags.handleCardPhoto(ctx);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/Error processing/);

    const gif = ctxFor({
      message: { photo: photo('g') },
      path: 'animations/file.gif',
    });
    await tags.handleCardPhoto(gif);
    expect(gif.reply.mock.calls[0][0]).toMatch(/Unsupported image format/);

    expect(transcribe).not.toHaveBeenCalled();
    expect(db.put).not.toHaveBeenCalled();
  });
});
