"use strict";

import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import DB from "./DB.js";
import UI from './UI.js';
import H3 from './H3.js';
import Holons from './Holons.js';
import Quests from './Quests.js';
import Shopping from './Shopping.js';
import Lunation from "./Lunation.js";
import Onboarding from "./Onboarding.js";
import Expenses from "./Expenses.js";
import Settings from './Settings.js';
import Bigtalk from './Bigtalk.js';
import Library from './Library.js';
import Users from './Users.js';
import Tags from './Tags.js';
import Participation from './RSVP.js';
import Council from './Council.js';
import Roles from './Roles.js';
import * as request from './Requests.js';
import OneOnOne from './OneOnOne.js';

// Delete lock file if it exists
if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}

class HolonsBot {
  constructor() {
    this.db = null;
    this.telebot = null;
    this.settings = null;
    this.ui = null;
    this.lunation = null;
    this.shopping = null;
    this.quests = null;
    this.bigtalk = null;
    this.library = null;
    this.users = null;
    this.expenses = null;
    this.onboarding = null;
    this.holons = null;
    this.h3 = null;
    this.tags = null;
    this.participation = null;
    this.council = null;
    this.roles = null;
    this.rounds = null;
    this.userVoiceData = {};
  }

  async init(appname = 'Holons', telegramtoken = null, discordtoken = null) {
    try {
      this.telebot = new Telegraf(telegramtoken);
      this.telebot.launch({ handlerTimeout: Infinity });

      if (process.env.MODE === 'development') {
        console.log('Development Mode');
        this.db = new DB(`${appname}Debug`);
      } else {
        console.log('Production Mode');
        this.db = new DB(appname);
      }

      await this.db.init();

      await this.initializeModules();

      this.setupTelegramCommands();
      this.setupTelegramHandlers();
      //this.setupDiscordBot(discordtoken);

      this.handleProcessEvents();
    } catch (error) {
      console.error('Error initializing:', error);
    }
  }

  async initializeModules() {
    this.settings = new Settings(this.telebot, this.db);
    await this.settings.init();

    this.ui = new UI(this.telebot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.telebot);
    this.shopping = new Shopping(this.telebot, this.db, this.settings);
    this.quests = new Quests(this.telebot, this.db, this.settings);
    this.bigtalk = new Bigtalk(this.telebot, this.settings);
    this.library = new Library(this.telebot, this.db);
    this.users = new Users(this.telebot, this.db);
    this.expenses = new Expenses(this.telebot, this.db, this.ui, this.settings);
    this.onboarding = new Onboarding(this.telebot, this.db);
    this.holons = new Holons(this.telebot, this.db, this.settings);
    this.h3 = new H3(this.telebot, this.db);
    this.tags = new Tags(this.telebot, this.db);
    this.participation = new Participation(this.telebot, this.db);
    this.council = new Council(this.telebot, this.db);
    this.roles = new Roles(this.telebot, this.db, this.ui, this.settings);
    this.rounds = new OneOnOne(this.telebot, this.db, this.settings);
  }

  setupTelegramCommands() {

    this.telebot.command('start', async (ctx) => {
      ctx.reply('Hello! To start giving your groups coordination superpowers, just type / for a list of possible commands and start playing with them. For instance \n /task do the dishes \n /request ride to the station \n /offer massage \n  ATTENTION: THIS IS A PREVIEW VERSION. ALL YOUR DATA MIGHT BE LOST AT ANY MOMENT, WITHOUT PRIOR NOTICE. PLEASE REPORT ANY BUGS OR ISSUES TO @RobertoValenti');
    });

    this.telebot.command('help', async (ctx) => {
      ctx.reply('Just type / for a list of possible commands and start playing with them. For instance \n /task do the dishes \n /request ride to the station \n /offer massage \n');
    });

    if (process.env.MODE === 'development') {

      this.telebot.on('inline_query', async (ctx) => {
        await this.handleInlineQuery(ctx);
      });

      this.telebot.on('chosen_inline_result', (ctx) => {
        console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
      });
    }

    this.telebot.command('fullrequest', async (ctx) => request.request('fullrequest', ctx, this.db));
    this.telebot.command(['appreciate', 'praise', 'kudo', 'apprezza', 'apprezziamo', 'fiorino'], async (ctx) => this.quests.sendAppreciation(ctx));

  }

  setupTelegramHandlers() {
    this.telebot.on('photo', async (ctx) => {
      await this.handlePhoto(ctx);
    });

    this.telebot.on('callback_query', async (ctx) => {
      await this.handleCallbackQuery(ctx);
    });
  }

