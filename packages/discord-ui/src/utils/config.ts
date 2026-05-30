/**
 * Environment configuration for the Discord UI.
 *
 * Loads the monorepo-root `.env` first (single source of truth shared with the
 * web app, telegram-ui and mcp-ui), then a package-local `.env` for overrides.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/discord-ui/src/utils -> repo root is four levels up.
dotenv.config({ path: resolve(__dirname, '../../../../.env') });
dotenv.config();

export interface DiscordConfig {
  /** Discord bot token. */
  readonly token: string | undefined;
  /** Discord application (client) id, needed to register slash commands. */
  readonly appId: string | undefined;
  /** Optional dev guild id — register commands there for instant updates. */
  readonly guildId: string | undefined;
  /** Holosphere application namespace. */
  readonly appName: string;
}

export const config: DiscordConfig = {
  token: process.env.DISCORD_TOKEN,
  appId: process.env.DISCORD_APP_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  appName: process.env.APPNAME || 'Holons',
};
