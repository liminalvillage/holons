/**
 * @fileoverview Message tagging and categorization system.
 * @module src/Tags
 */

// Tag aggregation logic now lives in `@holons/core/tags`; this module is the
// Telegram shell (command parsing + replies) over it.
import { getTagEntries, tagMessage, type TagsDB } from '@holons/core/tags';

// Minimal structural types so we don't depend on the full Telegraf surface
// area in this UI-only handler. The bot/db are duck-typed against what this
// module actually uses.
type CommandHandler = (ctx: any) => any | Promise<any>;
interface BotLike {
  command(name: string, handler: CommandHandler): unknown;
}
type DbLike = TagsDB;

/**
 * Tag management system for categorizing messages and content.
 *
 * Allows users to tag messages with keywords for organization and retrieval.
 * Tags are stored per-holon and can be searched and listed.
 *
 * @example
 * const tags = new Tags(bot, db);
 * // Reply to a message with /tag keyword1 keyword2
 */
export default class Tags {
  bot: BotLike;
  db: DbLike;

  constructor(bot: BotLike, db: DbLike) {
    this.bot = bot;
    this.db = db;

    this.bot.command('tag', async (ctx: any) => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to tag.');
      }

      const tags: string[] = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId: number = ctx.message.reply_to_message.message_id;
      const holonId: number | string = ctx.message.chat.id;
      const messageContent: string | undefined = ctx.message.reply_to_message.text;

      for (let i = 0; i < tags.length; i++) {
        await tagMessage(this.db, holonId.toString(), tags[i], {
          holonId,
          messageId,
          messageContent,
        });
      }

      ctx.reply('Message tagged successfully.');
    });

    // Query tagged messages
    this.bot.command('gettag', async (ctx: any) => {
      const holonId: number | string = ctx.message.chat.id;
      const tag: string | undefined = ctx.message.text.split(' ')[1];
      if (!tag) {
        return ctx.reply('Please specify a tag.');
      }

      const entries = await getTagEntries(this.db, holonId.toString(), tag);

      if (entries.length === 0) {
        return ctx.reply('No messages found for this tag.');
      }

      const response = entries.map((entry) => entry.messageContent).join('\n');
      ctx.reply(response);
    });
  }
}