  async handleInlineQuery(ctx) {
    let offers = [];
    let chats = await this.settings.getChats(ctx);
    let k = 0;

    for (const chatID of chats) {
      let users = await this.ui.getFederatedUsers(chatID);
      for (const user of users) {
        for (let j = 0; j < user.offers.length; j++) {
          offers.push({ id: k++, title: user.offers[j], description: user.username, price: '$10' });
        }
      }
    }

    const results = offers.map((offer) => ({
      type: 'article',
      id: offer.id,
      title: offer.title,
      description: offer.description,
      thumb_url: 'https://picsum.photos/200/300',
      input_message_content: {
        message_text: `${offer.title}: ${offer.description} - ${offer.price}`
      },
    }));

    await ctx.answerInlineQuery(results);
  }

  async handlePhoto(ctx) {
    if (ctx.message.caption) {
      const command = ctx.message.caption.split(' ')[0];
      if (['/task', '/quest', '/todo', '/offer', '/request'].includes(command)) {
        this.quests.quest(command.slice(1), ctx);
      } else if (['/spent', '/expense', '/speso'].includes(command)) {
        ctx.message.text = ctx.message.caption;
        this.expenses.spent(ctx);
      }
    }

    try {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });

      const rawImageBuffer = await sharp(response.data).toBuffer();
      const jimpImage = await Jimp.read(rawImageBuffer);
      const qr = new qrReader();

      qr.callback = (err, value) => {
        if (err) {
          return;
        }

        if (value) {
          ctx.reply(`${value.result.split('/').slice(value.result.split('/').length - 1)}`, Markup.inlineKeyboard([Markup.button.webApp('Open', `${value.result}`)]));
        }
      };

