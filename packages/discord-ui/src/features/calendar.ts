/**
 * Calendar feature. `/calendar` lists upcoming scheduled events (quests with a
 * `when`) and lets members RSVP with a button; `/ical` exports the holon's
 * events as a downloadable `.ics` feed.
 *
 * Events themselves are created via `/event` (the quests feature) and share the
 * `quests` lens. RSVP state lives on the member's `users` record. The iCal
 * serialisation and RSVP toggling logic live in `@holons/core/calendar`.
 */
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  buildRSVPList,
  countAttendees,
  generateICalFeed,
  toggleRSVP,
  type HolonEvent,
  type RSVPUser,
} from '@holons/core/calendar';
import type { Quest } from '@holons/core/tasks';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'calendar';
const QUESTS_BUCKET = 'quests';
const USERS_BUCKET = 'users';
const MAX_EVENT_CARDS = 5;

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

/** Quests that carry a schedule, oldest-first. */
function scheduledEvents(quests: Quest[]): Quest[] {
  return quests
    .filter(q => q && !q._deleted && q.when)
    .sort((a, b) => String(a.when).localeCompare(String(b.when)));
}

function upcoming(quests: Quest[]): Quest[] {
  const nowIso = new Date().toISOString();
  return scheduledEvents(quests).filter(q => String(q.when) >= nowIso);
}

function eventEmbed(event: Quest, attendees: number): EmbedBuilder {
  const when = event.when
    ? new Date(String(event.when)).toLocaleString()
    : 'unscheduled';
  const lines = [`🗓️ ${when}`];
  if (event.location) lines.push(`📍 ${event.location}`);
  lines.push(`✅ ${attendees} attending`);
  if (event.description) lines.push(`\n${event.description}`);
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(event.title)
    .setDescription(lines.join('\n'));
}

function eventComponents(eventId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(FEATURE_ID, 'rsvp', eventId))
        .setLabel('RSVP / Cancel')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✋')
    ),
  ];
}

export const calendarFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('calendar')
      .setDescription('Show upcoming events and RSVP'),
    new SlashCommandBuilder()
      .setName('ical')
      .setDescription('Export this holon’s events as a .ics calendar feed'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }
    const quests = ((await ctx.holosphere.getAll(ctx.holonId, QUESTS_BUCKET)) ??
      []) as Quest[];

    if (interaction.commandName === 'ical') {
      const events: HolonEvent[] = scheduledEvents(quests).map(q => ({
        id: String(q.id),
        title: q.title,
        description: q.description,
        location: q.location,
        when: String(q.when),
        ends: q.ends,
        status: q.status,
        category: q.category,
      }));
      if (events.length === 0) {
        await interaction.reply({
          content: 'No scheduled events to export yet.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const ics = generateICalFeed(events, ctx.holonId, ctx.holonId);
      const file = new AttachmentBuilder(Buffer.from(ics, 'utf8'), {
        name: 'holon.ics',
      });
      await interaction.reply({
        content: `📆 ${events.length} event(s) exported.`,
        files: [file],
      });
      return;
    }

    // commandName === 'calendar'
    const events = upcoming(quests);
    if (events.length === 0) {
      await interaction.reply({
        content: 'No upcoming events. Create one with `/event`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const users = ((await ctx.holosphere.getAll(ctx.holonId, USERS_BUCKET)) ??
      []) as RSVPUser[];
    const cards = events.slice(0, MAX_EVENT_CARDS);
    await interaction.reply({
      content: `**Upcoming events** (${events.length})`,
    });
    for (const event of cards) {
      await interaction.followUp({
        embeds: [eventEmbed(event, countAttendees(users, String(event.id)))],
        components: eventComponents(String(event.id)),
      });
    }
    if (events.length > cards.length) {
      await interaction.followUp({
        content: `…and ${events.length - cards.length} more. Export them all with \`/ical\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (parsed.action !== 'rsvp') return;
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [eventId] = parsed.args;
    const event = (await ctx.holosphere.get(
      ctx.holonId,
      QUESTS_BUCKET,
      eventId
    )) as Quest | null;
    if (!event) {
      await interaction.reply({
        content: 'That event no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = (await ctx.holosphere.get(
      ctx.holonId,
      USERS_BUCKET,
      interaction.user.id
    )) as RSVPUser | null;
    const base: RSVPUser = existing ?? {
      id: interaction.user.id,
      username: interaction.user.username,
    };
    const updated = toggleRSVP(base, eventId);
    await ctx.holosphere.put(ctx.holonId, USERS_BUCKET, updated);

    const users = ((await ctx.holosphere.getAll(ctx.holonId, USERS_BUCKET)) ??
      []) as RSVPUser[];
    const attendees = buildRSVPList(users, eventId).filter(r => r.attending);
    const embed = eventEmbed(event, attendees.length);
    if (attendees.length > 0) {
      embed.addFields({
        name: 'Attending',
        value: attendees
          .slice(0, 20)
          .map(a => a.name)
          .join(', '),
      });
    }
    await interaction.update({
      embeds: [embed],
      components: eventComponents(eventId),
    });
  },
};
