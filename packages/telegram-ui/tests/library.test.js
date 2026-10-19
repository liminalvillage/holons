// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { minuteKey, ymd } from '@holons/core/library';
import Library from '../src/Library.js';

const CHAT = -100123;
const ROBERTO = {
  id: 235114395,
  username: 'robertovalenti',
  first_name: 'Roberto',
};
const ANA = { id: 77, username: 'ana', first_name: 'Ana' };

const day = offset => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return ymd(d);
};

/** A booking as core stores it: the borrower id is text, the name a first name. */
const booking = (who, start, end) => ({
  id: `b-${start}`,
  start,
  end,
  borrowerId: String(who.id),
  borrower: who.first_name,
  borrowerInitials: who.first_name[0],
  created: '2026-01-01T00:00:00.000Z',
});

const thing = (id, extra = {}) => ({
  id,
  type: 'other',
  borrowed: false,
  borrower: null,
  createdBy: 1,
  category: 'Uncategorized',
  description: '',
  value: 0,
  created: '2026-01-01T00:00:00.000Z',
  ...extra,
});

function make(items = []) {
  const actions = [];
  const bot = {
    command: vi.fn(),
    action: (pattern, handler) => actions.push([pattern, handler]),
  };
  const store = new Map(items.map(i => [i.id, i]));
  const db = {
    get: vi.fn(async (_h, lens, id) =>
      lens === 'library' ? (store.get(id) ?? null) : null
    ),
    getAll: vi.fn(async (_h, lens) =>
      lens === 'library' ? [...store.values()] : []
    ),
    put: vi.fn(async (_h, lens, value) => {
      if (lens === 'library') store.set(value.id, value);
    }),
    delete: vi.fn(async (_h, _l, id) => store.delete(id)),
  };
  const library = new Library(bot, db);

  /** Tap an inline button as `from`, the way Telegraf routes a callback. */
  async function tap(data, from = ROBERTO) {
    const ctx = {
      chat: { id: CHAT },
      from,
      callbackQuery: { data, message: { chat: { id: CHAT } } },
      answerCbQuery: vi.fn(async () => {}),
      editMessageText: vi.fn(async () => {}),
      editMessageReplyMarkup: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
    };
    for (const [pattern, handler] of actions) {
      const match =
        typeof pattern === 'string'
          ? pattern === data
            ? [data]
            : null
          : data.match(pattern);
      if (!match) continue;
      ctx.match = match;
      await handler(ctx);
      return ctx;
    }
    throw new Error(`no handler for ${data}`);
  }

  return { library, store, tap };
}

/** Every button of the last edited message, as [text, callback_data]. */
function buttons(ctx) {
  const [, extra] = ctx.editMessageText.mock.calls.at(-1);
  const markup = extra.reply_markup ?? extra;
  return markup.inline_keyboard.flat().map(b => [b.text, b.callback_data]);
}

