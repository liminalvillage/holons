/**
 * @fileoverview Settings management for HolonsBot holons.
 * @module src/Settings
 */
import i18next from "i18next";
import fs from 'fs';
import * as utils from './utilities.js'
import { Scenes, Markup } from 'telegraf';
import SettingsScenes from './SettingsScenes.js';

const DASHBOARD_ADDRESS = process.env.DASHBOARD_ADDRESS || 'https://dashboard.holons.io';

/**
 * All available lenses that can be configured for a holon.
 * @constant {string[]}
 */
const ALL_AVAILABLE_LENSES = ['quests', 'offers', 'tags', 'expenses', 'announcements', 'users', 'shopping', 'recurring'];

/**
 * Settings management class for configuring holon behavior and preferences.
 *
 * @class Settings
 * @description Manages all holon settings including language, theme, admin configuration,
 * federation setup, notification preferences, and quest display modes. Provides both
 * command-based and menu-based configuration interfaces.
 *
 * @property {DB} db - Database instance for persistence
 * @property {Telegraf} bot - Telegraf bot instance
 * @property {Holons|null} holons - Reference to Holons module
 * @property {Quests|null} quests - Reference to Quests module for cache invalidation
 * @property {Map<string, {settings: Object, timestamp: number}>} _settingsCache - Settings cache
 * @property {number} _cacheTTL - Cache time-to-live in milliseconds
 * @property {SettingsScenes} scenes - Settings scenes handler for Telegraf scenes
 *
 * @example
 * const settings = new Settings(bot, db);
 * const holonSettings = await settings.getSettings(chatId);
 * holonSettings.language = 'es';
 * await settings.setSettings(holonSettings);
 */
