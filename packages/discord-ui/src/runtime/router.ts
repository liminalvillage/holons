/**
 * Single `interactionCreate` dispatcher. Builds the per-interaction context
 * and routes slash commands by name, and components/modals by the feature
 * namespace encoded in their customId.
 */
import {
  Events,
  MessageFlags,
  type Client,
  type Interaction,
} from 'discord.js';
import { buildInvocationContext } from '../context.js';
import { commandIndex, featureIndex, features } from '../features/index.js';
import type { HolonBindingStore, HoloStore } from '../types.js';
import { parseCustomId } from '../ui/customId.js';
import { errorMessage } from '../utils/errorHandler.js';
import { log } from '../utils/logger.js';

export interface RouterDeps {
  holosphere: HoloStore;
  bindings: HolonBindingStore;
}

export function attachRouter(client: Client, deps: RouterDeps): void {
  const byCommand = commandIndex(features);
  const byFeature = featureIndex(features);

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      const ctx = await buildInvocationContext({
        holosphere: deps.holosphere,
        bindings: deps.bindings,
        guildId: interaction.guildId ?? null,
      });

      if (interaction.isChatInputCommand()) {
        const feature = byCommand.get(interaction.commandName);
        if (feature) await feature.handleCommand(interaction, ctx);
        return;
      }

      if (interaction.isMessageComponent()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        await byFeature
          .get(parsed.feature)
          ?.handleComponent?.(interaction, parsed, ctx);
        return;
      }

      if (interaction.isModalSubmit()) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return;
        await byFeature
          .get(parsed.feature)
          ?.handleModal?.(interaction, parsed, ctx);
      }
    } catch (err) {
      log.error('Interaction handler failed', { error: errorMessage(err) });
      await replyError(interaction);
    }
  });
}

async function replyError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;
  const content = '⚠️ Something went wrong handling that interaction.';
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    /* nothing more we can do */
  }
}
