/**
 * `/holon` — bind a Discord server to a Holons holon (community). Every other
 * command operates on the bound holon, so this is the first thing an admin
 * runs in a new server.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Feature, InvocationContext } from '../types.js';

export const holonFeature: Feature = {
  id: 'holon',
  commands: [
    new SlashCommandBuilder()
      .setName('holon')
      .setDescription('Manage which Holons community this server is bound to')
      .addSubcommand(sub =>
        sub
          .setName('bind')
          .setDescription('Bind this server to a holon id')
          .addStringOption(opt =>
            opt
              .setName('id')
              .setDescription('The holon (community) id')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('current')
          .setDescription('Show the holon this server is bound to')
      ),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'bind') {
      const holonId = interaction.options.getString('id', true).trim();
      await ctx.bindings.set(interaction.guildId, holonId);
      await interaction.reply({
        content: `✅ This server is now bound to holon \`${holonId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // sub === 'current'
    await interaction.reply({
      content: ctx.holonId
        ? `This server is bound to holon \`${ctx.holonId}\`.`
        : 'This server is not bound to any holon yet. Use `/holon bind`.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
