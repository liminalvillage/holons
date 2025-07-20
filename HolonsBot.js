"use strict";
import 'dotenv/config';
import Server from './Server.js';
import qrReader from 'qrcode-reader';
import Jimp from 'jimp';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import { Telegraf, Markup, Scenes, session } from 'telegraf';
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
import Announcements from './Announcements.js';
import Checklists from './Checklists.js';
import Scheduler from './Scheduler.js';
import CapitalGame from './CapitalGame.js';
import i18next from 'i18next';


// Delete lock file if it exists
if (fs.existsSync('./orbitdb/repo.lock')) {
  fs.rmdirSync('./orbitdb/repo.lock');
}

class HolonsBot {
  constructor() {
    this.server = null;
    this.db = null;
    this.stage = null;
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
    this.checklists = null;
    this.scheduler = null;
    this.capitalGame = null;
  }

  async init(appname = 'Holons', telegramtoken = null, discordtoken = null) {
    try {
      // Initialize i18next
      const resources = {};
      const knownLanguages = ['en', 'it', 'es', 'fr', 'ru', 'de']; // All languages the bot supports

      // Load dedicated language files
      for (const lang of knownLanguages) {
        const filePath = `./data/locales/${lang}.json`;
        if (fs.existsSync(filePath)) {
          try {
            resources[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            console.log(`Loaded dedicated locale file for ${lang}`);
          } catch (e) {
            console.error(`Error reading or parsing ${filePath}:`, e);
            resources[lang] = { translation: {} }; // Fallback to empty translation
          }
        } else {
          // If a language file doesn't exist, initialize with an empty translation
          console.warn(`Dedicated locale file not found for ${lang} at ${filePath}. Initializing empty translations.`);
          resources[lang] = { translation: {} };
        }
      }

      // Ensure all known languages have at least an empty translation namespace if not loaded
      // This also handles cases where a file might exist but is empty or malformed, leading to an empty resources[lang]
      for (const lang of knownLanguages) {
        if (!resources[lang]) { // Should be redundant due to the else block above, but good for safety
          resources[lang] = { translation: {} };
          console.log(`Ensuring basic structure for ${lang} as it was not found in dedicated files.`);
        } else if (!resources[lang].translation) {
          // If a dedicated file was loaded but it MISSED a translation key (e.g. en.json = { week: [] })
          // or if it was initialized as {} in the catch block or missing file block.
          resources[lang].translation = {};
           console.log(`Ensuring translation namespace for ${lang}.`);
        }
      }

      await i18next.init({
        resources,
        fallbackLng: 'en',
        debug: process.env.MODE === 'development',
        interpolation: {
          escapeValue: false, // Important for rendering HTML/Markdown in messages
        }
      });

      this.telebot = new Telegraf(telegramtoken);

      // Initialize stage with ALL scenes at once
      console.log('Initializing stage');
      this.telebot.stage = new Scenes.Stage([]);

      // Add session and stage middleware ONCE
      this.telebot.use(session());
      this.telebot.use(this.telebot.stage.middleware());

      
      // Add  middleware to log all interaction queries to add the users to the database
      this.telebot.use((ctx, next) => {
        if (ctx.callbackQuery && this.users) {
          this.users.getUserInfo(ctx.callbackQuery.from, ctx.callbackQuery.message?.chat?.id);
        }
        if (ctx.message && this.users) {
          this.users.getUserInfo(ctx.message.from, ctx.message.chat.id);
        }
        return next();
      });


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
      this.handleProcessEvents();

    } catch (error) {
      console.error('Error initializing:', error);
    }
  }

  async initializeModules() {
    this.server = new Server(this.telebot, this.db.holosphere.gun);

    this.settings = new Settings(this.telebot, this.db);

    this.ui = new UI(this.telebot, this.db, this.settings);
    await this.ui.init();

    this.expenses = new Expenses(this.telebot, this.db, this.ui, this.settings);
    
    if (this.ui && this.expenses) {
        this.ui.setExpensesInstance(this.expenses);
    }

    this.lunation = new Lunation(this.telebot);
    this.shopping = new Shopping(this.telebot, this.db, this.settings);

    this.bigtalk = new Bigtalk(this.telebot, this.settings);
    this.library = new Library(this.telebot, this.db);
    this.users = new Users(this.telebot, this.db);
    this.holons = new Holons(this.telebot, this.db, this.settings);
    
    // Connect UI instance to Holons for polynomial parameter charts
    if (this.ui && this.holons && typeof this.holons.setUIInstance === 'function') {
      this.holons.setUIInstance(this.ui);
      console.log("UI instance successfully passed to Holons instance for chart generation.");
    } else {
      console.error("Failed to pass UI instance to Holons. Check if instances and method exist.");
    }
    
    // Ensure Holons instance is passed to Settings instance
    if (this.settings && typeof this.settings.setHolonsInstance === 'function' && this.holons) {
      this.settings.setHolonsInstance(this.holons);
      console.log("Holons instance successfully passed to Settings instance.");
    } else {
      console.error("Failed to pass Holons instance to Settings. Check if instances and method exist.");
    }

    this.h3 = new H3(this.telebot, this.db, this.settings);
    this.tags = new Tags(this.telebot, this.db);
    this.participation = new Participation(this.telebot, this.db);
    this.council = new Council(this.telebot, this.db);
    this.roles = new Roles(this.telebot, this.db, this.ui, this.settings);
    this.rounds = new OneOnOne(this.telebot, this.db, this.settings);
    this.announcements = new Announcements(this.telebot, this.db, this.settings, this.users);
    this.onboarding = new Onboarding(this.telebot, this.db);
    this.checklists = new Checklists(this.telebot, this.db);
    this.quests = new Quests(this.telebot, this.db, this.users, this.settings);
    this.quests.setChecklists(this.checklists);
    this.checklists.setQuestInstance(this.quests);
    
    // Connect UI instance to Quests for image generation
    if (this.ui && this.quests && typeof this.quests.setUIInstance === 'function') {
      this.quests.setUIInstance(this.ui);
      console.log("UI instance successfully passed to Quests instance for image generation.");
    } else {
      console.error("Failed to pass UI instance to Quests. Check if instances and method exist.");
    }
    
    this.capitalGame = new CapitalGame(this.telebot, this.settings);

    this.scheduler = new Scheduler(this.telebot, this.db, this.quests, this.settings);
    this.quests.setScheduler(this.scheduler);
    this.quests.expenses = this.expenses;
    this.quests.checklists = this.checklists;

  }

  setupTelegramCommands() {
    console.log("=== Setting up Telegram commands ===");
    
    this.telebot.command('start', async (ctx) => {
      const chatID = ctx.chat.id;
      const language = await this.settings.getLanguage(chatID) || 'en';

      // Check if this is a private chat or a group chat
      if (chatID > 0) {
        // Private chat - Start personal holon onboarding

        // Initialize session data
        ctx.session = ctx.session || {};
        ctx.session.db = this.db;

        // Start the onboarding wizard for personal profile
        try {
          // Check if the user already has a profile
          const userExists = await this.db.get('users', ctx.from.id);
        
          if (userExists) {
            await ctx.reply(
              i18next.t('personalWelcome', { lng: language }),
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    //[{ text: i18next.t('personalWelcomeButtons.updateProfile'), callback_data: "start_personal_wizard" }],
                    [{ text: i18next.t('personalWelcomeButtons.configureSettings', { lng: language }), callback_data: "settings_menu" }],
                    [{ text: i18next.t('personalWelcomeButtons.viewDashboard', { lng: language }), url: `https://dashboard.holons.io/${chatID}/dashboard` }]
                  ]
                }
              }
            );
          } else {
            // New user - start onboarding wizard
            await ctx.reply(i18next.t('personalWelcome', { lng: language }), {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  //[{ text: i18next.t('personalWelcomeButtons.updateProfile'), callback_data: "start_personal_wizard" }],
                  [{ text: i18next.t('personalWelcomeButtons.configureSettings', { lng: language }), callback_data: "settings_menu" }],

                  [{ text: i18next.t('personalWelcomeButtons.viewDashboard', { lng: language }), url: `https://dashboard.holons.io/${chatID}/dashboard` }]
                ]
              }
            });
          }
        } catch (error) {
          console.error("Error in personal start command:", error);
          await ctx.reply("Sorry, there was an error starting the onboarding process. Please try again.");
        }
      } else {
        // Group chat - Show settings interface
        await ctx.reply(i18next.t('groupWelcome', { lng: language }), { parse_mode: 'Markdown' });

        // Check if user is an admin
        try {
          const isAdmin = await this.isUserAdmin(ctx);

          if (isAdmin) {
            // Show settings button for admins
            await ctx.reply(
              "Configure your group's settings:",
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "⚙️ Configure Settings", callback_data: "settings_menu" }]
                  ]
                }
              }
            );
          } else {
            // Non-admin message
            await ctx.reply(
              "Only group administrators can configure the group settings. Please ask an admin to run the /start command.",
              {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "📚 Learn More About Holons", url: "https://holons.io" }]
                  ]
                }
              }
            );
          }
        } catch (error) {
          console.error("Error in group start command:", error);
          await ctx.reply("Sorry, there was an error checking your admin status. Please try again.");
        }
      }
    });

    this.telebot.command('help', async (ctx) => {
      ctx.reply('Just type / for a list of possible commands and start playing with them. For instance \n /task do the dishes \n /request ride to the station \n /offer massage \n');
    });

    this.telebot.command('more', async (ctx) => {
      const language = await this.settings.getLanguage(ctx.chat.id) || 'en';
      await ctx.reply(i18next.t('moreMessage', { lng: language }), { parse_mode: 'Markdown' });
    });

    if (process.env.MODE === 'development') {

      this.telebot.on('inline_query', async (ctx) => {
        await this.handleInlineQuery(ctx);
      });

      this.telebot.on('chosen_inline_result', (ctx) => {
        console.log(`Chosen product: ${ctx.chosenInlineResult.result_id}`);
      });
    }
  }

  setupTelegramHandlers() {
    console.log("=== Setting up Telegram handlers ===");
    
    // Handler for webapp data (hex selection from hexamap)
    this.telebot.on('web_app_data', async (ctx) => {
      try {
        const hex = ctx.message.web_app_data.data;
        const chatID = ctx.message.chat.id;
        
        console.log(`Received hex from webapp: ${hex} for chat: ${chatID}`);
        
        // Validate hex format (basic H3 validation)
        if (!hex || typeof hex !== 'string' || hex.length < 10) {
          await ctx.reply('❌ Invalid hex format received from map.');
          return;
        }
        
        // Save the hex to chat settings
        await this.settings.setHex(chatID, hex);
        
        // Get language for response
        const language = await this.settings.getLanguage(chatID) || 'en';
        
        // Send confirmation message
        await ctx.reply(
          `✅ ${i18next.t('hex_updated', { lng: language, defaultValue: 'Hex updated successfully' })}: \`${hex}\``,
          { parse_mode: 'Markdown' }
        );
        
        console.log(`Hex ${hex} saved for chat ${chatID}`);
        
      } catch (error) {
        console.error('Error handling webapp data:', error);
        await ctx.reply('❌ Error saving hex. Please try again.');
      }
    });
    
    this.telebot.on('photo', async (ctx) => {
      await this.handlePhoto(ctx);
    });

    // Handler for new chat members
    this.telebot.on('new_chat_members', async (ctx) => {
 
      const newMembers = ctx.message.new_chat_members;
      // Check if the bot itself was added to the group
      const botWasAdded = newMembers.some(member => member.id === ctx.botInfo.id);

      if (botWasAdded) {
        const language = await this.settings.getLanguage(ctx.chat.id) || 'en';
        await ctx.reply(i18next.t('groupWelcome', { lng: language }), { parse_mode: 'Markdown' });
      }

      // Add all new members to the database using Users module
      for (const member of newMembers) {
        // Skip if the new member is the bot itself
        if (member.id === ctx.botInfo.id) continue;

        try {
          // Use getUserInfo which will create the user if they don't exist
          await this.users.getUserInfo(member, ctx.chat.id);

          // Save a join action for the user
          await this.users.saveUserAction(
            member,
            'joined',
            'Joined the group',
            0,
            ctx.chat.id
          );
        } catch (error) {
          console.error(`Error processing new user ${member.id}:`, error);
        }
      }
      await this.users.saveUserAction(
        ctx.message.from,
        'added_bot',
        'Added bot to group',
        0,
        ctx.chat.id
      );
    });

    // Add new handler for replies to messages
    this.telebot.on('message', async (ctx) => {
      // Check if message is a reply
      if (ctx.message.reply_to_message) {
        await this.handleReply(ctx);
      }
    });
  }

  async handleInlineQuery(ctx) {
    let offers = [];
    let chats = await this.settings.getChats(ctx);
    let k = 0;

    for (const chatID of chats) {
      let users = await this.db.holosphere.getAll(chatID, 'users');
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
    // First handle caption commands if present
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

      qr.callback = async (err, value) => {
        if (err) {
          console.error('QR code read error:', err);
          return;
        }

        if (value && value.result) {
          const qrText = value.result;
          
          // Check if the QR code content starts with a command
          if (qrText.startsWith('/')) {
            const [command, ...args] = qrText.split(' ');
            // Create a new message context with the QR code content
            const newCtx = {
              ...ctx,
              chat: ctx.chat || ctx.message.chat,
              from: ctx.from || ctx.message.from,
              message: {
                ...ctx.message,
                text: qrText,
                caption: undefined,
                photo: undefined,
                from: ctx.message.from,
                chat: ctx.message.chat,
                date: ctx.message.date || Math.floor(Date.now() / 1000),
                message_id: ctx.message.message_id
              },
              replyWithPhoto: ctx.replyWithPhoto.bind(ctx),
              replyWithHTML: ctx.replyWithHTML.bind(ctx),
              replyWithMarkdown: ctx.replyWithMarkdown.bind(ctx),
              reply: ctx.reply.bind(ctx),
              telegram: ctx.telegram,
              deleteMessage: ctx.deleteMessage.bind(ctx),
              editMessageText: ctx.editMessageText.bind(ctx),
              editMessageReplyMarkup: ctx.editMessageReplyMarkup.bind(ctx)
            };
            
            // Handle specific commands
            if (['/task', '/quest', '/todo', '/offer', '/request'].includes(command)) {
              await this.quests.quest(command.slice(1), newCtx);
            } else if (['/spent', '/expense', '/speso'].includes(command)) {
              await this.expenses.spent(newCtx);
            } else {
              // For any other commands, just display the QR content
              await ctx.reply(`QR Code content: ${qrText}`);
            }
          } else {
            // Check if the content is a valid URL
            let isValidUrl = false;
            try {
              new URL(qrText);
              isValidUrl = true;
            } catch (e) {
              isValidUrl = false;
            }

            if (isValidUrl) {
              // If it's a URL, show the web app button
              await ctx.reply(`${qrText.split('/').slice(qrText.split('/').length - 1)}`, 
                Markup.inlineKeyboard([
                  Markup.button.webApp('Open', qrText)
                ])
              );
            } else {
              // If not a URL, just show the content
              await ctx.reply(`QR Code content: ${qrText}`);
            }
          }
        }
      };

      qr.decode(jimpImage.bitmap);
    } catch (error) {
      console.error('Error processing QR code:', error);
      // Don't send error to user unless it's a development environment
      if (process.env.NODE_ENV === 'development') {
        await ctx.reply('Error processing QR code. Please try again.');
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
    const gracefulShutdown = async () => {
      console.log('Gracefully shutting down...');
      
      // Close browser if it exists
      if (this.ui) {
        try {
          await this.ui.closeBrowser();
        } catch (error) {
          console.error('Error closing browser:', error);
        }
      }
      
      if (this.db.type === 'orbitdb') {
        await ipfs.stop();
      }
      process.exit(0);
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);

    // Add this new event handler for uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      process.exit();
    });

    // Add this new event handler for unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit();
    });
  }

  // Add this new method to handle replies
  async handleReply(ctx) {
    try {
      const repliedMessage = ctx.message.reply_to_message;

      // Check if the replied message is from the bot
      if (repliedMessage.from.id === ctx.botInfo.id) {
        // Try to determine the type of the original message
        const messageType = this.determineMessageType(repliedMessage);

        // Handle based on message type
        switch (messageType) {
          case 'quest':
            await this.quests.addNote(ctx);
            break;
          case 'expense':
            await this.expenses.addNote(ctx);
            break;
          // Add more cases as needed
          default:
            // Optional: Handle unknown message types
            console.log('Reply to unknown message type:', messageType);
        }
      }
    } catch (error) {
      console.error('Error handling reply:', error);
    }
  }

  // Add this helper method to determine message type
  determineMessageType(message) {
    if (this.db.get(message.chat.id + '/quests', message.message_id)) {
      return 'quest';
    }
    if (this.db.get(message.chat.id + '/expenses', message.message_id)) {
      return 'expense';
    }

    // Add more type checks as needed

    return 'unknown';
  }

  // Helper method to check if a user is an admin in the group
  async isUserAdmin(ctx) {
    try {
      // Get chat member info
      const userId = ctx.from.id;
      const chatId = ctx.chat.id;
      const member = await ctx.telegram.getChatMember(chatId, userId);

      // Check if user is an admin or creator
      return ['creator', 'administrator'].includes(member.status);
    } catch (error) {
      console.error("Error checking admin status:", error);
      return false;
    }
  }
}

console.log('Holon name: ', process.env.APPNAME)

const holons = new HolonsBot();
await holons.init(process.argv[2] || process.env.APPNAME, process.argv[3] || process.env.TELEGRAM, process.argv[4] || process.env.DISCORD);

