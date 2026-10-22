// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, it, expect, vi, afterEach } from 'vitest';
import Server from '../src/Server.js';
import { fileLink } from '../src/FileBots.js';

const { fileBots, fileOwner, getUserPicture } = Server.prototype;

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

  it('asks each bot for an avatar until one has met the user', async () => {
    const own = {
      getUserProfilePhotos: vi.fn(async () =>
        Promise.reject(new Error('400: Bad Request: user not found'))
      ),
      getFileLink: vi.fn(),
    };
    const quiet = {
      getUserProfilePhotos: vi.fn(async () => ({ total_count: 0, photos: [] })),
      getFileLink: vi.fn(),
    };
    const hubs = {
      getUserProfilePhotos: vi.fn(async () => ({
        total_count: 1,
        photos: [[{ file_id: 'small' }, { file_id: 'big' }]],
      })),
      getFileLink: vi.fn(async id => new URL(`https://api.telegram.org/${id}`)),
    };
    const self = {
      validateUserId: () => true,
      fileBots: () => [own, quiet, hubs],
    };
    expect(await getUserPicture.call(self, '235114395')).toBe(
      'https://api.telegram.org/big'
    );
    expect(hubs.getFileLink).toHaveBeenCalledWith('big');
    expect(own.getFileLink).not.toHaveBeenCalled();
  });

  it('answers empty when no bot has a photo of the user', async () => {
    const none = {
      getUserProfilePhotos: vi.fn(async () => ({ total_count: 0, photos: [] })),
    };
    const self = { validateUserId: () => true, fileBots: () => [none] };
    expect(await getUserPicture.call(self, '235114395')).toBe('');
  });

  it('links a stored file_id through the bot that owns it', async () => {
    vi.stubEnv('BOT_TOKEN', '111:own');
    vi.stubEnv('BOT_TOKENS', '');
    const own = {
      getFile: vi.fn(async () => ({ file_path: 'photos/a.jpg' })),
      getFileLink: vi.fn(
        async info => new URL(`https://t.me/${info.file_path}`)
      ),
    };
    expect((await fileLink(own, 'AgAC')).href).toBe(
      'https://t.me/photos/a.jpg'
    );
    expect(own.getFile).toHaveBeenCalledTimes(1);
  });

  it('links nothing when no bot opens the file_id', async () => {
    vi.stubEnv('BOT_TOKENS', '');
    const own = {
      getFile: vi.fn(async () => Promise.reject(new Error('400'))),
    };
    expect(await fileLink(own, 'AgAC')).toBeNull();
  });
});
