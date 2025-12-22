/**
 * @fileoverview Message tagging and categorization system.
 * @module src/Tags
 */

import { Markup } from 'telegraf';
import * as utils from './utilities.js';

/**
 * Tag management system for categorizing messages and content.
 *
 * @class Tags
 * @description Allows users to tag messages with keywords for organization
 * and retrieval. Tags are stored per-holon and can be searched and listed.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance
 *
 * @example
 * const tags = new Tags(bot, db);
 * // Reply to a message with /tag keyword1 keyword2
 */
export default class Tags {
  /**
   * Creates a new instance of the Tags class.
   * @param {Object} bot - The bot object.
   * @param {Object} db - The database object.
   */
  constructor(bot, db) {
    this.bot = bot;
    this.db = db;

    this.bot.command('tag', async (ctx) => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to tag.');
      }

      const tags = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId = ctx.message.reply_to_message.message_id;
      const holonId = ctx.message.chat.id;
      const messageContent = ctx.message.reply_to_message.text;

      for (let i = 0; i < tags.length; i++) {
        let tagobject = await this.db.get(holonId.toString(), 'tags', tags[i])
        if (tagobject?.content) {
          tagobject.content.push({ holonId, messageId, messageContent });
        } else {
          tagobject = { 'id': tags[i], 'content': [{ holonId, messageId, messageContent }] };
        }
        await this.db.put(holonId.toString(), 'tags', tagobject)

      };

      //saveDb();
      ctx.reply('Message tagged successfully.');
    });

    // Query tagged messages
    this.bot.command('gettag', async (ctx) => {
      const holonId = ctx.message.chat.id;
      const tag = ctx.message.text.split(' ')[1];
      if (!tag) {
        return ctx.reply('Please specify a tag.');
      }

      let tagobject = await this.db.get(holonId.toString(), 'tags', tag)

      if (!tagobject || !tagobject.content) {
        return ctx.reply('No messages found for this tag.');
      }

      const response = tagobject.content.map(entry => entry.messageContent).join('\n');
      ctx.reply(response);
    });
  }
}
