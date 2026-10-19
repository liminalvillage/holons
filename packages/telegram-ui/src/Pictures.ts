// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Pictures that outlive the bot that received them.
//
// A Telegram file_id only opens with this bot's token, so a picture stored as
// one is invisible to every other bot, to the web and kiosk image routes that
// hold a different token, and to other Nostr clients. On receipt the bot
// copies the bytes to Blossom (@holons/core/media) and stores the URL
// instead. If no media server takes it the file_id is kept, so a picture is
// never lost — it just stays bot-scoped until it is re-hosted.

import { resolveMediaServers, uploadBlob } from '@holons/core/media';
import { holonSigner } from './createHoloSphere.js';

const EXTENSION_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Give up on a slow media server rather than hold the reply. */
const UPLOAD_TIMEOUT_MS = 15_000;

/** Telegram serves octet-stream; name the type from the magic bytes. */
export function sniffImageType(bytes: Uint8Array, fallback = 'image/jpeg'): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) return 'image/webp';
  return fallback;
}

export interface HostDeps {
  signer?: ReturnType<typeof holonSigner>;
  servers?: string[];
  fetch?: typeof fetch;
}

/**
 * Copy a Telegram picture to Blossom and return its URL; on any failure
 * return the file_id unchanged. `telegram` is Telegraf's `ctx.telegram`.
 */
export async function hostTelegramPicture(
  telegram: { getFileLink(fileId: string): Promise<URL | string> },
  fileId: string | null | undefined,
  deps: HostDeps = {},
): Promise<string | null> {
  if (!fileId) return fileId ?? null;
  const signer = deps.signer ?? holonSigner();
  if (!signer) return fileId;
  const doFetch = deps.fetch ?? fetch;
  try {
    const link = new URL(String(await telegram.getFileLink(fileId)));
    const response = await doFetch(link, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`download ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const extension = link.pathname.split('.').pop()?.toLowerCase() ?? '';
    const type = sniffImageType(bytes, EXTENSION_MIMES[extension]);
    const blob = await uploadBlob({
      bytes,
      type,
      signer,
      servers: deps.servers ?? resolveMediaServers(process.env.MEDIA_SERVERS),
      fetch: doFetch,
    });
    return blob.url;
  } catch (error) {
    // Never log the file link: it carries the bot token.
    console.warn('[pictures] kept the Telegram file_id, Blossom upload failed:', (error as Error)?.message);
    return fileId;
  }
}
