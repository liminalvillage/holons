/**
 * @fileoverview Multi-platform bot supporting Telegram, Discord, and Mattermost.
 * @module src/MultiBot
 */

import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits,ActionRowBuilder, ButtonBuilder, ButtonStyle,Events } from 'discord.js';
import MattermostClient from 'mattermost-client';

import fs from 'fs';
import { platform } from 'os';

/**
 * Multi-platform bot extending Telegraf with Discord and Mattermost support.
 *
 * @class MultiBot
 * @extends Telegraf
 * @description Unified bot interface that bridges Telegram, Discord, and Mattermost.
 * Normalizes message contexts across platforms to enable cross-platform command
 * handling. Supports voice channel tracking on Discord.
 *
 * @property {string} telegramtoken - Telegram bot token
 * @property {string} discordtoken - Discord bot token
 * @property {string} mattermosttoken - Mattermost bot token
 * @property {Telegraf} telegramBot - Telegram bot instance
 * @property {Client} discordBot - Discord.js client instance
 * @property {MattermostClient} mattermostClient - Mattermost client instance
 * @property {Object} commands - Registered command handlers
 * @property {Object} userVoiceData - Discord voice channel tracking data
 *
 * @example
 * const bot = new MultiBot(telegramToken, discordToken, mattermostToken);
 * await bot.start();
 */
class MultiBot extends Telegraf {
    constructor(telegramtoken, discordtoken, mattermosttoken) {
        super(telegramtoken);
        this.telegramtoken = telegramtoken
        this.discordtoken = discordtoken
        this.mattermosttoken = mattermosttoken

        this.telegramBot = null;
        this.discordBot = null;
        this.mattermostClient = null;

        this.commands = {}
        this.userVoiceData = {};

        // Debug: Log ALL updates at the very start
        this.use((ctx, next) => {
            if (ctx.callbackQuery) {
                console.log('[MultiBot EARLY] Callback:', ctx.callbackQuery.data);
            }
            return next();
        });
    }

