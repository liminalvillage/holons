/**
 * Top-level Discord bot lifecycle: build holosphere + client, wire the router,
 * register slash commands, and log in. Mirrors telegram-ui's `HolonsBotCore`
 * but for Discord (and far lighter — feature wiring is static via the registry).
 */
import { Events } from 'discord.js';
import createHoloSphere from '../createHoloSphere.js';
import { createClient } from '../runtime/client.js';
import { registerCommands } from '../runtime/registerCommands.js';
import { attachRouter } from '../runtime/router.js';
import type { HoloStore } from '../types.js';
import { HolosphereHolonBindings } from '../ui/holonBinding.js';
import { config } from '../utils/config.js';
import { errorMessage } from '../utils/errorHandler.js';
import { log } from '../utils/logger.js';

export class DiscordBot {
  private readonly client = createClient();
  private readonly holosphere = createHoloSphere(
    config.appName
  ) as unknown as HoloStore;
  private started = false;

  async init(): Promise<void> {
    if (this.started) return;
    if (!config.token) {
      throw new Error(
        'DISCORD_TOKEN is not set — cannot start the Discord bot'
      );
    }

    const bindings = new HolosphereHolonBindings(this.holosphere);
    attachRouter(this.client, { holosphere: this.holosphere, bindings });

    this.client.once(Events.ClientReady, readyClient => {
      log.info('Discord bot ready', { user: readyClient.user.tag });
    });

    if (config.appId) {
      try {
        await registerCommands();
      } catch (err) {
        // Non-fatal: the bot still runs against previously-registered commands.
        log.warn('Slash command registration failed', {
          error: errorMessage(err),
        });
      }
    } else {
      log.warn('DISCORD_APP_ID not set — skipping slash command registration');
    }

    await this.client.login(config.token);
    this.started = true;
    log.info('Discord bot initialization completed');
  }

  async shutdown(): Promise<void> {
    if (!this.started) return;
    log.info('Shutting down Discord bot');
    await this.client.destroy();
    this.started = false;
  }
}

export default DiscordBot;
