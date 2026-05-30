/**
 * Dashboard + discovery. `/dashboard` links to the holon's web dashboard;
 * `/more` points members at the broader set of community tools.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'dashboard';
const DASHBOARD_ADDRESS =
  process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

export const dashboardFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('dashboard')
      .setDescription('A direct link to the web dashboard'),
    new SlashCommandBuilder()
      .setName('more')
      .setDescription('Discover more community tools'),
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

    if (interaction.commandName === 'dashboard') {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('📊 Web dashboard')
            .setURL(`${DASHBOARD_ADDRESS}/${ctx.holonId}`)
            .setDescription(`${DASHBOARD_ADDRESS}/${ctx.holonId}`),
        ],
      });
      return;
    }

    // /more
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle('🧰 More community tools')
          .setDescription(
            [
              '**Tasks & board:** `/task` `/tasks` `/offer` `/request` `/board`',
              '**Events & time:** `/event` `/calendar` `/ical` `/remind` `/reminders`',
              '**Value:** `/appreciate` `/status` `/score` `/equation`',
              '**Money:** `/spent` `/balance`',
              '**Lists:** `/buy` `/shopping` `/checklists` `/agenda`',
              '**People & roles:** `/join` `/members` `/roles` `/role`',
              '**Library:** `/library`',
              '**Comms:** `/announce` `/tag` `/rsvp`',
              '**Admin:** `/settings` `/federation` `/dna` `/dashboard`',
            ].join('\n')
          ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};
