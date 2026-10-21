// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi, afterEach } from 'vitest';
import Server from '../src/Server.js';

const { fileBots, fileOwner } = Server.prototype;

describe('Server file_id resolution across bots', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('tries this bot first, then each BOT_TOKENS bot once', () => {
    vi.stubEnv('BOT_TOKEN', '111:own');
    vi.stubEnv('BOT_TOKENS', ' 222:hubs ,111:own,222:hubs,');
    const self = { bot: { telegram: { name: 'own' } } };
    const bots = fileBots.call(self);
    expect(bots[0]).toBe(self.bot.telegram);
    expect(bots.slice(1).map(t => t.token)).toEqual(['222:hubs']);
  });

  it('answers with the first bot that opens the file_id', async () => {
    const own = {
      getFile: vi.fn(async () =>
        Promise.reject(new Error('400: Bad Request: wrong file_id'))
      ),
    };
    const hubs = {
      getFile: vi.fn(async () => ({ file_path: 'photos/file_1.jpg' })),
    };
    const found = await fileOwner.call(
      { fileBots: () => [own, hubs] },
      'AgACAgQAAyEF'
    );
    expect(found.telegram).toBe(hubs);
    expect(found.info.file_path).toBe('photos/file_1.jpg');
  });

  it('answers null when no bot opens it', async () => {
    const none = {
      getFile: vi.fn(async () => Promise.reject(new Error('400'))),
    };
    expect(
      await fileOwner.call({ fileBots: () => [none] }, 'AgACAgQAAyEF')
    ).toBeNull();
  });
});
