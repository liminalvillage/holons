/**
 * Quests/tasks feature. Slash commands create quests of each type; buttons on
 * the resulting message let members join/leave and mark the quest complete.
 *
 * All domain logic (record creation, participant toggling, completion rules,
 * persistence) lives in `@holons/core/tasks` — this module only translates
 * Discord interactions into those calls and renders the result.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  applyTaskCompletion,
  createMarketItem,
  createTask,
  saveTaskToHolon,
  toggleAppreciation,
  toggleParticipant,
  type Quest,
  type QuestInitiator,
} from '@holons/core/tasks';
import type { DiscordUser, Feature, InvocationContext } from '../types.js';
import type { ParsedCustomId } from '../ui/customId.js';
import { questComponents, questEmbed } from '../ui/DiscordUI.js';
import { questSummaryLine } from '../ui/format.js';

const FEATURE_ID = 'quests';
const QUESTS_BUCKET = 'quests';

/** Quest ids must avoid ':' (customId separator) and '_' (legacy parsing). */
function generateQuestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function userFrom(interaction: {
  user: { id: string; username: string };
}): DiscordUser {
  return { id: interaction.user.id, username: interaction.user.username };
}

function initiatorFrom(user: DiscordUser): QuestInitiator {
  return { id: user.id, username: user.username, firstName: user.username };
}

async function replyNeedHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

function buildCreateCommand(
  name: string,
  description: string,
  withLocation: boolean
): SlashCommandBuilder {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addStringOption(opt =>
      opt.setName('title').setDescription('Short title').setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('description')
        .setDescription('More detail')
        .setRequired(false)
    );
  if (withLocation) {
    builder.addStringOption(opt =>
      opt.setName('location').setDescription('Where').setRequired(false)
    );
  }
  return builder as SlashCommandBuilder;
}

export const questsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    buildCreateCommand('task', 'Create a task the community can pick up', true),
    buildCreateCommand('event', 'Create a scheduled event', true),
    buildCreateCommand('offer', 'Offer a resource or skill', false),
    buildCreateCommand('request', 'Request help from the community', false),
    new SlashCommandBuilder()
      .setName('quests')
      .setDescription('List quests in this holon'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await replyNeedHolon(interaction);
      return;
    }

    if (interaction.commandName === 'quests') {
      await listQuests(interaction, ctx, ctx.holonId);
      return;
    }

    await createQuest(interaction, ctx, ctx.holonId, interaction.commandName);
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
    const [questId] = parsed.args;
    const quest = (await ctx.holosphere.get(
      ctx.holonId,
      QUESTS_BUCKET,
      questId
    )) as Quest | null;

    if (!quest) {
      await interaction.reply({
        content: 'That quest no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = userFrom(interaction);

    if (parsed.action === 'toggle') {
      const updated = toggleParticipant(quest, initiatorFrom(user));
      await saveTaskToHolon(ctx.holosphere, ctx.holonId, updated);
      await interaction.update({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
      return;
    }

    if (parsed.action === 'appreciate') {
      const updated = toggleAppreciation(quest, initiatorFrom(user));
      await saveTaskToHolon(ctx.holosphere, ctx.holonId, updated);
      await interaction.update({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
      return;
    }

    if (parsed.action === 'complete') {
      const result = applyTaskCompletion(quest, user.id);
      if (!result.ok) {
        await interaction.reply({
          content:
            result.reason === 'forbidden'
              ? 'Only the initiator or a participant can complete this quest.'
              : `Cannot complete this quest (${result.reason}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await saveTaskToHolon(ctx.holosphere, ctx.holonId, result.task);
      await interaction.update({
        embeds: [questEmbed(result.task)],
        components: questComponents(FEATURE_ID, result.task),
      });
    }
  },
};

async function createQuest(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string,
  type: string
): Promise<void> {
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description') ?? undefined;
  const location = interaction.options.getString('location') ?? undefined;
  const user = userFrom(interaction);

  let quest: Quest;
  if (type === 'offer' || type === 'request') {
    quest = createMarketItem({
      holonId,
      initiator: initiatorFrom(user),
      kind: type,
      title,
      description,
    });
  } else {
    quest = createTask({
      holonId,
      initiator: initiatorFrom(user),
      title,
      type,
    });
    if (description) quest.description = description;
    if (location) quest.location = location;
  }
  quest.id = generateQuestId();

  await saveTaskToHolon(ctx.holosphere, holonId, quest);
  await interaction.reply({
    embeds: [questEmbed(quest)],
    components: questComponents(FEATURE_ID, quest),
  });
}

async function listQuests(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const all = ((await ctx.holosphere.getAll(holonId, QUESTS_BUCKET)) ??
    []) as Quest[];
  const active = all
    .filter(q => q && !q._deleted)
    .sort((a, b) => {
      // Ongoing before completed, then newest first.
      const ac = a.status === 'completed' ? 1 : 0;
      const bc = b.status === 'completed' ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return String(b.created ?? '').localeCompare(String(a.created ?? ''));
    });

  if (active.length === 0) {
    await interaction.reply({
      content:
        'No quests yet. Create one with `/task`, `/event`, `/offer` or `/request`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const shown = active.slice(0, 25);
  const lines = shown.map(questSummaryLine);
  const more =
    active.length > shown.length
      ? `\n\n…and ${active.length - shown.length} more.`
      : '';

  await interaction.reply({
    content: `**Quests** (${active.length})\n\n${lines.join('\n')}${more}`,
  });
}
