// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * @fileoverview Every bot whose file_ids may be stored in the graph. A file_id
 * (and a user's profile photo) opens only with the token of the bot that
 * received it, and groups run by other bots store theirs.
 * @module src/FileBots
 */

import { Telegram } from 'telegraf';

const cache = new WeakMap();

/**
 * This bot first, then the tokens in BOT_TOKENS (comma-separated), each once.
 * @param {object} own - this bot's Telegraf `telegram`
 */
export function fileBots(own) {
  if (!cache.has(own)) {
    const ownToken = String(process.env.BOT_TOKEN ?? '');
    const others = String(process.env.BOT_TOKENS ?? '')
      .split(',')
      .map(t => t.replace(/[^A-Za-z0-9:_-]/g, ''))
      .filter(t => t && t !== ownToken);
    cache.set(own, [own, ...[...new Set(others)].map(t => new Telegram(t))]);
  }
  return cache.get(own);
}

/** The first of `bots` that opens this file_id, with its getFile answer. */
export async function fileOwner(bots, fileId) {
  for (const telegram of bots) {
    const info = await telegram.getFile(fileId).catch(() => null);
    if (info) return { telegram, info };
  }
  return null;
}

/** A download link for a stored file_id from whichever bot owns it, or null. */
export async function fileLink(own, fileId) {
  const found = await fileOwner(fileBots(own), fileId);
  return found ? found.telegram.getFileLink(found.info) : null;
}
