/**
 * Settings feature. `/settings show` displays the bound holon's settings and
 * `/settings set` updates a single field. Federation links have their own
 * `/federation` command; this feature covers the general holon settings.
 *
 * Load/parse/save logic lives in `@holons/core/settings`; this module reads the
 * current settings, applies one field change, and persists.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  getDefaultHolonSettings,
  loadSettings,
  parseHolonSettings,
  saveSettings,
  type HolonSettings,
} from '@holons/core/settings';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'settings';

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

async function current(ctx: InvocationContext): Promise<HolonSettings> {
  const raw = await loadSettings(
    ctx.holosphere as unknown as Parameters<typeof loadSettings>[0],
    ctx.holonId as string
  );
  return raw
    ? parseHolonSettings(raw)
    : getDefaultHolonSettings(ctx.holonId as string);
}

export const settingsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('settings')
      .setDescription('View or change holon settings')
      .addSubcommand(sub =>
        sub.setName('show').setDescription('Show current holon settings')
      )
      .addSubcommand(sub =>
        sub
          .setName('set')
          .setDescription('Change one setting')
          .addStringOption(opt =>
            opt
              .setName('field')
              .setDescription('Which setting to change')
              .setRequired(true)
              .addChoices(
                { name: 'name', value: 'name' },
                { name: 'timezone', value: 'timezone' },
                { name: 'language', value: 'language' },
                { name: 'theme', value: 'theme' },
                { name: 'hex (accent colour)', value: 'hex' },
                { name: 'max-tasks', value: 'maxTasks' },
                { name: 'admin (user id)', value: 'admin' }
              )
          )
          .addStringOption(opt =>
            opt.setName('value').setDescription('New value').setRequired(true)
          )
      ),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }
    const settings = await current(ctx);

    if (interaction.options.getSubcommand() === 'show') {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle(`⚙️ Settings — ${settings.name || ctx.holonId}`)
            .addFields(
              {
                name: 'Timezone',
                value: settings.timezone || '—',
                inline: true,
              },
              {
                name: 'Language',
                value: settings.language || '—',
                inline: true,
              },
              { name: 'Theme', value: settings.theme || '—', inline: true },
              { name: 'Accent', value: settings.hex || '—', inline: true },
              {
                name: 'Max tasks',
                value: String(settings.maxTasks ?? '—'),
                inline: true,
              },
              { name: 'Admin', value: settings.admin || '—', inline: true },
              {
                name: 'Federation links',
                value: String(settings.federation?.length ?? 0),
                inline: true,
              }
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // subcommand === 'set'
    const field = interaction.options.getString('field', true);
    const value = interaction.options.getString('value', true).trim();
    if (field === 'maxTasks') {
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n < 0) {
        await interaction.reply({
          content: 'max-tasks must be a non-negative number.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      settings.maxTasks = n;
    } else {
      (settings as unknown as Record<string, unknown>)[field] = value;
    }
    settings.id = ctx.holonId;
    await saveSettings(
      ctx.holosphere as unknown as Parameters<typeof saveSettings>[0],
      ctx.holonId,
      settings
    );
    await interaction.reply({
      content: `✅ Updated **${field}** to \`${value}\`.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
