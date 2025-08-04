import i18next from "i18next";
import fs from 'fs';
import * as utils from './utilities.js'
import { Scenes } from 'telegraf';
import SettingsScenes from './SettingsScenes.js';

const ALL_AVAILABLE_LENSES = ['quests', 'offers', 'tags', 'expenses', 'announcements', 'users', 'shopping', 'recurring'];

export default class Settings {
    constructor(bot, db) {
        this.db = db;
        this.bot = bot;
        this.holons = null; // Re-add Holons instance placeholder
        
        // Create settings scenes handler
        this.scenes = new SettingsScenes(bot, db);
        
        // Register required methods from Settings in the scenes instance
        this.scenes.getSettings = this.getSettings.bind(this);
        this.scenes.setSettings = this.setSettings.bind(this);
        this.scenes.getLanguage = this.getLanguage.bind(this);
        this.scenes.showSettingsMenu = this.showSettingsMenu.bind(this);
        this.scenes.showArraySettingMenu = this.showArraySettingMenu.bind(this);
        this.scenes.showHexMenu = this.showHexMenu.bind(this);
        this.scenes.showFederationMenu = this.showFederationMenu.bind(this);
        this.scenes.showUsersManagementMenu = this.showUsersManagementMenu.bind(this);
        this.scenes.showUserInfo = this.showUserInfo.bind(this);
        this.scenes.processUserMentions = this.processUserMentions.bind(this);
        this.scenes.processManualUserEntry = this.processManualUserEntry.bind(this);
        this.scenes.addUserToDatabase = this.addUserToDatabase.bind(this);
        this.scenes.cleanupSceneMessages = this.cleanupSceneMessages.bind(this);
        
        // Register admin selection callback at bot level instead of scene level
        this.bot.action(/admin_select_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const userId = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            const language = await this.getLanguage(chatID);
            
            // Get user details
            const users = await this.db.getAll(chatID + '/users');
            const user = users.find(u => u.id.toString() === userId);
            
            if (!user) {
                await ctx.reply(i18next.t('settings_user_not_found', { lng: language }));
                return;
            }
            
            // Set as admin
            let settings = await this.getSettings(chatID);
            settings.admin = user.id.toString();
            await this.setSettings(settings);
            
            // Show success message
            const displayName = user.username ? '@' + user.username : (user.first_name || user.id.toString());
            await ctx.answerCbQuery(i18next.t('settings_admin_updated', { 
                lng: language, 
                admin: displayName 
            }));
            
            // Show updated admin selection menu
            await this.showAdminSelectionMenu(ctx, true);
        });

        // Register back button callback at bot level
        this.bot.action('settings_back', async (ctx) => {
            await ctx.answerCbQuery().catch()
    
            await this.showSettingsMenu(ctx, true);
        });

        // Use the registerScenes method to register all scenes with the bot's stage
        this.scenes.registerScenes(this.bot.stage);

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
                
                // Await all drop operations
                await Promise.all([
                    this.db.drop(chatID + '/shopping'),
                    this.db.drop(chatID + '/quests'),
                    this.db.drop(chatID + '/offers'),
                    this.db.drop(chatID + '/users'),
                    this.db.drop(chatID + '/tags'),
                    this.db.drop(chatID + '/expenses'),
                    this.db.drop(chatID + '/announcements'),
                    this.db.drop(chatID + '/recurring'),
                    this.db.drop(chatID + '/checklists'),
                    this.db.drop(chatID + '/roles')
                ])

