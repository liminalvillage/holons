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
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                // Delete the user's input message
                await ctx.deleteMessage(ctx.message.message_id);
                // Delete the scene's prompt message
                await ctx.deleteMessage(ctx.message.message_id - 1);
                // Delete the original settings message
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show purpose submenu
            await ctx.reply('Purpose Settings', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Current: ${settings.purpose || 'Not set'}`, callback_data: ' ' }],
                        [{ text: '✏️ Change', callback_data: 'settings_purpose_change' }],
                        [{ text: '« Back', callback_data: 'settings_back' }]
                    ]
                }
            }).catch(e => console.log('Error showing purpose menu:', e));
        });
        this.purposeScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in purpose scene message:', e)));

        this.domainsScene = new Scenes.BaseScene('domains_scene');
        this.domainsScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentDomains = settings.domains && settings.domains.length > 0 ? 
                '• ' + settings.domains.join('\n• ') : 
                i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: '\n' + currentDomains }) + '\n\n' + 
                           i18next.t('settings_send_new', { type: i18next.t('settings_domains').toLowerCase() }))
                .catch(e => console.log('Error in domains scene enter:', e));
        });
        this.domainsScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const domains = ctx.message.text
                .split(/[,\n]/)
                .map(d => d.trim())
                .filter(d => d !== '');
            let settings = await this.getSettings(chatID);
            settings.domains = domains;
            await this.setSettings(settings);
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
                await ctx.deleteMessage(ctx.message.message_id - 1);
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show domains submenu
            const keyboard = [
                [{ text: 'Current Domains:', callback_data: ' ' }]
            ];
            
            domains.forEach(domain => {
                keyboard.push([{ text: `• ${domain}`, callback_data: `domain_${domain}` }]);
            });
            
            if (domains.length === 0) {
                keyboard.push([{ text: 'No domains set', callback_data: ' ' }]);
            }
            
            keyboard.push([{ text: '✏️ Change', callback_data: 'settings_domains_change' }]);
            keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
            
            await ctx.reply('Domains Settings', {
                reply_markup: { inline_keyboard: keyboard }
            }).catch(e => console.log('Error showing domains menu:', e));
        });
        this.domainsScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in domains scene message:', e)));

        this.valuesScene = new Scenes.BaseScene('values_scene');
        this.valuesScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentValues = settings.values && settings.values.length > 0 ? 
                '• ' + settings.values.join('\n• ') : 
                i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: '\n' + currentValues }) + '\n\n' + 
                           i18next.t('settings_send_new', { type: i18next.t('settings_values').toLowerCase() }))
                .catch(e => console.log('Error in values scene enter:', e));
        });
        this.valuesScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const values = ctx.message.text
                .split(/[,\n]/)
                .map(v => v.trim())
                .filter(v => v !== '');
            let settings = await this.getSettings(chatID);
            settings.values = values;
            await this.setSettings(settings);
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
                await ctx.deleteMessage(ctx.message.message_id - 1);
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show values submenu
            const keyboard = [
                [{ text: 'Current Values:', callback_data: ' ' }]
            ];
            
            values.forEach(value => {
                keyboard.push([{ text: `• ${value}`, callback_data: `value_${value}` }]);
            });
            
            if (values.length === 0) {
                keyboard.push([{ text: 'No values set', callback_data: ' ' }]);
            }
            
            keyboard.push([{ text: '✏️ Change', callback_data: 'settings_values_change' }]);
            keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
            
            await ctx.reply('Values Settings', {
                reply_markup: { inline_keyboard: keyboard }
            }).catch(e => console.log('Error showing values menu:', e));
        });
        this.valuesScene.on('message', ctx => ctx.reply('Please send text only'));

        this.rolesScene = new Scenes.BaseScene('roles_scene');
        this.rolesScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentRoles = settings.roles && settings.roles.length > 0 ? 
                '• ' + settings.roles.join('\n• ') : 
                i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: '\n' + currentRoles }) + '\n\n' + 
                           i18next.t('settings_send_new', { type: i18next.t('settings_roles').toLowerCase() }))
                .catch(e => console.log('Error in roles scene enter:', e));
        });
        this.rolesScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const roles = ctx.message.text
                .split(/[,\n]/)
                .map(r => r.trim())
                .filter(r => r !== '');
            let settings = await this.getSettings(chatID);
            settings.roles = roles;
            await this.setSettings(settings);
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
                await ctx.deleteMessage(ctx.message.message_id - 1);
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show roles submenu
            const keyboard = [
                [{ text: 'Current Roles:', callback_data: ' ' }]
            ];
            
            roles.forEach(role => {
                keyboard.push([{ text: `• ${role}`, callback_data: `role_${role}` }]);
            });
            
            if (roles.length === 0) {
                keyboard.push([{ text: 'No roles set', callback_data: ' ' }]);
            }
            
            keyboard.push([{ text: '✏️ Change', callback_data: 'settings_roles_change' }]);
            keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
            
            await ctx.reply('Roles Settings', {
                reply_markup: { inline_keyboard: keyboard }
            }).catch(e => console.log('Error showing roles menu:', e));
        });
        this.rolesScene.on('message', ctx => ctx.reply('Please send text only'));

        this.adminScene = new Scenes.BaseScene('admin_scene');
        this.adminScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentAdmin = settings.admin || i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: currentAdmin }) + '\n\n' + 
                           i18next.t('settings_send_new', { type: i18next.t('settings_admin').toLowerCase() }))
                .catch(e => console.log('Error in admin scene enter:', e));
        });
        this.adminScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const admin = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            settings.admin = admin;
            await this.setSettings(settings);
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
                await ctx.deleteMessage(ctx.message.message_id - 1);
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show admin submenu
            await ctx.reply('Admin Settings', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Current: ${admin || 'Not set'}`, callback_data: ' ' }],
                        [{ text: '✏️ Change', callback_data: 'settings_admin_change' }],
                        [{ text: '« Back', callback_data: 'settings_back' }]
                    ]
                }
            }).catch(e => console.log('Error showing admin menu:', e));
        });
        this.adminScene.on('message', ctx => ctx.reply('Please send text only'));

        this.hexScene = new Scenes.BaseScene('hex_scene');
        this.hexScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentHex = settings.hex || i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: currentHex }) + '\n\n' + 
                           i18next.t('settings_send_new', { type: i18next.t('settings_hex').toLowerCase() }))
                .catch(e => console.log('Error in hex scene enter:', e));
        });
        this.hexScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const hex = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            settings.hex = hex;
            await this.setSettings(settings);
            await ctx.scene.leave();
            
            // Delete the scene messages
            try {
                await ctx.deleteMessage(ctx.message.message_id);
                await ctx.deleteMessage(ctx.message.message_id - 1);
                await ctx.deleteMessage(ctx.message.message_id - 2);
            } catch (e) {
                console.log('Error deleting messages:', e);
            }
            
            // Show hex submenu
            await ctx.reply('Hex Settings', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Current: ${hex || 'Not set'}`, callback_data: ' ' }],
                        [{ text: '✏️ Change', callback_data: 'settings_hex_change' }],
                        [{ text: '« Back', callback_data: 'settings_back' }]
                    ]
                }
            }).catch(e => console.log('Error showing hex menu:', e));
        });
        this.hexScene.on('message', ctx => ctx.reply('Please send text only'));

        // Register scenes
        this.bot.stage.register(this.purposeScene);
        this.bot.stage.register(this.domainsScene);
        this.bot.stage.register(this.valuesScene);
        this.bot.stage.register(this.rolesScene);
        this.bot.stage.register(this.adminScene);
        this.bot.stage.register(this.hexScene);
      

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
                ctx.reply('Bot resetted')
            } else {
                ctx.reply('Only a chat admin can perform this action')
            }
        })

        this.bot.command('id', async (ctx) => {
            ctx.reply('This holon ID is ' + utils.getChatId(ctx))
        })

        this.bot.command(['federate', 'spoon'], async (ctx) => {
            if (utils.isAdmin(ctx)) this.federate(ctx)
            else ctx.reply('Only a chat admin can perform this action')
        }
        )

        this.bot.command('federation', async (ctx) => {

            await this.getFederation(ctx)

        }
        )

        this.bot.command(['separate', 'fork', 'spork'], async (ctx) => {
            if (utils.isAdmin(ctx)) await this.separate(ctx)
            else ctx.reply('Only a chat admin can perform this action')
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

        this.bot.command('getvalues', async (ctx) => {
            let settings = await this.getSettings(utils.getChatId(ctx));
            ctx.reply('Current values:\n• ' + settings.values.join('\n• '));
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
                const domains = text
                    .split(/[,\n]/)                    // Split by comma or newline
                    .map(d => d.trim())                // Trim whitespace
                    .filter(d => d !== '');            // Remove empty entries

                let settings = await this.getSettings(chatID);
                settings.domains = domains;
                await this.setSettings(settings);
                ctx.reply('Domains set to:\n• ' + settings.domains.join('\n• '));
            } else {
                ctx.reply('Only admins can set the domains');
            }
        });

        // Handle timezone region selection
        this.bot.action(/timezone_region_(.+)/, async (ctx) => {
            const region = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            await ctx.editMessageText('Select timezone:', {
                reply_markup: await this.getTimezoneKeyboard(chatID, region)
            }).catch(e => console.log('Error in timezone region selection:', e));
        });

        // Handle timezone selection
        this.bot.action(/timezone_set_(.+)/, async (ctx) => {
            const timezone = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.timezone = timezone;
            await this.setSettings(settings);
            await ctx.editMessageText('Timezone set to: ' + timezone.split('/')[1].replace('_', ' '), {
                reply_markup: await this.getTimezoneKeyboard(chatID)
            }).catch(e => console.log('Error in timezone setting:', e));
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
            const action = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            
            switch(action) {
                case 'language':
                    await ctx.editMessageText('Select language:', {
                        reply_markup: await this.getLanguageKeyboard(chatID)
                    }).catch(e => console.log('Error in language menu:', e));
                    break;
                case 'theme':
                    await ctx.editMessageText('Select theme:', {
                        reply_markup: await this.getThemeKeyboard(chatID)
                    }).catch(e => console.log('Error in theme menu:', e));
                    break;
                case 'level':
                    await ctx.editMessageText('Select level:', {
                        reply_markup: await this.getLevelKeyboard(chatID)
                    }).catch(e => console.log('Error in level menu:', e));
                    break;
                case 'admin':
                    if (utils.isAdmin(ctx)) {
                        const currentAdmin = settings.admin || 'Not set';
                        await ctx.editMessageText('Admin Settings', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: `Current: ${currentAdmin}`, callback_data: ' ' }],
                                    [{ text: '✏️ Change', callback_data: 'settings_admin_change' }],
                                    [{ text: '« Back', callback_data: 'settings_back' }]
                                ]
                            }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'admin_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('admin_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'roles':
                    if (utils.isAdmin(ctx)) {
                        const currentRoles = settings.roles || [];
                        const keyboard = [
                            [{ text: 'Current Roles:', callback_data: ' ' }]
                        ];
                        
                        // Add each role as a button
                        currentRoles.forEach(role => {
                            keyboard.push([{ text: `• ${role}`, callback_data: `role_${role}` }]);
                        });
                        
                        if (currentRoles.length === 0) {
                            keyboard.push([{ text: 'No roles set', callback_data: ' ' }]);
                        }
                        
                        keyboard.push([{ text: '✏️ Change', callback_data: 'settings_roles_change' }]);
                        keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
                        
                        await ctx.editMessageText('Roles Settings', {
                            reply_markup: { inline_keyboard: keyboard }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'roles_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('roles_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'values':
                    if (utils.isAdmin(ctx)) {
                        const currentValues = settings.values || [];
                        const keyboard = [
                            [{ text: 'Current Values:', callback_data: ' ' }]
                        ];
                        
                        // Add each value as a button
                        currentValues.forEach(value => {
                            keyboard.push([{ text: `• ${value}`, callback_data: `value_${value}` }]);
                        });
                        
                        if (currentValues.length === 0) {
                            keyboard.push([{ text: 'No values set', callback_data: ' ' }]);
                        }
                        
                        keyboard.push([{ text: '✏️ Change', callback_data: 'settings_values_change' }]);
                        keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
                        
                        await ctx.editMessageText('Values Settings', {
                            reply_markup: { inline_keyboard: keyboard }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'values_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('values_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'hex':
                    if (utils.isAdmin(ctx)) {
                        const currentHex = settings.hex || 'Not set';
                        await ctx.editMessageText('Hex Settings', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: `Current: ${currentHex}`, callback_data: ' ' }],
                                    [{ text: '✏️ Change', callback_data: 'settings_hex_change' }],
                                    [{ text: '« Back', callback_data: 'settings_back' }]
                                ]
                            }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'hex_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('hex_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'purpose':
                    if (utils.isAdmin(ctx)) {
                        const currentPurpose = settings.purpose || 'Not set';
                        await ctx.editMessageText('Purpose Settings', {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: `Current: ${currentPurpose}`, callback_data: ' ' }],
                                    [{ text: '✏️ Change', callback_data: 'settings_purpose_change' }],
                                    [{ text: '« Back', callback_data: 'settings_back' }]
                                ]
                            }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'purpose_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('purpose_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'domains':
                    if (utils.isAdmin(ctx)) {
                        const currentDomains = settings.domains || [];
                        const keyboard = [
                            [{ text: 'Current Domains:', callback_data: ' ' }]
                        ];
                        
                        // Add each domain as a button
                        currentDomains.forEach(domain => {
                            keyboard.push([{ text: `• ${domain}`, callback_data: `domain_${domain}` }]);
                        });
                        
                        if (currentDomains.length === 0) {
                            keyboard.push([{ text: 'No domains set', callback_data: ' ' }]);
                        }
                        
                        keyboard.push([{ text: '✏️ Change', callback_data: 'settings_domains_change' }]);
                        keyboard.push([{ text: '« Back', callback_data: 'settings_back' }]);
                        
                        await ctx.editMessageText('Domains Settings', {
                            reply_markup: { inline_keyboard: keyboard }
                        });
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'domains_change':
                    if (utils.isAdmin(ctx)) {
                        await ctx.scene.enter('domains_scene');
                    } else {
                        ctx.reply('Only a chat admin can perform this action');
                    }
                    break;
                case 'timezone':
                    await ctx.editMessageText('Select region:', {
                        reply_markup: await this.getTimezoneKeyboard(chatID)
                    }).catch(e => console.log('Error in timezone menu:', e));
                    break;
                case 'equation':
                    let weights = await this.getValueEquation(chatID);
                    await ctx.editMessageText('Value Equation:', {
                        reply_markup: this.equationInlineKeyboard(weights)
                    });
                    break;
                case 'back':
                    await this.showSettingsMenu(ctx, true);
                    break;
                case 'help':
                    await ctx.reply(
                        "🌟 Welcome to Holons Bot! 🌟\n\n" +
                        "A Holon is a self-organizing entity that is both a whole and a part of a larger whole. This bot helps manage your Holon community by:\n\n" +
                        "�� Purpose & Values:\n" +
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
            const language = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;
            let settings = await this.getSettings(chatID);
            
            if (['en', 'it', 'es', 'fr'].includes(language)) {
                settings.language = language;
                await this.setSettings(settings);
                
                // Change i18next language
                await i18next.changeLanguage(language);
                
                // Update the settings menu with new translations
                await this.showSettingsMenu(ctx, true)
                    .catch(e => console.log('Error updating settings menu after language change:', e));
            }
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
        const keyboard = [
            [{ text: 'Current Value Equation Weights:', callback_data: ' ' }],
            [{ text: '✏️ Change', callback_data: 'settings_equation_change' }],
            [
                { text: 'Initiated:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_initiated' },
                { text: weights.initiated.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_initiated' }
            ],
            [
                { text: 'Completed:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_completed' },
                { text: weights.completed.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_completed' }
            ],
            [
                { text: 'Sent:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_sent' },
                { text: weights.sent.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_sent' }
            ],
            [
                { text: 'Received:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_received' },
                { text: weights.received.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_received' }
            ],
            [
                { text: 'Hours:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_hours' },
                { text: weights.hours.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_hours' }
            ],
            [
                { text: 'Money:', callback_data: 'null' },
                { text: '<', callback_data: 'decrement_money' },
                { text: weights.money.toString(), callback_data: 'null' },
                { text: '>', callback_data: 'increment_money' }
            ],
            [{ text: '« Back', callback_data: 'settings_back' }]
        ];
        return { inline_keyboard: keyboard };
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

    async getLevel(chatID) {
        let settings = await this.getSettings(chatID)
        return settings.level
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

    async getAdmin(chatID) {
        let settings = await this.getSettings(chatID)
        return settings.admin
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
        const chatID = ctx.message.chat.id;
        const federationID = ctx.message.text.split(' ')[1];

        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify the ID you would like to federate with. Example: /federate 123456. This chat ID is ' + chatID)
            return
        }

        // Save federation info into the chat database
        let fedinfo = await this.db.get('federation', chatID)

        if (fedinfo && fedinfo.federation) {

            if (fedinfo.federation.includes(federationID)) {
                ctx.reply('This chat is already federated with ' + federationID)
                return
            } else {
                fedinfo.federation.push(federationID.toString())
                this.db.put('federation', fedinfo)
            }
        } else {
            this.db.put('federation', {
                id: chatID,
                name: ctx.message.chat.title,
                federation: [federationID.toString()],
                notify: []
            })
        }
        // save who needs to be notified in the federation database
        fedinfo = await this.db.get(federationID.toString())[0]
        if (fedinfo) {
            if (fedinfo.notify.includes(chatID)) {
                ctx.reply('This chat is already federated with ' + federationID)
                return
            } else {
                fedinfo.notify.push(chatID)
                this.db.put('federation', fedinfo)
            }
        } else {
            this.db.put('federation', {
                id: federationID.toString(),
                name: await utils.getChatName(ctx, federationID),
                federation: [],
                notify: [chatID]
            })
        }


        // //federate one way
        // let settings =  await this.getSettings(chatID)
        // settings.federation.push(federationID)
        // this.this.db.put(settings)
        //federate the other way
        // let settings =  await this.getSettings(federationID)
        // settings.federation.push(chatID)
        // this.this.db.put(settings)

        ctx.reply('This chat has been federated with ' + federationID)
        return
    }

    // get the federation list from the database
    async separate(ctx) {
        const chatID = ctx.message.chat.id;
        const federationID = ctx.message.text.split(' ')[1];
        if (federationID === undefined || federationID === null) {
            ctx.reply('Please specify who you would like to revoke the federation with. Example: /separate 123456.')
            return
        }
        // Save federation info into the chat database
        let fedinfo = await this.db.get('federation', chatID)
        if (!fedinfo || !fedinfo.federation) {
            ctx.reply('You are not federated with ' + federationID)
            return
        }
        //TODO REMOVE NOTIFY

        //TODO REMOVE FEDERATION


        // let settings =  await this.getSettings(federationID)
        // let newfederation = settings.federation.filter(item => item !== chatID)
        // if (newfederation.length === settings.federation.length) {
        //     ctx.reply('You are not federated with ' + federationID)
        //     return
        // }
        // await this.this.db.put(settings)


        ctx.reply('Federation with ' + federationID + ' has been revoked')
        return
    }

    async getFederation(chatID) {
        let federation = await this.db.get('federation', chatID)
        if (!federation || federation == []) {
            return []
        }
        else
            //federation = federation.filter(item => item.id === chatID)[0]
            //console.log('This chat is federated with: ' + federation.federation + ' and will notify: ' + federation.notify)
            return federation.federation
    }

    async setRoles(ctx) {
        const chatID = ctx.message.chat.id;
        const roles = utils.parseList(ctx.message.text)

        if (roles === undefined || roles === null || roles === '') {
            return ('Please specify the roles. Example: /setRoles role1 role2')
        }
        let settings = await this.getSettings(chatID)
        settings.roles = roles
        this.db.put(chatID + '/settings', settings)
        return settings.roles
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
            const values = text
                .split(/[,\n]/)                    // Split by comma or newline
                .map(v => v.trim())                // Trim whitespace
                .filter(v => v !== '');            // Remove empty entries

            let settings = await this.getSettings(chatID);
            settings.values = values;
            await this.setSettings(settings);
            ctx.reply('Values set to:\n• ' + settings.values.join('\n• ')).catch(e => console.log('Error in setValues reply:', e));
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
        const chatID = ctx.chat?.id || ctx.callbackQuery.message.chat.id;
        let settings = await this.getSettings(chatID);
        
        const menuMarkup = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: i18next.t('settings_language') + ': ' + settings.language, callback_data: 'settings_language' },
                        { text: i18next.t('settings_theme') + ': ' + settings.theme, callback_data: 'settings_theme' }
                    ],
                    [
                        { text: i18next.t('settings_level') + ': ' + settings.level, callback_data: 'settings_level' },
                        { text: i18next.t('settings_timezone') + ': ' + (settings.timezone ? settings.timezone.split('/')[1].replace('_', ' ') : i18next.t('settings_not_set')), callback_data: 'settings_timezone' }
                    ],
                    [
                        { text: i18next.t('settings_admin') + ': ' + (settings.admin || i18next.t('settings_not_set')), callback_data: 'settings_admin' },
                        { text: i18next.t('settings_purpose') + ': ' + (settings.purpose ? '✓' : i18next.t('settings_not_set')), callback_data: 'settings_purpose' }
                    ],
                    [
                        { text: i18next.t('settings_domains') + ': ' + (settings.domains?.length || 0), callback_data: 'settings_domains' },
                        { text: i18next.t('settings_roles') + ': ' + (settings.roles?.length || 0), callback_data: 'settings_roles' }
                    ],
                    [
                        { text: i18next.t('settings_values') + ': ' + (settings.values?.length || 0), callback_data: 'settings_values' },
                        { text: i18next.t('settings_hex') + ': ' + (settings.hex || i18next.t('settings_not_set')), callback_data: 'settings_hex' }
                    ],
                    [
                        { text: i18next.t('settings_equation'), callback_data: 'settings_equation' }
                    ],
                    [
                        { text: i18next.t('settings_help'), callback_data: 'settings_help' },
                        { text: i18next.t('settings_support'), url: 'https://t.me/RobertoValenti' }
                    ]
                ]
            }
        };

        if (edit) {
            return ctx.editMessageText(i18next.t('settings'), menuMarkup)
                .catch(e => console.log('Error editing settings menu:', e));
        } else {
            return ctx.reply(i18next.t('settings'), menuMarkup)
                .catch(e => console.log('Error showing settings menu:', e));
        }
    }

    async getLanguageKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        return {
            inline_keyboard: [
                [{ text: i18next.t('settings_current', { value: settings.language }), callback_data: ' ' }],
                [{ text: i18next.t('settings_change'), callback_data: 'settings_language_select' }],
                [
                    { text: '🇬🇧 English', callback_data: 'language_en' },
                    { text: '🇮🇹 Italian', callback_data: 'language_it' }
                ],
                [
                    { text: '🇪🇸 Spanish', callback_data: 'language_es' },
                    { text: '🇫🇷 French', callback_data: 'language_fr' }
                ],
                [{ text: i18next.t('settings_back'), callback_data: 'settings_back' }]
            ]
        };
    }

    async getThemeKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        return {
            inline_keyboard: [
                [{ text: i18next.t('settings_current', { value: settings.theme }), callback_data: ' ' }],
                [{ text: i18next.t('settings_change'), callback_data: 'settings_theme_select' }],
                [
                    { text: i18next.t('settings_theme_light'), callback_data: 'theme_light' },
                    { text: i18next.t('settings_theme_dark'), callback_data: 'theme_dark' }
                ],
                [{ text: i18next.t('settings_back'), callback_data: 'settings_back' }]
            ]
        };
    }

    async getLevelKeyboard(chatID) {
        let settings = await this.getSettings(chatID);
        return {
            inline_keyboard: [
                [{ text: i18next.t('settings_current', { value: 'Level ' + settings.level }), callback_data: ' ' }],
                [{ text: i18next.t('settings_change'), callback_data: 'settings_level_select' }],
                [
                    { text: i18next.t('settings_level_1'), callback_data: 'level_1' },
                    { text: i18next.t('settings_level_2'), callback_data: 'level_2' },
                    { text: i18next.t('settings_level_3'), callback_data: 'level_3' }
                ],
                [{ text: i18next.t('settings_back'), callback_data: 'settings_back' }]
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
        const currentTimezone = settings.timezone ? settings.timezone.split('/')[1].replace('_', ' ') : 'Not set';

        if (!region) {
            // Show regions
            return {
                inline_keyboard: [
                    [{ text: `Current: ${currentTimezone}`, callback_data: ' ' }],
                    [{ text: '✏️ Change', callback_data: 'settings_timezone_select' }],
                    [{ text: 'Europe', callback_data: 'timezone_region_Europe' }],
                    [{ text: 'Americas', callback_data: 'timezone_region_Americas' }],
                    [{ text: 'Asia/Pacific', callback_data: 'timezone_region_Asia/Pacific' }],
                    [{ text: '« Back', callback_data: 'settings_back' }]
                ]
            };
        } else {
            // Show timezones for selected region
            const keyboard = [
                [{ text: `Current: ${currentTimezone}`, callback_data: ' ' }],
                [{ text: '✏️ Change', callback_data: 'settings_timezone_select' }]
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
            keyboard.push([{ text: '« Back to Regions', callback_data: 'settings_timezone' }]);
            return { inline_keyboard: keyboard };
        }
    }

    async getTimezone(chatID) {
        let settings = await this.getSettings(chatID);
        return settings.timezone || 'Not set';
    }
}