/**
 * Registers the features' slash commands with Discord via the REST API.
 *
 * Importable as `registerCommands()` (called on startup) and runnable directly
 * (`pnpm -F @holons/discord-ui register`) to (re)sync commands out of band.
 *
 * If `DISCORD_GUILD_ID` is set, commands register to that single guild and
 * appear instantly — ideal for development. Otherwise they register globally,
 * which can take up to an hour to propagate.
 */
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { features } from '../features/index.js';
import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

export function collectCommandJSON(): unknown[] {
  return features.flatMap(feature =>
    feature.commands.map(command => command.toJSON())
  );
}

export interface RegisterOptions {
  token?: string;
  appId?: string;
  guildId?: string;
}

export async function registerCommands(
  opts: RegisterOptions = {}
): Promise<void> {
  const token = opts.token ?? config.token;
  const appId = opts.appId ?? config.appId;
  const guildId = opts.guildId ?? config.guildId;

  if (!token || !appId) {
    throw new Error(
      'DISCORD_TOKEN and DISCORD_APP_ID are required to register slash commands'
    );
  }

  const body = collectCommandJSON();
  const rest = new REST({ version: '10' }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(appId, guildId)
    : Routes.applicationCommands(appId);

  await rest.put(route, { body });
  log.info('Registered slash commands', {
    count: body.length,
    scope: guildId ? `guild ${guildId}` : 'global',
  });
}

// Allow running this module directly as a CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  registerCommands().catch(err => {
    log.error('Slash command registration failed', { error: String(err) });
    process.exit(1);
  });
}