describe('Library (telegram)', () => {
  it('offers Return to the borrower although the stored id is text', async () => {
    const drill = thing('drill', {
      bookings: [booking(ROBERTO, day(0), day(3))],
    });
    const { tap } = make([drill]);

    const mine = await tap('libret_drill', ROBERTO);
    expect(buttons(mine).map(([, data]) => data)).toContain('lib_ret_drill');

    const theirs = await tap('libret_drill', ANA);
    expect(buttons(theirs).map(([, data]) => data)).not.toContain(
      'lib_ret_drill'
    );
  });

  it('returns a borrow whose time is already up', async () => {
    // What a lapsed borrow leaves behind: the stored flag still says borrowed.
    const drill = thing('drill', {
      borrowed: true,
      borrower: 'Roberto',
      borrowerId: String(ROBERTO.id),
      bookings: [booking(ROBERTO, day(-9), day(-2))],
    });
    const { library, store, tap } = make([drill]);

    // Listed as out and overdue, leading to the details (not to a new borrow).
    const [[row]] = library.getLibraryKeyboard([drill]).reply_markup
      .inline_keyboard;
    expect(row.callback_data).toBe('libret_drill');
    expect(row.text).toContain('🔴');

    const ctx = await tap('lib_ret_drill', ROBERTO);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Returned');
    expect(store.get('drill').bookings).toEqual([]);
    expect(store.get('drill').borrowed).toBe(false);
  });

  it('lists a thing by the clock, not by the stored flag', () => {
    const { library } = make();
    // Booked for tomorrow: free today whatever the flag says.
    const tent = thing('tent', {
      borrowed: true,
      bookings: [booking(ANA, day(1), day(2))],
    });
    const [[row]] = library.getLibraryKeyboard([tent]).reply_markup
      .inline_keyboard;
    expect(row.callback_data).toBe('library_borrow_tent');
  });

  it('books a car for an hour from now', async () => {
    const { store, tap } = make([thing('car')]);
    const chooser = await tap('library_borrow_car');
    expect(buttons(chooser).map(([, data]) => data)).toEqual(
      expect.arrayContaining(['lb_q_60', 'lb_q_120', 'lb_q_240', 'lb_t'])
    );

    await tap('lb_q_60');
    const [b] = store.get('car').bookings;
    expect(b.borrowerId).toBe(String(ROBERTO.id));
    expect(b.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(b.end) - new Date(b.start)).toBe(3_600_000);
    expect(store.get('car').borrowed).toBe(true);
  });

  it('books a chosen day, start time and length, around what is already booked', async () => {
    const tomorrow = day(1);
    const car = thing('car', {
      bookings: [booking(ANA, `${tomorrow}T10:00`, `${tomorrow}T11:00`)],
    });
    const { store, tap } = make([car]);

    await tap('library_borrow_car');
    const days = await tap('lb_t');
    // The day step is the calendar without the shortcuts that led here.
    expect(buttons(days).map(([, data]) => data)).not.toContain('lb_q_60');
    const hours = await tap(`lb_d_${tomorrow}`);
    expect(buttons(hours).map(([text]) => text)).toEqual(
      expect.arrayContaining(['00:00', '14:00', '23:00'])
    );
    const lengths = await tap('lb_h_11:00');
    expect(buttons(lengths).map(([, data]) => data)).toContain('lb_l_60');
    await tap('lb_l_60');

    // Back to back with Ana's hour: 11:00–12:00 stands.
    expect(store.get('car').bookings.map(b => [b.start, b.end])).toEqual([
      [`${tomorrow}T10:00`, `${tomorrow}T11:00`],
      [`${tomorrow}T11:00`, `${tomorrow}T12:00`],
    ]);

    // A clash is refused and says with whom.
    await tap('library_borrow_car', ANA);
    await tap('lb_t', ANA);
    await tap(`lb_d_${tomorrow}`, ANA);
    await tap('lb_h_11:00', ANA);
    const clash = await tap('lb_l_120', ANA);
    expect(clash.answerCbQuery.mock.calls[0][0]).toMatch(/^Booked by Roberto/);
    expect(store.get('car').bookings).toHaveLength(2);
  });

  it('still borrows for whole days from the calendar', async () => {
    const { store, tap } = make([thing('drill')]);
    await tap('library_borrow_drill');
    await tap(`lb_d_${day(3)}`);
    expect(store.get('drill').bookings.map(b => [b.start, b.end])).toEqual([
      [day(0), day(3)],
    ]);
  });

  it("leaves today's hours already gone out of the start times", async () => {
    const { tap } = make([thing('car')]);
    await tap('library_borrow_car');
    await tap('lb_t');
    const hours = await tap(`lb_d_${day(0)}`);
    const first = buttons(hours)[0][0];
    expect(first).toBe(`${minuteKey(new Date()).slice(11, 13)}:00`);
  });

  // The bot shares one callback namespace, and the first handler that matches
  // wins: the scheduler's unanchored /n_(.+)/ once swallowed the length tap.
  it('no other module answers a booking button', () => {
    const src = fileURLToPath(new URL('../src/', import.meta.url));
    const others = [];
    for (const file of readdirSync(src)) {
      if (!/\.(ts|js)$/.test(file) || file === 'Library.ts') continue;
      const code = readFileSync(src + file, 'utf8');
      for (const m of code.matchAll(
        /\.action\(\s*\/((?:\\.|[^/\n])+)\/([a-z]*)/g
      )) {
        others.push([file, new RegExp(m[1], m[2])]);
      }
    }
    expect(others.length).toBeGreaterThan(20);
    const taps = [
      'lb_q_60',
      'lb_t',
      'lb_h_14:00',
      'lb_l_60',
      'lb_d_2026-10-12',
      'lb_m_2026-10_mm',
      'library_cancel_borrow',
    ];
    const shadowed = taps.flatMap(data =>
      others
        .filter(([, re]) => re.test(data))
        .map(([file]) => `${data} ← ${file}`)
    );
    expect(shadowed).toEqual([]);
  });
});
