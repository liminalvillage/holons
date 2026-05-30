/**
 * Reminders feature. `/remind` schedules a one-shot or recurring reminder in
 * the current channel; `/reminders` lists them with Cancel buttons. The
 * scheduling math + persistence live in `@holons/core/scheduler`; a background
 * runtime (see ../runtime/scheduler.ts) fires due reminders into their channel.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  deleteReminder,
  listReminders,
  saveReminder,
  type Frequency,
  type Reminder,
  type SchedulerDB,
} from '@holons/core/scheduler';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'reminders';

function db(ctx: InvocationContext): SchedulerDB {
  return ctx.holosphere as unknown as SchedulerDB;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parse "in 10m" / "2h" / "3d" / "1w" / an absolute date, into a future Date. */
function parseWhen(input: string): Date | null {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^in\s+/, '');
  const rel = text.match(
    /^(\d+)\s*(m|min|mins|h|hour|hours|d|day|days|w|week|weeks)$/
  );
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0]; // m/h/d/w
    return new Date(Date.now() + n * UNIT_MS[unit]);
  }
  const abs = new Date(input.trim());
  if (!Number.isNaN(abs.getTime()) && abs.getTime() > Date.now()) return abs;
  return null;
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

function remindersEmbed(reminders: Reminder[]): EmbedBuilder {
  const lines = reminders.map(r => {
    const when = new Date(r.fireAt).toLocaleString();
    const repeat = r.frequency ? ` 🔄 ${r.frequency}` : '';
    return `• **${r.text}** — ${when}${repeat}`;
  });
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('⏰ Reminders')
    .setDescription(lines.join('\n'));
}

function cancelButtons(
  reminders: Reminder[]
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const shown = reminders.slice(0, 20);
  for (let i = 0; i < shown.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const r of shown.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(FEATURE_ID, 'cancel', r.id))
          .setLabel(`Cancel: ${r.text}`.slice(0, 70))
          .setStyle(ButtonStyle.Danger)
      );
    }
    rows.push(row);
  }
  return rows;
}

export const remindersFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('remind')
      .setDescription('Schedule a reminder in this channel')
      .addStringOption(opt =>
        opt
          .setName('when')
          .setDescription('e.g. "in 10m", "2h", "3d", or "2026-06-01 18:00"')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('text').setDescription('What to remind').setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName('repeat')
          .setDescription('Repeat cadence (optional)')
          .setRequired(false)
          .addChoices(
            { name: 'hourly', value: 'hourly' },
            { name: 'daily', value: 'daily' },
            { name: 'weekly', value: 'weekly' },
            { name: 'monthly', value: 'monthly' }
          )
      ),
    new SlashCommandBuilder()
      .setName('reminders')
      .setDescription('List this holon’s reminders'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }

    if (interaction.commandName === 'reminders') {
      const reminders = await listReminders(db(ctx), ctx.holonId);
      if (reminders.length === 0) {
        await interaction.reply({
          content: 'No reminders set. Create one with `/remind`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [remindersEmbed(reminders)],
        components: cancelButtons(reminders),
      });
      return;
    }

    // /remind
    const when = parseWhen(interaction.options.getString('when', true));
    if (!when) {
      await interaction.reply({
        content:
          'Could not understand that time. Try "in 10m", "2h", "3d", or "2026-06-01 18:00".',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const reminder: Reminder = {
      id: genId(),
      holonId: ctx.holonId,
      text: interaction.options.getString('text', true).trim(),
      fireAt: when.toISOString(),
      createdBy: interaction.user.id,
      channelId: interaction.channelId,
      frequency:
        (interaction.options.getString('repeat') as Frequency | null) ?? null,
      created: new Date().toISOString(),
    };
    await saveReminder(db(ctx), reminder);
    await interaction.reply({
      content: `⏰ Reminder set for **${when.toLocaleString()}**${
        reminder.frequency ? ` (repeats ${reminder.frequency})` : ''
      }: ${reminder.text}`,
      flags: MessageFlags.Ephemeral,
    });
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (parsed.action !== 'cancel' || !ctx.holonId) return;
    await deleteReminder(db(ctx), ctx.holonId, parsed.args[0]);
    const reminders = await listReminders(db(ctx), ctx.holonId);
    if (reminders.length === 0) {
      await interaction.update({
        content: '⏰ All reminders cleared.',
        embeds: [],
        components: [],
      });
      return;
    }
    await interaction.update({
      embeds: [remindersEmbed(reminders)],
      components: cancelButtons(reminders),
    });
  },
};
