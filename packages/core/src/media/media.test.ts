// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { signerFromSecretKey } from '../holosphere/signers.js';
import {
  BLOSSOM_AUTH_KIND,
  DEFAULT_MEDIA_SERVERS,
  blobHash,
  blossomAuthHeader,
  isHostedPicture,
  pictureSource,
  pictureUrl,
  resolveMediaServers,
  uploadAuthTemplate,
  uploadBlob,
} from './index.js';

const SK = '1'.repeat(64);
const BYTES = new TextEncoder().encode('a picture');
const HASH = blobHash(BYTES);
const FILE_ID = 'AgACAgQAAyEFAAMBCIaEhgAD62rV4tEDzqRZePt7GNe2Pj58_6P6AAICEGsb';

function decodeAuth(header: string) {
  const b64 = header.replace(/^Nostr /, '').replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

describe('pictureSource / pictureUrl', () => {
  it('passes hosted URLs through', () => {
    const url = `https://blossom.holons.io/${HASH}.jpg`;
    expect(pictureSource(url)).toEqual({ kind: 'url', url });
    expect(pictureUrl(url)).toBe(url);
    expect(isHostedPicture(url)).toBe(true);
    expect(pictureUrl('/assets/logo.png')).toBe('/assets/logo.png');
  });

  it('inlines data URIs and raw base64 payloads', () => {
    expect(pictureUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(pictureSource('/9j/4AAQ')).toEqual({ kind: 'inline', url: 'data:image/jpeg;base64,/9j/4AAQ' });
    expect(isHostedPicture('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
  });

  it('routes a Telegram file_id through the image route', () => {
    expect(pictureSource(FILE_ID)).toEqual({ kind: 'telegram', fileId: FILE_ID });
    expect(pictureUrl(FILE_ID)).toBe(`/api/image?file_id=${FILE_ID}`);
    expect(pictureUrl(FILE_ID, { imageRoute: 'https://x.io/api/image' })).toBe(`https://x.io/api/image?file_id=${FILE_ID}`);
  });

  it('has nothing for empty values', () => {
    expect(pictureUrl(null)).toBe('');
    expect(pictureUrl('  ')).toBe('');
    expect(pictureSource(42)).toBeNull();
  });
});

describe('resolveMediaServers', () => {
  it('parses a list and drops trailing slashes and junk', () => {
    expect(resolveMediaServers('https://a.io/, nope ,https://b.io')).toEqual(['https://a.io', 'https://b.io']);
  });
  it('falls back to the default', () => {
    expect(resolveMediaServers('')).toEqual([...DEFAULT_MEDIA_SERVERS]);
    expect(resolveMediaServers(undefined)).toEqual([...DEFAULT_MEDIA_SERVERS]);
  });
});

describe('upload authorization', () => {
  it('is a kind-24242 upload scoped to one blob and one server', () => {
    const t = uploadAuthTemplate({ sha256: HASH, server: 'https://Blossom.Holons.io', now: 1000, ttlS: 60 });
    expect(t.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(t.tags).toEqual([
      ['t', 'upload'],
      ['x', HASH],
      ['server', 'blossom.holons.io'],
      ['expiration', '1060'],
    ]);
  });

  it('encodes the signed event as base64url without padding', () => {
    const event = signerFromSecretKey(SK).sign(uploadAuthTemplate({ sha256: HASH, server: 'https://a.io' }));
    const header = blossomAuthHeader(event);
    expect(header).toMatch(/^Nostr [A-Za-z0-9_-]+$/);
    const decoded = decodeAuth(header);
    expect(decoded).toEqual(JSON.parse(JSON.stringify(event)));
    expect(verifyEvent(decoded)).toBe(true);
  });
});

describe('uploadBlob', () => {
  const signer = signerFromSecretKey(SK);

  function server(status: number, body: object) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it('PUTs the bytes with a signed authorization and returns the descriptor', async () => {
    const descriptor = { url: `https://a.io/${HASH}.jpg`, sha256: HASH, size: BYTES.length, type: 'image/jpeg' };
    const { calls, fetchFn } = server(201, descriptor);
    const out = await uploadBlob({ bytes: BYTES, type: 'image/jpeg', signer, servers: ['https://a.io'], fetch: fetchFn });
    expect(out).toEqual(descriptor);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://a.io/upload');
    expect(calls[0].init.method).toBe('PUT');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['X-SHA-256']).toBe(HASH);
    expect(headers['Content-Type']).toBe('image/jpeg');
    const auth = decodeAuth(headers.Authorization);
    expect(auth.pubkey).toBe(signer.pubkey);
    expect(auth.tags).toContainEqual(['x', HASH]);
  });

  it('falls through to the next server when one refuses', async () => {
    const descriptor = { url: `https://b.io/${HASH}.jpg`, sha256: HASH, size: BYTES.length, type: 'image/jpeg' };
    const seen: string[] = [];
    const fetchFn = (async (url: string) => {
      seen.push(url);
      return url.startsWith('https://a.io')
        ? new Response('', { status: 503 })
        : new Response(JSON.stringify(descriptor), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await uploadBlob({ bytes: BYTES, type: 'image/jpeg', signer, servers: ['https://a.io', 'https://b.io'], fetch: fetchFn });
    expect(out.url).toBe(descriptor.url);
    expect(seen).toEqual(['https://a.io/upload', 'https://b.io/upload']);
  });

  it('rejects a descriptor for different bytes', async () => {
    const { fetchFn } = server(201, { url: 'https://a.io/x.jpg', sha256: 'f'.repeat(64), size: 1, type: 'image/jpeg' });
    await expect(uploadBlob({ bytes: BYTES, type: 'image/jpeg', signer, servers: ['https://a.io'], fetch: fetchFn })).rejects.toThrow(
      /unexpected blob descriptor/,
    );
  });

  it('throws the last failure when no server takes it', async () => {
    const fetchFn = (async () => new Response('', { status: 401, headers: { 'x-reason': 'auth' } })) as unknown as typeof fetch;
    await expect(uploadBlob({ bytes: BYTES, type: 'image/jpeg', signer, servers: ['https://a.io'], fetch: fetchFn })).rejects.toThrow(
      'https://a.io: 401 auth',
    );
  });
});
