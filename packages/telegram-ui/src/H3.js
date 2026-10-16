/**
 * @fileoverview H3 geospatial indexing for location-based holon features.
 * @module src/H3
 */

import { publishToFederation } from '@holons/core/federation';
import { linkHolons } from './federationLinks.js';

// WRAPPER CLASS FOR HOLOSPHERE
class H3 {
  constructor(bot, db, settings) {
    this.db = db;
    this.holosphere = db;
    this.settings = settings;
    this.bot = bot;

    this.bot.command('get', async ctx => {
      const holonId = ctx.message.chat.id;
      const tag = ctx.message.text.split(' ')[1];
      if (!tag) {
        return ctx.reply('Please specify a tag.');
      }
      const hex = (await this.settings.getSettings(holonId)).hex;

      const data = await this.db.get(hex, tag);
      ctx.reply(JSON.stringify(data, null, 2));
    });

    this.bot.command('compute', async ctx => {
      const holonId = ctx.message.chat.id;
      const operation = ctx.message.text.split(' ')[1];
      if (operation != 'sum') {
        ctx.reply('Operation not implemented');
        return;
      }
      const lense = ctx.message.text.split(' ')[2];
      if (!lense) {
        ctx.reply('Please specify a lense where to perform the operation ');
        return;
      }
      const hex = (await this.settings.getSettings(holonId)).hex;
      await this.db.compute(hex, lense, operation);
    });

    this.bot.command('cast', async ctx => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to cast.');
      }
      const tags = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId = ctx.message.reply_to_message.message_id;
      const holonId = ctx.message.chat.id;
      const settings = await this.settings.getSettings(holonId);
      const id = settings.hex ? settings.hex : 'Hex not set, use /setHex';
      // fetch the stored node

      const node = await this.db.getNode(holonId, 'quests', messageId);
      console.log(node);

      //for (let tag of tags) {

      await this.db.upcast(id, 'quests', node);
      //}
    });

    this.bot.command('publish', async ctx => {
      if (!ctx.message.reply_to_message) {
        return ctx.reply('Please reply to a message you want to publish.');
      }
      const tags = ctx.message.text.split(' ').slice(1);
      if (tags.length === 0) {
        return ctx.reply('Please provide at least one tag.');
      }

      const messageId = ctx.message.reply_to_message.message_id;
      const holonId = ctx.message.chat.id;

      const settings = await this.settings.getSettings(holonId);
      const hex = settings.hex;

      if (!hex) {
        return ctx.reply('Hex not set. Please set hex using /setHex');
      }

      try {
        // Get the node from holosphere
        const node = await this.db.getNode(holonId, 'quests', messageId);

        if (!node) {
          return ctx.reply('No quest found for this message.');
        }

        // Federate the chat's holon with the hex cell through the one
        // write path: the record counts because the bot's key is the
        // holon's anchor (an admin, see @holons/core/holosphere CAPABILITIES).
        // A hex cell is open (nobody speaks for it): both halves are written.
        await linkHolons(this.db, holonId, hex, {
          lensConfig: {
            inbound: ['quests', 'events'],
            outbound: ['quests', 'events'],
          },
          askPartner: false,
        });

        const outcome = await publishToFederation(
          {
            holosphere: this.db,
            holonId,
            lens: 'quests',
            item: { id: messageId },
          },
          { kind: 'hex', cell: hex },
          // Federation holograms are opt-in; preserve the prior hologram publish.
          { useHolograms: true }
        );

        if (outcome.publishedTo > 0) {
          ctx.reply(`Quest published to hex ${hex} via federation`);
        } else {
          const errorMessage = outcome.errors[0] || 'Unknown propagation error';
          ctx.reply(`Failed to publish: ${errorMessage}`);
        }
      } catch (error) {
        console.error('Error publishing quest:', error);
        ctx.reply('Error publishing quest');
      }
    });
  }
}

export default H3;