                await this.db.put(chatID + '/settings', await this.getDefaultSettings(chatID, chatName))
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
                let chatID = utils.getChatId(ctx)
                let settings = await this.getSettings(chatID) // Fetch full settings
                let weights = settings.valueEquation
                let currencies = settings.currencies || []
                ctx.reply(i18next.t('settings_value_equation_weights'), this.equationInlineKeyboard(weights, currencies));
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
            await ctx.answerCbQuery().catch()
            const region = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            await ctx.editMessageText('Select timezone:', {
                reply_markup: await this.getTimezoneKeyboard(chatID, region)
            }).catch((err) => { console.log(err) });
        });

        // Handle timezone selection
        this.bot.action(/timezone_set_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
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
            await ctx.answerCbQuery().catch()
            const action = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            // Handle array settings - always use the new UI
            if (['values', 'domains', 'roles', 'purpose', 'currencies'].includes(action)) {
                await this.showArraySettingMenu(ctx, action);
                return;
            }

            switch (action) {
                case 'name':
                    await ctx.scene.enter('name_scene');
                    break;
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
                    // Store the original message ID in scene state before entering admin scene
                    ctx.scene.state = { 
                        originalMessageId: ctx.callbackQuery.message.message_id 
                    };
                    await this.showAdminSelectionMenu(ctx, true);
                    break;
                case 'users':
                    // Enter users management scene
                    await ctx.scene.enter('users_scene');
                    break;
                case 'hex':
                    if (utils.isAdmin(ctx)) {
                        // Show hex menu instead of entering scene directly
                        await this.showHexMenu(ctx, true);
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
                    let chatIDForEq = ctx.callbackQuery.message.chat.id;
                    let settingsForEq = await this.getSettings(chatIDForEq); // Fetch full settings
                    let weightsForEq = settingsForEq.valueEquation;
                    let currenciesForEq = settingsForEq.currencies || [];
                    await ctx.editMessageText(i18next.t('settings_equation_title'), {
                        reply_markup: this.equationInlineKeyboard(weightsForEq, currenciesForEq)
                    }).catch((err) => { console.log(err) });
                    break;
                case 'holacracy':  
                    await this.showHolacracyMenu(ctx, true);
                    break;
                case 'federation':
                    if (utils.isAdmin(ctx)) {
                        await this.showFederationMenu(ctx, true);
                    } else {
                        ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
                    }
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
                case 'manage_rewards': // Re-add this case
                    if (this.holons && typeof this.holons.showHolonsMenu === 'function') {
                        await this.holons.showHolonsMenu(ctx, true); // Assuming true for edit
                    } else {
                        console.error('Holons instance or showHolonsMenu method is not available in Settings.');
                        const lang = await this.getLanguage(chatID);
                        await ctx.reply(i18next.t('error_rewards_unavailable', { lng: lang, defaultValue: 'Error: Reward management is currently unavailable.'})).catch(()=>{});
                    }
                    break;
                case 'max_tasks':
                    await this.showMaxTasksMenu(ctx, true);
                    break;
            }
        });

        // Add language selection handlers
        this.bot.action(/language_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const language = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);

            if (['en', 'it', 'es', 'fr', 'ru', 'de'].includes(language)) {
                settings.language = language;
                await this.setSettings(settings);
                await i18next.changeLanguage(language);
                await ctx.reply(i18next.t('settings_language_updated', { language: language }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Add theme selection handlers
        this.bot.action(/theme_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
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
            await ctx.answerCbQuery().catch()
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
            await ctx.answerCbQuery().catch()
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
            await ctx.answerCbQuery().catch()
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID); // Fetch full settings
            let weights = settings.valueEquation;
            let currencies = settings.currencies || [];
            await ctx.editMessageText(i18next.t('settings_equation_title'), {
                reply_markup: this.equationInlineKeyboard(weights, currencies)
            }).catch((err) => { console.log(err) });
        });

        // Handle increment/decrement actions for value equation weights
        this.bot.action(/^(increment|decrement)_(\w+)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
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

            // Need to pass currencies to equationInlineKeyboard
            let updatedSettings = await this.getSettings(chatID);
            let updatedCurrencies = updatedSettings.currencies || [];
            await ctx.editMessageText(i18next.t('settings_value_equation_weights'), {
                reply_markup: this.equationInlineKeyboard(weights, updatedCurrencies)
            }).catch((err) => { console.log(err) });
        });

        // Add array setting action handlers
        ['values', 'domains', 'roles', 'currencies'].forEach(type => {
            // Add change handler for entering add scene
            this.bot.action(`settings_${type}_change`, async (ctx) => {
                await ctx.answerCbQuery().catch()
                await ctx.scene.enter('add_array_item_scene', { type });
            });

            this.bot.action(`enter_remove_mode_${type}`, async (ctx) => {
                await ctx.answerCbQuery().catch()
                await this.showArraySettingMenu(ctx, type, true);
            });

            this.bot.action(`exit_remove_mode_${type}`, async (ctx) => {
                await ctx.answerCbQuery().catch()
                await this.showArraySettingMenu(ctx, type, false);
            });

            this.bot.action(new RegExp(`remove_${type}_(\\d+)`), async (ctx) => {
                await ctx.answerCbQuery().catch()
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
        
        // Unified back button handler for all settings menus
        this.bot.action('settings_back', async (ctx) => {
            await ctx.answerCbQuery().catch()
            console.log('Going back to settings menu');
            // Leave any active scene
            if (ctx.scene && ctx.scene.current) {
                await ctx.scene.leave();
            }
            // Always edit existing message when returning to settings
            await this.showSettingsMenu(ctx, true);
        });

        // Handle array setting actions
        this.bot.action(/settings_(values|domains|roles|purpose|currencies)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type);
        });

        // Add handler for users settings
        this.bot.action('settings_users', async (ctx) => {
            await ctx.answerCbQuery().catch()
            // Store the original message ID in scene state
            ctx.scene.state = { 
                originalMessageId: ctx.callbackQuery.message.message_id 
            };
            await ctx.scene.enter('users_scene');
        });

        // Handle entering remove mode
        this.bot.action(/enter_remove_mode_(values|domains|roles|purpose|currencies)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type, true);
        });

        // Handle exiting remove mode
        this.bot.action(/exit_remove_mode_(values|domains|roles|purpose|currencies)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const type = ctx.match[1];
            return this.showArraySettingMenu(ctx, type, false);
        });

        // Handle removing items
        this.bot.action(/remove_(values|domains|roles|purpose|currencies)_(\d+)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
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
            await ctx.answerCbQuery().catch()
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'values' });
            } catch (error) {
                console.error('Error entering values add scene:', error);
                return ctx.reply('Error adding values. Please try again later.');
            }
        });

        this.bot.action('settings_domains_change', async (ctx) => {
            console.log('DOMAINS ADD button clicked');
            await ctx.answerCbQuery().catch()
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'domains' });
            } catch (error) {
                console.error('Error entering domains add scene:', error);
                return ctx.reply('Error adding domains. Please try again later.');
            }
        });

        this.bot.action('settings_roles_change', async (ctx) => {
            console.log('ROLES ADD button clicked');
            await ctx.answerCbQuery().catch()
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'roles' });
            } catch (error) {
                console.error('Error entering roles add scene:', error);
                return ctx.reply('Error adding roles. Please try again later.');
            }
        });

        this.bot.action('settings_currencies_change', async (ctx) => {
            console.log('CURRENCIES ADD button clicked');
            await ctx.answerCbQuery().catch()
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'currencies' });
            } catch (error) {
                console.error('Error entering currencies add scene:', error);
                return ctx.reply('Error adding currencies. Please try again later.');
            }
        });

        this.bot.action('settings_purpose_change', async (ctx) => {
            console.log('PURPOSE ADD button clicked');
            await ctx.answerCbQuery().catch()
            try {
                return await ctx.scene.enter('add_array_item_scene', { type: 'purpose' });
            } catch (error) {
                console.error('Error entering purpose add scene:', error);
                return ctx.reply('Error adding purpose. Please try again later.');
            }
        });

        // Handle federation actions
        this.bot.action('add_federation', async (ctx) => {
            await ctx.answerCbQuery().catch()
            if (utils.isAdmin(ctx)) {
                await ctx.scene.enter('federation_scene');
            } else {
                const chatID = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
            }
        });

        this.bot.action(/unfederate_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            if (utils.isAdmin(ctx)) {
                const chatID = ctx.callbackQuery.message.chat.id;
                const federationID = ctx.match[1];
                const language = await this.getLanguage(chatID);

                try {
                    // const fedInfoBefore = await this.db.holosphere.getFederation(chatID.toString());
                    // console.log(`[Settings.js /unfederate_] ChatID: ${chatID}, federationID to remove: ${federationID}`);
                    // console.log('[Settings.js /unfederate_] FedInfo BEFORE unfederate:', JSON.stringify(fedInfoBefore, null, 2));
                    
                    await this.db.holosphere.unfederate(chatID.toString(), federationID);
                    
                    // const fedInfoAfter = await this.db.holosphere.getFederation(chatID.toString());
                    // console.log('[Settings.js /unfederate_] FedInfo AFTER unfederate:', JSON.stringify(fedInfoAfter, null, 2));

                                const federationName = await this.getHolonDisplayName(federationID, ctx);
            await ctx.reply(i18next.t('settings_federation_removed', { lng: language, federationID: federationName }));
                    await this.showFederationMenu(ctx, true);
                } catch (error) {
                    console.error('Unfederation error in Settings.js:', error);
                    await ctx.reply(i18next.t('settings_unfederation_error', { lng: language, error: error.message }));
                }
            } else {
                const chatID = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
            }
        });

        this.bot.action(/unnotify_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            if (utils.isAdmin(ctx)) {
                const chatID = ctx.callbackQuery.message.chat.id;
                const notifyID = ctx.match[1];
                const language = await this.getLanguage(chatID);

                try {
                    // const fedInfoBefore = await this.db.holosphere.getFederation(chatID.toString());
                    // console.log(`[Settings.js /unnotify_] ChatID: ${chatID}, notifyID to remove: ${notifyID}`);
                    // console.log('[Settings.js /unnotify_] FedInfo BEFORE removeNotify:', JSON.stringify(fedInfoBefore, null, 2));
                    
                    const removeResult = await this.db.holosphere.removeNotify(chatID.toString(), notifyID);
                    // console.log('[Settings.js /unnotify_] Result from removeNotify:', removeResult);

                    // const fedInfoAfter = await this.db.holosphere.getFederation(chatID.toString());
                    // console.log('[Settings.js /unnotify_] FedInfo AFTER removeNotify:', JSON.stringify(fedInfoAfter, null, 2));

                    // if (removeResult === false) {
                    //     console.warn(`[Settings.js /unnotify_] removeNotify reported that ID ${notifyID} was not found in the list for ${chatID}.`);
                    // }

                    const notifyName = await this.getHolonDisplayName(notifyID, ctx);
                    await ctx.reply(i18next.t('settings_notify_removed', { lng: language, id: notifyName }));
                    await this.showFederationMenu(ctx, true);
                } catch (error) {
                    console.error('Unnotify error in Settings.js:', error);
                    await ctx.reply(i18next.t('settings_unnotify_error', { lng: language, error: error.message }));
                }
            } else {
                const chatID = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(chatID) }));
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
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length === 0) { 
                await ctx.reply(i18next.t('settings_usage_array', { 
                    lng: language, 
                    command: '/addroles',
                    example: '/addroles role1, role2, role3'
                }));
                return;
            }

            const newRoles = args.join(' ').split(/[\n,]+/).map(r => r.trim()).filter(r => r);
            let settings = await this.getSettings(chatID);
            if (!settings.roles) settings.roles = [];
            
            let addedCount = 0;
            newRoles.forEach(role => {
                if (!settings.roles.includes(role)) {
                    settings.roles.push(role);
                    addedCount++;
                }
            });
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_array_updated', { 
                lng: language, 
                field: i18next.t('settings_roles', { lng: language }),
                count: addedCount 
            }));
        });

        // Add command for adding currencies
        this.bot.command('addcurrencies', async (ctx) => {
            const text = ctx.message.text.replace('/addcurrencies', '').trim();
            if (!text) {
                await ctx.reply('Please provide currencies to add, like: /addcurrencies EUR, USD, JPY. Always use singular form.');
                return;
            }

            const chatID = ctx.chat.id;
            const newCurrencies = text.split(/[\n,]+/).map(c => c.trim().toLowerCase()).filter(c => c !== '');

            let settings = await this.getSettings(chatID);

            if (!settings.currencies) {
                settings.currencies = [];
            }

            newCurrencies.forEach(currency => {
                if (!settings.currencies.includes(currency)) {
                    settings.currencies.push(currency);
                }
            });
            
            await this.setSettings(settings);

            await ctx.reply(`Added currencies: ${newCurrencies.join(', ')}. Ensure these are in singular form.`);
            await this.showArraySettingMenu(ctx, 'currencies', false);
        });

        // Add help messages for adding items
        this.bot.action(/help_add_(values|domains|roles|purpose|currencies)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const type = ctx.match[1];

            // Check if bot has admin rights using the utility function
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            console.log('Bot admin status:', botHasAdminRights);

            if (botHasAdminRights) {
                // Bot has admin rights - enter the appropriate scene
                try {
                    switch (type) {
                        case 'values':
                            return await ctx.scene.enter('values_scene');
                        case 'domains':
                            return await ctx.scene.enter('domains_scene');
                        case 'roles':
                            return await ctx.scene.enter('roles_scene');
                        case 'purpose':
                            return await ctx.scene.enter('purpose_scene');
                        case 'currencies':
                            return await ctx.scene.enter('add_array_item_scene', { type: 'currencies' });
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
                    'roles': '/addroles',
                    'currencies': '/addcurrencies'
                };

                const exampleMap = {
                    'values': 'Collaboration, Innovation, Sustainability',
                    'domains': 'Community Management, Content Creation, Development',
                    'roles': 'Facilitator, Developer, Designer',
                    'currencies': 'euro, dollar, yen (use singular)'
                };

                message = `To add ${type}, use the command:\n\n${commandMap[type]} ${exampleMap[type]}\n\nYou can separate multiple items with commas. For currencies, please always use the singular form (e.g., euro not euros).`;
            }

            await ctx.reply(message);
        });

        // Action handler for adding federation (from federation keyboard)
        this.bot.action('add_federation', async (ctx) => {
            await ctx.answerCbQuery().catch()
            // Store the original message ID in scene state
            ctx.scene.state = { 
                originalMessageId: ctx.callbackQuery.message.message_id 
            };
            await ctx.scene.enter('federation_scene');
        });
        
        // Federation and hex back handlers have been removed and consolidated with unified settings_back handler

        // Setup add array item scene
        this.addArrayItemScene = new Scenes.BaseScene('add_array_item_scene');
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
                
                // Store message ID for cleanup
                ctx.scene.state.userMessageId = ctx.message.message_id;
                
                // Clean up messages using helper method with built-in admin check
                await this.cleanupSceneMessages(ctx);

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

        // Simple action handler for viewing hex (just acknowledges the click)
        this.bot.action('hex_view', async (ctx) => {
            await ctx.answerCbQuery().catch()
        });
        
        // Action handler for viewing hex map (temporary replacement for web app button)
        this.bot.action('hex_view_map', async (ctx) => {
            await ctx.answerCbQuery().catch()
            const chatID = ctx.callbackQuery.message.chat.id;
            const language = await this.getLanguage(chatID);
            await ctx.reply(i18next.t('settings_map_redirect', { 
                lng: language, 
                defaultValue: 'View the hex map at: https://hexamap.holons.io/index.html?id=' + chatID 
            }));
        });

        // Action handler for editing hex (from hex menu)
        this.bot.action('help_add_hex', async (ctx) => {
            await ctx.answerCbQuery().catch()
            // Store the original message ID in scene state
            ctx.scene.state = { 
                originalMessageId: ctx.callbackQuery.message.message_id 
            };
            await ctx.scene.enter('hex_scene');
        });

        // Create generalized scenes
        this.textInputScene = new Scenes.BaseScene('text_input_scene');
        this.textInputScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const { field, title, command } = ctx.scene.state;
            
            // Get current value
            let settings = await this.getSettings(chatID);
            const currentValue = settings[field] || i18next.t('settings_not_set', { lng: language });
            
            // Store original message ID if coming from callback
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }

            // Check bot admin rights
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            
            if (botHasAdminRights) {
                // Send interactive prompt
                const promptMessage = await ctx.reply(
                    i18next.t('settings_current', { lng: language, value: currentValue }) + '\n\n' +
                    i18next.t('settings_send_new', { lng: language, type: title.toLowerCase() })
                );
                ctx.scene.state.promptMessageId = promptMessage.message_id;
            } else {
                // Send command instructions
                await ctx.reply(
                    i18next.t('settings_current', { lng: language, value: currentValue }) + '\n\n' +
                    i18next.t('settings_use_command', { 
                        lng: language, 
                        command: command,
                        example: `${command} new ${title.toLowerCase()}`
                    })
                );
                await ctx.scene.leave();
            }
        });

        this.textInputScene.on('text', async (ctx) => {
            const chatID = ctx.chat.id;
            const { field } = ctx.scene.state;
            
            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            
            // Save the input
            let settings = await this.getSettings(chatID);
            settings[field] = ctx.message.text;
            await this.setSettings(settings);
            
            // Clean up messages if bot has admin rights
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            if (botHasAdminRights) {
                await this.cleanupSceneMessages(ctx);
            }

            // Show updated menu
            if (field === 'purpose') {
                await this.showArraySettingMenu(ctx, 'purpose', false);
            } else if (field === 'hex') {
                await this.showHexMenu(ctx, false);
            } else {
                await this.showSettingsMenu(ctx, false);
            }
            
            await ctx.scene.leave();
        });

        this.arrayInputScene = new Scenes.BaseScene('array_input_scene');
        this.arrayInputScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const { field, title, command } = ctx.scene.state;

            // Store original message ID if coming from callback
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }

            // Check bot admin rights
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            
            if (botHasAdminRights) {
                // Send interactive prompt
                const promptMessage = await ctx.reply(
                    i18next.t('settings_enter_new_items', { lng: language, type: title.toLowerCase() })
                );
                ctx.scene.state.promptMessageId = promptMessage.message_id;
            } else {
                // Send command instructions
                await ctx.reply(
                    i18next.t('settings_use_command_array', { 
                        lng: language, 
                        command: command,
                        example: `${command} item1, item2, item3`
                    })
                );
                await ctx.scene.leave();
            }
        });

        this.arrayInputScene.on('text', async (ctx) => {
            const chatID = ctx.chat.id;
            const { field } = ctx.scene.state;
            
            // Parse input into array
            const newItems = ctx.message.text
                .split(/[,\n]/)
                .map(item => item.trim())
                .filter(item => item !== '');

            // Save to settings
            let settings = await this.getSettings(chatID);
            if (!settings[field]) {
                settings[field] = [];
            }
            settings[field].push(...newItems);
            await this.setSettings(settings);

            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            
            // Clean up messages if bot has admin rights
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            if (botHasAdminRights) {
                await this.cleanupSceneMessages(ctx);
            }

            // Show updated menu
            await this.showArraySettingMenu(ctx, field, false);
            await ctx.scene.leave();
        });

        this.listPickerScene = new Scenes.BaseScene('list_picker_scene');
        this.listPickerScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const { field, title, options, displayField } = ctx.scene.state;

            // Create keyboard with options
            const keyboard = {
                inline_keyboard: [
                    [{ text: title, callback_data: ' ' }],
                    ...options.map(option => [{
                        text: option[displayField],
                        callback_data: `select_${field}_${option.id}`
                    }]),
                    [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
                ]
            };

            await ctx.reply(i18next.t('settings_select_option', { lng: language, type: title }), {
                reply_markup: keyboard
            });
        });

        // Register the scenes
        this.bot.stage.register(this.textInputScene);
        this.bot.stage.register(this.arrayInputScene);
        this.bot.stage.register(this.listPickerScene);

        // Update action handlers to use new scenes
        this.bot.action('settings_name', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('text_input_scene', {
                field: 'name',
                title: i18next.t('settings_name', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/setname'
            });
        });

        this.bot.action('settings_values_change', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('array_input_scene', {
                field: 'values',
                title: i18next.t('settings_values', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/addvalues'
            });
        });

        this.bot.action('settings_domains_change', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('array_input_scene', {
                field: 'domains',
                title: i18next.t('settings_domains', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/adddomains'
            });
        });

        this.bot.action('settings_roles_change', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('array_input_scene', {
                field: 'roles',
                title: i18next.t('settings_roles', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/addroles'
            });
        });

        this.bot.action('settings_currencies_change', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('array_input_scene', {
                field: 'currencies',
                title: i18next.t('settings_currencies', { lng: await this.getLanguage(ctx.chat.id), defaultValue: "Currencies" }),
                command: '/addcurrencies'
            });
        });

        this.bot.action('help_add_purpose', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('text_input_scene', {
                field: 'purpose',
                title: i18next.t('settings_purpose', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/setpurpose'
            });
        });

        this.bot.action('help_add_hex', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('text_input_scene', {
                field: 'hex',
                title: i18next.t('settings_hex', { lng: await this.getLanguage(ctx.chat.id) }),
                command: '/sethex'
            });
        });

        this.bot.action('help_add_currencies', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('array_input_scene', {
                field: 'currencies',
                title: i18next.t('settings_currencies', { lng: await this.getLanguage(ctx.chat.id), defaultValue: "Currencies" }),
                command: '/addcurrencies'
            });
        });

        this.bot.action('settings_holacracy', async (ctx) => {
            // console.log("!!!!!!!!!!!! ACTION: settings_holacracy TRIGGERED !!!!!!!!!!!!"); // New Log
            await ctx.answerCbQuery().catch()
            await this.showHolacracyMenu(ctx, true);
        });

        // Command handlers for non-admin scenarios
        this.bot.command('setname', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 2) {
                await ctx.reply(i18next.t('settings_usage', { 
                    lng: language, 
                    command: '/setname',
                    example: '/setname new name'
                }));
                return;
            }

            const newName = args.slice(1).join(' ');
            let settings = await this.getSettings(chatID);
            settings.name = newName;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_name', { lng: language }),
                value: newName 
            }));
        });

        this.bot.command('setpurpose', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 2) {
                await ctx.reply(i18next.t('settings_usage', { 
                    lng: language, 
                    command: '/setpurpose',
                    example: '/setpurpose new purpose'
                }));
                return;
            }

            const newPurpose = args.slice(1).join(' ');
            let settings = await this.getSettings(chatID);
            settings.purpose = newPurpose;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_purpose', { lng: language }),
                value: newPurpose 
            }));
        });

        this.bot.command('sethex', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 2) {
                await ctx.reply(i18next.t('settings_usage', { 
                    lng: language, 
                    command: '/sethex',
                    example: '/sethex new hex'
                }));
                return;
            }

            const newHex = args.slice(1).join(' ');
            let settings = await this.getSettings(chatID);
            settings.hex = newHex;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_hex', { lng: language }),
                value: newHex 
            }));
        });

        this.bot.command('addvalues', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 2) {
                await ctx.reply(i18next.t('settings_usage_array', { 
                    lng: language, 
                    command: '/addvalues',
                    example: '/addvalues value1, value2, value3'
                }));
                return;
            }

            const newValues = args.slice(1).join(' ').split(/[,\n]/).map(v => v.trim()).filter(v => v);
            let settings = await this.getSettings(chatID);
            if (!settings.values) settings.values = [];
            settings.values.push(...newValues);
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_array_updated', { 
                lng: language, 
                field: i18next.t('settings_values', { lng: language }),
                count: newValues.length 
            }));
        });

        this.bot.command('adddomains', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length < 2) {
                await ctx.reply(i18next.t('settings_usage_array', { 
                    lng: language, 
                    command: '/adddomains',
                    example: '/adddomains domain1, domain2, domain3'
                }));
                return;
            }

            const newDomains = args.slice(1).join(' ').split(/[,\n]/).map(d => d.trim()).filter(d => d);
            let settings = await this.getSettings(chatID);
            if (!settings.domains) settings.domains = [];
            settings.domains.push(...newDomains);
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_array_updated', { 
                lng: language, 
                field: i18next.t('settings_domains', { lng: language }),
                count: newDomains.length 
            }));
        });

        this.bot.command('addroles', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length === 0) { // Corrected to check if any role is provided
                await ctx.reply(i18next.t('settings_usage_array', { 
                    lng: language, 
                    command: '/addroles',
                    example: '/addroles role1, role2, role3'
                }));
                return;
            }

            const newRoles = args.join(' ').split(/[\n,]+/).map(r => r.trim()).filter(r => r);
            let settings = await this.getSettings(chatID);
            if (!settings.roles) settings.roles = [];
            
            let addedCount = 0;
            newRoles.forEach(role => {
                if (!settings.roles.includes(role)) {
                    settings.roles.push(role);
                    addedCount++;
                }
            });
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_array_updated', { 
                lng: language, 
                field: i18next.t('settings_roles', { lng: language }),
                count: addedCount 
            }));
        });

        this.bot.command('addcurrencies', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const isAdmin = await utils.isAdmin(ctx);
            
            if (!isAdmin) {
                await ctx.reply(i18next.t('settings_admin_only', { lng: language }));
                return;
            }

            const args = ctx.message.text.split(' ').slice(1);
            if (args.length === 0) { // Changed to check if any currency is provided
                await ctx.reply(i18next.t('settings_usage_array', { 
                    lng: language, 
                    command: '/addcurrencies',
                    example: '/addcurrencies euro, dollar (use singular)'
                }));
                return;
            }

            const newCurrencies = args.join(' ').split(/[\n,]+/).map(c => c.trim().toLowerCase()).filter(c => c); // Store in lowercase singular
            let settings = await this.getSettings(chatID);
            if (!settings.currencies) settings.currencies = [];
            
            let addedCount = 0;
            newCurrencies.forEach(currency => {
                if (!settings.currencies.includes(currency)) {
                    settings.currencies.push(currency);
                    addedCount++;
                }
            });
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_array_updated', { 
                lng: language, 
                field: i18next.t('settings_currencies', { lng: language, defaultValue: "Currencies" }),
                count: addedCount 
            }));
        });

        // Action handlers for viewing shared lenses in federation
        this.bot.action(/federation_lenses_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const targetChatID = ctx.match[1];
            await this.showSharedLensesMenu(ctx, targetChatID, 'federated', true);
        });

        this.bot.action(/notify_lenses_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const targetChatID = ctx.match[1];
            await this.showSharedLensesMenu(ctx, targetChatID, 'notifies', true);
        });

        // Action handler for toggling a shared lens
        this.bot.action(/toggle_lens_(.+?)_(federated|notifies)_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const targetChatID = ctx.match[1];
            const relationshipType = ctx.match[2];
            const lensNameToToggle = ctx.match[3];
            const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;

            try {
                let fedInfo = await this.db.holosphere.getFederation(chatID);

                if (!fedInfo) {
                    // This case should ideally not be hit if UI flows from showFederationMenu
                    console.warn(`No federation info found for ${chatID} when trying to toggle lens for ${targetChatID}. Creating new structure.`);
                    fedInfo = {
                        id: chatID,
                        name: chatID, // Or fetch actual name if possible
                        federation: relationshipType === 'federated' ? [targetChatID] : [],
                        notify: relationshipType === 'notifies' ? [targetChatID] : [],
                        lensConfig: {},
                        timestamp: Date.now()
                    };
                }

                if (!fedInfo.lensConfig) {
                    fedInfo.lensConfig = {};
                }

                let linkSpecificConfig = fedInfo.lensConfig[targetChatID];
                if (!linkSpecificConfig) {
                    linkSpecificConfig = { federate: [], notify: [], timestamp: Date.now() };
                }

                let targetArray;
                if (relationshipType === 'federated') {
                    if (!linkSpecificConfig.federate) linkSpecificConfig.federate = [];
                    targetArray = linkSpecificConfig.federate;
                } else { // relationshipType === 'notifies'
                    if (!linkSpecificConfig.notify) linkSpecificConfig.notify = [];
                    targetArray = linkSpecificConfig.notify;
                }

                const lensIndex = targetArray.indexOf(lensNameToToggle);
                if (lensIndex > -1) {
                    targetArray.splice(lensIndex, 1); // Disable: remove from array
                } else {
                    targetArray.push(lensNameToToggle); // Enable: add to array
                }

                linkSpecificConfig.timestamp = Date.now();
                fedInfo.lensConfig[targetChatID] = linkSpecificConfig;
                fedInfo.timestamp = Date.now();

                await this.db.holosphere.putGlobal('federation', fedInfo); // Save the entire modified fedInfo

                // Fetch the updated config for UI refresh
                const updatedLensesForUI = await this.getLensesConfigForUI(chatID, targetChatID, relationshipType);
                await this.showSharedLensesMenu(ctx, targetChatID, relationshipType, true, updatedLensesForUI);

            } catch (error) {
                console.error(`Error toggling lens ${lensNameToToggle} for ${targetChatID} (relationship: ${relationshipType}):`, error);
                await ctx.reply('An error occurred while updating lens settings. Please try again.').catch(()=>{});
                 // Optionally, re-show menu with potentially stale data or an error message state
                const potentiallyStaleConfig = await this.getLensesConfigForUI(chatID, targetChatID, relationshipType).catch(() => ALL_AVAILABLE_LENSES.map(name => ({ name, enabled: false })));
                await this.showSharedLensesMenu(ctx, targetChatID, relationshipType, true, potentiallyStaleConfig ).catch(()=>{});
            }
        });

        this.bot.action(/set_max_tasks_(\d+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const value = parseInt(ctx.match[1]);
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.maxTasks = value;
            await this.setSettings(settings);
            const language = await this.getLanguage(chatID);
            await ctx.reply(
                i18next.t('settings_max_tasks_updated', { lng: language, value: value === 0 ? i18next.t('settings_max_tasks_unlimited', { lng: language }) : value })
            );
            await this.showMaxTasksMenu(ctx, true);
        });
    }

    // Re-add this method to allow injection of Holons instance
    setHolonsInstance(holonsInstance) {
        this.holons = holonsInstance;
        // Forward the holons instance to the scenes
        if (this.scenes && typeof this.scenes.setHolons === 'function') {
            this.scenes.setHolons(holonsInstance);
        }
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
    equationInlineKeyboard(weights, currencies = []) { // Added currencies parameter
        const language = i18next.language; // Or get from settings if preferred
        let inlineKeyboard = [
            [{ text: i18next.t('settings_value_equation_weights', {lng: language} ), callback_data: ' ' }],
            // Removed edit button as per previous structure, actions directly modify
            // [{ text: '✏️ ' + i18next.t('settings_edit', {lng: language}), callback_data: 'settings_equation_change' }],
            [
                { text: i18next.t('settings_initiated', {lng: language}), callback_data: 'null' },
                { text: '<', callback_data: 'decrement_initiated' },
                { text: weights.initiated !== undefined ? weights.initiated.toString() : '0', callback_data: 'null' },
                { text: '>', callback_data: 'increment_initiated' }
            ],
            [
                { text: i18next.t('settings_completed', {lng: language}), callback_data: 'null' },
                { text: '<', callback_data: 'decrement_completed' },
                { text: weights.completed !== undefined ? weights.completed.toString() : '0', callback_data: 'null' },
                { text: '>', callback_data: 'increment_completed' }
            ],
            [
                { text: i18next.t('settings_sent', {lng: language}), callback_data: 'null' },
                { text: '<', callback_data: 'decrement_sent' },
                { text: weights.sent !== undefined ? weights.sent.toString() : '0', callback_data: 'null' },
                { text: '>', callback_data: 'increment_sent' }
            ],
            [
                { text: i18next.t('settings_received', {lng: language}), callback_data: 'null' },
                { text: '<', callback_data: 'decrement_received' },
                { text: weights.received !== undefined ? weights.received.toString() : '0', callback_data: 'null' },
                { text: '>', callback_data: 'increment_received' }
            ]
        ];

        // Dynamically add currencies from the settings.currencies array
        if (currencies && Array.isArray(currencies)) {
            currencies.forEach(currency => {
                const currencyKey = currency.toLowerCase().replace(/[^a-z0-9_]/g, '');
                if (currencyKey) { // Ensure the key is valid
                    inlineKeyboard.push([
                        { text: currency.toUpperCase(), callback_data: 'null' }, // Display currency name
                        { text: '<', callback_data: `decrement_${currencyKey}` },
                        { text: weights[currencyKey] !== undefined ? weights[currencyKey].toString() : '0', callback_data: 'null' },
                        { text: '>', callback_data: `increment_${currencyKey}` }
                    ]);
                }
            });
        }

        inlineKeyboard.push([{ text: i18next.t('settings_back', {lng: language}), callback_data: 'settings_back' }]);

        return {
            inline_keyboard: inlineKeyboard
        };
    }

    getDefaultSettings(chatID, chatName) {
        return {
            id: chatID,
            hex: '',
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
            currencies: [],
            valueEquation: {
                initiated: 1,
                completed: 1,
                sent: 1,
                received: 1,
                wants: 1,
                offers: 1
            },
            maxTasks: 13, // Default to 13 (Fibonacci)
        }
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
        if (!['en', 'it', 'es', 'fr', 'ru', 'de'].includes(language)) {
            ctx.reply('Please specify "en", "it", "es", "fr", "ru" or "de". Example: /setLanguage en')
            return
        }

        let settings = await this.getSettings(chatID)
        settings.language = language
        this.db.put(chatID + '/settings', settings)
        await i18next.changeLanguage(language); // Ensure i18next instance is updated
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
            ctx.reply('Please specify the ID you would like to federate with. Example: /federate 123456 or /federate 0x1234abcd. This chat ID is ' + chatID);
            return;
        }

        // Validate federation ID format - accept completely numeric or hex holon IDs
        const isNumeric = /^-?\d+$/.test(federationID);
        const isHex = /^(0x)?[0-9a-fA-F]+$/.test(federationID);
        
        if (!isNumeric && !isHex) {
            ctx.reply('Invalid holon ID format. Please enter a numeric ID (e.g., -1001234567890) or a hex address (e.g., 0x1234abcd).');
            return;
        }

        try {
            // Use holosphere federate method
            console.log('FEDERATING', chatID, federationID)
            console.log("!!!!!!!!!!!!!!!!!!!!!!!FEDERATION HAS HAPPENED!"); 
            await this.db.holosphere.federate(chatID, federationID);
            const federationName = await this.getHolonDisplayName(federationID, ctx);
            ctx.reply('This chat has been federated with ' + federationName);
        } catch (error) {
            console.error('Federation error:', error);
            ctx.reply('Error creating federation: ' + error.message);
        }
    }

    async separate(ctx) {
        const chatID = ctx.message.chat.id;
        const federationID = ctx.message.text.split(' ')[1];

        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify who you would like to revoke the federation with. Example: /separate 123456 or /separate 0x1234abcd.');
            return;
        }

        // Validate federation ID format - accept completely numeric or hex holon IDs
        const isNumeric = /^-?\d+$/.test(federationID);
        const isHex = /^(0x)?[0-9a-fA-F]+$/.test(federationID);
        
        if (!isNumeric && !isHex) {
            ctx.reply('Invalid holon ID format. Please enter a numeric ID (e.g., -1001234567890) or a hex address (e.g., 0x1234abcd).');
            return;
        }

        try {
            // Use holosphere unfederate method
            await this.db.holosphere.unfederate(chatID, federationID);
            const federationName = await this.getHolonDisplayName(federationID, ctx);
            ctx.reply('Federation with ' + federationName + ' has been revoked');
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
                currencies: settings.currencies || defaultSettings.currencies,
                // Ensure object properties exist
                valueEquation: {
                    ...defaultSettings.valueEquation,
                    ...(settings.valueEquation || {})
                },
                maxTasks: typeof settings.maxTasks !== 'undefined' ? settings.maxTasks : defaultSettings.maxTasks,
            }
            // Dynamically add currencies from settings.currencies to valueEquation if not present
            if (settings.currencies && Array.isArray(settings.currencies)) {
                settings.currencies.forEach(currency => {
                    // Ensure currency is a simple string and suitable as a key
                    const currencyKey = currency.toLowerCase().replace(/[^a-z0-9_]/g, '');
                    if (currencyKey && typeof settings.valueEquation[currencyKey] === 'undefined') {
                        settings.valueEquation[currencyKey] = 0; // Default weight for new currency
                    }
                });
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

    async calculateUserScores(users, chatID, expensesInstance) {
        const settings = await this.getSettings(chatID);
        const equation = settings.valueEquation;
        const currencies = settings.currencies || [];
        
        const userScores = [];
        for (const userId in users) {
            const user = users[userId];
            if (!user || user.id === undefined) continue; // Skip if user or user.id is undefined

            let score = (user.initiated && user.initiated.length * equation.initiated || 0) +
                (user.completed && user.completed.length * equation.completed || 0) +
                (user.sent * equation.sent || 0) +
                (user.received * equation.received || 0) +
                (user.hours * equation.hours || 0) +
                (user.collaboration * equation.collaboration || 0) +
                (user.wants && user.wants.length * equation.wants || 0) +
                (user.offers && user.offers.length * equation.offers || 0);

            let currencyScoreContribution = 0;
            if (currencies && currencies.length > 0 && expensesInstance) {
                for (const currencyName of currencies) {
                    const currencyKey = currencyName.toLowerCase().replace(/[^a-z0-9_]/g, '');
                    if (currencyKey && equation[currencyKey] !== undefined) {
                        try {
                            const balance = await expensesInstance.getUserCurrencyBalance(chatID, user.id, currencyKey);
                            const weight = equation[currencyKey] || 0;
                            currencyScoreContribution += balance * weight;
                        } catch (e) {
                            console.error(`Error getting balance for ${currencyKey} for user ${user.id}:`, e);
                        }
                    }
                }
            }
            score += currencyScoreContribution;
            userScores.push({ ...user, score });
        }

        return userScores.sort((a, b) => b.score - a.score);
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
        
        // Fetch federation info for the button
        const fedInfo = await this.db.holosphere.getFederation(chatID);
        const federationCount = fedInfo && fedInfo.federation && Array.isArray(fedInfo.federation) ? fedInfo.federation.length : 0;
        
        // Create the message with Holon ID shown at the top
        let holonAddressLine = '';
        let holonNetworkLine = '';
        if (this.holons && typeof this.holons.getSplitterContract === 'function') {
            try {
                const chatIdNormalized = `chat_${Math.abs(chatID)}`;
                const splitterContract = await this.holons.getSplitterContract(chatIdNormalized);
                if (splitterContract && splitterContract.target && splitterContract.target !== '0x0000000000000000000000000000000000000000') {
                    holonAddressLine = `\n🔷 Holon Address: \`${splitterContract.target}\``;
                    if (this.holons.network) {
                        holonNetworkLine = `\n🌐 Network: ${this.holons.network}`;
                    }
                }
            } catch (e) {
                // Ignore errors, just don't show address/network
            }
        }
        const menuText = `${i18next.t('settings', { lng: language })}\n ${i18next.t('holon_id', { lng: language, defaultValue: 'Holon ID' })}: ${chatID}${holonAddressLine}${holonNetworkLine}`;

        const menuMarkup = {
            reply_markup: {
                inline_keyboard: [
                    // 1. Name (full width)
                    [
                        { text: `✏️ ${i18next.t('settings_name', { lng: language, defaultValue: 'Name' })}: ${settings.name || i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_name' }
                    ],
                    // 2. Language | Timezone
                    [
                        { text: `${this.getSettingIcon('language')} ${i18next.t('settings_language', { lng: language })}: ${settings.language}`, callback_data: 'settings_language' },
                        { text: `${this.getSettingIcon('timezone')} ${i18next.t('settings_timezone', { lng: language })}: ${settings.timezone ? settings.timezone.split('/')[1].replace('_', ' ') : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_timezone' }
                    ],
                    // 3. Max Tasks | Users
                    [
                        { text: `${this.getSettingIcon('maxTasks')} ${i18next.t('settings_max_tasks', { lng: language, defaultValue: 'Max Tasks' })}: ${settings.maxTasks === 0 ? i18next.t('settings_max_tasks_unlimited', { lng: language, defaultValue: 'Unlimited' }) : settings.maxTasks}`, callback_data: 'settings_max_tasks' },
                        { text: `${this.getSettingIcon('users')} ${i18next.t('settings_users', { lng: language })}`, callback_data: 'settings_users' }
                    ],
                    // 4. Admin | Federation
                    [
                        { text: `${this.getSettingIcon('admin')} ${i18next.t('settings_admin', { lng: language })}: ${settings.admin ? '✓' : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_admin' },
                        { text: `${this.getSettingIcon('federation')} ${i18next.t('settings_federation', { lng: language })}: ${federationCount}`, callback_data: 'settings_federation' }
                    ],
                    // 5. Holacracy | Hex
                    [
                        { text: `${this.getSettingIcon('holacracy')} ${i18next.t('settings_holacracy', {lng: language, defaultValue: 'Holacracy'})}`, callback_data: 'settings_holacracy'},
                        { text: `${this.getSettingIcon('hex')} ${i18next.t('settings_hex', { lng: language })}: ${settings.hex ? '✓' : i18next.t('settings_not_set', { lng: language })}`, callback_data: 'settings_hex' }
                    ],
                    // 6. Currencies | Flow Management
                    [
                        { text: `${this.getSettingIcon('currencies')} ${i18next.t('settings_currencies', { lng: language, defaultValue: 'Currencies' })}: ${settings.currencies?.length || 0}`, callback_data: 'settings_currencies'},
                        { text: `${this.getSettingIcon('flow_management')} ${i18next.t('settings_flow_management', { lng: language, defaultValue: 'Flow Management' })}`, callback_data: 'holons_flow_management' }
                    ],
                    // 7. Value Equation (full width)
                    [
                        { text: `${this.getSettingIcon('equation')} ${i18next.t('settings_equation', { lng: language })}`, callback_data: 'settings_equation' }
                    ],
                    // 8. Help | Support
                    [
                        { text: i18next.t('settings_help', { lng: language }), callback_data: 'settings_help' },
                        { text: i18next.t('settings_support', { lng: language }), url: 'https://t.me/HolonicDAO' }
                    ],
                    // 9. Dashboard (full width)
                    [
                        { text: `🔍 ${i18next.t('dashboard', { lng: language, defaultValue: 'Holonic Dashboard' })}`, url: `https://dashboard.holons.io/${chatID}/dashboard` }
                    ]
                ]
            }
        };

        try {
            if (edit) {
                await ctx.editMessageText(menuText, menuMarkup);
            } else {
                await ctx.reply(menuText, menuMarkup);
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
                    { text: `🇬🇧 ${i18next.t('language_native_en', { lng: language, defaultValue: 'English'})}`, callback_data: 'language_en' },
                    { text: `🇮🇹 ${i18next.t('language_native_it', { lng: language, defaultValue: 'Italian'})}`, callback_data: 'language_it' }
                ],
                [
                    { text: `🇪🇸 ${i18next.t('language_native_es', { lng: language, defaultValue: 'Spanish'})}`, callback_data: 'language_es' },
                    { text: `🇫🇷 ${i18next.t('language_native_fr', { lng: language, defaultValue: 'French'})}`, callback_data: 'language_fr' }
                ],
                [
                    { text: `🇷🇺 ${i18next.t('language_native_ru', { lng: language, defaultValue: 'Russian'})}`, callback_data: 'language_ru' },
                    { text: `🇩🇪 ${i18next.t('language_native_de', { lng: language, defaultValue: 'German'})}`, callback_data: 'language_de' }
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
            keyboard.push([{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_timezone' }]);
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

        // Create message text
        let messageText = '';

        // Special handling for purpose (which is a string, not an array)
        if (type === 'purpose') {
            const currentPurpose = settings.purpose || i18next.t('settings_not_set', { lng: language });
            
            // Show purpose in message text
            messageText = `🎯 *${i18next.t('settings_purpose', { lng: language })}*\n\n${currentPurpose}`;

            // Only show edit and back buttons
            keyboard.inline_keyboard = [
                [{
                    text: `✏️ ${i18next.t('settings_edit', { lng: language })}`,
                    callback_data: 'help_add_purpose'
                }],
                [{
                    text: i18next.t('settings_back', { lng: language }),
                    callback_data: 'settings_back'
                }]
            ];
        }
        // For arrays (values, domains, roles)
        else {
            messageText = i18next.t('settings', { lng: language });
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

            // Back button for all menu types
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_back', { lng: language }),
                callback_data: 'settings_back'
            }]);
        }

        try {
            if (ctx.callbackQuery) {
                await ctx.editMessageText(messageText, {
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            } else {
                await ctx.reply(messageText, {
                    reply_markup: keyboard,
                    parse_mode: 'Markdown'
                });
            }
        } catch (e) {
            console.log(`Error showing ${type} menu:`, e);
        }
    }

    // Helper method to get setting icon
    getSettingIcon(type) {
        switch (type) {
            case 'values': return '💫';
            case 'domains': return '🗺️'; // Changed icon for domains to avoid conflict
            case 'roles': return '👥';
            case 'purpose': return '🎯';
            case 'language': return '🌐';
            case 'theme': return '🎨';
            case 'timezone': return '🕒';
            case 'admin': return '👑';
            case 'users': return '👪';
            case 'hex': return '✡️';
            case 'equation': return '⚖️';
            case 'level': return '📊';
            case 'federation': return '🔗';
            case 'currencies': return '💱'; 
            case 'holacracy': return '🏛️'; // Added icon for holacracy
            case 'manage_rewards': return '💰'; // Icon for Manage Rewards
            case 'flow_management': return '🌊'; // Icon for Flow Management
            case 'maxTasks': return '📋';
            default: return '⚙️';
        }
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

                // Add crown emoji if this is the current admin
                const isAdmin = currentAdmin === user.id.toString() ||
                    currentAdmin === user.username ||
                    currentAdmin === '@' + user.username;

                keyboard.inline_keyboard.push([{
                    text: `${isAdmin ? '👑 ' : ''}${displayName}`,
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
            callback_data: 'settings_back'
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

    async showFederationMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;

        // Get federation info
        const fedInfo = await this.db.holosphere.getFederation(chatID);
        const federatedWith = fedInfo && fedInfo.federation ? fedInfo.federation : [];
        const notifies = fedInfo && fedInfo.notify ? fedInfo.notify : [];

        const keyboard = {
            inline_keyboard: []
        };

        // Add header
        keyboard.inline_keyboard.push([{
            text: `${this.getSettingIcon('federation')} ${i18next.t('settings_federation', { lng: language })}`,
            callback_data: ' '
        }]);

        // Add federated chats section if any
        if (federatedWith.length > 0) {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_federated_with', { lng: language }),
                callback_data: ' '
            }]);

            for (const space of federatedWith) {
                const holonName = await this.getHolonDisplayName(space, ctx);
                keyboard.inline_keyboard.push([{
                    text: holonName,
                    callback_data: `federation_lenses_${space}` // Changed from ' '
                }, {
                    text: '❌',
                    callback_data: `unfederate_${space}`
                }]);
            }
        } else {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_no_federation', { lng: language }),
                callback_data: ' '
            }]);
        }

        // Add notified chats section if any
        if (notifies.length > 0) {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_notifies', { lng: language }),
                callback_data: ' '
            }]);

            for (const space of notifies) {
                const holonName = await this.getHolonDisplayName(space, ctx);
                keyboard.inline_keyboard.push([{
                    text: holonName,
                    callback_data: `notify_lenses_${space}` // Changed from ' '
                }, {
                    text: '❌',
                    callback_data: `unnotify_${space}`
                }]);
            }
        }

        // Add action buttons
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_add_federation', { lng: language }),
            callback_data: 'add_federation'
        }]);

        // Add back button
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back', { lng: language }),
            callback_data: 'settings_back'
        }]);

        // Display the keyboard
        try {
            if (edit && ctx.callbackQuery) {
                await ctx.editMessageText(i18next.t('settings_federation_title', { lng: language }), {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(i18next.t('settings_federation_title', { lng: language }), {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log('Error showing federation menu:', e);
        }
    }

    // Add users management menu method
    async showUsersManagementMenu(ctx, edit = false, removeMode = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;

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

        // Add header with indication of mode
        if (removeMode) {
            keyboard.inline_keyboard.push([{
                text: `🗑️ ${i18next.t('settings_remove_users', { lng: language }) || 'Remove Users'}`,
                callback_data: ' '
            }]);
        } else {
            keyboard.inline_keyboard.push([{
                text: `${this.getSettingIcon('users')} ${i18next.t('settings_users', { lng: language }) || 'Users'}`,
                callback_data: ' '
            }]);
        }

        // Add each user as a button
        if (users && users.length > 0) {
            for (const user of users) {
                // Skip users without proper identification
                if (!user.id) continue;

                // Create display name (prefer username, fallback to first_name or id)
                const displayName = user.username ?
                    '@' + user.username :
                    (user.first_name || user.id.toString());

                // Check if user is admin
                const isAdmin = settings.admin === user.id.toString() ||
                    settings.admin === user.username ||
                    settings.admin === '@' + user.username;

                // In remove mode, show delete button except for admin
                if (removeMode) {
                    if (!isAdmin) {
                        keyboard.inline_keyboard.push([{
                            text: `❌ ${displayName}`,
                            callback_data: `remove_user_${user.id}`
                        }]);
                    } else {
                        keyboard.inline_keyboard.push([{
                            text: `👑 ${displayName} (admin)`,
                            callback_data: ' '
                        }]);
                    }
                } else {
                    // In normal mode, show user info button
                    keyboard.inline_keyboard.push([{
                        text: `${isAdmin ? '👑 ' : ''}${displayName}`,
                        callback_data: `user_info_${user.id}`
                    }]);
                }
            }
        } else {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_no_users', { lng: language }) || 'No users found',
                callback_data: ' '
            }]);
        }

        // Add control buttons
        if (removeMode) {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_exit_remove_mode', { lng: language }) || 'Exit Remove Mode',
                callback_data: 'exit_remove_mode'
            }]);
        } else {
            keyboard.inline_keyboard.push([
                {
                    text: i18next.t('settings_add_user', { lng: language }) || 'Add User',
                    callback_data: 'add_user'
                },
                {
                    text: i18next.t('settings_remove_user', { lng: language }) || 'Remove User',
                    callback_data: 'enter_remove_mode'
                }
            ]);
        }

        // Add back button
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back', { lng: language }) || 'Back',
            callback_data: 'settings_back'
        }]);

        // Display the keyboard
        try {
            const messageText = removeMode
                ? (i18next.t('settings_select_user_to_remove', { lng: language }) || 'Select user to remove')
                : (i18next.t('settings_manage_users', { lng: language }) || 'Manage Users');

            if (edit && ctx.callbackQuery) {
                await ctx.editMessageText(messageText, {
                    reply_markup: keyboard
                });
            } else if (ctx.scene && ctx.scene.state && ctx.scene.state.originalMessageId && ctx.callbackQuery) {
                // Edit the original settings message if we're coming from there
                await ctx.editMessageText(messageText, {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(messageText, {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log('Error showing users management menu:', e);
        }
    }

    // Method to show user info
    async showUserInfo(ctx, userId) {
        const chatID = ctx.callbackQuery.message.chat.id;
        let settings = await this.getSettings(chatID);
        const language = settings.language;

        // Get user details
        let user = null;
        try {
            const users = await this.db.getAll(chatID + '/users');
            user = users.find(u => u.id.toString() === userId);
        } catch (error) {
            console.error('Error getting user info:', error);
        }

        if (!user) {
            await ctx.reply(i18next.t('settings_user_not_found', { lng: language }));
            return;
        }

        // Format user info
        const displayName = user.username ?
            '@' + user.username :
            (user.first_name || user.id.toString());

        const fullName = user.first_name && user.last_name ?
            `${user.first_name} ${user.last_name}` :
            (user.first_name || '');

        const isAdmin = settings.admin === user.id.toString() ||
            settings.admin === user.username ||
            settings.admin === '@' + user.username;

        // Create user info message
        let userInfo = `📋 *User Info*\n\n`;
        userInfo += `ID: \`${user.id}\`\n`;
        userInfo += `Username: ${user.username ? '@' + user.username : 'Not set'}\n`;
        userInfo += `Name: ${fullName || 'Not available'}\n`;
        userInfo += `Role: ${isAdmin ? 'Admin' : 'Member'}\n`;

        // Add back button
        const keyboard = {
            inline_keyboard: [
                [{
                    text: i18next.t('settings_back', { lng: language }),
                    callback_data: 'settings_back'
                }]
            ]
        };

        // Display user info
        await ctx.editMessageText(userInfo, {
            reply_markup: keyboard,
            parse_mode: 'Markdown'
        }).catch(e => {
            console.log('Error showing user info:', e);
            // Fallback without markdown if parse mode fails
            ctx.editMessageText(userInfo.replace(/\*/g, '').replace(/`/g, ''), {
                reply_markup: keyboard
            }).catch(err => console.log('Error in fallback user info:', err));
        });
    }

    // Process user mentions from message
    async processUserMentions(ctx) {
        const chatID = ctx.chat.id;
        const language = await this.getLanguage(chatID);
        const messageText = ctx.message.text;

        // Handle both regular mentions and text_mentions
        const entities = ctx.message.entities || [];
        const mentions = entities.filter(entity => entity.type === 'mention' || entity.type === 'text_mention');

        if (mentions.length === 0) {
            await ctx.reply(i18next.t('settings_no_mentions', { lng: language }) ||
                'No user mentions found. Please mention a user with @ or enter user details manually.');
            return;
        }

        const addedUsers = [];
        const failedUsers = [];

        for (const entity of mentions) {
            try {
                let user = null;

                // Handle different types of mentions
                if (entity.type === 'text_mention' && entity.user) {
                    // text_mention already contains the full user object
                    user = entity.user;
                } else if (entity.type === 'mention') {
                    // Extract username from the mention
                    const username = messageText.substring(entity.offset + 1, entity.offset + entity.length);

                    // First check if user exists in our database
                    user = await this.findUserInDatabase(chatID, username);

                    // If not in database, try to get from Telegram
                    if (!user) {
                        user = await this.lookupUserByUsername(ctx, username);
                    }

                    // If still not found, store just the username for manual completion
                    if (!user) {
                        // Create a minimal user object with just the username
                        user = {
                            id: null,
                            username: username,
                            first_name: '',
                            last_name: ''
                        };

                        // Ask for more info
                        const errorMsg = await ctx.reply(i18next.t('settings_need_user_id', { lng: language, username: username }) ||
                            `Could not get ID for @${username}. Please provide the numeric ID for this user in format: @${username},ID`);
                        // Store the error message ID for potential cleanup
                        if (!ctx.scene.state.errorMessageIds) {
                            ctx.scene.state.errorMessageIds = [];
                        }
                        ctx.scene.state.errorMessageIds.push(errorMsg.message_id);

                        failedUsers.push(username);
                        continue;
                    }
                }

                // If we have a valid user with ID, add to database
                if (user && user.id) {
                    await this.addUserToDatabase(chatID, user);
                    addedUsers.push(user.username || user.id.toString());
                }
            } catch (error) {
                console.error('Error processing mention:', error);
                if (entity.type === 'mention') {
                    failedUsers.push(messageText.substring(entity.offset + 1, entity.offset + entity.length));
                } else {
                    failedUsers.push('user');
                }
            }
        }

        // Report results
        let resultMessage = '';

        if (addedUsers.length > 0) {
            resultMessage += i18next.t('settings_users_added', { lng: language, count: addedUsers.length, users: addedUsers.join(', ') }) ||
                `Successfully added ${addedUsers.length} user(s): @${addedUsers.join(', @')}\n`;
        }

        if (failedUsers.length > 0) {
            resultMessage += i18next.t('settings_users_failed', { lng: language, count: failedUsers.length, users: failedUsers.join(', ') }) ||
                `Failed to add ${failedUsers.length} user(s): @${failedUsers.join(', @')}\n` +
                `Please provide more details for these users.`;
        }

        if (resultMessage) {
            const resultMsg = await ctx.reply(resultMessage);

            // Store the result message ID for potential cleanup
            if (!ctx.scene.state.resultMessageIds) {
                ctx.scene.state.resultMessageIds = [];
            }
            ctx.scene.state.resultMessageIds.push(resultMsg.message_id);
        }

        // If we added all users successfully, exit the scene
        if (failedUsers.length === 0 && addedUsers.length > 0) {
            // Clean up prompts before leaving
            await this.cleanupSceneMessages(ctx);
            await ctx.scene.leave();

            // Return to users management menu with fresh UI
            await this.showUsersManagementMenu(ctx, false);
        }
    }

    // Find a user in our database by username
    async findUserInDatabase(chatID, username) {
        try {
            const users = await this.db.getAll(chatID + '/users');
            return users.find(user =>
                user.username &&
                user.username.toLowerCase() === username.toLowerCase()
            );
        } catch (error) {
            console.error('Error finding user in database:', error);
            return null;
        }
    }

    // Look up a user by username using Telegram API
    async lookupUserByUsername(ctx, username) {
        try {
            // Try to get the user directly from chat members
            try {
                const chatMember = await ctx.getChatMember('@' + username);
                if (chatMember && chatMember.user) {
                    return chatMember.user;
                }
            } catch (e) {
                // Continue with other methods if this fails
                console.log('Could not get user directly, trying other methods');
            }

            if (ctx.chat.type != 'private') {
                // Check chat administrators
                const chatMembers = await ctx.getChatAdministrators();
                for (const member of chatMembers) {
                    if (member.user && member.user.username &&
                        member.user.username.toLowerCase() === username.toLowerCase()) {
                        return member.user;
                    }
                }
            }

            // If user replied to a message, check if it's from the user we're looking for
            if (ctx.message && ctx.message.reply_to_message) {
                const replyMsg = ctx.message.reply_to_message;
                if (replyMsg.from && replyMsg.from.username &&
                    replyMsg.from.username.toLowerCase() === username.toLowerCase()) {
                    return replyMsg.from;
                }
            }

            // Try to find the user in the current message's sender
            if (ctx.message && ctx.message.from &&
                ctx.message.from.username &&
                ctx.message.from.username.toLowerCase() === username.toLowerCase()) {
                return ctx.message.from;
            }

            // If all else fails, return null
            return null;
        } catch (error) {
            console.error('Error looking up user by username:', error);
            return null;
        }
    }

    // Handle combined username+ID format for manual entry
    async processManualUserEntry(ctx) {
        const chatID = ctx.chat.id;
        const language = await this.getLanguage(chatID);
        const messageText = ctx.message.text.trim();

        // Check if this is a username,ID format from a previous failed mention
        if (messageText.includes('@') && messageText.includes(',')) {
            const parts = messageText.split(',').map(p => p.trim());
            const usernameWithAt = parts[0];

            if (usernameWithAt.startsWith('@') && parts.length > 1) {
                const username = usernameWithAt.substring(1);
                const userId = parts[1];

                if (userId && !isNaN(parseInt(userId))) {
                    // Create a user with the given username and ID
                    const user = {
                        id: parseInt(userId),
                        username: username,
                        first_name: parts.length > 2 ? parts[2] : username,
                        last_name: parts.length > 3 ? parts[3] : ''
                    };

                    try {
                        await this.addUserToDatabase(chatID, user);
                        const successMsg = await ctx.reply(i18next.t('settings_user_added', { lng: language }));

                        // Store the success message ID for cleanup
                        if (!ctx.scene.state.resultMessageIds) {
                            ctx.scene.state.resultMessageIds = [];
                        }
                        ctx.scene.state.resultMessageIds.push(successMsg.message_id);

                        return true;
                    } catch (error) {
                        await ctx.reply(i18next.t('settings_error_adding_user', { lng: language, error: error.message }));
                        return false;
                    }
                    }
                }
            }
        }

   
    // Add user to database
    async addUserToDatabase(chatID, user) {
        // Get current users
        let users = await this.db.getAll(chatID + '/users');

        // Check if user already exists
        const existingUser = users.find(u => u.id && u.id.toString() === user.id.toString());
        if (existingUser) {
            return false; // (`User with ID ${user.id} already exists.`);
        }

        await this.db.put(chatID + '/users', user);


        return true;
    }

    // Helper method to clean up scene messages
    async cleanupSceneMessages(ctx) {
        try {
            // Check if bot has admin rights before trying to delete messages
            const botHasAdminRights = await utils.isBotAdmin(ctx);
            
            if (!botHasAdminRights) {
                console.log('Cannot clean up messages: bot lacks necessary admin rights');
                return;
            }
            
            // Delete the prompt message if it exists
            if (ctx.scene.state.promptMessageId) {
                await ctx.deleteMessage(ctx.scene.state.promptMessageId).catch(() => { });
            }

            // Delete the user's message if it exists
            if (ctx.scene.state.userMessageId) {
                await ctx.deleteMessage(ctx.scene.state.userMessageId).catch(() => { });
            }

            // Delete any error messages
            if (ctx.scene.state.errorMessageIds && ctx.scene.state.errorMessageIds.length > 0) {
                for (const msgId of ctx.scene.state.errorMessageIds) {
                    await ctx.deleteMessage(msgId).catch(() => { });
                }
            }

            // Delete any result messages
            if (ctx.scene.state.resultMessageIds && ctx.scene.state.resultMessageIds.length > 0) {
                for (const msgId of ctx.scene.state.resultMessageIds) {
                    await ctx.deleteMessage(msgId).catch(() => { });
                }
            }
        } catch (error) {
            console.log('Error cleaning up scene messages:', error);
        }
    }

    // Add method to show hex menu - follows the purpose pattern
    async showHexMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const currentHex = settings.hex || '';

        const keyboard = {
            inline_keyboard: []
        };

        // Add header
        keyboard.inline_keyboard.push([{
            text: `${this.getSettingIcon('hex')} ${i18next.t('settings_hex', { lng: language })}`,
            callback_data: ' '
        }]);

        // Add current hex (if any)
        if (currentHex) {
            keyboard.inline_keyboard.push([{
                text: `• ${currentHex}`,
                callback_data: 'hex_view'
            }]);
        } else {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_not_set', { lng: language }),
                callback_data: ' '
            }]);
        }

        // Add control buttons
        keyboard.inline_keyboard.push([{
            text: `✏️ ${i18next.t('settings_edit', { lng: language })}`,
            callback_data: 'help_add_hex'
        }]);

        // Add map hexamap webapp button (separate row to avoid mixing button types)
        keyboard.inline_keyboard.push([{
            text: `🗺️ ${i18next.t('settings_view_map', { lng: language, defaultValue: 'View on Map' })}`,
            callback_data: 'hex_view_map'
        }]);

        // Back button
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back', { lng: language }),
            callback_data: 'settings_back'
        }]);

        try {
            if (edit && ctx.callbackQuery) {
                await ctx.editMessageText(i18next.t('settings_hex_title', { lng: language }), {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(i18next.t('settings_hex_title', { lng: language }), {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log('Error showing hex menu:', e);
        }
    }

    // Add method to show shared lenses menu
    async showSharedLensesMenu(ctx, targetChatID, relationshipType, edit = false, currentLensesConfig = null) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!chatID) {
            console.error('Could not determine chat ID for shared lenses menu');
            return;
        }

        const language = await this.getLanguage(chatID);
        let title = '';
        const targetHolonName = await this.getHolonDisplayName(targetChatID, ctx);

        if (relationshipType === 'federated') {
            title = i18next.t('settings_lenses_federated_with', { lng: language, targetChatID: targetHolonName, defaultValue: `Lenses Federated with ${targetHolonName}` });
        } else if (relationshipType === 'notifies') {
            title = i18next.t('settings_lenses_notified_to', { lng: language, targetChatID: targetHolonName, defaultValue: `Lenses Notified to ${targetHolonName}` });
        }

        let lensesConfig = currentLensesConfig;
        if (!lensesConfig) {
            // --- Placeholder for Lenses Data Fetching & Initialization ---
            // TODO: Replace this with actual logic to fetch shared lenses configuration (name, enabled state)
            // for the targetChatID from db.holosphere or a similar source.
            // If no configuration exists, initialize it (e.g., all enabled by default) and persist it.
            // const EXAMPLE_LENS_NAMES = ['Quests', 'Offers', 'Tags', 'Expenses', 'Announcements', 'Users', 'Shopping', 'Recurring'];
            // lensesConfig = EXAMPLE_LENS_NAMES.map(name => ({ name: name, enabled: true }));
            lensesConfig = await this.getLensesConfigForUI(chatID, targetChatID, relationshipType);
            // Example: 
            // lensesConfig = await this.db.holosphere.getSharedLensesConfig(chatID, targetChatID, relationshipType);
            // if (!lensesConfig || lensesConfig.length === 0) { 
            //     lensesConfig = EXAMPLE_LENS_NAMES.map(name => ({ name: name, enabled: true }));
            //     // await this.db.holosphere.setSharedLensesConfig(chatID, targetChatID, relationshipType, lensesConfig); // Persist initial
            // }
            // --- End Placeholder ---
        }

        const keyboard = await this.getSharedLensesKeyboard(chatID, targetChatID, relationshipType, lensesConfig);

        try {
            if (edit && ctx.callbackQuery) {
                await ctx.editMessageText(title, {
                    reply_markup: keyboard
                });
            } else {
                await ctx.reply(title, {
                    reply_markup: keyboard
                });
            }
        } catch (e) {
            console.log('Error showing shared lenses menu:', e);
            // Fallback reply if edit fails
            await ctx.reply(title, {
                reply_markup: keyboard
            }).catch(err => console.log('Fallback reply error in showSharedLensesMenu:', err));
        }
    }

    async getSharedLensesKeyboard(chatID, targetChatID, relationshipType, lensesConfig) {
        const language = await this.getLanguage(chatID);
        const keyboard = {
            inline_keyboard: []
        };

        // Add lenses in 2 columns
        for (let i = 0; i < lensesConfig.length; i += 2) {
            const row = [];
            const lens1 = lensesConfig[i];
            row.push({
                text: `${lens1.enabled ? '✅' : '🔘'} ${lens1.name}`,
                callback_data: `toggle_lens_${targetChatID}_${relationshipType}_${lens1.name}`
            });
            if (i + 1 < lensesConfig.length) {
                const lens2 = lensesConfig[i+1];
                row.push({
                    text: `${lens2.enabled ? '✅' : '🔘'} ${lens2.name}`,
                    callback_data: `toggle_lens_${targetChatID}_${relationshipType}_${lens2.name}`
                });
            }
            keyboard.inline_keyboard.push(row);
        }
        
        if (lensesConfig.length === 0) {
             keyboard.inline_keyboard.push([{
                text: i18next.t('settings_no_lenses_shared', { lng: language, defaultValue: 'No specific lenses configured for this link.'}),
                callback_data: ' '
            }]);
        }

        // Add back button to federation menu
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back_to_federation', { lng: language, defaultValue: '⬅️ Back to Federation Menu' }),
            callback_data: 'settings_federation' // This should take back to showFederationMenu
        }]);

        return keyboard;
    }

    async getLensesConfigForUI(chatID, targetChatID, relationshipType) {
        const persistedLinkConfig = await this.db.holosphere.getFederatedConfig(chatID, targetChatID);
        let activeLensesForType = [];

        if (persistedLinkConfig) {
            if (relationshipType === 'federated' && persistedLinkConfig.federate) {
                activeLensesForType = persistedLinkConfig.federate;
            } else if (relationshipType === 'notifies' && persistedLinkConfig.notify) {
                activeLensesForType = persistedLinkConfig.notify;
            }
        }
        
        return ALL_AVAILABLE_LENSES.map(name => ({
            name: name,
            enabled: activeLensesForType.includes(name)
        }));
    }

    async showHolacracyMenu(ctx, edit = false) {
        const chatID = utils.getChatId(ctx);
        if (!chatID) {
            console.error('Could not determine chat ID for Holacracy menu');
            return;
        }

        let settings = await this.getSettings(chatID);
        const language = settings.language;

        const menuText = `${this.getSettingIcon('holacracy')} ${i18next.t('settings_holacracy', {lng: language, defaultValue: 'Holacracy Settings'})}`;

        const menuMarkup = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: `${this.getSettingIcon('purpose')} ${i18next.t('settings_purpose', { lng: language })}: ${settings.purpose ? '✓' : i18next.t('settings_not_set', { lng: language })}`,
                            callback_data: 'settings_purpose' 
                        }
                    ],
                    [
                        { 
                            text: `${this.getSettingIcon('roles')} ${i18next.t('settings_roles', { lng: language })}: ${settings.roles?.length || 0}`,
                            callback_data: 'settings_roles' 
                        }
                    ],
                    [
                        { 
                            text: `${this.getSettingIcon('domains')} ${i18next.t('settings_domains', { lng: language })}: ${settings.domains?.length || 0}`,
                            callback_data: 'settings_domains' 
                        }
                    ],
                    [
                        { 
                            text: `${this.getSettingIcon('values')} ${i18next.t('settings_values', { lng: language })}: ${settings.values?.length || 0}`,
                            callback_data: 'settings_values' 
                        }
                    ],
                    [
                        { text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }
                    ]
                ]
            }
        };

        try {
            if (edit) {
                await ctx.editMessageText(menuText, menuMarkup);
            } else {
                await ctx.reply(menuText, menuMarkup);
            }
        } catch (e) {
            console.log(`Error showing Holacracy menu (edit: ${edit}):`, e.message);
            if (edit && !e.message.includes("message is not modified")) {
                // If edit was true and it failed for a reason other than "not modified",
                // try sending as a new message as a last resort.
                console.log('Falling back to sending new message for Holacracy menu after edit error.');
                await ctx.reply(menuText, menuMarkup).catch(err => console.log('Fallback reply error in showHolacracyMenu:', err.message));
            } else if (!edit) {
                // If it wasn't an edit initially and reply failed, log it (though less common)
                 console.log('Error sending initial Holacracy menu as new message:', e.message);
            }
            // If it was an edit and the message was "not modified", we don't need to do anything further.
        }
    }

    async showMaxTasksMenu(ctx, edit = false) {
        const chatID = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        let settings = await this.getSettings(chatID);
        const language = settings.language;
        const fibs = [2,3,5,8,13,21,34,55,0]; // 0 = Unlimited
        const keyboard = { inline_keyboard: [] };
        for (let i = 0; i < fibs.length; i += 3) {
            const row = [];
            for (let j = 0; j < 3 && i + j < fibs.length; j++) {
                const n = fibs[i + j];
                row.push({
                    text: (settings.maxTasks === n ? '✅ ' : '') + (n === 0 ? i18next.t('settings_max_tasks_unlimited', { lng: language, defaultValue: 'Unlimited' }) : n.toString()),
                    callback_data: `set_max_tasks_${n}`
                });
            }
            keyboard.inline_keyboard.push(row);
        }
        keyboard.inline_keyboard.push([{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]);
        const menuText = i18next.t('settings_max_tasks_title', { lng: language, defaultValue: 'Set Max Tasks per User' }) + '\n' + i18next.t('settings_max_tasks_choose', { lng: language, defaultValue: 'Choose the maximum number of open tasks per user:' });
        if (edit && ctx.callbackQuery) {
            await ctx.editMessageText(menuText, { reply_markup: keyboard });
        } else {
            await ctx.reply(menuText, { reply_markup: keyboard });
        }
    }

    /**
     * Get display name for a holon in federation menu - shows ID when name is not known
     * @param {string} holonId - The holon ID
     * @param {object} ctx - Telegram context
     * @returns {Promise<string>} - Display name or ID if name is unknown
     */
    async getHolonDisplayName(holonId, ctx) {
        if (!holonId) return 'Unknown Holon';

        try {
            // Try to get the holon's settings to find its name
            const settings = await this.db.get(holonId.toString() + '/settings', holonId.toString());
            if (settings && settings.name && settings.name !== 'unknown') {
                return settings.name;
            }
        } catch (error) {
            // Settings not found, continue to fallback
        }

        // Try to get Telegram chat name if ctx is provided
        if (ctx) {
            try {
                const chatName = await utils.getChatName(ctx, holonId.toString());
                if (chatName && chatName !== 'unknown' && chatName !== null && chatName.trim() !== '') {
                    return chatName;
                }
            } catch (error) {
                // Chat name not available, continue to fallback
            }
        }

        // Final fallback: show the ID itself
        return holonId.toString();
    }
}