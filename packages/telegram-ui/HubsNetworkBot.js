// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

/**
 * HubsNetworkBot — pm2 entry point for the @HubsNetwork_Bot Telegram bot.
 *
 * One of these thin files per bot, so `pm2 list` shows a real name per bot
 * rather than three rows all called HolonsBot. The file itself carries no
 * logic; it only establishes the three things the shared core cannot work out
 * for itself when pm2 spawns it:
 *
 *  1. **cwd.** The package reads and writes a pile of cwd-relative paths —
 *     `./contracts/*.json`, `./html/*`, `./images/*`, and above all the
 *     Holosphere store at `./holosphere-store` (HOLOSPHERE_STORE_DIR). pm2 is
 *     started from wherever the operator happened to be, so pin the cwd here;
 *     otherwise the bot opens an empty store and re-syncs from the relays
 *     into a directory nobody expects.
 *  2. **Identity.** `utils/config.js` loads the monorepo root `.env`, which
 *     holds HolonsBot's token — so a bare copy of this file would just be a
 *     second HolonsBot and Telegram would reject it with a 409. Loading the
 *     per-bot `.env.hubsnetwork` first fixes that: dotenv never overwrites an
 *     entry already present in process.env, so these values win.
 *  3. **TypeScript.** The core is `core/HolonsBotCore.ts` and pm2's
 *     interpreter is a plain `node`, so tsx's ESM loader has to be registered
 *     before anything pulls the core in.
 *
 * Startup itself — global error handlers, retry-on-failure, graceful shutdown
 * — already lives in `src/HolonsBot.js`, so hand off to it rather than growing
 * a second startup path.
 *
 * NOTE: the store is per working directory, so two bots launched from this
 * same checkout would share one `./holosphere-store`. Give each additional bot
 * its own checkout (as /root/RegenOS and /root/harvest do), or set
 * HOLOSPHERE_STORE_DIR in its `.env.<bot>`.
 */

import { register } from 'tsx/esm/api';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const packageRoot = dirname(fileURLToPath(import.meta.url));

process.chdir(packageRoot);
dotenv.config({ path: resolve(packageRoot, '../../.env.hubsnetwork') });

register();

await import('./src/HolonsBot.js');
