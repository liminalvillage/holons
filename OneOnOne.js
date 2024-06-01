import schedule from 'node-schedule';

class OneOnOne {
  constructor(bot, db, settings) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;

    this.conversations = {}; // To track ongoing conversations
    this.pairings = new Set(); // To track unique pairings

    bot.command(['round'], async (ctx) => {
      let chatID = ctx.chat.id;
      let participants = await this.db.getAll(chatID + '/users');
      if (participants.length < 2) {
        ctx.reply('Not enough participants for this. Please invite more people to join.');
        return;
      }

      // Schedule the round at regular intervals
      schedule.scheduleJob('*/1 * * * *', async () => {
        await this.startRound(participants, chatID);
      });

      ctx.reply('Scheduled speed dating rounds.');
    });

    bot.command(['summary'], async (ctx) => {
      const user = ctx.from.username;
      const summary = ctx.message.text.split('/summary ')[1];
      if (this.conversations[user]) {
        const { partner, chatID } = this.conversations[user];
        // Store the summary in the database
        await this.db.save(`${chatID}/summaries`, { user, partner, summary });
        ctx.reply('Thank you for your summary!');
        delete this.conversations[user]; // Remove the conversation after reporting
      } else {
        ctx.reply('You have no ongoing conversations to report.');
      }
    });
  }

  async startRound(participants, chatID) {
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
        this.bot.telegram.sendMessage(chatID, 'All participants have been paired. Resetting pairs.');
        this.pairings.clear();
        await this.startRound(participants, chatID); // Start a new round with cleared pairs
      } else {
        for (const [user1, user2] of newPairings) {
          await this.createConversation(user1, user2, chatID);
        }
      }
    } else {
      this.bot.telegram.sendMessage(chatID, 'Not enough participants for this session. Please wait for the next round.');
    }
  }

  // Function to create a conversation for pairs
  async createConversation(user1, user2, chatID) {
    try {
      const message1 = `You have been paired with @${user2.username} for a 15-minute conversation. Please discuss and use /summary to report the conversation summary.`;
      const message2 = `You have been paired with @${user1.username} for a 15-minute conversation. Please discuss and use /summary to report the conversation summary.`;

      await this.bot.telegram.sendMessage(user1.id, message1);
      await this.bot.telegram.sendMessage(user2.id, message2);

      // Track the ongoing conversation
      this.conversations[user1.username] = { partner: user2.username, chatID };
      this.conversations[user2.username] = { partner: user1.username, chatID };

      // Notify users in the main chat
      this.bot.telegram.sendMessage(chatID, `@${user1.username} and @${user2.username}, you have been paired for a private conversation! Please check your direct messages.`);
    } catch (error) {
      console.error('Error creating conversation:', error);
      this.bot.telegram.sendMessage(chatID, `An error occurred while pairing @${user1.username} and @${user2.username}.`);
    }
  }
}

export default OneOnOne;