      qr.decode(jimpImage.bitmap);
    } catch (error) {
      console.error('Error processing QR code:', error);
    }
  }

  async handleCallbackQuery(ctx) {
    const callbackData = ctx.callbackQuery.data;
    const chatID = ctx.update.callback_query.message.chat.id;
    const messageID = ctx.update.callback_query.message.message_id;

    if (callbackData.startsWith('removekeyboard')) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    }

    if (messageID === this.quests.calendar.chats.get(chatID)) {
      const when = this.quests.calendar.clickButtonCalendar(ctx);
      if (when !== -1) {
        const quest = await this.db.get(chatID + '/quests', messageID);

        if (!quest) {
          console.log('Quest not found');
          return;
        }

        quest.status = 'scheduled';
        quest.when = when;

        setTimeout(() => {
          this.quests.remind(ctx, quest);
        }, new Date(when).getTime() - Date.now());

        this.quests.updateMessage(ctx, quest);
        this.db.put(chatID + '/quests', quest);
      }
    }
  }

  setupDiscordBot(discordtoken) {
    if (!discordtoken) return;

    const discordbot = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,

      ],
    });

    discordbot.on('ready', () => {
      console.log(`Discord BOT started with ${discordbot.users.cache.size} users, in ${discordbot.channels.cache.size} channels of ${discordbot.guilds.cache.size} guilds.`);
      discordbot.user.setActivity(`Serving ${discordbot.guilds.cache.size} servers`);
    });



    // discordbot.on('speaking', (user, speaking) => {
    //     const userId = user.id;

    //     if (speaking) {
    //        this.userVoiceData[userId].speakingStart = new Date();
    //         console.log(`${userId} started speaking`);
    //     } else {
    //         const speakingTime = new Date() -this.userVoiceData[userId].speakingStart;
    //        this.userVoiceData[userId].speakingTime += speakingTime;
    //         console.log(`${userId} stopped speaking. Total speaking time: ${this.this.userVoiceData[userId].speakingTime} ms`);

    //         // Reset speaking start time
    //         deletethis.userVoiceData[userId].speakingStart;
    //     }
    // });


    discordbot.on('messageCreate', (msg) => {
      console.log("DISCORD MESSAGE:", msg.content);
      if (msg.content.charAt(0) === process.env.PREFIX) {
        msg.react('👀').catch(console.error);
      }



    });

    discordbot.login(discordtoken);
  }


  handleCommand(msg) {
    const commandBody = msg.content.substring(process.env.PREFIX.length).split(' ');
    const command = commandBody[0];
    switch (command) {
      case 'quest':
        this.quests.quest('quest', this.discord2telegram(msg), this.db);
        break;
      case 'task':
        console.log('task');
        break;
      // Add more cases as needed
      default:
        console.log(`Unknown command: ${command}`);
    }
  }

  discord2telegram(interaction) {
    const ctx = {
      interaction,
      chat: { id: interaction.guild.id },
      message: {
        message_id: interaction.id,
        from: {
          id: interaction.author.id,
          first_name: interaction.author.username,
        },
        chat: {
          id: interaction.channel.id,
        },
        text: interaction.content,
      },

      from: {
        id: interaction.author.id,
        username: interaction.author.username,
        first_name: interaction.author.username,
      },

      reply: async (message, buttons = []) => {
        // if (interaction.type === InteractionType.ApplicationCommand) {
        {
          if (buttons.length > 0) {
            const components = new ActionRowBuilder().addComponents(
              buttons.map(button => new ButtonBuilder()
                .setCustomId(button.callback_data)
                .setLabel(button.text)
                .setStyle(ButtonStyle.Primary))
            );
            await interaction.reply({ content: message, components: [components] });
          } else {
            await interaction.reply(message);
          }
          // } else if (interaction.type === InteractionType.MessageComponent) {
          //     if (buttons.length > 0) {
          //         const components = new ActionRowBuilder().addComponents(
          //             buttons.map(button => new ButtonBuilder()
          //                 .setCustomId(button.callback_data)
          //                 .setLabel(button.text)
          //                 .setStyle(ButtonStyle.Primary))
          //         );
          //         await interaction.update({ content: message, components: [components] });
          //     } else {
          //       await interaction.followUp({ content: message, ephemeral: true });
          // }
        }
      },
      pinChatMessage: async (messageId) => {
        if (interaction.channel) {
          const message = await interaction.channel.messages.fetch(messageId);
          await message.pin();
        }
      },
      editMessageReplyMarkup: async (options) => {
        if (interaction.message) {
          await interaction.update(options);
        }
      },
      answerCbQuery: async (message) => {
        await interaction.reply({ content: message, ephemeral: true });
      }
    };
    return ctx;
  }




  // discord2telegram(message) {
  //   const ctx = message;
  //   ctx.source = 'discord';
  //   ctx.chat = {};
  //   ctx.chat.id = message.channel.id;

  //   ctx.from = {};
  //   ctx.from.id = message.author.id;
  //   ctx.from.username = message.author.username;
  //   ctx.from.first_name = message.author.username;

  //   ctx.deleteMessage = () => message.delete();
  //   ctx.updateType = "message";
  //   ctx.reply = (text, markup) => {
  //     if (markup && markup.inline_keyboard) {
  //       const rows = markup.inline_keyboard.map(row => {
  //         const buttons = row.map(button => new ButtonBuilder()
  //           .setCustomId(button.callback_data)
  //           .setLabel(button.text)
  //           .setStyle(ButtonStyle.Primary) // Default to 'Primary' style, change as needed
  //         );
  //         return new ActionRowBuilder().addComponents(buttons);
  //       });

  //       return message.channel.send({ content: text, components: rows });
  //     } else {
  //       return message.channel.send(text);
  //     }
  //   };

  //   ctx.Markup = {
  //     inlineKeyboard: (buttons) => ({ inline_keyboard: buttons })
  //   };

  //   pinChatMessage: async (messageId) => {
  //     if (interaction.channel) {
  //       const message = await interaction.channel.messages.fetch(messageId);
  //       await message.pin();
  //     }
  //   },
  //     editMessageReplyMarkup: async (options) => {
  //       if (interaction.message) {
  //         await interaction.update(options);
  //       }
  //     },
  //       answerCbQuery: async (message) => {
  //         await interaction.reply({ content: message, ephemeral: true });
  //       }

  //   ctx.message = {
  //     message_id: message.id,
  //     from: {
  //       id: message.author.id,
  //       first_name: message.author.username,
  //     },
  //     chat: {
  //       id: message.channel.id,
  //     },
  //     text: message.content,
  //   };

  //   return ctx;
  // }

  handleProcessEvents() {
    process.on('SIGINT', async () => {
      console.log('Gracefully shutting down...');
      if (this.db.type === 'orbitdb') {
        await ipfs.stop();
      }
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Gracefully shutting down...');
      await ipfs.stop();
      process.exit(0);
    });
  }
}

console.log('Holon name: ', process.env.APPNAME)

const holons = new HolonsBot();
await holons.init(process.argv[2] || process.env.APPNAME, process.argv[3] || process.env.TELEGRAM, process.argv[4] || process.env.DISCORD);
