/**
 * Settings feature (read-only). `/settings` shows the holon's configuration
 * loaded via `@holons/core/settings`. Editing settings (lenses, federation,
 * flow management) is deferred to a later phase — see the package roadmap.
 */
import {
  EmbedBuilder,
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { loadSettings } from '@holons/core/settings';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'settings';

export const settingsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('Show this holon’s settings'),
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

    const settings = await loadSettings(ctx.holosphere as never, ctx.holonId);
    if (!settings) {
      await interaction.reply({
        content: `Holon \`${ctx.holonId}\` has no settings configured yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const federation = Array.isArray(settings.federation)
      ? settings.federation.length
      : 0;
    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle(`⚙️ Settings — ${settings.name ?? ctx.holonId}`)
      .addFields(
        { name: 'Holon id', value: `\`${ctx.holonId}\``, inline: true },
        { name: 'Timezone', value: settings.timezone || '—', inline: true },
        { name: 'Language', value: settings.language || '—', inline: true },
        { name: 'Theme', value: settings.theme || '—', inline: true },
        {
          name: 'Max tasks',
          value: settings.maxTasks != null ? String(settings.maxTasks) : '—',
          inline: true,
        },
        {
          name: 'Federated holons',
          value: String(federation),
          inline: true,
        }
      )
      .setFooter({ text: 'Read-only — editing comes in a later release.' });

    await interaction.reply({ embeds: [embed] });
  },
};
