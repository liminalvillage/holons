import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { Client, GatewayIntentBits } from 'discord.js';
import MattermostClient from 'mattermost-client';

class MultiBot extends Telegraf {
    constructor() {
        super(process.env.TELEGRAM);

        this.telegramBot = null;
        this.discordBot = null;
        this.mattermostClient = null;
        this.commands = {}
    }

    async start() {
        this.telegramBot = this //new Telegraf(process.env.TELEGRAM);
        this.discordBot = new Client({ intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates,
        ] });
        this.mattermostClient = new MattermostClient(process.env.MATTERMOST);
        this.telegramBot.launch(); // Start the bot    

        this.discordBot.on('ready', () => {
            console.log(`Logged in as ${this.discordBot.user.tag}!`);
        });

        this.discordBot.on('messageCreate', (message) => {
            if (message.author.bot) return;
            if (message.content === 'ping') {
                message.reply('Pong!');
            }
        });

        this.discordBot.login(process.env.DISCORD);

        this.setupDiscordCommands();
        this.setupTelegramCommands();
        this.setupMattermostCommands();
    }


    setupTelegramCommands() {
        this.telegramBot.on('text', (ctx) => {
            this.handleMessage(ctx, 'telegram');
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

        this.discordBot.login(process.env.DISCORD);
    }

    setupMattermostCommands() {
        this.mattermostClient.on('message', (msg) => {
            this.handleMessage(msg, 'mattermost');
        });

        this.mattermostClient.login();
    }

    on(...args) {
        console.log('on', ...args);
        super.on(...args);

    }

    command(...args) {
        console.log('command', ...args);
        //register command
        if (Array.isArray(args[0]))
            for (let i = 0; i < args[0].length; i++)
                this.commands[args[0][i]] = args[1];
        else
            this.commands[args[0]] = args[1];
        //super.command(...args);

    }

    async handleInlineQuery(ctx, platform) {
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

    async handlePhoto(ctx, platform) {
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

    async handleMessage(msg, platform) {
        let ctx;
        if (platform == 'discord'){
            ctx = this.discord2telegram(msg, platform);
        }
        else
            ctx = msg

        if (ctx.message.text.startsWith(process.env.PREFIX)) {
            console.log("in", ctx.message.text);
            const command = ctx.message.text.split(' ')[0].substring(1);
            const args = ctx.message.text.split(' ').slice(1);
            console.log (command, this.commands)
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

    async stop() {
        await this.telegramBot.stop();
        await this.discordBot.destroy();
    }


}

export default MultiBot;