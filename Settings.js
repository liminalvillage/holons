import i18next from "i18next";
import fs from 'fs';
import locales from "./data/locales.json" assert { type: "json" };
import * as utils from './utilities.js'
import { Markup } from 'telegraf';
import { Scenes } from 'telegraf';
import exp from "constants";

export default class Settings {
    constructor(bot, db) {
        this.db = db
        this.bot = bot

      
        // Create scenes for text input
        this.purposeScene = new Scenes.BaseScene('purpose_scene');
        this.purposeScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentPurpose = settings.purpose || i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: currentPurpose }) + '\n\n' +
                i18next.t('settings_send_new', { type: i18next.t('settings_purpose').toLowerCase() }))
                .catch(e => console.log('Error in purpose scene enter:', e));
        });
        this.purposeScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.purpose = ctx.message.text;
            await this.setSettings(settings);
            
            // Delete the scene messages and user input
            try {
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => {});
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show purpose with new UI
            await this.showArraySettingMenu(ctx, 'purpose', false);
            await ctx.scene.leave();
        });
        this.purposeScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in purpose scene message:', e)));

        this.domainsScene = new Scenes.BaseScene('domains_scene');
        this.domainsScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentDomains = settings.domains && settings.domains.length > 0 ?
                '• ' + settings.domains.join('\n• ') :
                i18next.t('settings_not_set');
            await ctx.reply(
                i18next.t('settings_send_new', { type: i18next.t('settings_domains').toLowerCase() }))
                .catch(e => console.log('Error in domains scene enter:', e));
        });
        this.domainsScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const newDomains = ctx.message.text
                .split(/[,\n]/)
                .map(d => d.trim())
                .filter(d => d !== '');
                
            let settings = await this.getSettings(chatID);
            
            // Initialize the array if it doesn't exist
            if (!settings.domains) {
                settings.domains = [];
            }
            
            // Append new domains instead of replacing existing ones
            settings.domains.push(...newDomains);
            await this.setSettings(settings);

            // Delete the scene messages and user input
            try {
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => {});
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show domains with new UI
            await this.showArraySettingMenu(ctx, 'domains', false);
            await ctx.scene.leave();
        });
        this.domainsScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in domains scene message:', e)));

        this.valuesScene = new Scenes.BaseScene('values_scene');
        this.valuesScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentValues = settings.values && settings.values.length > 0 ?
                '• ' + settings.values.join('\n• ') :
                i18next.t('settings_not_set');
            await ctx.reply(
                i18next.t('settings_send_new', { type: i18next.t('settings_values').toLowerCase() }))
                .catch(e => console.log('Error in values scene enter:', e));
        });
        this.valuesScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const newValues = ctx.message.text
                .split(/[,\n]/)
                .map(v => v.trim())
                .filter(v => v !== '');
                
            let settings = await this.getSettings(chatID);
            
            // Initialize the array if it doesn't exist
            if (!settings.values) {
                settings.values = [];
            }
            
            // Append new values instead of replacing existing ones
            settings.values.push(...newValues);
            await this.setSettings(settings);

            // Delete the scene messages and user input
            try {
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => {});
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show values with new UI
            await this.showArraySettingMenu(ctx, 'values', false);
            await ctx.scene.leave();
        });
        this.valuesScene.on('message', ctx => ctx.reply('Please send text only'));

        this.rolesScene = new Scenes.BaseScene('roles_scene');
        this.rolesScene.enter(async (ctx) => {
            
                i18next.t('settings_not_set');
            await ctx.reply(
                i18next.t('settings_send_new', { type: i18next.t('settings_roles').toLowerCase() }))
                .catch(e => console.log('Error in roles scene enter:', e));
        });
        this.rolesScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const newRoles = ctx.message.text
                .split(/[,\n]/)
                .map(r => r.trim())
                .filter(r => r !== '');
                
            let settings = await this.getSettings(chatID);
            
            // Initialize the array if it doesn't exist
            if (!settings.roles) {
                settings.roles = [];
            }
            
            // Append new roles instead of replacing existing ones
            settings.roles.push(...newRoles);
            await this.setSettings(settings);

            // Delete the scene messages and user input
            try {
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => {});
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show roles with new UI
            await this.showArraySettingMenu(ctx, 'roles', false);
            await ctx.scene.leave();
        });
        this.rolesScene.on('message', ctx => ctx.reply('Please send text only'));

        this.adminScene = new Scenes.BaseScene('admin_scene');
        this.adminScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            
            // Show admin selection keyboard with all available users
            await this.showAdminSelectionMenu(ctx, false);
        });

        this.adminScene.action(/admin_select_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const userId = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            
            let settings = await this.getSettings(chatID);
            settings.admin = userId;
            await this.setSettings(settings);
            
            // Show updated admin selection menu
            await this.showAdminSelectionMenu(ctx, true);
        });

        this.adminScene.action('admin_back', async (ctx) => {
            await ctx.answerCbQuery();
            await ctx.scene.leave();
            await this.showSettingsMenu(ctx, true);
        });

        this.adminScene.on('text', async (ctx) => {
            // For backward compatibility, also handle text input
            const chatID = ctx.message.chat.id;
            const admin = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            const language = settings.language;
            
            settings.admin = admin;
            await this.setSettings(settings);
            await ctx.scene.leave();

            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => {});
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show settings menu
            await this.showSettingsMenu(ctx, false);
        });
        this.adminScene.on('message', ctx => {
            const chatId = ctx.message.chat.id;
            this.getLanguage(chatId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }))
                    .catch(e => console.log('Error in admin scene message:', e));
            });
        });

        this.hexScene = new Scenes.BaseScene('hex_scene');
        this.hexScene.enter(async (ctx) => {    
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            
            await ctx.reply(
                i18next.t('settings_send_new', { lng: language, type: i18next.t('settings_hex', { lng: language }).toLowerCase() })
            ).catch(e => console.log('Error in hex scene enter:', e));

            // Show hex submenu
            await ctx.reply(i18next.t('settings_hex_title', { lng: language }), {
                reply_markup: await this.getHexKeyboard(chatID)
            }).catch(e => console.log('Error showing hex menu:', e));
        });
        this.hexScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const hex = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            const language = settings.language;
            
            settings.hex = hex;
            await this.setSettings(settings);
            await ctx.scene.leave();

            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show hex submenu
            await ctx.reply(i18next.t('settings_hex_title', { lng: language }), {
                reply_markup: await this.getHexKeyboard(chatID)
            }).catch(e => console.log('Error showing hex menu:', e));
        });
        this.hexScene.on('message', ctx => {
            const chatId = ctx.message.chat.id;
            this.getLanguage(chatId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }));
            });
        });

        this.addArrayItemScene = new Scenes.BaseScene('add_array_item_scene');

        // Create a simple test scene
        this.testScene = new Scenes.BaseScene('test_scene');
        this.testScene.enter(async (ctx) => {
            await ctx.reply('You entered the test scene. Type something to continue.');
        });
        
        this.testScene.on('text', async (ctx) => {
            await ctx.reply(`You typed: ${ctx.message.text}`);
            await ctx.scene.leave();
        });
        
        // Add a test scene for adding items
        this.addTestScene = new Scenes.BaseScene('add_test_scene');
        this.addTestScene.enter(async (ctx) => {
            await ctx.reply('Please enter items to add (comma separated):');
        });
        this.addTestScene.on('text', async (ctx) => {
            await ctx.reply(`You would add: ${ctx.message.text}`);
            await ctx.scene.leave();
        });

        // Register all scenes
        this.bot.stage.register(this.purposeScene);
        this.bot.stage.register(this.domainsScene);
        this.bot.stage.register(this.valuesScene);
        this.bot.stage.register(this.rolesScene);
        this.bot.stage.register(this.adminScene);
        this.bot.stage.register(this.hexScene);
        this.bot.stage.register(this.addArrayItemScene);
        this.bot.stage.register(this.testScene);
        this.bot.stage.register(this.addTestScene);

        // Call setupScenes to initialize scene handlers
        this.setupScenes();

        // ================= ADMIN ===========================

        this.bot.command('getsettings', async (ctx) => {
            let settings = await this.getSettings(utils.getChatId(ctx))

            ctx.reply(JSON.stringify(settings))
        })

        this.bot.command(['getchatnames'], async (ctx) => {
            let chats = ctx.message.text.split(',')
            let chatnames = ''
            for (let i = 0; i < chats.length; i++) {
                let name = await utils.getChatName(ctx, chats[i])
                if (name)
                    chatnames += name + ','
                console.log(chats[i], name)
            };
            ctx.reply(chatnames).catch((e) => { console.log(e) })

        })

        this.bot.command(['restart', 'reset'], async (ctx) => {
            if (utils.isAdmin(ctx)) {
                let chatID = utils.getChatId(ctx)
                let chatName = await utils.getChatName(ctx, chatID)
                this.db.drop(chatID + '/shopping')
                this.db.drop(chatID + '/quests')
                this.db.drop(chatID + '/offers')
                this.db.drop(chatID + '/users')
                this.db.drop(chatID + '/tags')
                this.db.drop(chatID + '/expenses')
                this.db.drop(chatID + '/announcements')
                this.db.drop(chatID + '/recurring')

                this.db.put(chatID + '/settings', await this.getDefaultSettings(chatID, chatName))
                //clear federation
                await this.db.holosphere.resetFederation(chatID)
                ctx.reply('Holon resetted')
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }
        })

        this.bot.command('id', async (ctx) => {
            ctx.reply('This holon ID is ' + utils.getChatId(ctx))
        })

        this.bot.command(['federate', 'spoon'], async (ctx) => {
            if (utils.isAdmin(ctx)) this.federate(ctx).catch((e) => { console.log(e) })
            else ctx.reply('Only a chat admin can perform this action')
        }
        )

        this.bot.command('federation', async (ctx) => {
            try {
                const chatID = utils.getChatId(ctx);
                const fedInfo = await this.db.holosphere.getFederation(chatID);

               

                let message = 'Federation information:\n\n';
                if (!fedInfo || !fedInfo.federation || fedInfo.federation.length === 0) {
                    message += 'This chat is not federated with any other spaces.'
                }
                else
                message += `This chat (${chatID}) is federated with:\n`;

                for (const space of fedInfo.federation) {
                    message += `- ${space}\n`;
                }

                if (fedInfo.notify && fedInfo.notify.length > 0) {
                    message += '\nThis chat will notify:\n';
                    for (const space of fedInfo.notify) {
                        message += `- ${space}\n`;
                    }
                }

                ctx.reply(message);
            } catch (error) {
                console.error('Error getting federation info:', error);
                ctx.reply('Error retrieving federation information: ' + error.message);
            }
        })

        this.bot.command(['separate', 'fork', 'spork'], async (ctx) => {
            if (utils.isAdmin(ctx)) await this.separate(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        }
        )

        // Add method to completely clear federation information
        this.bot.command('clearFederation', async (ctx) => {
            await this.clearFederation(ctx)
        }
        )


        this.bot.command('setlanguage', async (ctx) => {
            if (utils.isAdmin(ctx)) await this.setLanguage(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        })

        this.bot.command('settheme', async (ctx) => {
            if (utils.isAdmin(ctx)) this.setTheme(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        })

        this.bot.command('setadmin', async (ctx) => {
            if (utils.isAdmin(ctx)) await this.setAdmin(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        })

        this.bot.command(['valueweights', 'weights', 'weight', 'equation'], async (ctx) => {
            if (utils.isAdmin(ctx)) {
                let weights = await this.getValueEquation(utils.getChatId(ctx))
                ctx.reply('Value Equation:', this.equationInlineKeyboard(weights));
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }
        })

        this.bot.command('sethex', async (ctx) => ctx.reply("New hex: " + await this.setHex(ctx)))
        this.bot.command('gethex', async (ctx) => ctx.reply("Current hex: " + await this.getHex(ctx)))
        this.bot.command('gethexcontent', async (ctx) => ctx.reply(await this.getHexContent(ctx)))

        this.bot.command('setroles', async (ctx) => ctx.reply("New roles: " + await this.setRoles(ctx)))
        this.bot.command('getroles', async (ctx) => { let roles = await this.getRoles(utils.getChatId(ctx)); ctx.reply(roles ? roles : 'No roles specified') })

        this.bot.command('setvalues', async (ctx) => {
            if (utils.isAdmin(ctx)) {
                await this.setValues(ctx);
            } else {
                ctx.reply('Only a chat admin can perform this action');
            }
        });


        this.bot.command('setpurpose', async (ctx) => {
            if (utils.isAdmin(ctx)) {
                await this.setPurpose(ctx);
            } else {
                ctx.reply('Only a chat admin can perform this action');
            }
        });


        this.bot.command('setdomains', async (ctx) => {
            if (utils.isAdmin(ctx)) {
                const chatID = ctx.message.chat.id;
                const text = ctx.message.text.substring('/setDomains'.length).trim();

                if (!text) {
                    ctx.reply('Please specify the domains, separated by commas or newlines. Examples:\n\n1. Using commas:\n/setDomains Managing community resources, Coordinating events, Maintaining channels\n\n2. Using newlines:\n/setDomains\nManaging community resources\nCoordinating events\nMaintaining channels');
                    return;
                }

                // Split by both newlines and commas
                const newDomains = text
                    .split(/[,\n]/)                    // Split by comma or newline
                    .map(d => d.trim())                // Trim whitespace
                    .filter(d => d !== '');            // Remove empty entries

                let settings = await this.getSettings(chatID);
                
                // Initialize domains array if it doesn't exist
                if (!settings.domains) {
                    settings.domains = [];
                }
                
                // Append new domains instead of replacing
                settings.domains.push(...newDomains);
                
                await this.setSettings(settings);
                ctx.reply('Domains added:\n• ' + newDomains.join('\n• '));
            } else {
                ctx.reply('Only admins can set the domains');
            }
        });

        // Handle timezone region selection
        this.bot.action(/timezone_region_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const region = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            await ctx.editMessageText('Select timezone:', {
                reply_markup: await this.getTimezoneKeyboard(chatID, region)
            }).catch((err) => { console.log(err) });
        });

        // Handle timezone selection
        this.bot.action(/timezone_set_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const timezone = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.timezone = timezone;
            await this.setSettings(settings);
            await ctx.editMessageText('Timezone set to: ' + timezone.split('/')[1].replace('_', ' '), {
                reply_markup: await this.getTimezoneKeyboard(chatID)
            }).catch((err) => { console.log(err) });
        });

        // Add back the settings command handler
        this.bot.command('settings', async (ctx) => {
            if (utils.isAdmin(ctx)) {
                await this.showSettingsMenu(ctx, false)
                    .catch(e => console.log('Error in settings command:', e));
            } else {
                ctx.reply('Only a chat admin can perform this action')
                    .catch(e => console.log('Error in settings admin check:', e));
            }
        });

        // Handle settings menu callbacks
        this.bot.action(/settings_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const action = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            // Handle array settings - always use the new UI
            if (['values', 'domains', 'roles', 'purpose'].includes(action)) {
                await this.showArraySettingMenu(ctx, action);
                return;
            }

            switch (action) {
                case 'menu':
                    await this.showSettingsMenu(ctx, true);
                    break;
                case 'language':
                    await ctx.editMessageText(i18next.t('settings_select_language'), {
                        reply_markup: await this.getLanguageKeyboard(chatID)
                    }).catch(e => console.log('Error in language menu:', e));
                    break;
                case 'theme':
                    await ctx.editMessageText(i18next.t('settings_select_theme'), {
                        reply_markup: await this.getThemeKeyboard(chatID)
                    }).catch(e => console.log('Error in theme menu:', e));
                    break;
                case 'level':
                    await ctx.editMessageText(i18next.t('settings_select_level'), {
                        reply_markup: await this.getLevelKeyboard(chatID)
                    }).catch(e => console.log('Error in level menu:', e));
                    break;
                case 'admin':
                    if (utils.isAdmin(ctx)) {
                        // Enter admin scene directly instead of showing intermediate screen
                        await ctx.scene.enter('admin_scene');
                    } else {
                        ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
                    }
                    break;
                case 'hex':
                    if (utils.isAdmin(ctx)) {
                        // Enter hex scene directly instead of showing intermediate screen
                        await ctx.scene.enter('hex_scene');
                    } else {
                        ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
                    }
                    break;
                case 'timezone':
                    await ctx.editMessageText(i18next.t('settings_select_timezone_region'), {
                        reply_markup: await this.getTimezoneKeyboard(chatID)
                    }).catch(e => console.log('Error in timezone menu:', e));
                    break;
                case 'equation':
                    let weights = await this.getValueEquation(chatID);
                    await ctx.editMessageText(i18next.t('settings_equation_title'), {
                        reply_markup: this.equationInlineKeyboard(weights)
                    }).catch((err) => { console.log(err) });
                    break;
                case 'back':
                    await this.showSettingsMenu(ctx, true);
                    break;
                case 'help':
                    await ctx.reply(
                        "🌟 Welcome to Holons Bot! 🌟\n\n" +
                        "A Holon is a self-organizing entity that is both a whole and a part of a larger whole. This bot helps manage your Holon community by:\n\n" +
                        "🌟 Purpose & Values:\n" +
                        "• Define your Holon's purpose\n" +
                        "• Set core values that guide your community\n" +
                        "• Establish domains of accountability\n\n" +
                        "👥 Roles & Responsibilities:\n" +
                        "• Assign roles to members\n" +
                        "• Track contributions and participation\n" +
                        "• Manage administrative access\n\n" +
                        "⚖️ Value System:\n" +
                        "• Configure value equation weights\n" +
                        "• Track member contributions\n" +
                        "• Balance giving and receiving\n\n" +
                        "🔗 Integration:\n" +
                        "• Connect with other Holons via Hex IDs\n" +
                        "• Customize language and theme\n" +
                        "• Set your timezone for coordination\n\n" +
                        "To get started:\n" +
                        "1. Set an admin using the Admin setting\n" +
                        "2. Define your Holon's purpose\n" +
                        "3. Add your core values\n" +
                        "4. Define accountability domains\n" +
                        "5. Configure roles as needed\n\n" +
                        "Need help? Click the Support & Feedback button to contact us!"
                    ).catch(e => console.log('Error sending help message:', e));
                    break;
            }
        });

        // Add language selection handlers
        this.bot.action(/language_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const language = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            if (['en', 'it', 'es', 'fr'].includes(language)) {
                settings.language = language;
                await this.setSettings(settings);
                await i18next.changeLanguage(language);
                await ctx.reply(i18next.t('settings_language_updated', { language: language }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Add theme selection handlers
        this.bot.action(/theme_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const theme = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            if (['light', 'dark'].includes(theme)) {
                settings.theme = theme;
                await this.setSettings(settings);
                await ctx.reply(i18next.t('settings_theme_updated', { theme: theme }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Add level selection handlers
        this.bot.action(/level_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const level = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            if (['1', '2', '3'].includes(level)) {
                settings.level = parseInt(level);
                await this.setSettings(settings);
                await ctx.reply(i18next.t('settings_level_updated', { level: level }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Handle timezone settings selection
        this.bot.action(/timezone_set_(.+)/, async (ctx) => {
            await ctx.answerCbQuery();
            const timezone = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.timezone = timezone;
            await this.setSettings(settings);
            const displayTimezone = timezone.split('/')[1].replace('_', ' ');
            await ctx.reply(i18next.t('settings_timezone_updated', { timezone: displayTimezone }));
            await ctx.editMessageText(i18next.t('settings_select_timezone_region'), {
                reply_markup: await this.getTimezoneKeyboard(chatID)
            }).catch((err) => { console.log(err) });
        });

        this.bot.action(/settings_equation_change/, async (ctx) => {
            await ctx.answerCbQuery();
            const chatID = ctx.callbackQuery.message.chat.id;
            let weights = await this.getValueEquation(chatID);
            await ctx.editMessageText(i18next.t('settings_equation_title'), {
                reply_markup: this.equationInlineKeyboard(weights)
            }).catch((err) => { console.log(err) });
        });

        // Handle increment/decrement actions for value equation weights
        this.bot.action(/^(increment|decrement)_(\w+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const chatID = ctx.callbackQuery.message.chat.id;
            const action = ctx.match[1];
            const field = ctx.match[2];

            let weights = await this.getValueEquation(chatID);

            if (action === 'increment') {
                weights[field]++;
            } else {
                weights[field]--;
            }

            await this.setValueEquation(chatID, weights);

            await ctx.editMessageText('Value Equation:', {
                reply_markup: this.equationInlineKeyboard(weights)
            }).catch((err) => { console.log(err) });
        });

        // Add array setting action handlers
        ['values', 'domains', 'roles'].forEach(type => {
            // Add change handler for entering add scene
            this.bot.action(`settings_${type}_change`, async (ctx) => {
                await ctx.answerCbQuery();
                await ctx.scene.enter('add_array_item_scene', { type });
            });

            this.bot.action(`enter_remove_mode_${type}`, async (ctx) => {
                await ctx.answerCbQuery();
                await this.showArraySettingMenu(ctx, type, true);
            });

            this.bot.action(`exit_remove_mode_${type}`, async (ctx) => {
                await ctx.answerCbQuery();
                await this.showArraySettingMenu(ctx, type, false);
            });

            this.bot.action(new RegExp(`remove_${type}_(\\d+)`), async (ctx) => {
                await ctx.answerCbQuery();
                const index = parseInt(ctx.match[1]);
                const chatID = ctx.chat.id;
                let settings = await this.getSettings(chatID);
                
                if (!settings[type] || !settings[type][index]) {
                    await ctx.reply(`Item not found in ${type}`);
                    return;
                }

                // Remove the item
                settings[type].splice(index, 1);
                await this.setSettings(settings);

                // Show updated menu in remove mode
                await this.showArraySettingMenu(ctx, type, true);
            });
        });

        // Register action handlers for settings
        this.bot.action('settings', (ctx) => this.showSettingsMenu(ctx, true));
        this.bot.action('settings_back', (ctx) => this.showSettingsMenu(ctx, true));
        
        // Handle array setting actions
        this.bot.action(/settings_(values|domains|roles|purpose)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type);
        });
        
        // Handle entering remove mode
        this.bot.action(/enter_remove_mode_(values|domains|roles|purpose)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type, true);
        });
        
        // Handle exiting remove mode
        this.bot.action(/exit_remove_mode_(values|domains|roles|purpose)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type, false);
        });
        
        // Handle removing items
        this.bot.action(/remove_(values|domains|roles|purpose)_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const type = ctx.match[1];
            const index = parseInt(ctx.match[2]);
            const chatID = ctx.callbackQuery.message.chat.id;
            
            let settings = await this.getSettings(chatID);
            if (!settings[type]) settings[type] = [];
            
            settings[type].splice(index, 1);
            await this.setSettings(settings);
            
            return this.showArraySettingMenu(ctx, type, true);
        });
        
        // Handle adding items with explicit handlers for each type
        this.bot.action('settings_values_change', async (ctx) => {
            console.log('VALUES ADD button clicked');
            await ctx.answerCbQuery();
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'values' });
            } catch (error) {
                console.error('Error entering values add scene:', error);
                return ctx.reply('Error adding values. Please try again later.');
            }
        });
        
        this.bot.action('settings_domains_change', async (ctx) => {
            console.log('DOMAINS ADD button clicked');
            await ctx.answerCbQuery();
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'domains' });
            } catch (error) {
                console.error('Error entering domains add scene:', error);
                return ctx.reply('Error adding domains. Please try again later.');
            }
        });
        
        this.bot.action('settings_roles_change', async (ctx) => {
            console.log('ROLES ADD button clicked');
            await ctx.answerCbQuery();
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'roles' });
            } catch (error) {
                console.error('Error entering roles add scene:', error);
                return ctx.reply('Error adding roles. Please try again later.');
            }
        });
        
        this.bot.action('settings_purpose_change', async (ctx) => {
            console.log('PURPOSE ADD button clicked');
            await ctx.answerCbQuery();
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'purpose' });
            } catch (error) {
                console.error('Error entering purpose add scene:', error);
                return ctx.reply('Error adding purpose. Please try again later.');
            }
        });

 
        // Add a direct command to add values without scenes
        this.bot.command('addvalues', async (ctx) => {
            const text = ctx.message.text.replace('/addvalues', '').trim();
            if (!text) {
                await ctx.reply('Please provide values to add, like: /addvalues value1, value2, value3');
                return;
            }
            
            const chatID = ctx.chat.id;
            const values = text.split(/[,\n]/)
                .map(v => v.trim())
                .filter(v => v !== '');
                
            let settings = await this.getSettings(chatID);
            
            if (!settings.values) {
                settings.values = [];
            }
            
            settings.values.push(...values);
            await this.setSettings(settings);
            
            await ctx.reply(`Added ${values.length} values: ${values.join(', ')}`);
            await this.showArraySettingMenu(ctx, 'values', false);
        });
        
        // Add direct commands for other types
        this.bot.command('adddomains', async (ctx) => {
            const text = ctx.message.text.replace('/adddomains', '').trim();
            if (!text) {
                await ctx.reply('Please provide domains to add, like: /adddomains domain1, domain2, domain3');
                return;
            }
            
            const chatID = ctx.chat.id;
            const domains = text.split(/[,\n]/)
                .map(d => d.trim())
                .filter(d => d !== '');
                
            let settings = await this.getSettings(chatID);
            
            if (!settings.domains) {
                settings.domains = [];
            }
            
            settings.domains.push(...domains);
            await this.setSettings(settings);
            
            await ctx.reply(`Added ${domains.length} domains: ${domains.join(', ')}`);
            await this.showArraySettingMenu(ctx, 'domains', false);
        });
        
        this.bot.command('addroles', async (ctx) => {
            const text = ctx.message.text.replace('/addroles', '').trim();
            if (!text) {
                await ctx.reply('Please provide roles to add, like: /addroles role1, role2, role3');
                return;
            }
            
            const chatID = ctx.chat.id;
            const newRoles = text.split(/[,\n]/)
                .map(r => r.trim())
                .filter(r => r !== '');
                
            let settings = await this.getSettings(chatID);
            
            // Initialize roles array if it doesn't exist
            if (!settings.roles) {
                settings.roles = [];
            }
            
            // Append new roles instead of replacing
            settings.roles.push(...newRoles);
            
            await this.setSettings(settings);
            await ctx.reply(`Added ${newRoles.length} roles: ${newRoles.join(', ')}`);
            await this.showArraySettingMenu(ctx, 'roles', false);
        });

        // Handle help messages for adding items
        this.bot.action(/help_add_(values|domains|roles|purpose)$/, async (ctx) => {
            await ctx.answerCbQuery();
            const type = ctx.match[1];
            
            // Check if bot has delete_messages permission (indicating admin rights)
            let botHasAdminRights = false;
            try {
                // Try to get the bot's member info from the chat
                const chatId = ctx.chat.id;
                if (chatId < 0) { // It's a group chat
                    const botMember = await ctx.telegram.getChatMember(chatId, ctx.botInfo.id);
                    botHasAdminRights = botMember && 
                        (botMember.status === 'administrator' || botMember.status === 'creator') &&
                        (botMember.can_delete_messages === true);
                    
                    console.log('Bot admin status:', botHasAdminRights);
                }
            } catch (error) {
                console.error('Error checking bot admin status:', error);
                botHasAdminRights = false;
            }
            
            if (botHasAdminRights) {
                // Bot has admin rights - enter the appropriate scene
                try {
                    switch(type) {
                        case 'values':
                            return await ctx.scene.enter('values_scene');
                        case 'domains':
                            return await ctx.scene.enter('domains_scene');
                        case 'roles':
                            return await ctx.scene.enter('roles_scene');
                        case 'purpose':
                            return await ctx.scene.enter('purpose_scene');
                    }
                } catch (error) {
                    console.error(`Error entering ${type} scene:`, error);
                    // Fall back to command instructions if scene entry fails
                }
            }
            
            // Bot doesn't have admin rights or scene entry failed - show command instructions
            let message = '';
            
            if (type === 'purpose') {
                message = 'To set your purpose, use the command:\n\n/setpurpose To create a thriving community through collaboration';
            } else {
                // For array types
                const commandMap = {
                    'values': '/addvalues',
                    'domains': '/adddomains',
                    'roles': '/addroles'
                };
                
                const exampleMap = {
                    'values': 'Collaboration, Innovation, Sustainability',
                    'domains': 'Community Management, Content Creation, Development',
                    'roles': 'Facilitator, Developer, Designer'
                };
                
                message = `To add ${type}, use the command:\n\n${commandMap[type]} ${exampleMap[type]}\n\nYou can separate multiple items with commas.`;
            }
            
            await ctx.reply(message);
        });
    }

    async getHex(ctx) {
        let settings = await this.getSettings(utils.getChatId(ctx))
        return settings.hex
    }

    async setHex(ctx) {
        if (utils.isAdmin(ctx)) {
            const chatID = ctx.message.chat.id;
            const hex = ctx.message.text.split(' ')[1];
            let settings = await this.getSettings(chatID)
            settings.hex = hex
            await this.setSettings(settings)
            return hex
        }
        else ctx.reply("Only admins can set the hex")


    }

    async getHexContent(ctx) {
        const chatID = ctx.message.chat.id;
        let settings = await this.getSettings(chatID)
        let hex = settings.hex
        let content = await this.db.getAll(hex + '/tags')
        //console.log(content)
        return content ? content[0].id : 'not found'
    }


    // TODO: move to utilities or UI
    equationInlineKeyboard(weights) {
        return {
            inline_keyboard: [
                [{ text: i18next.t('settings_value_equation_weights'), callback_data: ' ' }],
                [{ text: '✏️ ' + i18next.t('settings_edit'), callback_data: 'settings_equation_change' }],
                [
                    { text: i18next.t('settings_initiated'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_initiated' },
                    { text: weights.initiated.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_initiated' }
                ],
                [
                    { text: i18next.t('settings_completed'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_completed' },
                    { text: weights.completed.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_completed' }
                ],
                [
                    { text: i18next.t('settings_sent'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_sent' },
                    { text: weights.sent.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_sent' }
                ],
                [
                    { text: i18next.t('settings_received'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_received' },
                    { text: weights.received.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_received' }
                ],
                [
                    { text: i18next.t('settings_hours'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_hours' },
                    { text: weights.hours.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_hours' }
                ],
                [
                    { text: i18next.t('settings_money'), callback_data: 'null' },
                    { text: '<', callback_data: 'decrement_money' },
                    { text: weights.money.toString(), callback_data: 'null' },
                    { text: '>', callback_data: 'increment_money' }
                ],
                [{ text: i18next.t('settings_back'), callback_data: 'settings_back' }]
            ]
        };
    }

    getDefaultSettings(chatID, chatName) {
        return {
            id: chatID,
            hex: chatID,
            version: 0.1,
            name: chatName || 'unknown',
            timezone: '',
            whitelisted: false,
            language: process.env.LANGUAGE || 'en',
            theme: 'dark',
            level: 0,
            admin: '',
            roles: [],
            values: [],
            purpose: '',
            domains: [],
            valueEquation: {
                initiated: 1,
                completed: 1,
                sent: 1,
                received: 1,
                hours: 1,
                collaboration: 1,
                wants: 1,
                offers: 1,
                money: 1
            }
        }
    }

    async init() {
        i18next
            .init({
                lng: 'en',
                resources: locales,
                fallbackLng: 'en',
            });
    }

    // get language from the database
    async getLanguage(chatID) {
        let settings = await this.getSettings(chatID)
        return settings.language
    }

    async setLanguage(ctx) {
        const chatID = ctx.message.chat.id;
        const language = ctx.message.text.split(' ')[1];

        if (language === undefined || language === null) {
            ctx.reply('Please specify the language. Example: /setLanguage en')
            return
        }
        if (language !== 'en' && language !== 'it' && language !== 'es' && language !== 'fiobbo') {
            ctx.reply('Please specify "en", "it", "es", or "fiobbo". Example: /setLanguage en')
            return
        }

        let settings = await this.getSettings(chatID)
        settings.language = language
        this.db.put(chatID + '/settings', settings)
        ctx.reply('Language changed to ' + language)
    }

    async getTheme(chatID) {
        let settings = await this.getSettings(chatID)

        if (settings.theme === 'light') {
            //return themelight
            return fs.readFileSync('themes/theme-light.css', 'utf8');
        } else {
            //return themedark
            return fs.readFileSync('themes/theme-dark.css', 'utf8');
        }
    }


    async setTheme(ctx) {
        const chatID = ctx.message.chat.id;
        const theme = ctx.message.text.split(' ')[1];

        if (theme === undefined || theme === null) {
            ctx.reply('Please specify the theme. Example: /setTheme light')
            return
        }
        if (theme !== 'light' && theme !== 'dark') {
            ctx.reply('Please specify "light" or "dark". Example: /setTheme light')
            return
        }
        let settings = await this.getSettings(chatID)
        settings.theme = theme
        this.db.put(chatID + '/settings', settings)
        ctx.reply('Theme changed to ' + theme)
    }

    async setLevel(ctx) {
        const chatID = ctx.message.chat.id;
        const level = ctx.message.text.split(' ')[1];

        if (level === undefined || level === null) {
            ctx.reply('Please specify the level. Example: /setLevel 1')
            return
        }
        if (level !== '1' && level !== '2' && level !== '3') {
            ctx.reply('Please specify "1", "2" or "3". Example: /setLevel 1')
            return
        }

        let settings = await this.getSettings(chatID)
        settings.level = level
        this.db.put(chatID + '/settings', settings)
        ctx.reply('Level changed to ' + level)

    }

    async setAdmin(ctx) {
        const chatID = ctx.message.chat.id;
        const admin = ctx.message.text.split(' ')[1];
        if (admin === undefined || admin === null) {
            ctx.reply('Please specify the admin. Example: /setAdmin @admin')
            return
        }
        let settings = await this.getSettings(chatID)
        settings.admin = admin
        this.db.put(chatID + '/settings', settings)
        ctx.reply('Admin changed to ' + admin)
    }



    async federate(ctx) {
        const chatID = ctx.message.chat.id.toString();
        const federationID = ctx.message.text.split(' ')[1];

        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify the ID you would like to federate with. Example: /federate 123456. This chat ID is ' + chatID);
            return;
        }

        try {
            // Use holosphere federate method
            console.log('FEDERATING', chatID, federationID)
            await this.db.holosphere.federate(chatID, federationID);
            ctx.reply('This chat has been federated with ' + federationID);
        } catch (error) {
            console.error('Federation error:', error);
            ctx.reply('Error creating federation: ' + error.message);
        }
    }

    async separate(ctx) {
        const chatID = ctx.message.chat.id;
        const federationID = ctx.message.text.split(' ')[1];

        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify who you would like to revoke the federation with. Example: /separate 123456.');
            return;
        }

        try {
            // Use holosphere unfederate method
            await this.db.holosphere.unfederate(chatID, federationID);
            ctx.reply('Federation with ' + federationID + ' has been revoked');
        } catch (error) {
            console.error('Unfederation error:', error);
            ctx.reply('Error removing federation: ' + error.message);
        }
    }

    async getFederation(chatID) {
        try {
            // Use holosphere getFederation method
            return await this.db.holosphere.getFederation(chatID);
        } catch (error) {
            console.error('Get federation error:', error);
            return [];
        }
    }

    

    async setRoles(ctx) {
        const chatID = ctx.message.chat.id;
        const newRoles = utils.parseList(ctx.message.text);

        if (newRoles === undefined || newRoles === null || newRoles.length === 0) {
            return ('Please specify the roles. Example: /setRoles role1 role2');
        }
        
        let settings = await this.getSettings(chatID);
        
        // Initialize roles array if it doesn't exist
        if (!settings.roles) {
            settings.roles = [];
        }
        
        // Append new roles instead of replacing
        settings.roles.push(...newRoles);
        
        await this.setSettings(settings);
        return `Added roles: ${newRoles.join(', ')}`;
    }

    async getRoles(chatID) {
        let settings = await this.getSettings(chatID)
        return settings.roles
    }

    async setValues(ctx) {
        if (utils.isAdmin(ctx)) {
            const chatID = ctx.message.chat.id;
            const text = ctx.message.text.substring('/setValues'.length).trim();

            if (!text) {
                ctx.reply('Please specify the values, separated by commas or newlines. Examples:\n\n1. Using commas:\n/setValues Collaboration, Communication, Pro-activity\n\n2. Using newlines:\n/setValues\nCollaboration\nCommunication\nPro-activity');
                return;
            }

            // Split by both newlines and commas
            const newValues = text
                .split(/[,\n]/)                    // Split by comma or newline
                .map(v => v.trim())                // Trim whitespace
                .filter(v => v !== '');            // Remove empty entries

            let settings = await this.getSettings(chatID);
            
            // Initialize the array if it doesn't exist
            if (!settings.values) {
                settings.values = [];
            }
            
            // Append new values instead of replacing existing ones
            settings.values.push(...newValues);
            
            await this.setSettings(settings);
            ctx.reply('Values added:\n• ' + newValues.join('\n• ')).catch(e => console.log('Error in setValues reply:', e));
        } else {
            ctx.reply('Only admins can set the values').catch(e => console.log('Error in setValues admin check:', e));
        }
    }

    async getValues(chatID) {
        let settings = await this.getSettings(chatID);
        return settings.values;
    }

    async getSettings(chatID) {
        let settings = await this.db.get(chatID + '/settings', chatID)
        if (!settings || settings == '') {
            let chatName = await utils.getChatName(this.bot, chatID)
            settings = this.getDefaultSettings(chatID, chatName)
            await this.db.put(chatID + '/settings', settings)
        } else {
            // Ensure all required fields exist by merging with default settings
            const defaultSettings = this.getDefaultSettings(chatID, settings.name || 'unknown')
            settings = {
                ...defaultSettings,  // Start with all default values
                ...settings,         // Override with existing settings
                // Ensure array properties exist
                roles: settings.roles || defaultSettings.roles,
                values: settings.values || defaultSettings.values,
                domains: settings.domains || defaultSettings.domains,
                // Ensure object properties exist
                valueEquation: {
                    ...defaultSettings.valueEquation,
                    ...(settings.valueEquation || {})
                }
            }
            // Save the updated settings with any missing fields
            await this.db.put(chatID + '/settings', settings)
        }
        return settings
    }

    async setSettings(settings) {
        await this.db.put(settings.id + '/settings', settings)
    }

    async setValueEquation(chatID, equation) {
        let settings = await this.getSettings(chatID)
        settings.valueEquation = equation
        await this.db.put(chatID + '/settings', settings)
    }

    async getValueEquation(chatID) {
        let settings = await this.getSettings(chatID)
        return settings.valueEquation
    }

    async whitelisted(ctx) {
        let settings = await settings.getSettings(utils.getChatId(ctx))
        if (settings.whitelisted) return ''
        else return ("This bot is still in development, and this chat is not whitelisted to use this function.")
    }


    // async getSettingsButtons(chatID) {
    //     return [
    //         [{ text: 'Language:'}], [{ text: 'IT', setLanguage(chatID, 'it') }],[{ text: 'EN', setLanguage(ctx, 'en') }]
    //         [{ text: 'Theme' }],
    //         [{ text: 'Level', callback_data: 'level' }],
    //         [{ text: 'Admin', callback_data: 'admin' }],
    //         [{ text: 'Roles', callback_data: 'roles' }]
    //     ]
    // }

    async showSettingsMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;
        
        const menuMarkup = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: `${this.getSettingIcon('language')} ${i18next.t('settings_language', { lng: language })}: ${settings.language}`, callback_data: 'settings_language' },
                        { text: `${this.getSettingIcon('theme')} ${i18next.t('settings_theme', { lng: language })}: ${settings.theme}`, callback_data: 'settings_theme' }
                    ],
                    [
                        { text: `${this.getSettingIcon('timezone')} ${i18next.t('settings_timezone', { lng: language })}: ${settings.timezone ? settings.timezone.split('/')[1].replace('_', ' ') : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_timezone' },
                        { text: `${this.getSettingIcon('purpose')} ${i18next.t('settings_purpose', { lng: language })}: ${settings.purpose ? '✓' : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_purpose' }
                    ],
                    [
                        { text: `${this.getSettingIcon('roles')} ${i18next.t('settings_roles', { lng: language })}: ${settings.roles?.length || 0}`, callback_data: 'settings_roles' },
                        { text: `${this.getSettingIcon('values')} ${i18next.t('settings_values', { lng: language })}: ${settings.values?.length || 0}`, callback_data: 'settings_values' }
                    ],
                    [
                        { text: `${this.getSettingIcon('domains')} ${i18next.t('settings_domains', { lng: language })}: ${settings.domains?.length || 0}`, callback_data: 'settings_domains' },
                        { text: `${this.getSettingIcon('equation')} ${i18next.t('settings_equation', { lng: language })}`, callback_data: 'settings_equation' }
                    ],
                    [
                        { text: `${this.getSettingIcon('admin')} ${i18next.t('settings_admin', { lng: language })}: ${settings.admin ? '✓' : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_admin' },
                        { text: `${this.getSettingIcon('hex')} ${i18next.t('settings_hex', { lng: language })}: ${settings.hex ? '✓' : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_hex' }
                    ],
                    [
                        { text: i18next.t('settings_help', { lng: language }), callback_data: 'settings_help' },
                        { text: i18next.t('settings_support', { lng: language }), url: 'https://t.me/RobertoValenti' }
                    ]
                ]
            }
        };

        try {
            if (edit) {
                await ctx.editMessageText(i18next.t('settings', { lng: language }), menuMarkup);
            } else {
                await ctx.reply(i18next.t('settings', { lng: language }), menuMarkup);
            }
        } catch (e) {
            console.log('Error showing settings menu:', e);
        }
    }

    async getLanguageKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('language')} ${i18next.t('settings_language', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: settings.language }), callback_data: ' ' }],
                [
                    { text: '🇬🇧 English', callback_data: 'language_en' },
                    { text: '🇮🇹 Italian', callback_data: 'language_it' }
                ],
                [
                    { text: '🇪🇸 Spanish', callback_data: 'language_es' },
                    { text: '🇫🇷 French', callback_data: 'language_fr' }
                ],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async getThemeKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('theme')} ${i18next.t('settings_theme', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: settings.theme }), callback_data: ' ' }],
                [
                    { text: i18next.t('settings_theme_light', { lng: language }), callback_data: 'theme_light' },
                    { text: i18next.t('settings_theme_dark', { lng: language }), callback_data: 'theme_dark' }
                ],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async getLevelKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('level')} ${i18next.t('settings_level', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: 'Level ' + settings.level }), callback_data: ' ' }],
                [
                    { text: i18next.t('settings_level_1', { lng: language }), callback_data: 'level_1' },
                    { text: i18next.t('settings_level_2', { lng: language }), callback_data: 'level_2' },
                    { text: i18next.t('settings_level_3', { lng: language }), callback_data: 'level_3' }
                ],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async getTimezoneKeyboard(chatID, region = null) {
        const timezones = {
            'Europe': [
                'Europe/London', 'Europe/Paris', 'Europe/Berlin',
                'Europe/Rome', 'Europe/Madrid', 'Europe/Moscow'
            ],
            'Americas': [
                'America/New_York', 'America/Chicago', 'America/Denver',
                'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo'
            ],
            'Asia/Pacific': [
                'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore',
                'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland'
            ]
        };

        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const currentTimezone = settings.timezone ? settings.timezone.split('/')[1].replace('_', ' ') : i18next.t('settings_not_set', { lng: language });

        if (!region) {
            // Show regions
            return {
                inline_keyboard: [
                    [{ text: `${this.getSettingIcon('timezone')} ${i18next.t('settings_timezone', { lng: language })}`, callback_data: ' ' }],
                    [{ text: `${i18next.t('settings_current', { lng: language, value: currentTimezone })}`, callback_data: ' ' }],
                    [{ text: i18next.t('settings_region_europe', { lng: language }), callback_data: 'timezone_region_Europe' }],
                    [{ text: i18next.t('settings_region_americas', { lng: language }), callback_data: 'timezone_region_Americas' }],
                    [{ text: i18next.t('settings_region_asia_pacific', { lng: language }), callback_data: 'timezone_region_Asia/Pacific' }],
                    [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
                ]
            };
        } else {
            // Show timezones for selected region
            const keyboard = [
                [{ text: `${this.getSettingIcon('timezone')} ${i18next.t('settings_timezone', { lng: language })}`, callback_data: ' ' }],
                [{ text: `${i18next.t('settings_current', { lng: language, value: currentTimezone })}`, callback_data: ' ' }]
            ];
            for (let i = 0; i < timezones[region].length; i += 2) {
                const row = [];
                row.push({
                    text: timezones[region][i].split('/')[1].replace('_', ' '),
                    callback_data: 'timezone_set_' + timezones[region][i]
                });
                if (i + 1 < timezones[region].length) {
                    row.push({
                        text: timezones[region][i + 1].split('/')[1].replace('_', ' '),
                        callback_data: 'timezone_set_' + timezones[region][i + 1]
                    });
                }
                keyboard.push(row);
            }
            keyboard.push([{ text: i18next.t('settings_back_to_regions', { lng: language }), callback_data: 'settings_timezone' }]);
            return { inline_keyboard: keyboard };
        }
    }

    async getTimezone(chatID) {
        let settings = await this.getSettings(chatID);
        return settings.timezone || 'Not set';
    }

    // Add method to show array setting menu
    async showArraySettingMenu(ctx, type, removeMode = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;
        
        const keyboard = {
            inline_keyboard: []
        };

        // Special handling for purpose (which is a string, not an array)
        if (type === 'purpose') {
            const currentPurpose = settings.purpose || '';
            
            // Add header
            keyboard.inline_keyboard.push([{
                text: `🎯 ${i18next.t('settings_purpose', { lng: language })}`,
                callback_data: ' '
            }]);
            
            // Add current purpose (if any)
            if (currentPurpose) {
                keyboard.inline_keyboard.push([{
                    text: `• ${currentPurpose}`,
                    callback_data: 'purpose_view'
                }]);
            } else {
                keyboard.inline_keyboard.push([{
                    text: i18next.t('settings_not_set', { lng: language }),
                    callback_data: ' '
                }]);
            }
            
            // Add control buttons
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_edit_purpose', { lng: language }),
                callback_data: 'help_add_purpose'
            }]);
        } 
        // For arrays (values, domains, roles)
        else {
            let items = settings[type] || [];
            
            // Add header with count
            keyboard.inline_keyboard.push([{
                text: `${this.getSettingIcon(type)} ${i18next.t(`settings_${type}`, { lng: language })}: ${items.length}`,
                callback_data: ' '
            }]);
            
            // Add items if there are any
            if (items && items.length > 0) {
                items.forEach((item, index) => {
                    if (removeMode) {
                        keyboard.inline_keyboard.push([{
                            text: `❌ ${item}`,
                            callback_data: `remove_${type}_${index}`
                        }]);
                    } else {
                        keyboard.inline_keyboard.push([{
                            text: `• ${item}`,
                            callback_data: `${type}_${index}`
                        }]);
                    }
                });
            } else {
                keyboard.inline_keyboard.push([{
                    text: i18next.t('settings_no_items', { lng: language, type: i18next.t(`settings_${type}`, { lng: language }).toLowerCase() }),
                    callback_data: ' '
                }]);
            }

            // Add control buttons at the bottom
            if (removeMode) {
                keyboard.inline_keyboard.push([{
                    text: i18next.t('settings_exit_remove_mode', { lng: language }),
                    callback_data: `exit_remove_mode_${type}`
                }]);
            } else {
                keyboard.inline_keyboard.push([
                    {
                        text: i18next.t('settings_add', { lng: language }),
                        callback_data: `help_add_${type}`
                    },
                    {
                        text: i18next.t('settings_remove', { lng: language }),
                        callback_data: `enter_remove_mode_${type}`
                    }
                ]);
            }
        }

        // Back button for all menu types
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back_to_settings', { lng: language }),
            callback_data: 'settings_back'
        }]);
        
        try {
            if (ctx.callbackQuery) {
                await ctx.editMessageText(i18next.t('settings', { lng: language }), {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(i18next.t('settings', { lng: language }), {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log(`Error showing ${type} menu:`, e);
        }
    }

    // Helper method to get setting icon
    getSettingIcon(type) {
    return '';
        switch(type) {
            case 'values': return '💫';
            case 'domains': return '🔍';
            case 'roles': return '👥';
            case 'purpose': return '🎯';
            case 'language': return '🌐';
            case 'theme': return '🎨';
            case 'timezone': return '🕒';
            case 'admin': return '👑';
            case 'hex': return '🔗';
            case 'equation': return '⚖️';
            case 'level': return '📊';
            default: return '⚙️';
        }
    }

    setupScenes() {
        // Setup add array item scene
        this.addArrayItemScene.enter(async (ctx) => {
            try {
                console.log('Enter add_array_item_scene');
                
                // Get the type from ctx.scene.state.type or directly from state
                const type = ctx.scene.state.type || (ctx.scene.state.state ? ctx.scene.state.state.type : null);
                console.log('Scene type:', type);
                
                if (!type) {
                    console.error('Error: No type provided for add_array_item_scene');
                    await ctx.reply('Error: Could not determine what to add. Please try again.');
                    return ctx.scene.leave();
                }
                
                // Store the message ID and chat ID
                ctx.scene.state.chatId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
                ctx.scene.state.originalMessageId = ctx.callbackQuery?.message?.message_id;
                
                // Store the type
                ctx.scene.state.type = type;
                
                // Send prompt message
                console.log('Sending prompt for type:', type);
                const promptMessage = await ctx.reply(i18next.t('settings_enter_new_items', { type: i18next.t(`settings_${type}`).toLowerCase() }));
                
                // Store prompt message ID for later deletion
                ctx.scene.state.promptMessageId = promptMessage.message_id;
            } catch (error) {
                console.error('Error in addArrayItemScene.enter:', error);
                await ctx.reply('An error occurred. Please try again.');
                await ctx.scene.leave();
            }
        });

        this.addArrayItemScene.on('text', async (ctx) => {
            try {
                console.log('Received text in add_array_item_scene');
                const itemsText = ctx.message.text;
                const chatId = ctx.scene.state.chatId || ctx.chat.id;
                const type = ctx.scene.state.type;
                
                console.log('Processing text for type:', type);
                
                if (!type) {
                    console.error('Error: No type stored in scene state');
                    await ctx.reply('Error: Could not determine what to add. Please try again.');
                    return ctx.scene.leave();
                }
                
                let settings = await this.getSettings(chatId);

                // Initialize array if it doesn't exist
                if (!settings[type]) {
                    settings[type] = [];
                }

                // Add new items
                const newItems = itemsText
                    .split(/[,\n]/)
                    .map(text => text.trim())
                    .filter(text => text !== '');
                
                console.log('Adding items:', newItems);

                settings[type].push(...newItems);
                await this.setSettings(settings);

                // Delete the prompt message and user's input
                try {
                    if (ctx.scene.state.promptMessageId) {
                        await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => {});
                    }
                    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
                } catch (error) {
                    console.log('Error deleting messages:', error);
                }

                // Show updated array setting menu
                console.log('Showing updated menu for type:', type);
                await this.showArraySettingMenu(ctx, type, false);
                await ctx.scene.leave();

            } catch (error) {
                console.error(`Error adding items:`, error);
                await ctx.reply(`Error adding items. Please try again.`);
                await ctx.scene.leave();
            }
        });
    }

    // Add setPurpose method
    async setPurpose(ctx) {
        const chatID = ctx.message.chat.id;
        const text = ctx.message.text.replace('/setpurpose', '').trim();
        const language = await this.getLanguage(chatID);

        if (!text) {
            ctx.reply(i18next.t('settings_specify_purpose', { lng: language }));
            return;
        }

        let settings = await this.getSettings(chatID);
        settings.purpose = text;
        await this.setSettings(settings);
        await ctx.reply(i18next.t('settings_purpose_set', { lng: language, value: text }));
        await this.showArraySettingMenu(ctx, 'purpose', false);
    }

    async getAdminKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const admin = settings.admin || i18next.t('settings_not_set', { lng: language });
        
        // Simplify the keyboard since we no longer need the edit button
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('admin')} ${i18next.t('settings_admin', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: admin }), callback_data: ' ' }],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async getHexKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const hex = await this.getHex({ chat: { id: chatID } });
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('hex')} ${i18next.t('settings_hex', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: hex || i18next.t('settings_not_set', { lng: language }) }), callback_data: ' ' }],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async showAdminSelectionMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const currentAdmin = settings.admin || '';

        // Get all users from the chat
        let users = [];
        try {
            // Use the Users class functionality to get chat users
            users = await this.db.getAll(chatID + '/users');
        } catch (error) {
            console.error('Error getting users:', error);
        }

        const keyboard = {
            inline_keyboard: []
        };

        // Add header
        keyboard.inline_keyboard.push([{
            text: `${this.getSettingIcon('admin')} ${i18next.t('settings_admin', { lng: language })}`,
            callback_data: ' '
        }]);

        // Add each user as a button
        if (users && users.length > 0) {
            for (const user of users) {
                // Skip users without proper identification
                if (!user.id) continue;

                // Create display name (prefer username, fallback to first_name or id)
                const displayName = user.username ? 
                    '@' + user.username : 
                    (user.first_name || user.id.toString());
                
                // Add check mark if this is the current admin
                const isAdmin = currentAdmin === user.id.toString() || 
                                currentAdmin === user.username ||
                                currentAdmin === '@' + user.username;
                
                keyboard.inline_keyboard.push([{
                    text: `${isAdmin ? '✅ ' : ''}${displayName}`,
                    callback_data: `admin_select_${user.id}`
                }]);
            }
        } else {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_no_users', { lng: language }),
                callback_data: ' '
            }]);
        }

        // Add back button
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back', { lng: language }),
            callback_data: 'admin_back'
        }]);

        // Display the keyboard
        try {
            if (edit && ctx.callbackQuery) {
                await ctx.editMessageText(i18next.t('settings_select_admin', { lng: language }), {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(i18next.t('settings_select_admin', { lng: language }), {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log('Error showing admin selection menu:', e);
        }
    }
}