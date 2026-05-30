/**
 * Tags feature. `/tag add <keyword> <text>` files a snippet under a keyword and
 * `/tag get <keyword>` retrieves everything filed under it. Tag aggregation
 * lives in `@holons/core/tags`; this module is the Discord shell.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getTagEntries, tagMessage, type TagsDB } from '@holons/core/tags';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'tags';

function db(ctx: InvocationContext): TagsDB {
  return ctx.holosphere as unknown as TagsDB;
}

export const tagsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('tag')
      .setDescription('Tag and retrieve snippets by keyword')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('File a snippet under a keyword')
          .addStringOption(opt =>
            opt
              .setName('keyword')
              .setDescription('Tag keyword')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('text')
              .setDescription('Text or link to remember')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('get')
          .setDescription('Show everything filed under a keyword')
          .addStringOption(opt =>
            opt
              .setName('keyword')
              .setDescription('Tag keyword')
              .setRequired(true)
          )
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
    const keyword = interaction.options.getString('keyword', true).trim();

    if (interaction.options.getSubcommand() === 'add') {
      const text = interaction.options.getString('text', true).trim();
      await tagMessage(db(ctx), ctx.holonId, keyword, {
        holonId: ctx.holonId,
        messageId: interaction.id,
        messageContent: text,
      });
      await interaction.reply({
        content: `🏷️ Tagged under **${keyword}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // subcommand === 'get'
    const entries = await getTagEntries(db(ctx), ctx.holonId, keyword);
    if (entries.length === 0) {
      await interaction.reply({
        content: `Nothing tagged **${keyword}** yet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const lines = entries
      .slice(0, 25)
      .map((e, i) => `${i + 1}. ${e.messageContent ?? '(no text)'}`);
    const more =
      entries.length > 25 ? `\n\n…and ${entries.length - 25} more.` : '';
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle(`🏷️ ${keyword} (${entries.length})`)
          .setDescription(lines.join('\n') + more),
      ],
    });
  },
};
