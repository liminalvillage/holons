"use strict";
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
      this.telebot = new Telegraf(telegramtoken);

      // Initialize stage with ALL scenes at once
      console.log('Initializing stage');
      this.telebot.stage = new Scenes.Stage([]);

      // Add session and stage middleware ONCE
      this.telebot.use(session());
      this.telebot.use(this.telebot.stage.middleware());

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
    this.server = new Server(this.telebot);

    this.settings = new Settings(this.telebot, this.db);
    await this.settings.init();

    this.ui = new UI(this.telebot, this.db, this.settings);
    await this.ui.init();

    this.lunation = new Lunation(this.telebot);
    this.shopping = new Shopping(this.telebot, this.db, this.settings);

    this.bigtalk = new Bigtalk(this.telebot, this.settings);
    this.library = new Library(this.telebot, this.db);
    this.users = new Users(this.telebot, this.db);
    this.expenses = new Expenses(this.telebot, this.db, this.ui, this.settings);
    this.holons = new Holons(this.telebot, this.db, this.settings);
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
              "Welcome back! What would you like to do?",
              {
                reply_markup: {
                  inline_keyboard: [
                    //[{ text: i18next.t('personalWelcomeButtons.updateProfile'), callback_data: "start_personal_wizard" }],
                    [{ text: i18next.t('personalWelcomeButtons.configureSettings'), callback_data: "settings_menu" }],
                    [{ text: i18next.t('personalWelcomeButtons.join'), callback_data: "join_community" }],
                    [{ text: i18next.t('personalWelcomeButtons.viewDashboard'), url: `https://dashboard.holons.io/${chatID}/dashboard` }]
                  ]
                }
              }
            );
          } else {
            // New user - start onboarding wizard
            await ctx.reply(i18next.t('personalWelcome'), {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  //[{ text: i18next.t('personalWelcomeButtons.updateProfile'), callback_data: "start_personal_wizard" }],
                  [{ text: i18next.t('personalWelcomeButtons.configureSettings'), callback_data: "settings_menu" }],
                  [{ text: i18next.t('personalWelcomeButtons.join'), callback_data: "join_community" }],
                  [{ text: i18next.t('personalWelcomeButtons.viewDashboard'), url: `https://dashboard.holons.io/${chatID}/dashboard` }]
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
        await ctx.reply(i18next.t('groupWelcome'), { parse_mode: 'Markdown' });

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
      const moreMessage = `
*🔄 Task Management*
• \`/tasks\` - List all currently open tasks
• \`/actions\` - View history of completed tasks

*👥 Community Roles*
• \`/assignroles\` - Automatically assign roles based on actions
• \`/facilitate\` - Get advice on community issues

*🛒 Shopping & Expenses*
• \`/buy\` - Add items to shopping list (e.g. /buy milk)
• \`/shopping\` - View clickable shopping list
• \`/spent\` - Log expenses
• \`/balance\` - View balance table

*🌙 Lunation & Activities*
• \`/prompt\` - See current lunation day and suggested team activity
• \`/bigtalk\` - Engage in community-building conversations

*💫 Values & Identity*
• \`/ivalue\` - Set your personal values
• \`/values\` - View shared values of users or community

*🏷️ Content Management*
• \`/tag\` - Save content under specific tags
• \`/publish\` - Share content in the holosphere
• \`/cast\` - Share content across all scales
• \`/summarize\` - Create conversation summaries (use /done to finish)

*🔄 Federation Tools*
• \`/spoon\` - Connect chats to share actions and needs
• \`/fork\` - Disconnect federated chats
• \`/restart\` - Reset community settings

Type \`/\` to see all available commands.`;
      await ctx.reply(moreMessage, { parse_mode: 'Markdown' });
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

    // Add action handler for join_community
    this.telebot.action('join_community', async (ctx) => {
      console.log("=== Join Community Action Handler Called ===");
      console.log("User:", ctx.from);
      console.log("Chat ID:", ctx.chat.id);
      
      try {
        console.log("Getting user info...");
        await this.users.getUserInfo(ctx.from, ctx.chat.id);
        console.log("User info retrieved successfully");
        
        await ctx.reply("Welcome to the holon, " + ctx.from.first_name + "!");
        console.log("Welcome message sent");

        const userId = ctx.from.id;
        console.log("Checking user profile for ID:", userId);
        const userProfile = await this.db.get('users', userId);

        if (!userProfile) {
          console.log("No user profile found");
          await ctx.reply("Please complete your profile first before joining a community.");
          return;
        }
        console.log("User profile found");

        console.log("Fetching available communities...");
        const communities = await this.holons.listHolons();
        console.log("Communities fetched:", communities);

        if (!communities || communities.length === 0) {
          console.log("No communities available");
          await ctx.reply("No communities are available at the moment. Please check back later.");
          return;
        }

        console.log("Creating keyboard with communities...");
        const keyboard = communities.map(holon => ({
          text: holon.name,
          callback_data: `join_holon_${holon.address}`
        }));
        console.log("Keyboard created:", keyboard);

        console.log("Sending community selection message...");
        await ctx.reply(
          "Select a community to join:",
          {
            reply_markup: {
              inline_keyboard: keyboard.map(button => [button])
            }
          }
        );
        console.log("Community selection message sent");
      } catch (error) {
        console.error("Error in join community process:", error);
        console.error("Error stack:", error.stack);
        await ctx.reply("Sorry, there was an error joining the community. Please try again.");
      }
    });
  }

  setupTelegramHandlers() {
    console.log("=== Setting up Telegram handlers ===");
    this.telebot.on('photo', async (ctx) => {
      await this.handlePhoto(ctx);
    });

    this.telebot.on('callback_query', async (ctx) => {
      console.log("=== Callback Query Received in setupTelegramHandlers ===");
      console.log("Callback data:", ctx.callbackQuery.data);
      console.log("From user:", ctx.from);
      console.log("Message:", ctx.callbackQuery.message);
      await this.handleCallbackQuery(ctx);
    });

    // Handler for new chat members
    this.telebot.on('new_chat_members', async (ctx) => {
      const newMembers = ctx.message.new_chat_members;

      // Check if the bot itself was added to the group
      const botWasAdded = newMembers.some(member => member.id === ctx.botInfo.id);

      if (botWasAdded) {
        const welcomeMessage = `
🌟 *Welcome to Holons!* 🌟

I'm your fractal community coordination protocol. Here's how to get started:

1. Type \`/\` to see available commands
2. Type \`/join\` or complete a task to start participating
3. Type \`/dashboard\` to access your dashboard


*🎯 Core Commands*
• \`/settings\` - Configure your group's settings, federation and more
• \`/task\` - Create a new task (e.g. /task do the dishes)
• \`/appreciate\` - Send appreciation (e.g. /appreciate @laura for cooking)
• \`/request\` - Make a request (e.g. /request foot massage)
• \`/offer\` - Share what you can offer (e.g. /offer yoga sessions)
• \`/status\` - View community rankings
• \`/board\` - See all requests and offers

*💰 Value Tracking / Mutual Credit System*
• \`/spent\` - Log expenses (e.g. /spent 10 euros shopping)
• \`/balance\` - View community balance (e.g. /balance euros)

*🌐 Dashboard & Participation*
• Complete tasks to earn points and rewards
• Access your dashboard by typing /dashboard

*🤝 Holonic Federation*
• Connect with other holons to share information and rewards
• Build a network of communities through the holonic federation
• Share vouchers, resources and rewards and coordinate across communities and ecosystems

Need help? Contact @RobertoValenti for support.

⚠️ *Required Permissions*
To work properly, I need to be able to:
• Read messages
• Delete messages
• Pin messages

Please add me as an admin with these permissions.`;


        await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
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

    try {
      // Acknowledge the callback query first
      await ctx.answerCbQuery();
      console.log("Received callback query:", callbackData);

      // Handle join specific holon callback
      if (callbackData.startsWith('join_holon_')) {
        console.log("Joining specific holon:", callbackData);
        const holonAddress = callbackData.split('_')[2];
        
        try {
          const userId = ctx.from.id;
          const userProfile = await this.db.get('users', userId);

          if (!userProfile) {
            await ctx.reply("Please complete your profile first before joining a community.");
            return;
          }

          // Get the holon contract
          const holon = await this.holons.getHolonContract(holonAddress);
          const holonName = await holon.name().catch(() => 'Unknown Holon');

          // Join the holon
          await this.holons.joinHolon(userId, holonAddress);
          
          await ctx.reply(`Successfully joined ${holonName}! Welcome to the community.`);
          
          // Update the message to show joined status
          await ctx.editMessageText(
            `You have joined ${holonName}!`,
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "✅ Joined", callback_data: "already_joined" }]
                ]
              }
            }
          ).catch(err => console.log('Error updating message:', err));

        } catch (error) {
          console.error("Error joining specific holon:", error);
          await ctx.reply("Sorry, there was an error joining the community. Please try again.");
        }
        return;
      }

      // Handle personal profile callbacks
      if (callbackData === 'start_personal_wizard') {
        await ctx.answerCbQuery('Starting personal setup...');

        ctx.session = ctx.session || {};
        ctx.session.db = this.db;
        ctx.session.stage = 0;
        ctx.session.sequence = ['values', 'location', 'categories', 'questions'];
        ctx.session.wizard = true;
        ctx.session.id = ctx.from.id;
        ctx.session.username = ctx.from.username;
        ctx.session.first_name = ctx.from.first_name;
        ctx.session.last_name = ctx.from.last_name;

        return ctx.scene.enter(ctx.session.sequence[ctx.session.stage]);
      }

      // Handle view personal tokens
      if (callbackData === 'view_personal_tokens') {
        await ctx.answerCbQuery('Fetching your tokens...');

        try {
          const userId = ctx.from.id.toString();
          let message = '💰 *Your Token Balances* 💰\n\n';

          const userHolons = await this.holons.listHolonsOf(userId).catch(() => []);

          if (userHolons && userHolons.length > 0) {
            for (const holonAddress of userHolons) {
              const holon = await this.holons.getHolonContract(holonAddress);
              const holonName = await holon.name().catch(() => 'Unknown Holon');
              const ethBalance = await holon.etherBalance(userId).catch(() => '0');

              message += `*${holonName}*\n`;
              message += `ETH: ${ethers.formatEther(ethBalance)}\n\n`;
            }
          } else {
            message += "You don't have any tokens yet. Join a holon to start earning tokens!";
          }

          await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Back", callback_data: "personal_menu_back" }]
              ]
            }
          }).catch((err) => { console.log(err) });
        } catch (error) {
          console.error("Error fetching token balances:", error);
          await ctx.editMessageText("Sorry, there was an error fetching your token balances. Please try again later.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Back", callback_data: "personal_menu_back" }]
              ]
            }
          }).catch((err) => { console.log(err) });
        }
        return;
      }

      // Handle view personal contributions
      if (callbackData === 'view_personal_contributions') {
        await ctx.answerCbQuery('Fetching your contributions...');

        try {
          const userId = ctx.from.id;
          let message = '🏆 *Your Contributions* 🏆\n\n';

          const userChats = await this.settings.getChats(ctx);

          if (userChats && userChats.length > 0) {
            for (const chatId of userChats) {
              try {
                const user = await this.db.get(`${chatId}/users`, userId);
                if (user) {
                  const chatInfo = await ctx.telegram.getChat(chatId).catch(() => ({ title: 'Unknown Group' }));

                  message += `*${chatInfo.title}*\n`;
                  message += `Tasks Initiated: ${user.initiated?.length || 0}\n`;
                  message += `Tasks Completed: ${user.completed?.length || 0}\n`;
                  message += `Messages Sent: ${user.sent || 0}\n`;
                  message += `Hours Contributed: ${user.hours || 0}\n\n`;
                }
              } catch (error) {
                console.error(`Error getting user data for chat ${chatId}:`, error);
              }
            }
          } else {
            message += "You haven't made any contributions yet. Join a group to start contributing!";
          }

          await ctx.editMessageText(message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Back", callback_data: "personal_menu_back" }]
              ]
            }
          }).catch((err) => { console.log(err) });
        } catch (error) {
          console.error("Error fetching contributions:", error);
          await ctx.editMessageText("Sorry, there was an error fetching your contributions. Please try again later.", {
            reply_markup: {
              inline_keyboard: [
                [{ text: "◀️ Back", callback_data: "personal_menu_back" }]
              ]
            }
          }).catch((err) => { console.log(err) });
        }
        return;
      }

      // Handle personal menu back
      if (callbackData === 'personal_menu_back') {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
          "Welcome back! What would you like to do?",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "💰 View My Tokens", callback_data: "view_personal_tokens" }],
                [{ text: "🔍 View My Contributions", callback_data: "view_personal_contributions" }]
              ]
            }
          }
        ).catch((err) => { console.log(err) });
        return;
      }

      // Handle settings menu
      if (callbackData === 'settings_menu') {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
          "⚙️ *Group Settings* ⚙️\n\nCustomize how Holon works in this group:",
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎯 Set Purpose", callback_data: "settings_purpose_change" }],
                [{ text: "💫 Set Values", callback_data: "settings_values_change" }],
                [{ text: "🏷️ Set Domains", callback_data: "settings_domains_change" }],
                [{ text: "👥 Set Roles", callback_data: "settings_roles_change" }],
                [{ text: "🔢 Value Equation", callback_data: "settings_equation" }],
                [{ text: "🌐 Language", callback_data: "settings_language" }],
                [{ text: i18next.t("back_to_menu"), callback_data: "settings_back_to_start" }]
              ]
            }
          }
        ).catch((err) => { console.log(err) });
        return;
      }

      // Handle settings back to start
      if (callbackData === 'settings_back_to_start') {
        await ctx.answerCbQuery();

        const isAdmin = await this.isUserAdmin(ctx);

        if (isAdmin) {
          await ctx.editMessageText(
            "As an admin, you can set up the group's holon configuration:",
            {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "🎯 Set Group Purpose", callback_data: "settings_purpose_change" }],
                  [{ text: "💫 Define Group Values", callback_data: "settings_values_change" }],
                  [{ text: "🔧 Configure Settings", callback_data: "settings_menu" }],
                  [{ text: "💰 Set Up Token System", callback_data: "holons_create" }]
                ]
              }
            }
          ).catch((err) => { console.log(err) });
        }
        return;
      }

      // Handle schedule button click
      if (callbackData.startsWith('schedule_quest_')) {
        const [_, __, chatId, questId] = callbackData.split('_');
        return await this.quests.schedule(ctx);
      }

      // Handle calendar date/time selection
      if (callbackData.startsWith('t_') || callbackData.startsWith('n_')) {
        const when = this.quests.calendar.clickButtonCalendar(ctx);

        if (when === -1) return;

        const questId = this.quests.calendar.questIds.get(chatID);

        if (!questId) {
          console.log('No quest ID found in calendar data');
          await ctx.answerCbQuery('Could not find associated task');
          return;
        }

        this.scheduler.updateTaskSchedule(chatID, questId, new Date(when), ctx);
        const quest = await this.db.get(`${chatID}/quests`, questId);
        
        if (!quest) {
          console.log(`Quest ${questId} not found in database`);
          await ctx.answerCbQuery('Could not find the task');
          return;
        }

        quest.status = 'scheduled';
        quest.when = when;

        setTimeout(() => {
          this.quests.remind(ctx, quest);
        }, new Date(when).getTime() - Date.now());

        await this.db.put(`${chatID}/quests`, quest);
        await this.quests.updateMessage(ctx, quest);

        await ctx.deleteMessage(messageID).catch(err => {
          console.log('Error deleting calendar message:', err);
        });

        await ctx.answerCbQuery('Task scheduled successfully!');
        return;
      }

    } catch (error) {
      console.error('Error in callback query:', error);
      await ctx.answerCbQuery('An error occurred. Please try again.');
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

