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
  wouldCreateDependencyCycle,
  type Quest,
  type QuestInitiator,
} from '@holons/core/tasks';
import {
  createChecklist,
  getChecklist,
  addItemsToChecklist,
  type ChecklistStore,
} from '@holons/core/checklists';
import type { DiscordUser, Feature, InvocationContext } from '../types.js';
import type { ParsedCustomId } from '../ui/customId.js';
import {
  checklistComponents,
  checklistEmbed,
  questComponents,
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
      .setDescription('List quests in this holon')
      .addStringOption(opt =>
        opt
          .setName('type')
          .setDescription('Only show one kind')
          .setRequired(false)
          .addChoices(
            { name: 'task', value: 'task' },
            { name: 'event', value: 'event' },
            { name: 'offer', value: 'offer' },
            { name: 'request', value: 'request' }
          )
      ),
    new SlashCommandBuilder()
      .setName('quest')
      .setDescription('Work with a single quest')
      .addSubcommand(sub =>
        sub
          .setName('show')
          .setDescription('Show one quest as an interactive card')
          .addStringOption(opt =>
            opt.setName('id').setDescription('Quest id').setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('depend')
          .setDescription('Make one quest depend on another')
          .addStringOption(opt =>
            opt
              .setName('id')
              .setDescription('The quest that depends')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('on')
              .setDescription('The quest it must come after')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('checklist')
          .setDescription('Show or create a checklist attached to a quest')
          .addStringOption(opt =>
            opt.setName('id').setDescription('Quest id').setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('items')
              .setDescription('Comma-separated items to add')
              .setRequired(false)
          )
      ),
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

    if (interaction.commandName === 'quest') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'depend') {
        await dependQuest(interaction, ctx, ctx.holonId);
      } else if (sub === 'checklist') {
        await questChecklist(interaction, ctx, ctx.holonId);
      } else {
        await showQuest(interaction, ctx, ctx.holonId);
      }
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
  const typeFilter = interaction.options.getString('type');
  const all = ((await ctx.holosphere.getAll(holonId, QUESTS_BUCKET)) ??
    []) as Quest[];
  const active = all
    .filter(q => q && !q._deleted)
    .filter(q => !typeFilter || (q.type ?? 'task') === typeFilter)
    .sort((a, b) => {
      // Ongoing before completed, then newest first.
      const ac = a.status === 'completed' ? 1 : 0;
      const bc = b.status === 'completed' ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return String(b.created ?? '').localeCompare(String(a.created ?? ''));
    });

  if (active.length === 0) {
    await interaction.reply({
      content: typeFilter
        ? `No ${typeFilter} quests yet.`
        : 'No quests yet. Create one with `/task`, `/event`, `/offer` or `/request`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const shown = active.slice(0, 25);
  // Append the id so members can reopen the interactive card via `/quest`.
  const lines = shown.map(q => `${questSummaryLine(q)}  \`${q.id}\``);
  const more =
    active.length > shown.length
      ? `\n\n…and ${active.length - shown.length} more.`
      : '';
  const heading = typeFilter ? `**Quests · ${typeFilter}**` : '**Quests**';

  await interaction.reply({
    content: `${heading} (${active.length})\n\n${lines.join('\n')}${more}\n\n_Open one with_ \`/quest show id:<id>\``,
  });
}

async function showQuest(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const questId = interaction.options.getString('id', true).trim();
  const quest = (await ctx.holosphere.get(
    holonId,
    QUESTS_BUCKET,
    questId
  )) as Quest | null;

  if (!quest || quest._deleted) {
    await interaction.reply({
      content: `No quest with id \`${questId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    embeds: [questEmbed(quest)],
    components: questComponents(FEATURE_ID, quest),
  });
}

/**
 * `/quest depend` — record that `id` must come after `on`. Rejected if it
 * would close a cycle (the dependency graph must stay a DAG), using the core
 * `wouldCreateDependencyCycle` guard against the full quest set.
 */
async function dependQuest(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const fromId = interaction.options.getString('id', true).trim();
  const onId = interaction.options.getString('on', true).trim();

  if (fromId === onId) {
    await interaction.reply({
      content: 'A quest cannot depend on itself.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const all = ((await ctx.holosphere.getAll(holonId, QUESTS_BUCKET)) ??
    []) as Quest[];
  const quest = all.find(q => String(q.id) === fromId && !q._deleted);
  const dep = all.find(q => String(q.id) === onId && !q._deleted);
  if (!quest || !dep) {
    await interaction.reply({
      content: `Unknown quest id: \`${!quest ? fromId : onId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (wouldCreateDependencyCycle(all, fromId, onId)) {
    await interaction.reply({
      content: '⛔ That would create a dependency cycle.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const deps = ((quest.dependencies as string[] | undefined) ?? []).map(String);
  if (deps.includes(onId)) {
    await interaction.reply({
      content: `\`${quest.title}\` already depends on \`${dep.title}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  quest.dependencies = [...deps, onId];
  await saveTaskToHolon(ctx.holosphere, holonId, quest);

  await interaction.reply({
    embeds: [questEmbed(quest)],
    components: questComponents(FEATURE_ID, quest),
  });
}

/**
 * `/quest checklist` — show (or lazily create) a checklist attached to a
 * quest. The checklist id is the quest id (base36, colon/underscore-free), so
 * it links cleanly and its toggle buttons route to the checklists feature.
 */
async function questChecklist(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const questId = interaction.options.getString('id', true).trim();
  const quest = (await ctx.holosphere.get(
    holonId,
    QUESTS_BUCKET,
    questId
  )) as Quest | null;
  if (!quest || quest._deleted) {
    await interaction.reply({
      content: `No quest with id \`${questId}\`.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const store = ctx.holosphere as unknown as ChecklistStore;
  const name = String(quest.id);
  let checklist = await getChecklist(store, holonId, name);

  if (!checklist) {
    const created = await createChecklist(store, holonId, name, {
      type: 'quest',
      questId: name,
      parentTitle: quest.title,
      creator: interaction.user.id,
    });
    if (!created.ok) {
      await interaction.reply({
        content: 'Could not create a checklist for this quest.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    checklist = created.checklist;
    quest.checklistId = name;
    await saveTaskToHolon(ctx.holosphere, holonId, quest);
  }

  const items = interaction.options.getString('items');
  if (items) {
    const added = await addItemsToChecklist(store, holonId, name, items);
    if (added.ok) checklist = added.checklist;
  }

  await interaction.reply({
    embeds: [checklistEmbed(checklist)],
    components: checklistComponents('checklists', checklist),
  });
}
