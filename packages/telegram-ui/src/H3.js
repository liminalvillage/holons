/**
 * @fileoverview H3 geospatial indexing for location-based holon features.
 * @module src/H3
 */

import 'gun/lib/then.js';
import { publishToFederation } from '@holons/core/federation';

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

      // if (!node) {
      //     node = await this.db.gun.get(holonId + '/' + messageId).put({ id: holonId + '/' + messageId, content: messageContent })
      // }

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

        // Setup federation with the hex target
        let fedInfo = null;
        try {
          fedInfo = await this.db.getGlobal('federation', holonId);
        } catch (error) {
          // Federation info doesn't exist, create new one
        }

        if (!fedInfo) {
          fedInfo = {
            id: holonId,
            name: holonId,
            inbound: [],
            outbound: [],
            lensConfig: {},
            timestamp: Date.now(),
          };
        }

        // Ensure arrays exist
        if (!fedInfo.inbound) fedInfo.inbound = [];
        if (!fedInfo.outbound) fedInfo.outbound = [];
        if (!fedInfo.lensConfig) fedInfo.lensConfig = {};

        // Add hex to federation if not already present
        if (!fedInfo.inbound.includes(hex)) {
          fedInfo.inbound.push(hex);
        }
        if (!fedInfo.outbound.includes(hex)) {
          fedInfo.outbound.push(hex);
        }

        // Configure lens settings for the hex
        fedInfo.lensConfig[hex] = {
          inbound: ['quests', 'events'],
          outbound: ['quests', 'events'],
          timestamp: Date.now(),
        };

        // Save the federation configuration
        await this.db.putGlobal('federation', fedInfo);

        const outcome = await publishToFederation(
          {
            holosphere: this.db,
            holonId,
            lens: 'quests',
            item: { id: messageId },
          },
          { kind: 'hex', cell: hex }
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

  reconstructNodeRef(soul) {
    const parts = soul.split('/');
    let ref = this.db.gun;
    parts.forEach(part => {
      ref = ref.get(part);
    });
    return ref;
  }

  findSoul(gunRef) {
    // // Method 1: Direct soul
    // if (gunRef._ && gunRef._['#']) {
    //     console.log('soul found 1: ', gunRef._['#'])
    //     return gunRef._['#']
    // }

    // // Method 2: Back reference
    // if (gunRef._.back && gunRef._.back.link) {
    //     console.log('soul found 2: ', gunRef._.back.link)
    //     return gunRef._.back.link;
    // }

    // Method 4: Check back chain
    let back = gunRef._.back;
    let backChain = [];
    while (back) {
      if (back.get) backChain.push(back.get);
      //if (back.link) backChain.push(back.link);
      back = back.back;
    }
    if (backChain.length > 0) {
      //reverse the backchain
      backChain = backChain.reverse();
      //chain the backchain into a string
      let soul = backChain.join('/');
      soul += '/' + gunRef._.get;
      return soul;
    } else return null;
  }
}

export default H3;
