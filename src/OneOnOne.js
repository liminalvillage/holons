/**
 * @fileoverview Speed dating / one-on-one conversation pairing system.
 * @module src/OneOnOne
 */

import schedule from 'node-schedule';

/**
 * One-on-one conversation pairing system for community networking.
 *
 * @class OneOnOne
 * @description Facilitates scheduled one-on-one conversations between
 * community members. Automatically pairs participants for 15-minute
 * private discussions and collects conversation summaries. Tracks
 * pairings to ensure everyone meets everyone over time.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Settings} settings - Settings manager
 * @property {Object} conversations - Active conversation tracking
 * @property {Set} pairings - Unique pairings tracker to avoid repeats
 *
 * @example
 * const oneOnOne = new OneOnOne(bot, db, settings);
 * // Use /round to schedule pairing rounds
 * // Use /summary <text> to report conversation outcomes
 */
class OneOnOne {
  constructor(bot, db, settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;

    this.conversations = {}; // To track ongoing conversations
    this.pairings = new Set(); // To track unique pairings
    this.scheduledJobs = new Map(); // Track scheduled jobs per holon to prevent memory leaks

    bot.command(['round'], async (ctx) => {
      let holonId = ctx.chat.id;
      let participants = await this.db.getAll(`${holonId}/users`);
      if (participants.length < 2) {
        ctx.reply('Not enough participants for this. Please invite more people to join.');
        return;
      }

      // Cancel any existing job for this holon to prevent accumulation
      if (this.scheduledJobs.has(holonId)) {
        this.scheduledJobs.get(holonId).cancel();
        this.scheduledJobs.delete(holonId);
      }

      // Schedule the round at regular intervals and store the job reference
      const job = schedule.scheduleJob('*/1 * * * *', async () => {
        await this.startRound(participants, holonId);
      });
      this.scheduledJobs.set(holonId, job);

      ctx.reply('Scheduled speed dating rounds.');
    });

    bot.command(['summary'], async (ctx) => {
      const user = ctx.from.username;
      const summary = ctx.message.text.split('/summary ')[1];
      if (this.conversations[user]) {
        const { partner, holonId } = this.conversations[user];
        // Store the summary in the database
        await this.db.put(holonId.toString(), 'summaries', { id: `${user}_${partner}`, user, partner, summary });
        ctx.reply('Thank you for your summary!');
        delete this.conversations[user]; // Remove the conversation after reporting
      } else {
        ctx.reply('You have no ongoing conversations to report.');
      }
    });
  }

  async startRound(participants, holonId) {
    if (participants.length >= 2) {
      const newPairings = [];

      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const user1 = participants[i];
          const user2 = participants[j];
          const pairKey = `${user1.id}-${user2.id}`;

          if (!this.pairings.has(pairKey)) {
            newPairings.push([user1, user2]);
            this.pairings.add(pairKey);
          }

          if (newPairings.length * 2 >= participants.length) break;
        }
        if (newPairings.length * 2 >= participants.length) break;
      }

      if (newPairings.length === 0) {
        this.bot.telegram.sendMessage(holonId, 'All participants have been paired. Resetting pairs.');
        this.pairings.clear();
        await this.startRound(participants, holonId); // Start a new round with cleared pairs
      } else {
        for (const [user1, user2] of newPairings) {
          await this.createConversation(user1, user2, holonId);
        }
      }
    } else {
      this.bot.telegram.sendMessage(holonId, 'Not enough participants for this session. Please wait for the next round.');
    }
  }

  // Function to create a conversation for pairs
  async createConversation(user1, user2, holonId) {
    try {
      const message1 = `You have been paired with @${user2.username} for a 15-minute conversation. Please discuss and use /summary to report the conversation summary.`;
      const message2 = `You have been paired with @${user1.username} for a 15-minute conversation. Please discuss and use /summary to report the conversation summary.`;

      await this.bot.telegram.sendMessage(user1.id, message1);
      await this.bot.telegram.sendMessage(user2.id, message2);

      // Track the ongoing conversation
      this.conversations[user1.username] = { partner: user2.username, holonId };
      this.conversations[user2.username] = { partner: user1.username, holonId };

      // Notify users in the main chat
      this.bot.telegram.sendMessage(holonId, `@${user1.username} and @${user2.username}, you have been paired for a private conversation! Please check your direct messages.`);
    } catch (error) {
      console.error('Error creating conversation:', error);
      this.bot.telegram.sendMessage(holonId, `An error occurred while pairing @${user1.username} and @${user2.username}.`);
    }
  }

  /**
   * Cancel a scheduled job for a specific holon
   * @param {string|number} holonId - The holon ID
   * @returns {boolean} True if job was cancelled, false if no job existed
   */
  cancelJob(holonId) {
    if (this.scheduledJobs.has(holonId)) {
      this.scheduledJobs.get(holonId).cancel();
      this.scheduledJobs.delete(holonId);
      return true;
    }
    return false;
  }

  /**
   * Cancel all scheduled jobs and cleanup resources
   */
  shutdown() {
    for (const [holonId, job] of this.scheduledJobs) {
      job.cancel();
    }
    this.scheduledJobs.clear();
    this.conversations = {};
    this.pairings.clear();
  }
}

export default OneOnOne;