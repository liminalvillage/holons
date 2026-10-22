// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/* global Response */
import { describe, it, expect, vi } from 'vitest';
import { signerFromSecretKey } from '@holons/core/holosphere';
import { blobHash } from '@holons/core/media';
import { hostTelegramPicture, sniffImageType } from '../src/Pictures.js';

const FILE_ID = 'AgACAgQAAyEFAAMBCIaEhgAD62rV4tEDzqRZePt7GNe2Pj58';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const signer = signerFromSecretKey('2'.repeat(64));
const telegram = {
  getFileLink: vi.fn(
    async () =>
      new URL('https://api.telegram.org/file/botTOKEN/photos/file_1.jpg')
  ),
};

function fakeFetch({ upload = 201 } = {}) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    const href = String(url);
    calls.push({ href, init });
    if (href.startsWith('https://api.telegram.org/'))
      return new Response(JPEG, { status: 200 });
    const hash = blobHash(JPEG);
    return upload >= 400
      ? new Response('', { status: upload })
      : new Response(
          JSON.stringify({
            url: `https://blossom.test/${hash}.jpg`,
            sha256: hash,
            size: JPEG.length,
            type: 'image/jpeg',
          }),
          { status: upload }
        );
  });
  return { fn, calls };
}

describe('hostTelegramPicture', () => {
  it('copies the photo to Blossom and returns the hosted URL', async () => {
    const { fn, calls } = fakeFetch();
    const url = await hostTelegramPicture(telegram, FILE_ID, {
      signer,
      servers: ['https://blossom.test'],
      fetch: fn,
    });
    expect(url).toBe(`https://blossom.test/${blobHash(JPEG)}.jpg`);
    const put = calls.find(c => c.href === 'https://blossom.test/upload');
    expect(put.init.method).toBe('PUT');
    expect(put.init.headers['Content-Type']).toBe('image/jpeg');
  });

  it('keeps the file_id when no media server takes it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fn } = fakeFetch({ upload: 503 });
    expect(
      await hostTelegramPicture(telegram, FILE_ID, {
        signer,
        servers: ['https://blossom.test'],
        fetch: fn,
      })
    ).toBe(FILE_ID);
    // The download link carries the bot token — it must never be logged.
    expect(JSON.stringify(warn.mock.calls)).not.toContain('botTOKEN');
    warn.mockRestore();
  });

  it('keeps the file_id when the bot has no signing key yet', async () => {
    const { fn } = fakeFetch();
    expect(await hostTelegramPicture(telegram, FILE_ID, { fetch: fn })).toBe(
      FILE_ID
    );
    expect(fn).not.toHaveBeenCalled();
  });

  it('passes an absent picture through', async () => {
    expect(await hostTelegramPicture(telegram, null, { signer })).toBeNull();
  });
});

describe('sniffImageType', () => {
  it('names the type from magic bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(
      'image/png'
    );
    expect(
      sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57]))
    ).toBe('image/webp');
    expect(sniffImageType(new Uint8Array([0, 0]), 'image/gif')).toBe(
      'image/gif'
    );
  });
});
