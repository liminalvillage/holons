/**
 * Shopping-list feature. `/shopping add` / `/shopping list` plus per-item
 * toggle buttons and a "Remove checked" button.
 *
 * CRUD lives in `@holons/core/shopping` (pure functions over the checklist
 * document); this module loads/saves the document and renders it.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  CHECKLISTS_COLLECTION,
  SHOPPING_KEY,
  addItem,
  normalizeChecklist,
  removeChecked,
  toggleItem,
  type ShoppingChecklist,
} from '@holons/core/shopping';
import type { Feature, InvocationContext } from '../types.js';
import type { ParsedCustomId } from '../ui/customId.js';
import { shoppingComponents, shoppingEmbed } from '../ui/DiscordUI.js';

const FEATURE_ID = 'shopping';

async function loadList(
  ctx: InvocationContext,
  holonId: string
): Promise<ShoppingChecklist | null> {
  const raw = await ctx.holosphere.get(
    holonId,
    CHECKLISTS_COLLECTION,
    SHOPPING_KEY
  );
  return normalizeChecklist(raw);
}

async function saveList(
  ctx: InvocationContext,
  holonId: string,
  list: ShoppingChecklist
): Promise<void> {
  await ctx.holosphere.put(holonId, CHECKLISTS_COLLECTION, list);
}

export const shoppingFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('shopping')
      .setDescription('Manage the shared shopping list')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Add an item to the shopping list')
          .addStringOption(opt =>
            opt.setName('item').setDescription('Item to add').setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('Show the shopping list')
      ),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await interaction.reply({
        content:
          'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const holonId = ctx.holonId;
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const text = interaction.options.getString('item', true);
      const current = await loadList(ctx, holonId);
      const updated = addItem(current, text, {
        createdBy: interaction.user.id,
      });
      await saveList(ctx, holonId, updated);
      await interaction.reply({
        embeds: [shoppingEmbed(updated)],
        components: shoppingComponents(FEATURE_ID, updated),
      });
      return;
    }

    // sub === 'list'
    const list = await loadList(ctx, holonId);
    await interaction.reply({
      embeds: [shoppingEmbed(list)],
      components: shoppingComponents(FEATURE_ID, list),
    });
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const holonId = ctx.holonId;
    const current = await loadList(ctx, holonId);

    let updated: ShoppingChecklist | null = current;
    if (parsed.action === 'toggle') {
      updated = toggleItem(current, parsed.args[0]);
    } else if (parsed.action === 'clearChecked') {
      updated = removeChecked(current);
    }

    if (!updated) {
      await interaction.reply({
        content: 'The shopping list is empty.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await saveList(ctx, holonId, updated);
    await interaction.update({
      embeds: [shoppingEmbed(updated)],
      components: shoppingComponents(FEATURE_ID, updated),
    });
  },
};
