/**
 * The discord.js gateway client. Slash commands and component interactions
 * only need the `Guilds` intent — we don't read message content.
 */
import { Client, GatewayIntentBits } from 'discord.js';

export function createClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}
