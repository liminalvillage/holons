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
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  applyTaskCompletion,
  createMarketItem,
  createTask,
  deleteTaskWithCascade,
  saveTaskToHolon,
  toggleAppreciation,
  toggleParticipant,
  toggleStopper,
  type Quest,
  type QuestInitiator,
} from '@holons/core/tasks';
import type { DiscordUser, Feature, InvocationContext } from '../types.js';
import type { ParsedCustomId } from '../ui/customId.js';
import {
  questComponents,
  questEditModal,
  questEmbed,
} from '../ui/DiscordUI.js';
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

/**
 * Guard against partial Holosphere reads: GUN can surface a quest before its
 * array fields have synced, which would make the core toggles throw. Coerce the
 * list fields to arrays so handlers never crash mid-interaction.
 */
function normalizeQuest(quest: Quest | null): Quest | null {
  if (!quest) return null;
  return {
    ...quest,
    participants: Array.isArray(quest.participants) ? quest.participants : [],
    appreciation: Array.isArray(quest.appreciation) ? quest.appreciation : [],
    stoppers: Array.isArray(quest.stoppers) ? quest.stoppers : [],
  };
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
    new SlashCommandBuilder()
      .setName('tasks')
      .setDescription('List currently open tasks'),
    new SlashCommandBuilder()
      .setName('board')
      .setDescription('List all offers and requests'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await replyNeedHolon(interaction);
      return;
    }

    if (
      interaction.commandName === 'quests' ||
      interaction.commandName === 'tasks' ||
      interaction.commandName === 'board'
    ) {
      await listQuests(interaction, ctx, ctx.holonId, interaction.commandName);
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
    const holonId = ctx.holonId;
    const [questId] = parsed.args;
    const user = userFrom(interaction);

    // `edit` opens a modal, which MUST be the first response — handle it before
    // any defer. (Its own Holosphere read is one quick fetch.)
    if (parsed.action === 'edit') {
      const quest = normalizeQuest(
        (await ctx.holosphere.get(
          holonId,
          QUESTS_BUCKET,
          questId
        )) as Quest | null
      );
      if (!quest) {
        await interaction.reply({
          content: 'That quest no longer exists.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!isInitiator(quest, user.id)) {
        await interaction.reply({
          content: 'Only the initiator can edit this quest.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.showModal(questEditModal(FEATURE_ID, quest));
      return;
    }

    // Everything else edits the message. Acknowledge IMMEDIATELY so a slow
    // Holosphere round-trip can't blow Discord's 3s interaction deadline (which
    // would drop the buttons). After deferUpdate we use editReply / followUp.
    await interaction.deferUpdate();

    const quest = normalizeQuest(
      (await ctx.holosphere.get(
        holonId,
        QUESTS_BUCKET,
        questId
      )) as Quest | null
    );
    if (!quest) {
      await interaction.followUp({
        content: 'That quest no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (parsed.action === 'toggle') {
      const updated = toggleParticipant(quest, initiatorFrom(user));
      await saveTaskToHolon(ctx.holosphere, holonId, updated);
      await interaction.editReply({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
      return;
    }

    if (parsed.action === 'appreciate') {
      const updated = toggleAppreciation(quest, initiatorFrom(user));
      await saveTaskToHolon(ctx.holosphere, holonId, updated);
      await interaction.editReply({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
      return;
    }

    if (parsed.action === 'complete') {
      const result = applyTaskCompletion(quest, user.id);
      if (!result.ok) {
        await interaction.followUp({
          content:
            result.reason === 'forbidden'
              ? 'Only the initiator or a participant can complete this quest.'
              : `Cannot complete this quest (${result.reason}).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await saveTaskToHolon(ctx.holosphere, holonId, result.task);
      await interaction.editReply({
        embeds: [questEmbed(result.task)],
        components: questComponents(FEATURE_ID, result.task),
      });
      return;
    }

    if (parsed.action === 'stop') {
      const { task: updated } = toggleStopper(quest, initiatorFrom(user));
      await saveTaskToHolon(ctx.holosphere, holonId, updated);
      await interaction.editReply({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
      return;
    }

    if (parsed.action === 'delete') {
      if (!isInitiator(quest, user.id)) {
        await interaction.followUp({
          content: 'Only the initiator can delete this quest.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const result = await deleteTaskWithCascade(
        ctx.holosphere as unknown as Parameters<
          typeof deleteTaskWithCascade
        >[0],
        holonId,
        questId
      );
      const cascade =
        result.forwardsFound > 0
          ? ` (cleaned up ${result.forwardsDeleted}/${result.forwardsFound} federated copies)`
          : '';
      await interaction.editReply({
        content: `🗑️ **${quest.title}** deleted${cascade}.`,
        embeds: [],
        components: [],
      });
      return;
    }
  },

  async handleModal(
    interaction: ModalSubmitInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (parsed.action !== 'editSubmit') return;
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
    if (!isInitiator(quest, userFrom(interaction).id)) {
      await interaction.reply({
        content: 'Only the initiator can edit this quest.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const field = (id: string): string =>
      interaction.fields.getTextInputValue(id).trim();
    const updated: Quest = { ...quest, title: field('title') || quest.title };
    setOrClear(updated, 'description', field('description'));
    setOrClear(updated, 'location', field('location'));
    setOrClear(updated, 'when', field('when'));

    await saveTaskToHolon(ctx.holosphere, ctx.holonId, updated);

    // The modal was opened from the quest message, so we can update it in place.
    if (interaction.isFromMessage()) {
      await interaction.update({
        embeds: [questEmbed(updated)],
        components: questComponents(FEATURE_ID, updated),
      });
    } else {
      await interaction.reply({
        content: '✅ Quest updated.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

/** True when the acting user opened the quest (initiator id matches). */
function isInitiator(quest: Quest, userId: string): boolean {
  return String(quest.initiator?.id ?? '') === String(userId);
}

/** Set a field to the trimmed value, or delete it when the value is empty. */
function setOrClear(
  quest: Quest,
  key: 'description' | 'location' | 'when',
  value: string
): void {
  if (value) quest[key] = value;
  else delete quest[key];
}

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

const MARKET_TYPES = new Set(['offer', 'request', 'need']);

/** Per-command list view config. */
function listView(command: string): {
  heading: string;
  empty: string;
  keep: (q: Quest) => boolean;
} {
  if (command === 'tasks') {
    return {
      heading: 'Open tasks',
      empty: 'No open tasks. Create one with `/task`.',
      keep: q => q.status !== 'completed' && !MARKET_TYPES.has(String(q.type)),
    };
  }
  if (command === 'board') {
    return {
      heading: 'Board — offers & requests',
      empty: 'No offers or requests yet. Add one with `/offer` or `/request`.',
      keep: q => MARKET_TYPES.has(String(q.type)),
    };
  }
  return {
    heading: 'Quests',
    empty:
      'No quests yet. Create one with `/task`, `/event`, `/offer` or `/request`.',
    keep: () => true,
  };
}

async function listQuests(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string,
  command: string
): Promise<void> {
  const view = listView(command);
  const all = ((await ctx.holosphere.getAll(holonId, QUESTS_BUCKET)) ??
    []) as Quest[];
  const active = all
    .filter(q => q && !q._deleted && view.keep(q))
    .sort((a, b) => {
      // Ongoing before completed, then newest first.
      const ac = a.status === 'completed' ? 1 : 0;
      const bc = b.status === 'completed' ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return String(b.created ?? '').localeCompare(String(a.created ?? ''));
    });

  if (active.length === 0) {
    await interaction.reply({
      content: view.empty,
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
    content: `**${view.heading}** (${active.length})\n\n${lines.join('\n')}${more}`,
  });
}