    async start() {
        //---------------------------------------- TELEGRAM
        this.telegramBot = this //new Telegraf(process.env.TELEGRAM);
        // Note: /start command is handled by Settings.js with localized messages
        this.setupTelegramCommands();
        this.telegramBot.launch(); // Start the bot AFTER handlers are set up


        // -------------------------------------- DISCORD
        this.discordBot = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates,
            ]
        });
        this.discordBot.on('ready', () => {
            console.log(`Logged in as ${this.discordBot.user.tag}!`);
        });

        // this.discordBot.on('messageCreate', (message) => {
        //     if (message.author.bot) return;
        //     if (message.content === 'ping') {
        //         message.reply('Pong!');
        //     }
        // });
        this.discordBot.login(this.discordtoken);
        this.setupDiscordCommands()

        // ------------------------------------ MATTERMOST       
        this.mattermostClient = new MattermostClient(this.mattermosttoken);
        this.setupMattermostCommands();
    }


    setupTelegramCommands() {
        this.telegramBot.on('text', (ctx) => {
            this.handleMessage(ctx, 'telegram');
        })

        // Handle callback queries (button clicks)
        this.telegramBot.on('callback_query', (ctx, next) => {
            console.log('[MultiBot] Callback query received:', ctx.callbackQuery?.data);
            return next();
        })
    }


    setupDiscordCommands() {
        this.discordBot.on('ready', () => {
            console.log(`Discord BOT started with ${this.discordBot.users.cache.size} users, in ${this.discordBot.channels.cache.size} channels of ${this.discordBot.guilds.cache.size} guilds.`);
            this.discordBot.user.setActivity(`Serving ${this.discordBot.guilds.cache.size} servers`);
        });

        this.discordBot.on('messageCreate', (msg) => {
            this.handleMessage(msg, 'discord');
        });

        this.discordBot.on('messageCreate', async (message) => {
            if (message.content === '!join') {
                if (message.member.voice.channel) {
                    const connection = joinVoiceChannel({
                        channelId: message.member.voice.channel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    const members = Array.from(message.member.voice.channel.members.keys());

                    connection.receiver.speaking.on('start', (userId) => {
                        const audioStream = connection.receiver.subscribe(userId);
                        const outputPath = `./recordings/${userId}-${Date.now()}.pcm`;
                        const pcmStream = new prism.opus.Decoder({
                            channels: 2,
                            rate: 48000,
                            frameSize: 960,
                        });
                        audioStream.pipe(pcmStream);
                        pcmStream.pipe(fs.createWriteStream(outputPath));
                    }
                    );

                    // Adjust time as needed for your requirements

                    message.reply('Recording the conversation between ' + members.join(', '));
                } else {
                    message.reply('You need to join a voice channel first!');
                }
            }
            if (message.content === '!leave') {
                const connection = getVoiceConnection(message.guild.id);
                if (connection) {
                    connection.destroy();
                    message.reply('Left the voice channel.');
                } else {
                    message.reply('I am not in a voice channel.');
                }
            }
        });
        
        this.discordBot.on(Events.InteractionCreate, async interaction => {
            if (!interaction.isButton()) return;
            console.log(interaction)
            if (interaction.customId === 'primary') {
                await interaction.reply({ content: 'Button clicked!', ephemeral: true });
            }
        });

        this.discordBot.on('voiceStateUpdate', (oldState, newState) => {
            const userId = newState.id;
            const newChannelId = newState.channelId;
            const oldChannelId = oldState.channelId;

            if (newChannelId && !oldChannelId) {
                // User joins a voice channel
                if (!this.userVoiceData[newChannelId]) {
                    this.userVoiceData[newChannelId] = {};
                }
                if (!this.userVoiceData[newChannelId][userId]) {
                    this.userVoiceData[newChannelId][userId] = { joinedAt: new Date() };
                } else {
                    this.userVoiceData[newChannelId][userId].joinedAt = new Date();
                }
                console.log(`${userId} joined voice channel ${newChannelId}`);
            } else if (!newChannelId && oldChannelId) {
                // User leaves a voice channel
                if (this.userVoiceData[oldChannelId] && this.userVoiceData[oldChannelId][userId]) {
                    const timeSpent = new Date() - this.userVoiceData[oldChannelId][userId].joinedAt;
                    this.userVoiceData[oldChannelId][userId].totalTime = (this.userVoiceData[oldChannelId][userId].totalTime || 0) + timeSpent;
                    console.log(`${userId} left the voice channel. Total time: ${this.userVoiceData[oldChannelId][userId].totalTime} ms`);
                    delete this.userVoiceData[oldChannelId][userId];
                }
                // If the channel is empty, delete the channel entry
                if (this.userVoiceData[oldChannelId] && Object.keys(this.userVoiceData[oldChannelId]).length === 0) {
                    delete this.userVoiceData[oldChannelId];
                }
            } else if (newChannelId && oldChannelId && newChannelId !== oldChannelId) {
                // User switches voice channels
                if (this.userVoiceData[oldChannelId] && this.userVoiceData[oldChannelId][userId]) {
                    const timeSpent = new Date() - this.userVoiceData[oldChannelId][userId].joinedAt;
                    this.userVoiceData[oldChannelId][userId].totalTime = (this.userVoiceData[oldChannelId][userId].totalTime || 0) + timeSpent;
                    console.log(`${userId} switched voice channels. Total time in ${oldChannelId}: ${this.userVoiceData[oldChannelId][userId].totalTime} ms`);
                    delete this.userVoiceData[oldChannelId][userId];
                }
                // If the old channel is empty, delete the channel entry
                if (this.userVoiceData[oldChannelId] && Object.keys(this.userVoiceData[oldChannelId]).length === 0) {
                    delete this.userVoiceData[oldChannelId];
                }
                // Add the user to the new channel
                if (!this.userVoiceData[newChannelId]) {
                    this.userVoiceData[newChannelId] = {};
                }
                this.userVoiceData[newChannelId][userId] = { joinedAt: new Date() };
                console.log(`${userId} joined voice channel ${newChannelId}`);
            }
        });

    }

    setupMattermostCommands() {
        this.mattermostClient.on('message', (msg) => {
            this.handleMessage(msg, 'mattermost');
        });

        this.mattermostClient.login();
    }

    // on(...args) {
    //     super.on(...args);
    // }

    command(...args) {
        //register command
        if (Array.isArray(args[0]))
            for (let i = 0; i < args[0].length; i++){
                this.commands[args[0][i]] = args[1];
                console.log('command:', args[0][i])
            }
        else
            this.commands[args[0]] = args[1];
        //super.command(...args);

    }

    async handleInlineQuery(ctx, platform) {
        let offers = [];
        let chats = await this.settings.getChats(ctx);
        let k = 0;

        for (const holonId of chats) {
            let users = await this.db.getAll(holonId.toString(), 'users');
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

    async handlePhoto(ctx, platform) {
        if (ctx.message.caption) {
            const command = ctx.message.caption.split(' ')[0];
            console.log('Photo caption command:', command, 'Full caption:', ctx.message.caption);

            if (['/task', '/quest', '/todo', '/offer', '/request', '/compito', '/missione'].includes(command)) {
                console.log('Creating quest from photo caption:', command);
                ctx.message.text = ctx.message.caption;
                this.quests.quest(command.slice(1), ctx);
            } else if (['/spent', '/expense', '/speso'].includes(command)) {
                ctx.message.text = ctx.message.caption;
                this.expenses.spent(ctx);
            }
        }
    }

    async handleMessage(msg, platform) {
        let ctx
        if (platform == 'discord') {
            ctx = this.discord2telegram(msg);
        }
        else {
            ctx = msg
            ctx.platform = 'telegram';
        }
        if (ctx.message.text.startsWith(process.env.PREFIX)) {
            const command = ctx.message.text.split(' ')[0].substring(1);
            const args = ctx.message.text.split(' ').slice(1);
            if (this.commands[command]) {
                //call the function with the context
                this.commands[command](ctx);
            } else {
                ctx.reply('Unknown command');
            }

        }
    }

    discord2telegram(interaction) {
        const ctx = {
            platform: 'discord',
            telegram: this,
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
            
            //detect button press    
            reply: async (message, buttons) => {
                // if (interaction.type === InteractionType.ApplicationCommand) {
                {
                    console.log('buttons', buttons)
                    if (buttons) {
                        buttons = buttons.reply_markup.inline_keyboard[0]
                       // for (let i = 0; i < buttons.length; i++) {
                         //   let row = buttons[i]
                           let components = new ActionRowBuilder().addComponents(
                                buttons.map(button => new ButtonBuilder()
                                    .setCustomId(button.callback_data)
                                    .setLabel(button.text)
                                    .setStyle(ButtonStyle.Primary))
                            )
                      //  }
                        return await interaction.reply({ content: message, components: [components] });
                    } else {
                        return await interaction.reply(message);
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

    async stop() {
        await this.telegramBot.stop();
        await this.discordBot.destroy();
    }


}

export default MultiBot;