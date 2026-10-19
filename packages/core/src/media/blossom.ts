// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Blossom (BUD-01/02/11) — content-addressed blob hosting for pictures.
//
// A Telegram file_id only opens with the token of the bot that received it,
// and an inline data: URI is too big for a relay event. A Blossom blob is
// neither: any surface, any bot and any Nostr client fetches it by URL, and
// the URL names the bytes (sha256), so every server holding them serves the
// same picture. The uploader proves who it is with a signed kind-24242 event;
// the key stays behind a `NostrSigner`.

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { NostrSigner } from '../holosphere/signers.js';

/** BUD-11 authorization event kind. */
export const BLOSSOM_AUTH_KIND = 24242;

/** The Holons Blossom server — the default when an app configures none. */
export const DEFAULT_MEDIA_SERVERS: readonly string[] = Object.freeze(['https://blossom.holons.io']);

/** How long an upload authorization stays valid, in seconds. */
export const UPLOAD_AUTH_TTL_S = 300;

/** What a Blossom server answers for a stored blob (BUD-02). */
export interface BlobDescriptor {
  url: string;
  sha256: string;
  size: number;
  type: string;
  uploaded?: number;
}

/**
 * The media servers an app should use: the configured comma-separated list
 * (`MEDIA_SERVERS` / `VITE_MEDIA_SERVERS`), or the default. Trailing slashes
 * are dropped so paths join cleanly.
 */
export function resolveMediaServers(raw: string | undefined | null | string[]): string[] {
  const list = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((s) => String(s).trim().replace(/\/+$/, ''))
    .filter((s) => /^https?:\/\//i.test(s));
  return list.length ? list : [...DEFAULT_MEDIA_SERVERS];
}

/** Lowercase hex sha256 of the exact bytes — the blob's name everywhere. */
export function blobHash(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/**
 * The unsigned kind-24242 upload authorization, scoped to one blob and one
 * server so a leaked token can't be replayed for anything else.
 */
export function uploadAuthTemplate(opts: { sha256: string; server: string; now?: number; ttlS?: number }) {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: now,
    tags: [
      ['t', 'upload'],
      ['x', opts.sha256],
      ['server', new URL(opts.server).hostname.toLowerCase()],
      ['expiration', String(now + (opts.ttlS ?? UPLOAD_AUTH_TTL_S))],
    ],
    content: 'Upload picture',
  };
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url without padding — runs the same in Node and the browser. */
function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** The `Authorization` header value for a signed BUD-11 event. */
export function blossomAuthHeader(event: object): string {
  return `Nostr ${base64url(new TextEncoder().encode(JSON.stringify(event)))}`;
}

export interface UploadOptions {
  bytes: Uint8Array;
  /** MIME type, e.g. `image/jpeg`. */
  type: string;
  signer: NostrSigner;
  servers?: string[];
  fetch?: typeof fetch;
  now?: number;
}

/**
 * Upload a blob to the first server that accepts it and return its
 * descriptor. Servers are tried in order; the last failure is thrown when
 * none takes it, so callers decide whether to keep a fallback.
 */
export async function uploadBlob(opts: UploadOptions): Promise<BlobDescriptor> {
  const doFetch = opts.fetch ?? fetch;
  const hash = blobHash(opts.bytes);
  let lastError: unknown = new Error('uploadBlob: no media server configured');
  for (const server of resolveMediaServers(opts.servers)) {
    try {
      const auth = opts.signer.sign(uploadAuthTemplate({ sha256: hash, server, now: opts.now }));
      const resp = await doFetch(`${server}/upload`, {
        method: 'PUT',
        headers: {
          Authorization: blossomAuthHeader(auth),
          'Content-Type': opts.type,
          'X-SHA-256': hash,
        },
        body: opts.bytes as unknown as RequestInit['body'],
      });
      if (!resp.ok) {
        const reason = resp.headers.get('x-reason') ?? '';
        throw new Error(`${server}: ${resp.status} ${reason}`.trim());
      }
      const descriptor = (await resp.json()) as BlobDescriptor;
      // A server must not alter the bytes; a different hash means it did.
      if (descriptor.sha256 !== hash || !/^https?:\/\//i.test(descriptor.url ?? '')) {
        throw new Error(`${server}: unexpected blob descriptor`);
      }
      return descriptor;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
