/**
 * RSVP feature. `/rsvp <title>` posts an ad-hoc attendance card with a single
 * toggle button; members tap it to mark themselves attending or not. Attendance
 * is stored on each member's `users` record via `@holons/core/calendar`'s RSVP
 * helpers (the same model the calendar feature uses), keyed by a generated
 * event id carried in the button.
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
  buildRSVPList,
  toggleRSVP,
  type RSVPUser,
} from '@holons/core/calendar';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'rsvp';
const USERS_BUCKET = 'users';

/** Colon/underscore-free event id for the customId. */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function rsvpEmbed(title: string, attendees: string[]): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`✋ RSVP — ${title}`)
    .setDescription(
      attendees.length
        ? `**${attendees.length} attending:**\n${attendees.join(', ')}`
        : 'No one has RSVP’d yet. Tap below to join.'
    );
}

function rsvpButton(eventId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(FEATURE_ID, 'toggle', eventId))
        .setLabel('Going / Cancel')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✋')
    ),
  ];
}

export const rsvpFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('rsvp')
      .setDescription('Post an RSVP card people can tap to join')
      .addStringOption(opt =>
        opt
          .setName('title')
          .setDescription('What are people RSVPing to?')
          .setRequired(true)
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
    const title = interaction.options.getString('title', true).trim();
    await interaction.reply({
      embeds: [rsvpEmbed(title, [])],
      components: rsvpButton(genId()),
    });
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (parsed.action !== 'toggle') return;
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [eventId] = parsed.args;
    const title =
      interaction.message.embeds[0]?.title?.replace(/^✋ RSVP — /, '') ??
      'Event';

    const existing = (await ctx.holosphere.get(
      ctx.holonId,
      USERS_BUCKET,
      interaction.user.id
    )) as RSVPUser | null;
    const base: RSVPUser = existing ?? {
      id: interaction.user.id,
      username: interaction.user.username,
    };
    await ctx.holosphere.put(
      ctx.holonId,
      USERS_BUCKET,
      toggleRSVP(base, eventId)
    );

    const users = ((await ctx.holosphere.getAll(ctx.holonId, USERS_BUCKET)) ??
      []) as RSVPUser[];
    const attendees = buildRSVPList(users, eventId)
      .filter(r => r.attending)
      .map(r => r.name)
      .slice(0, 30);
    await interaction.update({
      embeds: [rsvpEmbed(title, attendees)],
      components: rsvpButton(eventId),
    });
  },
};