export default class Settings {
    /**
     * Creates a new Settings instance and registers all settings commands.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     */
    constructor(bot, db) {
        this.db = db;
        this.bot = bot;
        this.holons = null;
        this.quests = null;

        this._settingsCache = new Map();
        this._cacheTTL = 60 * 1000;

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
            const holonId = ctx.callbackQuery.message.chat.id;
            const language = await this.getLanguage(holonId);
            
            // Get user details
            const users = await this.db.getAll(holonId + '/users');
            const user = users.find(u => u.id.toString() === userId);
            
            if (!user) {
                await ctx.reply(i18next.t('settings_user_not_found', { lng: language }));
                return;
            }
            
            // Set as admin
            let settings = await this.getSettings(holonId);
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
            let settings = await this.getSettings(utils.getholonId(ctx))

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
                let holonId = utils.getholonId(ctx)
                let holonName = await utils.getChatName(ctx, holonId)

                console.log(`\n=== Starting reset for holon ${holonId} ===`);
                console.log('(Relay deletions will be processed asynchronously)');

                const lenses = [
                    'shopping', 'quests', 'offers', 'users', 'tags',
                    'expenses', 'announcements', 'recurring', 'checklists',
                    'roles', 'settings', 'library', 'deposits', 'appreciations'
                ];

                const globalTables = [
                    'recurring', 'recurringlookup', 'reminders',
                    'reminderslookup', 'federation', 'fedannouncements'
                ];

                // Clear locally first, then async sync to relay with 200ms delay between deletions
                const { localCleared, relayQueueSize } = await this.db.clearWithAsyncRelaySync(holonId, lenses, globalTables, 200);

                console.log('=== Local reset complete, relay sync in progress ===\n');

                await this.db.put(holonId + '/settings', await this.getDefaultSettings(holonId, holonName))
                ctx.reply(`Holon reset complete! ${relayQueueSize} items queued for relay deletion (processing in background).`)
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }
        })

        this.bot.command('id', async (ctx) => {
            ctx.reply('This holon ID is ' + utils.getholonId(ctx))
        })

        this.bot.command(['federate', 'spoon'], async (ctx) => {
            if (utils.isAdmin(ctx)) this.federate(ctx).catch((e) => { console.log(e) })
            else ctx.reply('Only a chat admin can perform this action')
        }
        )

        this.bot.command('federation', async (ctx) => {
            try {
                const holonId = utils.getholonId(ctx);
                const fedInfo = await this.db.getFederation(holonId);

                let message = 'Federation information:\n\n';
                // Combine inbound and outbound arrays to get all federated holons (deduplicated)
                const inbound = fedInfo?.inbound || [];
                const outbound = fedInfo?.outbound || [];
                const federatedHolons = [...new Set([...inbound, ...outbound])];

                if (federatedHolons.length === 0) {
                    message += 'This chat is not federated with any other spaces.';
                } else {
                    message += `This chat (${holonId}) is federated with:\n`;
                    for (const space of federatedHolons) {
                        const lensConfig = fedInfo.lensConfig?.[space] || {};
                        const inbound = lensConfig.inbound || [];
                        const outbound = lensConfig.outbound || [];
                        message += `\n- ${space}`;
                        if (inbound.length > 0) message += `\n  ↓ Receiving: ${inbound.join(', ')}`;
                        if (outbound.length > 0) message += `\n  ↑ Sending: ${outbound.join(', ')}`;
                        if (inbound.length === 0 && outbound.length === 0) message += ` (no lenses configured)`;
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
                let holonId = utils.getholonId(ctx)
                let settings = await this.getSettings(holonId) // Fetch full settings
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
        this.bot.command('getroles', async (ctx) => { let roles = await this.getRoles(utils.getholonId(ctx)); ctx.reply(roles ? roles : 'No roles specified') })

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
                const holonId = ctx.message.chat.id;
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

                let settings = await this.getSettings(holonId);

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
            const holonId = ctx.callbackQuery.message.chat.id;
            await ctx.editMessageText('Select timezone:', {
                reply_markup: await this.getTimezoneKeyboard(holonId, region)
            }).catch((err) => { console.log(err) });
        });

        // Handle timezone selection
        this.bot.action(/timezone_set_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const timezone = ctx.match[1];
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);
            settings.timezone = timezone;
            await this.setSettings(settings);
            await ctx.editMessageText('Timezone set to: ' + timezone.split('/')[1].replace('_', ' '), {
                reply_markup: await this.getTimezoneKeyboard(holonId)
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
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);

            // Handle array settings - always use the new UI
            if (['values', 'domains', 'roles', 'purpose', 'currencies'].includes(action)) {
                await this.showArraySettingMenu(ctx, action);
                return;
            }

            const self = this; // Capture reference for callbacks in switch cases
            switch (action) {
                case 'name':
                    // Migrated to InputScene
                    const nameLanguage = await this.getLanguage(holonId);
                    const currentName = settings.name || i18next.t('settings_not_set', { lng: nameLanguage });
                    await ctx.scene.enter('input_scene', {
                        promptText: i18next.t('settings_current', { lng: nameLanguage, value: currentName }) + '\n\n' +
                                   i18next.t('settings_send_new', { lng: nameLanguage, type: i18next.t('settings_name', { lng: nameLanguage, defaultValue: 'name' }).toLowerCase() }),
                        allowEmpty: false,
                        showCancelButton: true,
                        onComplete: async (ctx, input) => {
                            const holonId = ctx.chat.id;
                            let settings = await self.getSettings(holonId);
                            settings.name = input;
                            await self.setSettings(settings);
                            await self.showSettingsMenu(ctx);
                        }
                    });
                    break;
                case 'menu':
                    await this.showSettingsMenu(ctx, true);
                    break;
                case 'language':
                    await ctx.editMessageText(i18next.t('settings_select_language'), {
                        reply_markup: await this.getLanguageKeyboard(holonId)
                    }).catch(e => console.log('Error in language menu:', e));
                    break;
                case 'theme':
                    await ctx.editMessageText(i18next.t('settings_select_theme'), {
                        reply_markup: await this.getThemeKeyboard(holonId)
                    }).catch(e => console.log('Error in theme menu:', e));
                    break;
                case 'level':
                    await ctx.editMessageText(i18next.t('settings_select_level'), {
                        reply_markup: await this.getLevelKeyboard(holonId)
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
                        ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(holonId) }));
                    }
                    break;
                case 'timezone':
                    await ctx.editMessageText(i18next.t('settings_select_timezone_region'), {
                        reply_markup: await this.getTimezoneKeyboard(holonId)
                    }).catch(e => console.log('Error in timezone menu:', e));
                    break;
                case 'equation':
                    let holonIdForEq = ctx.callbackQuery.message.chat.id;
                    let settingsForEq = await this.getSettings(holonIdForEq); // Fetch full settings
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
                        ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(holonId) }));
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
                        const lang = await this.getLanguage(holonId);
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
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);

            if (['en', 'it', 'es', 'fr', 'ru', 'de'].includes(language)) {
                settings.language = language;
                await this.setSettings(settings);
                // Invalidate language cache in Quests module
                if (this.quests && typeof this.quests.invalidateLanguageCache === 'function') {
                    this.quests.invalidateLanguageCache(holonId);
                }
                await i18next.changeLanguage(language);
                await ctx.reply(i18next.t('settings_language_updated', { language: language }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Add theme selection handlers
        this.bot.action(/theme_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const theme = ctx.match[1];
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);

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
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);

            if (['1', '2', '3'].includes(level)) {
                settings.level = parseInt(level);
                await this.setSettings(settings);
                await ctx.reply(i18next.t('settings_level_updated', { level: level }));
                await this.showSettingsMenu(ctx, true);
            }
        });

        // Duplicate removed - timezone_set_ handler already registered above around line 284

        this.bot.action(/settings_equation_change/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId); // Fetch full settings
            let weights = settings.valueEquation;
            let currencies = settings.currencies || [];
            await ctx.editMessageText(i18next.t('settings_equation_title'), {
                reply_markup: this.equationInlineKeyboard(weights, currencies)
            }).catch((err) => { console.log(err) });
        });

        // Handle increment/decrement actions for value equation weights
        this.bot.action(/^(increment|decrement)_(\w+)$/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const holonId = ctx.callbackQuery.message.chat.id;
            const action = ctx.match[1];
            const field = ctx.match[2];

            let weights = await this.getValueEquation(holonId);

            if (action === 'increment') {
                weights[field]++;
            } else {
                weights[field]--;
            }

            await this.setValueEquation(holonId, weights);

            // Need to pass currencies to equationInlineKeyboard
            let updatedSettings = await this.getSettings(holonId);
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

                // Use InputScene for array input
                const holonId = ctx.chat.id;
                const language = await this.getLanguage(holonId);

                return ctx.scene.enter('input_scene', {
                    promptKey: 'settings_enter_new_items',
                    promptParams: { type: i18next.t(`settings_${type}`, { lng: language }).toLowerCase(), lng: language },
                    inputType: 'array',
                    allowEmpty: false,
                    showCancelButton: true,
                    onComplete: async (ctx, newItems) => {
                        const holonId = ctx.chat.id;

                        let settings = await this.getSettings(holonId);
                        if (!settings[type]) {
                            settings[type] = [];
                        }

                        settings[type].push(...newItems);
                        await this.setSettings(settings);
                        await this.showArraySettingMenu(ctx, type, false);
                    }
                });
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
                const holonId = ctx.chat.id;
                let settings = await this.getSettings(holonId);

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

        // Duplicate removed - settings_back handler already registered above around line 66

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
            const holonId = ctx.callbackQuery.message.chat.id;

            let settings = await this.getSettings(holonId);
            if (!settings[type]) settings[type] = [];

            // Special protection for currencies - prevent removing 'hour' as it's connected with tasks
            if (type === 'currencies') {
                const itemToRemove = settings[type][index];
                if (itemToRemove === 'hour') {
                    const language = await this.getLanguage(holonId);
                    await ctx.reply('⏰ Hour currency cannot be removed as it is the default currency for all groups.');
                    return this.showArraySettingMenu(ctx, type, true);
                }
            }

            settings[type].splice(index, 1);
            await this.setSettings(settings);

            return this.showArraySettingMenu(ctx, type, true);
        });

        // Duplicate handlers removed - these are already registered dynamically in the loop around line 517-522

        this.bot.action('settings_purpose_change', async (ctx) => {
            console.log('PURPOSE ADD button clicked');
            await ctx.answerCbQuery().catch()
            try {
                const holonId = ctx.chat.id;
                const language = await this.getLanguage(holonId);

                return ctx.scene.enter('input_scene', {
                    promptKey: 'settings_enter_new_items',
                    promptParams: { type: i18next.t('settings_purpose', { lng: language }).toLowerCase(), lng: language },
                    inputType: 'array',
                    allowEmpty: false,
                    showCancelButton: true,
                    onComplete: async (ctx, newItems) => {
                        const holonId = ctx.chat.id;

                        let settings = await this.getSettings(holonId);
                        if (!settings.purpose) {
                            settings.purpose = [];
                        }

                        settings.purpose.push(...newItems);
                        await this.setSettings(settings);
                        await this.showArraySettingMenu(ctx, 'purpose', false);
                    }
                });
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
                const holonId = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(holonId) }));
            }
        });

        this.bot.action(/unfederate_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            if (utils.isAdmin(ctx)) {
                const holonId = ctx.callbackQuery.message.chat.id;
                const federationID = ctx.match[1];
                const language = await this.getLanguage(holonId);

                try {
                    // Use HoloSphere2 API to unfederate holons
                    console.log(`[unfederate] Unfederating ${holonId} from ${federationID}`);
                    const success = await this.db.unfederateHolon(holonId.toString(), federationID.toString());

                    if (success) {
                        // Update the federation menu to reflect the removal
                        await this.showFederationMenu(ctx, true);
                    } else {
                        await ctx.answerCbQuery('Federation not found');
                    }
                } catch (error) {
                    // Ignore "message not modified" errors - this can happen if cache wasn't updated yet
                    if (error.response?.description?.includes('message is not modified')) {
                        console.log('[unfederate] Menu unchanged after unfederation - holon may have already been removed');
                        return;
                    }
                    console.error('Unfederation error in Settings.js:', error);
                    await ctx.answerCbQuery(`Error: ${error.message}`);
                }
            } else {
                const holonId = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(holonId) }));
            }
        });

        this.bot.action(/unnotify_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            if (utils.isAdmin(ctx)) {
                const holonId = ctx.callbackQuery.message.chat.id;
                const notifyID = ctx.match[1];
                const language = await this.getLanguage(holonId);

                try {
                    // Use HoloSphere2 API to unfederate holons
                    console.log(`[removeNotify] Removing inbound connection from ${notifyID} to ${holonId}`);
                    const success = await this.db.unfederateHolon(holonId.toString(), notifyID.toString());

                    if (success) {
                        // Update the federation menu to reflect the removal
                        await this.showFederationMenu(ctx, true);
                    } else {
                        await ctx.answerCbQuery('Inbound connection not found');
                    }
                } catch (error) {
                    console.error('Error removing notification:', error);
                    await ctx.answerCbQuery(`Error: ${error.message}`);
                }
            } else {
                const holonId = ctx.callbackQuery.message.chat.id;
                ctx.reply(i18next.t('adminonly', { lng: await this.getLanguage(holonId) }));
            }
        });

        // Add a direct command to add values without scenes
        this.bot.command('addvalues', async (ctx) => {
            const text = ctx.message.text.replace('/addvalues', '').trim();
            if (!text) {
                await ctx.reply('Please provide values to add, like: /addvalues value1, value2, value3');
                return;
            }

            const holonId = ctx.chat.id;
            const values = text.split(/[,\n]/)
                .map(v => v.trim())
                .filter(v => v !== '');

            let settings = await this.getSettings(holonId);

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

            const holonId = ctx.chat.id;
            const domains = text.split(/[,\n]/)
                .map(d => d.trim())
                .filter(d => d !== '');

            let settings = await this.getSettings(holonId);

            if (!settings.domains) {
                settings.domains = [];
            }

            settings.domains.push(...domains);
            await this.setSettings(settings);

            await ctx.reply(`Added ${domains.length} domains: ${domains.join(', ')}`);
            await this.showArraySettingMenu(ctx, 'domains', false);
        });

        this.bot.command('addroles', async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
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

            const holonId = ctx.chat.id;
            const newCurrencies = text.split(/[\n,]+/).map(c => c.trim().toLowerCase()).filter(c => c !== '');

            let settings = await this.getSettings(holonId);

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

        // Individual handlers for adding items - using InputScene pattern
        // All handlers clear cache before reading, then pass settings directly to showArraySettingMenu
        this.bot.action('help_add_purpose', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const self = this;

            let settings = await this.getSettings(holonId);
            const currentPurpose = settings.purpose || i18next.t('settings_not_set', { lng: language });

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_current', { lng: language, value: currentPurpose }) + '\n\n' +
                           i18next.t('settings_send_new', { lng: language, type: i18next.t('settings_purpose', { lng: language }).toLowerCase() }),
                allowEmpty: false,
                onComplete: async (ctx, input) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    settings.purpose = input;
                    await self.setSettings(settings);
                    await self.showArraySettingMenu(ctx, 'purpose');
                }
            });
        });

        this.bot.action('help_add_values', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const field = 'values';
            const self = this;

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_enter_new_items', {
                    lng: language,
                    type: i18next.t('settings_values', { lng: language }).toLowerCase()
                }),
                inputType: 'array',
                allowEmpty: false,
                onComplete: async (ctx, newItems) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    if (!settings[field]) settings[field] = [];
                    settings[field].push(...newItems);
                    await self.setSettings(settings);
                    await self.showArraySettingMenu(ctx, field);
                }
            });
        });

        this.bot.action('help_add_domains', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const field = 'domains';
            const self = this;

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_enter_new_items', {
                    lng: language,
                    type: i18next.t('settings_domains', { lng: language }).toLowerCase()
                }),
                inputType: 'array',
                allowEmpty: false,
                onComplete: async (ctx, newItems) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    if (!settings[field]) settings[field] = [];
                    settings[field].push(...newItems);
                    await self.setSettings(settings);
                    await self.showArraySettingMenu(ctx, field);
                }
            });
        });

        this.bot.action('help_add_roles', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const field = 'roles';
            const self = this;

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_enter_new_items', {
                    lng: language,
                    type: i18next.t('settings_roles', { lng: language }).toLowerCase()
                }),
                inputType: 'array',
                allowEmpty: false,
                onComplete: async (ctx, newItems) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    if (!settings[field]) settings[field] = [];
                    settings[field].push(...newItems);
                    await self.setSettings(settings);
                    await self.showArraySettingMenu(ctx, field);
                }
            });
        });

        // Duplicate removed - add_federation handler already registered above around line 673
        
        // Federation and hex back handlers have been removed and consolidated with unified settings_back handler

        // Setup add array item scene
        // add_array_item_scene migrated to InputScene - removed

        // Simple action handler for viewing hex (just acknowledges the click)
        this.bot.action('hex_view', async (ctx) => {
            await ctx.answerCbQuery().catch()
        });
        
        // Action handler for viewing hex map - opens dashboard map lens
        this.bot.action('hex_view_map', async (ctx) => {
            await ctx.answerCbQuery().catch()
            const holonId = ctx.callbackQuery.message.chat.id;
            const language = await this.getLanguage(holonId);
            const mapUrl = `${DASHBOARD_ADDRESS}/${holonId}/map`;
            await ctx.reply(i18next.t('settings_map_redirect', {
                lng: language,
                defaultValue: 'View this holon on the map:'
            }), {
                reply_markup: {
                    inline_keyboard: [[
                        { text: `🗺️ ${i18next.t('settings_view_map', { lng: language, defaultValue: 'View on Map' })}`, url: mapUrl }
                    ]]
                }
            });
        });

        // Action handler for editing hex (from hex menu) - Migrated to InputScene
        this.bot.action('help_add_hex', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.callbackQuery.message.chat.id;
            const language = await this.getLanguage(holonId);
            const self = this; // Capture reference for callbacks

            await ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_send_new', { lng: language, type: i18next.t('settings_hex', { lng: language }).toLowerCase() }) ||
                           'Please enter the new hex value:',
                allowEmpty: false,
                showCancelButton: true,
                onComplete: async (ctx, input) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    settings.hex = input.trim();
                    await self.setSettings(settings);
                    await self.showHexMenu(ctx);
                }
            });
        });

        // Create generalized scenes
        // Scenes migrated to InputScene - no custom text input scenes needed

        this.listPickerScene = new Scenes.BaseScene('list_picker_scene');
        this.listPickerScene.enter(async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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

        // Register only listPickerScene (textInputScene and arrayInputScene are registered in SettingsScenes.js)
        this.bot.stage.register(this.listPickerScene);

        // Update action handlers to use InputScene
        this.bot.action('settings_name', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const field = 'name';
            const self = this; // Capture reference for callbacks

            // Get current value
            let settings = await this.getSettings(holonId);
            const currentValue = settings[field] || i18next.t('settings_not_set', { lng: language });

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_current', { lng: language, value: currentValue }) + '\n\n' +
                           i18next.t('settings_send_new', { lng: language, type: i18next.t('settings_name', { lng: language }).toLowerCase() }),
                allowEmpty: false,
                onComplete: async (ctx, value) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    settings[field] = value;
                    await self.setSettings(settings);
                    await self.showSettingsMenu(ctx);
                }
            });
        });

        // Duplicates removed - these handlers are already registered above around line 617-670:
        // - settings_values_change, settings_domains_change, settings_roles_change, settings_currencies_change
        // Also removed duplicate help_add_hex (registered around line 1065)

        this.bot.action('help_add_currencies', async (ctx) => {
            await ctx.answerCbQuery().catch();
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            const field = 'currencies';
            const self = this;

            return ctx.scene.enter('input_scene', {
                promptText: i18next.t('settings_enter_new_items', {
                    lng: language,
                    type: i18next.t('settings_currencies', { lng: language, defaultValue: "Currencies" }).toLowerCase()
                }),
                inputType: 'array',
                allowEmpty: false,
                onComplete: async (ctx, newItems) => {
                    const holonId = ctx.chat.id;
                    let settings = await self.getSettings(holonId);
                    if (!settings[field]) settings[field] = [];
                    settings[field].push(...newItems);
                    await self.setSettings(settings);
                    await self.showArraySettingMenu(ctx, field);
                }
            });
        });

        this.bot.action('settings_holacracy', async (ctx) => {
            // console.log("!!!!!!!!!!!! ACTION: settings_holacracy TRIGGERED !!!!!!!!!!!!"); // New Log
            await ctx.answerCbQuery().catch()
            await this.showHolacracyMenu(ctx, true);
        });

        // Command handlers for non-admin scenarios
        this.bot.command('setname', async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
            settings.name = newName;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_name', { lng: language }),
                value: newName 
            }));
        });

        this.bot.command('setpurpose', async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
            settings.purpose = newPurpose;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_purpose', { lng: language }),
                value: newPurpose 
            }));
        });

        this.bot.command('sethex', async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
            settings.hex = newHex;
            await this.setSettings(settings);
            
            await ctx.reply(i18next.t('settings_updated', { 
                lng: language, 
                field: i18next.t('settings_hex', { lng: language }),
                value: newHex 
            }));
        });

        this.bot.command('addvalues', async (ctx) => {
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
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
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
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
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
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
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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
            let settings = await this.getSettings(holonId);
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

        // Action handler for viewing federation lens configuration for a specific holon
        this.bot.action(/federation_config_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const targetholonId = ctx.match[1];
            await this.showFederationLensConfig(ctx, targetholonId, true);
        });

        // Action handler for toggling a specific direction (inbound/outbound) for a lens
        this.bot.action(/toggle_lens_direction_(.+?)_(outbound|inbound)_(.+)/, async (ctx) => {
            // Answer callback query IMMEDIATELY to prevent duplicate clicks
            await ctx.answerCbQuery().catch(() => {});

            const targetholonId = ctx.match[1];
            const direction = ctx.match[2]; // 'outbound' or 'inbound'
            const lensNameToToggle = ctx.match[3];
            const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
            const holonIdStr = holonId.toString();
            const targetholonIdStr = targetholonId.toString();

            // Create a unique lock key for this operation
            const lockKey = `${holonIdStr}_${targetholonIdStr}_${direction}_${lensNameToToggle}`;

            // Prevent concurrent toggles of the same lens (simple debounce)
            if (!this.toggleLocks) this.toggleLocks = new Set();
            if (this.toggleLocks.has(lockKey)) {
                console.log(`[toggle_lens] Ignoring duplicate toggle for ${lockKey}`);
                return;
            }
            this.toggleLocks.add(lockKey);

            try {
                // Get current federation config
                let lensConfig = await this.db.getFederatedConfig(holonIdStr, targetholonIdStr);

                // If no config exists, create default
                if (!lensConfig) {
                    lensConfig = { inbound: [], outbound: [] };
                }

                // Ensure arrays exist
                if (!Array.isArray(lensConfig.inbound)) lensConfig.inbound = [];
                if (!Array.isArray(lensConfig.outbound)) lensConfig.outbound = [];

                // Determine which array to toggle based on direction
                // 'outbound' means sending data TO target (use outbound array)
                // 'inbound' means receiving data FROM target (use inbound array)
                const targetArray = direction === 'outbound' ? lensConfig.outbound : lensConfig.inbound;

                // Toggle the lens in the specific direction
                const lensIndex = targetArray.indexOf(lensNameToToggle);
                if (lensIndex > -1) {
                    targetArray.splice(lensIndex, 1); // Disable: remove from array
                    console.log(`[toggle_lens] Disabled ${direction} lens ${lensNameToToggle} for ${targetholonIdStr}`);
                } else {
                    targetArray.push(lensNameToToggle); // Enable: add to array
                    console.log(`[toggle_lens] Enabled ${direction} lens ${lensNameToToggle} for ${targetholonIdStr}`);
                }

                // UPDATE UI IMMEDIATELY (optimistic update with cached config)
                await this.showFederationLensConfig(ctx, targetholonId, true, lensConfig);

                // Check if federation should be removed (no lenses in either direction)
                const hasAnyLenses = lensConfig.inbound.length > 0 || lensConfig.outbound.length > 0;

                // NOW perform database operations in background
                if (!hasAnyLenses) {
                    // No lenses enabled, remove the federation
                    this.db.unfederateHolon(holonIdStr, targetholonIdStr).catch(err => {
                        console.error('Error unfederating holon:', err);
                    });
                } else {
                    // Check if we're enabling a lens (it was just added to the array)
                    const isEnabling = lensIndex === -1;

                    // Update federation with new lens config - skip propagation by default
                    this.db.federateHolon(holonIdStr, targetholonIdStr, {
                        lensConfig: lensConfig,
                        skipPropagation: true  // Don't auto-propagate existing data
                    }).then(async () => {
                        console.log(`[toggle_lens] Updated federation for ${holonIdStr} -> ${targetholonIdStr}`);

                        // If enabling a lens, ask about propagating existing data
                        if (isEnabling) {
                            const language = await this.getLanguage(holonId);
                            const targetName = await this.getHolonDisplayName(targetholonIdStr, ctx);

                            await ctx.reply(
                                i18next.t('settings_propagate_existing_prompt', {
                                    lng: language,
                                    lens: lensNameToToggle,
                                    target: targetName,
                                    defaultValue: `📤 Copy existing ${lensNameToToggle} to ${targetName}?`
                                }),
                                {
                                    reply_markup: {
                                        inline_keyboard: [[
                                            {
                                                text: i18next.t('yes', { lng: language, defaultValue: 'Yes' }),
                                                callback_data: `propagate_existing_${targetholonIdStr}_${direction}_${lensNameToToggle}`
                                            },
                                            {
                                                text: i18next.t('no', { lng: language, defaultValue: 'No' }),
                                                callback_data: 'propagate_existing_dismiss'
                                            }
                                        ]]
                                    }
                                }
                            );
                        }
                    }).catch(err => {
                        console.error(`[toggle_lens] Error updating federation:`, err);
                    });
                }

            } catch (error) {
                console.error(`Error toggling ${direction} lens ${lensNameToToggle} for ${targetholonId}:`, error);
                await ctx.reply('An error occurred while updating lens settings. Please try again.').catch(()=>{});
            } finally {
                // Always release the lock after a short delay
                setTimeout(() => {
                    this.toggleLocks.delete(lockKey);
                }, 500);
            }
        });

        this.bot.action(/set_max_tasks_(\d+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const value = parseInt(ctx.match[1]);
            const holonId = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(holonId);
            settings.maxTasks = value;
            await this.setSettings(settings);
            const language = await this.getLanguage(holonId);
            await ctx.reply(
                i18next.t('settings_max_tasks_updated', { lng: language, value: value === 0 ? i18next.t('settings_max_tasks_unlimited', { lng: language }) : value })
            );
            await this.showMaxTasksMenu(ctx, true);
        });

        // Handle propagate existing data confirmation
        this.bot.action(/propagate_existing_(.+?)_(outbound|inbound)_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch(() => {});

            const targetholonId = ctx.match[1];
            const direction = ctx.match[2];
            const lensName = ctx.match[3];
            const holonId = ctx.callbackQuery?.message?.chat?.id;
            const holonIdStr = holonId.toString();
            const targetholonIdStr = targetholonId.toString();
            const language = await this.getLanguage(holonId);

            try {
                // Delete the confirmation message
                await ctx.deleteMessage().catch(() => {});

                // Propagate existing data using holosphere's federate method
                // For outbound: source sends to target
                // For inbound: target sends to source
                if (direction === 'outbound') {
                    await this.db.holosphere.federate(holonIdStr, targetholonIdStr, lensName, {
                        direction: 'outbound',
                        mode: 'reference'
                    });
                } else {
                    await this.db.holosphere.federate(targetholonIdStr, holonIdStr, lensName, {
                        direction: 'outbound',
                        mode: 'reference'
                    });
                }

                const targetName = await this.getHolonDisplayName(targetholonIdStr, ctx);
                await ctx.reply(
                    i18next.t('settings_propagate_success', {
                        lng: language,
                        lens: lensName,
                        target: targetName,
                        defaultValue: `✅ Existing ${lensName} copied to ${targetName}`
                    })
                );
            } catch (error) {
                console.error('Error propagating existing data:', error);
                await ctx.reply(
                    i18next.t('settings_propagate_error', {
                        lng: language,
                        defaultValue: '❌ Failed to copy existing items'
                    })
                );
            }
        });

        // Handle dismiss propagation prompt
        this.bot.action('propagate_existing_dismiss', async (ctx) => {
            await ctx.answerCbQuery().catch(() => {});
            await ctx.deleteMessage().catch(() => {});
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

    setQuestsInstance(questsInstance) {
        this.quests = questsInstance;
    }

    async getHex(ctx) {
        let settings = await this.getSettings(utils.getholonId(ctx))
        return settings.hex
    }

    async setHex(ctx) {
        if (utils.isAdmin(ctx)) {
            const holonId = ctx.message.chat.id;
            const hex = ctx.message.text.split(' ')[1];
            let settings = await this.getSettings(holonId)
            settings.hex = hex
            await this.setSettings(settings)
            return hex
        }
        else ctx.reply("Only admins can set the hex")


    }

    async getHexContent(ctx) {
        const holonId = ctx.message.chat.id;
        let settings = await this.getSettings(holonId)
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

    /**
     * Creates a default settings object for a new holon.
     * @param {string|number} holonId - The holon ID
     * @param {string} holonName - The holon name
     * @returns {Object} Default settings object
     */
    getDefaultSettings(holonId, holonName) {
        return {
            id: holonId,
            hex: '',
            version: 0.2,
            name: holonName || 'unknown',
            timezone: '',
            whitelisted: false,
            language: process.env.LANGUAGE || 'en',
            theme: 'dark',
            level: 0,
            admin: '',
            values: [],
            purpose: '',
            domains: [],
            currencies: ['hour','euro'], // Default currency for all groups
            valueEquation: {
                initiated: 1,
                completed: 1,
                sent: 1,
                received: 1
            },
            maxTasks: 13, // Default to 13 (Fibonacci)
        }
    }

    /**
     * Gets the language setting for a holon.
     * @async
     * @param {string|number} holonId - The holon ID
     * @returns {Promise<string>} Language code (e.g., 'en', 'it', 'es')
     */
    async getLanguage(holonId) {
        let settings = await this.getSettings(holonId)
        return settings.language
    }

    /**
     * Sets the language for a holon via command.
     * @async
     * @param {Object} ctx - Telegraf context
     * @returns {Promise<void>}
     */
    async setLanguage(ctx) {
        const holonId = ctx.message.chat.id;
        const language = ctx.message.text.split(' ')[1];

        if (language === undefined || language === null) {
            ctx.reply('Please specify the language. Example: /setLanguage en')
            return
        }
        if (!['en', 'it', 'es', 'fr', 'ru', 'de'].includes(language)) {
            ctx.reply('Please specify "en", "it", "es", "fr", "ru" or "de". Example: /setLanguage en')
            return
        }

        let settings = await this.getSettings(holonId)
        settings.language = language
        this.db.put(holonId + '/settings', settings)
        await i18next.changeLanguage(language); // Ensure i18next instance is updated
        ctx.reply('Language changed to ' + language)
    }

    /**
     * Gets the theme CSS for a holon.
     * @async
     * @param {string|number} holonId - The holon ID
     * @returns {Promise<string>} Theme CSS content
     */
    async getTheme(holonId) {
        let settings = await this.getSettings(holonId)

        if (settings.theme === 'light') {
            return fs.readFileSync('themes/theme-light.css', 'utf8');
        } else {
            return fs.readFileSync('themes/theme-dark.css', 'utf8');
        }
    }

    /**
     * Sets the theme for a holon via command.
     * @async
     * @param {Object} ctx - Telegraf context
     * @returns {Promise<void>}
     */
    async setTheme(ctx) {
        const holonId = ctx.message.chat.id;
        const theme = ctx.message.text.split(' ')[1];

        if (theme === undefined || theme === null) {
            ctx.reply('Please specify the theme. Example: /setTheme light')
            return
        }
        if (theme !== 'light' && theme !== 'dark') {
            ctx.reply('Please specify "light" or "dark". Example: /setTheme light')
            return
        }
        let settings = await this.getSettings(holonId)
        settings.theme = theme
        this.db.put(holonId + '/settings', settings)
        ctx.reply('Theme changed to ' + theme)
    }

    async setLevel(ctx) {
        const holonId = ctx.message.chat.id;
        const level = ctx.message.text.split(' ')[1];

        if (level === undefined || level === null) {
            ctx.reply('Please specify the level. Example: /setLevel 1')
            return
        }
        if (level !== '1' && level !== '2' && level !== '3') {
            ctx.reply('Please specify "1", "2" or "3". Example: /setLevel 1')
            return
        }

        let settings = await this.getSettings(holonId)
        settings.level = level
        this.db.put(holonId + '/settings', settings)
        ctx.reply('Level changed to ' + level)

    }

    async setAdmin(ctx) {
        const holonId = ctx.message.chat.id;
        const admin = ctx.message.text.split(' ')[1];
        if (admin === undefined || admin === null) {
            ctx.reply('Please specify the admin. Example: /setAdmin @admin')
            return
        }
        let settings = await this.getSettings(holonId)
        settings.admin = admin
        this.db.put(holonId + '/settings', settings)
        ctx.reply('Admin changed to ' + admin)
    }



    async federate(ctx) {
        const holonId = ctx.message.chat.id.toString();
        const federationID = ctx.message.text.split(' ')[1];

        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify the ID you would like to federate with. Example: /federate 123456 or /federate 0x1234abcd. This holon ID is ' + holonId);
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
            // Use holosphere federateHolon method with empty lens config (user will configure lenses via menu)
            console.log('FEDERATING', holonId, federationID)

            await this.db.federateHolon(holonId.toString(), federationID.toString(), {
                lensConfig: { inbound: [], outbound: [] }
            });

            const federationName = await this.getHolonDisplayName(federationID, ctx);
            console.log("Federation created successfully!");
            ctx.reply(`This chat has been federated with ${federationName}. Use /settings → Federation to configure which lenses to share.`);
        } catch (error) {
            console.error('Federation error:', error);
            ctx.reply('Error creating federation: ' + error.message);
        }
    }

    async separate(ctx) {
        const holonId = ctx.message.chat.id;
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
            // Use HoloSphere2 API to unfederate holons
            console.log(`[separate] Unfederating ${holonId} from ${federationID}`);
            const success = await this.db.unfederateHolon(holonId.toString(), federationID.toString());

            if (success) {
                const federationName = await this.getHolonDisplayName(federationID, ctx);
                ctx.reply('Federation with ' + federationName + ' has been revoked');
            } else {
                ctx.reply('Error removing federation: Federation not found');
            }
        } catch (error) {
            console.error('Unfederation error:', error);
            ctx.reply('Error removing federation: ' + error.message);
        }
    }

    async getFederation(holonId) {
        try {
            // Use holosphere getFederation method
            return await this.db.getFederation(holonId);
        } catch (error) {
            console.error('Get federation error:', error);
            return [];
        }
    }



    async setRoles(ctx) {
        const holonId = ctx.message.chat.id;
        const newRoles = utils.parseList(ctx.message.text);

        if (newRoles === undefined || newRoles === null || newRoles.length === 0) {
            return ('Please specify the roles. Example: /setRoles role1 role2');
        }

        let settings = await this.getSettings(holonId);

        // Initialize roles array if it doesn't exist
        if (!settings.roles) {
            settings.roles = [];
        }

        // Append new roles instead of replacing
        settings.roles.push(...newRoles);

        await this.setSettings(settings);
        return `Added roles: ${newRoles.join(', ')}`;
    }

    async getRoles(holonId) {
        let settings = await this.getSettings(holonId)
        return settings.roles
    }

    async setValues(ctx) {
        if (utils.isAdmin(ctx)) {
            const holonId = ctx.message.chat.id;
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

            let settings = await this.getSettings(holonId);

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

    /**
     * Gets the values array from holon settings.
     * @async
     * @param {string|number} holonId - The holon ID
     * @returns {Promise<string[]>} Array of values
     */
    async getValues(holonId) {
        let settings = await this.getSettings(holonId);
        return settings.values;
    }

    /**
     * Retrieves settings for a holon, using cache when available.
     * Creates default settings if none exist.
     * @async
     * @param {string|number} holonId - The holon ID
     * @returns {Promise<Object>} The holon settings object
     */
    async getSettings(holonId) {
        // Check cache first
        const cached = this._settingsCache.get(holonId);
        if (cached && Date.now() - cached.timestamp < this._cacheTTL) {
            return cached.settings;
        }

        let settings = await this.db.get(holonId + '/settings', holonId)
        if (!settings || settings == '') {
            let holonName = await utils.getChatName(this.bot, holonId)
            settings = this.getDefaultSettings(holonId, holonName)
            await this.db.put(holonId + '/settings', settings)
        } else {
            // Ensure all required fields exist by merging with default settings
            const defaultSettings = this.getDefaultSettings(holonId, settings.name || 'unknown')
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
                // Ensure 'hour' is always included as a default currency
                if (!settings.currencies.includes('hour')) {
                    settings.currencies.push('hour');
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
            // NOTE: Removed auto-save here - it was causing race conditions
            // Settings should only be saved explicitly via setSettings()
        }

        // Cache the result
        this._settingsCache.set(holonId, {
            settings,
            timestamp: Date.now()
        });

        return settings
    }

    /**
     * Saves settings for a holon and invalidates the cache.
     * @async
     * @param {Object} settings - The settings object to save (must have 'id' property)
     * @returns {Promise<void>}
     */
    async setSettings(settings) {
        if (!settings.id) {
            console.error('[setSettings] ERROR: settings.id is missing!');
            return;
        }
        await this.db.put(settings.id + '/settings', settings);

        // Invalidate local cache - delete both numeric and string keys to handle type mismatches
        const holonId = settings.id;
        this._settingsCache.delete(holonId);
        this._settingsCache.delete(Number(holonId));
        this._settingsCache.delete(String(holonId));

        this.db.clearCacheForholonId(holonId);
    }

    async setValueEquation(holonId, equation) {
        let settings = await this.getSettings(holonId)
        settings.valueEquation = equation
        await this.db.put(holonId + '/settings', settings)
    }

    async getValueEquation(holonId) {
        let settings = await this.getSettings(holonId)
        return settings.valueEquation
    }

    async calculateUserScores(users, holonId, expensesInstance) {
        const settings = await this.getSettings(holonId);
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
                // (user.hours * equation.hours || 0) + // COMMENTED OUT FOR TESTING
                (user.collaboration * equation.collaboration || 0) +
                (user.wants && user.wants.length * equation.wants || 0) +
                (user.offers && user.offers.length * equation.offers || 0);

            let currencyScoreContribution = 0;
            console.log(`\n=== CURRENCY CALCULATION FOR USER ${user.id} ===`);
            console.log(`Available currencies: [${currencies.join(', ')}]`);
            console.log(`Equation keys: [${Object.keys(equation).join(', ')}]`);
            
            if (currencies && currencies.length > 0 && expensesInstance) {
                for (const currencyName of currencies) {
                    const currencyKey = currencyName.toLowerCase().replace(/[^a-z0-9_]/g, '');
                    console.log(`\nProcessing currency: ${currencyName} -> ${currencyKey}`);
                    
                    if (currencyKey && equation[currencyKey] !== undefined) {
                        try {
                            const balance = await expensesInstance.getUserCurrencyBalance(holonId, user.id, currencyKey);
                            const weight = equation[currencyKey] || 0;
                            const contribution = balance * weight;
                            currencyScoreContribution += contribution;
                            console.log(`  ✅ Balance: ${balance}, Weight: ${weight}, Contribution: ${contribution}`);
                        } catch (e) {
                            console.error(`❌ Error getting balance for ${currencyKey} for user ${user.id}:`, e);
                        }
                    } else {
                        console.log(`  ⏭️ Skipped - currencyKey: ${currencyKey}, equation[currencyKey]: ${equation[currencyKey]}`);
                    }
                }
            } else {
                console.log(`  ⏭️ No currencies or expenses instance available`);
            }
            
            console.log(`Total currency contribution: ${currencyScoreContribution}`);
            score += currencyScoreContribution;
            userScores.push({ ...user, score });
        }

        return userScores.sort((a, b) => b.score - a.score);
    }

    async whitelisted(ctx) {
        let settings = await settings.getSettings(utils.getholonId(ctx))
        if (settings.whitelisted) return ''
        else return ("This bot is still in development, and this chat is not whitelisted to use this function.")
    }


    // async getSettingsButtons(holonId) {
    //     return [
    //         [{ text: 'Language:'}], [{ text: 'IT', setLanguage(holonId, 'it') }],[{ text: 'EN', setLanguage(ctx, 'en') }]
    //         [{ text: 'Theme' }],
    //         [{ text: 'Level', callback_data: 'level' }],
    //         [{ text: 'Admin', callback_data: 'admin' }],
    //         [{ text: 'Roles', callback_data: 'roles' }]
    //     ]
    // }

    async showSettingsMenu(ctx, edit = false) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        const userId = ctx.callbackQuery?.from?.id || ctx.from?.id;
        const chatType = ctx.callbackQuery?.message?.chat?.type || ctx.chat?.type;
        const isPrivateChat = chatType === 'private';
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
        const language = settings.language;
        const dashboardUrl = `${DASHBOARD_ADDRESS}/${holonId}/?user=${userId}`;
        
        // Fetch federation info for the button
        const fedInfo = await this.db.getFederation(holonId);
        // Combine inbound and outbound arrays to get all federated holons (deduplicated)
        const inbound = fedInfo?.inbound || [];
        const outbound = fedInfo?.outbound || [];
        const federationCount = [...new Set([...inbound, ...outbound])].length;
        
        // Create the message with Holon ID shown at the top
        let holonAddressLine = '';
        let holonNetworkLine = '';
        if (this.holons && typeof this.holons.getSplitterContract === 'function') {
            try {
                const holonIdNormalized = `chat_${Math.abs(holonId)}`;
                const splitterContract = await this.holons.getSplitterContract(holonIdNormalized);
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
        const menuText = `${i18next.t('settings', { lng: language })}\n ${i18next.t('holon_id', { lng: language, defaultValue: 'Holon ID' })}: ${holonId}${holonAddressLine}${holonNetworkLine}`;

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
                    // 9. Dashboard (full width) - web_app only works in private chats, use URL for groups
                    [
                        isPrivateChat
                            ? { text: `🔍 ${i18next.t('dashboard', { lng: language, defaultValue: 'Holonic Dashboard' })}`, web_app: { url: dashboardUrl } }
                            : { text: `🔍 ${i18next.t('dashboard', { lng: language, defaultValue: 'Holonic Dashboard' })}`, url: dashboardUrl }
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
            // Ignore "message is not modified" errors - this is expected when state hasn't changed
            if (!e.description || !e.description.includes('message is not modified')) {
                console.log('Error showing settings menu:', e);
            }
        }
    }

    async getLanguageKeyboard(holonId) {
        let settings = await this.getSettings(holonId);
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

    async getThemeKeyboard(holonId) {
        let settings = await this.getSettings(holonId);
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

    async getLevelKeyboard(holonId) {
        let settings = await this.getSettings(holonId);
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

    async getTimezoneKeyboard(holonId, region = null) {
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

        let settings = await this.getSettings(holonId);
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

    async getTimezone(holonId) {
        let settings = await this.getSettings(holonId);
        return settings.timezone || 'UTC';
    }

    // Add method to show array setting menu
    async showArraySettingMenu(ctx, type, removeMode = false) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
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
        const holonId = ctx.message.chat.id;
        const text = ctx.message.text.replace('/setpurpose', '').trim();
        const language = await this.getLanguage(holonId);

        if (!text) {
            ctx.reply(i18next.t('settings_specify_purpose', { lng: language }));
            return;
        }

        let settings = await this.getSettings(holonId);
        settings.purpose = text;
        await this.setSettings(settings);
        await ctx.reply(i18next.t('settings_purpose_set', { lng: language, value: text }));
        await this.showArraySettingMenu(ctx, 'purpose', false);
    }

    async getAdminKeyboard(holonId) {
        let settings = await this.getSettings(holonId);
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

    async getHexKeyboard(holonId) {
        let settings = await this.getSettings(holonId);
        const language = settings.language;
        const hex = await this.getHex({ chat: { id: holonId } });
        return {
            inline_keyboard: [
                [{ text: `${this.getSettingIcon('hex')} ${i18next.t('settings_hex', { lng: language })}`, callback_data: ' ' }],
                [{ text: i18next.t('settings_current', { lng: language, value: hex || i18next.t('settings_not_set', { lng: language }) }), callback_data: ' ' }],
                [{ text: i18next.t('settings_back', { lng: language }), callback_data: 'settings_back' }]
            ]
        };
    }

    async showAdminSelectionMenu(ctx, edit = false) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
        const language = settings.language;
        const currentAdmin = settings.admin || '';

        // Get all users from the chat
        let users = [];
        try {
            users = await this.db.getAll(holonId + '/users');
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
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
        const language = settings.language;

        // Get federation info
        const fedInfo = await this.db.getFederation(holonId);
        const federatedHolons = fedInfo && fedInfo.federated ? fedInfo.federated : [];
        const inboundHolons = fedInfo && fedInfo.inbound ? fedInfo.inbound : [];
        const outboundHolons = fedInfo && fedInfo.outbound ? fedInfo.outbound : [];

        // Combine federated, inbound and outbound for unified list
        // federated array contains all partners, inbound/outbound indicate active lens directions
        const allFederatedHolons = new Set([...federatedHolons, ...inboundHolons, ...outboundHolons]);

        const keyboard = {
            inline_keyboard: []
        };

        // Add header
        keyboard.inline_keyboard.push([{
            text: `${this.getSettingIcon('federation')} ${i18next.t('settings_federation', { lng: language })}`,
            callback_data: ' '
        }]);

        // Add unified federated holons list
        if (allFederatedHolons.size > 0) {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_federated_holons', { lng: language, defaultValue: '🔗 Federated Holons' }),
                callback_data: ' '
            }]);

            for (const space of allFederatedHolons) {
                const holonName = await this.getHolonDisplayName(space, ctx);

                // Show indicators for connection type
                let indicators = '';
                const hasInbound = inboundHolons.includes(space);
                const hasOutbound = outboundHolons.includes(space);

                if (hasInbound && hasOutbound) {
                    indicators = '↔️ ';
                } else if (hasOutbound) {
                    indicators = '📤 ';
                } else if (hasInbound) {
                    indicators = '📥 ';
                }

                keyboard.inline_keyboard.push([{
                    text: `${indicators}${holonName}`,
                    callback_data: `federation_config_${space}`
                }, {
                    text: '❌',
                    callback_data: `unfederate_${space}`
                }]);
            }
        } else {
            keyboard.inline_keyboard.push([{
                text: i18next.t('settings_no_federation', { lng: language, defaultValue: 'No federated holons' }),
                callback_data: ' '
            }]);
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
            // Silently ignore "message not modified" errors - this is expected when menu content hasn't changed
            if (!e.response?.description?.includes('message is not modified')) {
                console.log('Error showing federation menu:', e);
            }
        }
    }

    // Add users management menu method
    async showUsersManagementMenu(ctx, edit = false, removeMode = false) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
        const language = settings.language;

        // Get all users from the chat
        let users = [];
        try {
            // Use the Users class functionality to get chat users
            users = await this.db.getAll(holonId + '/users');
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
        const holonId = ctx.callbackQuery.message.chat.id;
        let settings = await this.getSettings(holonId);
        const language = settings.language;

        // Get user details
        let user = null;
        try {
            const users = await this.db.getAll(holonId + '/users');
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
        const holonId = ctx.chat.id;
        const language = await this.getLanguage(holonId);
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
                    user = await this.findUserInDatabase(holonId, username);

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
                    await this.addUserToDatabase(holonId, user);
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
    async findUserInDatabase(holonId, username) {
        try {
            const users = await this.db.getAll(holonId + '/users');
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
        const holonId = ctx.chat.id;
        const language = await this.getLanguage(holonId);
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
                        await this.addUserToDatabase(holonId, user);
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
    async addUserToDatabase(holonId, user) {
        // Get current users
        let users = await this.db.getAll(holonId + '/users');

        // Check if user already exists
        const existingUser = users.find(u => u.id && u.id.toString() === user.id.toString());
        if (existingUser) {
            return false; // (`User with ID ${user.id} already exists.`);
        }

        await this.db.put(holonId + '/users', user);


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
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID');
            return;
        }

        let settings = await this.getSettings(holonId);
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
    /**
     * Show federation lens configuration menu for a specific holon
     * Displays all lenses with inbound and outbound checkboxes on each line
     * @param {object} cachedLensConfig - Optional cached lens config to avoid DB read (for optimistic updates)
     */
    async showFederationLensConfig(ctx, targetholonId, edit = false, cachedLensConfig = null) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID for federation lens config');
            return;
        }

        const language = await this.getLanguage(holonId);
        const targetHolonName = await this.getHolonDisplayName(targetholonId, ctx);
        const title = i18next.t('settings_federation_lens_config', {
            lng: language,
            targetholonId: targetHolonName,
            defaultValue: `🔗 Federation with ${targetHolonName}`
        });

        // Define these upfront for use throughout the function
        const holonIdStr = holonId.toString();
        const targetholonIdStr = targetholonId.toString();

        // Get the current lens configuration (use cached if provided for optimistic updates)
        let lensConfig;
        if (cachedLensConfig) {
            lensConfig = cachedLensConfig;
        } else {
            lensConfig = await this.db.getFederatedConfig(holonIdStr, targetholonIdStr);
        }

        const outboundLenses = lensConfig && lensConfig.outbound ? lensConfig.outbound : [];
        const inboundLenses = lensConfig && lensConfig.inbound ? lensConfig.inbound : [];

        const keyboard = {
            inline_keyboard: []
        };

        // Add header row
        keyboard.inline_keyboard.push([
            { text: 'Lens', callback_data: ' ' },
            { text: '📤 Out', callback_data: ' ' },
            { text: '📥 In', callback_data: ' ' }
        ]);

        // Add each lens with its inbound/outbound checkboxes
        for (const lensName of ALL_AVAILABLE_LENSES) {
            const hasOutbound = outboundLenses.includes(lensName);
            const hasInbound = inboundLenses.includes(lensName);

            keyboard.inline_keyboard.push([
                {
                    text: lensName,
                    callback_data: ' '
                },
                {
                    text: hasOutbound ? '✅' : '🔘',
                    callback_data: `toggle_lens_direction_${targetholonIdStr}_outbound_${lensName}`
                },
                {
                    text: hasInbound ? '✅' : '🔘',
                    callback_data: `toggle_lens_direction_${targetholonIdStr}_inbound_${lensName}`
                }
            ]);
        }

        // Add back button to federation menu
        keyboard.inline_keyboard.push([{
            text: i18next.t('settings_back_to_federation', { lng: language, defaultValue: '⬅️ Back to Federation' }),
            callback_data: 'settings_federation'
        }]);

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
            // Ignore "message is not modified" errors - this is expected when state hasn't changed
            if (!e.description || !e.description.includes('message is not modified')) {
                console.log('Error showing federation lens config:', e);
            }
        }
    }

    async showSharedLensesMenu(ctx, targetholonId, relationshipType, edit = false, currentLensesConfig = null) {
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        if (!holonId) {
            console.error('Could not determine holon ID for shared lenses menu');
            return;
        }

        const language = await this.getLanguage(holonId);
        let title = '';
        const targetHolonName = await this.getHolonDisplayName(targetholonId, ctx);

        // Support both old and new terminology
        if (relationshipType === 'outbound' || relationshipType === 'federated') {
            title = i18next.t('settings_lenses_outbound_to', { lng: language, targetholonId: targetHolonName, defaultValue: `Outbound Lenses to ${targetHolonName}` });
        } else if (relationshipType === 'inbound' || relationshipType === 'notifies') {
            title = i18next.t('settings_lenses_inbound_from', { lng: language, targetholonId: targetHolonName, defaultValue: `Inbound Lenses from ${targetHolonName}` });
        }

        let lensesConfig = currentLensesConfig;
        if (!lensesConfig) {
            // --- Placeholder for Lenses Data Fetching & Initialization ---
            // TODO: Replace this with actual logic to fetch shared lenses configuration (name, enabled state)
            // for the targetholonId from db.holosphere or a similar source.
            // If no configuration exists, initialize it (e.g., all enabled by default) and persist it.
            // const EXAMPLE_LENS_NAMES = ['Quests', 'Offers', 'Tags', 'Expenses', 'Announcements', 'Users', 'Shopping', 'Recurring'];
            // lensesConfig = EXAMPLE_LENS_NAMES.map(name => ({ name: name, enabled: true }));
            lensesConfig = await this.getLensesConfigForUI(holonId, targetholonId, relationshipType);
            // Example: 
            // lensesConfig = await this.db.holosphere.getSharedLensesConfig(holonId, targetholonId, relationshipType);
            // if (!lensesConfig || lensesConfig.length === 0) { 
            //     lensesConfig = EXAMPLE_LENS_NAMES.map(name => ({ name: name, enabled: true }));
            //     // await this.db.holosphere.setSharedLensesConfig(holonId, targetholonId, relationshipType, lensesConfig); // Persist initial
            // }
            // --- End Placeholder ---
        }

        const keyboard = await this.getSharedLensesKeyboard(holonId, targetholonId, relationshipType, lensesConfig);

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
            // Ignore "message is not modified" errors - this is expected when state hasn't changed
            if (!e.description || !e.description.includes('message is not modified')) {
                console.log('Error showing shared lenses menu:', e);
            }
            // Fallback reply if edit fails
            await ctx.reply(title, {
                reply_markup: keyboard
            }).catch(err => console.log('Fallback reply error in showSharedLensesMenu:', err));
        }
    }

    async getSharedLensesKeyboard(holonId, targetholonId, relationshipType, lensesConfig) {
        const language = await this.getLanguage(holonId);
        const keyboard = {
            inline_keyboard: []
        };

        // Add lenses in 2 columns
        for (let i = 0; i < lensesConfig.length; i += 2) {
            const row = [];
            const lens1 = lensesConfig[i];
            row.push({
                text: `${lens1.enabled ? '✅' : '🔘'} ${lens1.name}`,
                callback_data: `toggle_lens_${targetholonId}_${relationshipType}_${lens1.name}`
            });
            if (i + 1 < lensesConfig.length) {
                const lens2 = lensesConfig[i+1];
                row.push({
                    text: `${lens2.enabled ? '✅' : '🔘'} ${lens2.name}`,
                    callback_data: `toggle_lens_${targetholonId}_${relationshipType}_${lens2.name}`
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

    async getLensesConfigForUI(holonId, targetholonId, relationshipType) {
        const persistedLinkConfig = await this.db.getFederatedConfig(holonId, targetholonId);
        let activeLensesForType = [];

        if (persistedLinkConfig) {
            // Support both old and new terminology
            if ((relationshipType === 'outbound' || relationshipType === 'federated') && persistedLinkConfig.federate) {
                activeLensesForType = persistedLinkConfig.federate;
            } else if ((relationshipType === 'inbound' || relationshipType === 'notifies') && persistedLinkConfig.notify) {
                activeLensesForType = persistedLinkConfig.notify;
            }
        }
        
        return ALL_AVAILABLE_LENSES.map(name => ({
            name: name,
            enabled: activeLensesForType.includes(name)
        }));
    }

    async showHolacracyMenu(ctx, edit = false) {
        const holonId = utils.getholonId(ctx);
        if (!holonId) {
            console.error('Could not determine holon ID for Holacracy menu');
            return;
        }

        let settings = await this.getSettings(holonId);
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
        const holonId = ctx.callbackQuery?.message?.chat?.id || ctx.chat?.id;
        let settings = await this.getSettings(holonId);
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
                const holonName = await utils.getChatName(ctx, holonId.toString());
                if (holonName && holonName !== 'unknown' && holonName !== null && holonName.trim() !== '') {
                    return holonName;
                }
            } catch (error) {
                // Chat name not available, continue to fallback
            }
        }

        // Final fallback: show the ID itself
        return holonId.toString();
    }
}