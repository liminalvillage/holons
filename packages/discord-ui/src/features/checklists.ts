/**
 * Checklists feature. `/checklist create|add|show|list` with per-item toggle
 * buttons. CRUD lives in `@holons/core/checklists` (store-based operations);
 * this module supplies the holosphere store and renders the result.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  addItemsToChecklist,
  createChecklist,
  getAllChecklists,
  getChecklist,
  toggleItem,
  type ChecklistStore,
} from '@holons/core/checklists';
import type { Feature, InvocationContext } from '../types.js';
import type { ParsedCustomId } from '../ui/customId.js';
import { checklistComponents, checklistEmbed } from '../ui/DiscordUI.js';
import { checklistSummaryLine } from '../ui/format.js';

const FEATURE_ID = 'checklists';

function store(ctx: InvocationContext): ChecklistStore {
  return ctx.holosphere as unknown as ChecklistStore;
}

/** Names must avoid `_` (core) and `:` (our customId separator). */
function invalidName(name: string): boolean {
  return !name || name.includes('_') || name.includes(':');
}

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

export const checklistsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('checklist')
      .setDescription('Create and manage checklists')
      .addSubcommand(sub =>
        sub
          .setName('create')
          .setDescription('Create a new checklist')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Checklist name')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('items')
              .setDescription('Comma-separated items')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Add items to a checklist')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Checklist name')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('items')
              .setDescription('Comma-separated items')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('show')
          .setDescription('Show a checklist')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Checklist name')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('List all checklists')
      ),
    new SlashCommandBuilder()
      .setName('checklists')
      .setDescription('Open the checklists interface'),
    new SlashCommandBuilder()
      .setName('agenda')
      .setDescription('Open the shared agenda'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }
    const holonId = ctx.holonId;

    if (interaction.commandName === 'checklists') {
      const all = await getAllChecklists(store(ctx), holonId);
      if (all.length === 0) {
        await interaction.reply({
          content: 'No checklists yet. Create one with `/checklist create`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `**Checklists** (${all.length})\n\n${all
          .map(checklistSummaryLine)
          .join('\n')}`,
      });
      return;
    }

    if (interaction.commandName === 'agenda') {
      const AGENDA = 'agenda';
      let checklist = await getChecklist(store(ctx), holonId, AGENDA);
      if (!checklist) {
        const created = await createChecklist(store(ctx), holonId, AGENDA, {
          creator: interaction.user.id,
        });
        if (!created.ok) {
          await interaction.reply({
            content: 'Could not open the agenda.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        checklist = created.checklist;
      }
      await interaction.reply({
        embeds: [checklistEmbed(checklist)],
        components: checklistComponents(FEATURE_ID, checklist),
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const all = await getAllChecklists(store(ctx), holonId);
      if (all.length === 0) {
        await interaction.reply({
          content: 'No checklists yet. Create one with `/checklist create`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        content: `**Checklists** (${all.length})\n\n${all
          .map(checklistSummaryLine)
          .join('\n')}`,
      });
      return;
    }

    const name = interaction.options.getString('name', true).trim();

    if (sub === 'create') {
      if (invalidName(name)) {
        await interaction.reply({
          content: 'Checklist names cannot contain `_` or `:`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const result = await createChecklist(store(ctx), holonId, name, {
        creator: interaction.user.id,
      });
      if (!result.ok) {
        await interaction.reply({
          content:
            result.reason === 'exists'
              ? `A checklist named \`${name}\` already exists.`
              : 'Invalid checklist name.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const items = interaction.options.getString('items');
      let checklist = result.checklist;
      if (items) {
        const added = await addItemsToChecklist(
          store(ctx),
          holonId,
          name,
          items
        );
        if (added.ok) checklist = added.checklist;
      }
      await interaction.reply({
        embeds: [checklistEmbed(checklist)],
        components: checklistComponents(FEATURE_ID, checklist),
      });
      return;
    }

    if (sub === 'add') {
      const items = interaction.options.getString('items', true);
      const result = await addItemsToChecklist(
        store(ctx),
        holonId,
        name,
        items
      );
      if (!result.ok) {
        await interaction.reply({
          content:
            result.reason === 'not_found'
              ? `No checklist named \`${name}\`. Create it with \`/checklist create\`.`
              : 'No valid items to add.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [checklistEmbed(result.checklist)],
        components: checklistComponents(FEATURE_ID, result.checklist),
      });
      return;
    }

    // show
    const checklist = await getChecklist(store(ctx), holonId, name);
    if (!checklist) {
      await interaction.reply({
        content: `No checklist named \`${name}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [checklistEmbed(checklist)],
      components: checklistComponents(FEATURE_ID, checklist),
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
    if (parsed.action !== 'toggle') return;

    const [name, indexRaw] = parsed.args;
    const checklist = await toggleItem(
      store(ctx),
      ctx.holonId,
      name,
      Number(indexRaw)
    );
    if (!checklist) {
      await interaction.reply({
        content: 'That checklist item no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.update({
      embeds: [checklistEmbed(checklist)],
      components: checklistComponents(FEATURE_ID, checklist),
    });
  },
};
