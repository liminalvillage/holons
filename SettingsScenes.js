/**
 * SettingsScenes.js
 * 
 * This file contains the SettingsScenes class which encapsulates all Telegraf scenes
 * used for managing settings in the Holons Bot. It provides a clean separation of
 * scene-related code from the main Settings class.
 * 
 * The scenes defined here handle various user interactions such as:
 * - Setting the purpose, name, domains, values, and roles for a Holon
 * - Managing users and administrators
 * - Setting up federations between Holons
 * - Managing hex identifiers and other configuration
 * 
 * Usage:
 * 1. Create an instance of SettingsScenes with a Telegraf bot and database
 * 2. Bind required methods from the Settings class to the instance
 * 3. Register the scenes with Telegraf's stage
 * 
 * Note: This class depends on several methods from the Settings class that are
 * passed via binding in the Settings constructor.
 */

import i18next from "i18next";
import { Scenes } from 'telegraf';
import * as utils from './utilities.js';

export default class SettingsScenes {
    constructor(bot, db) {
        this.db = db;
        this.bot = bot;
        
        // Create scenes for text input
        this.purposeScene = new Scenes.BaseScene('purpose_scene');
        this.nameScene = new Scenes.BaseScene('name_scene');
        this.domainsScene = new Scenes.BaseScene('domains_scene');
        this.valuesScene = new Scenes.BaseScene('values_scene');
        this.rolesScene = new Scenes.BaseScene('roles_scene');
        this.adminScene = new Scenes.BaseScene('admin_scene');
        this.hexScene = new Scenes.BaseScene('hex_scene');
        this.addArrayItemScene = new Scenes.BaseScene('add_array_item_scene');
        this.testScene = new Scenes.BaseScene('test_scene');
        this.addTestScene = new Scenes.BaseScene('add_test_scene');
        this.federationScene = new Scenes.BaseScene('federation_scene');
        this.usersScene = new Scenes.BaseScene('users_scene');
        this.addUserScene = new Scenes.BaseScene('add_user_scene');
        this.textInputScene = new Scenes.BaseScene('text_input_scene');
        this.arrayInputScene = new Scenes.BaseScene('array_input_scene');
        this.listPickerScene = new Scenes.BaseScene('list_picker_scene');
        
        this.setupScenes();
    }
    
    setupScenes() {
        this.setupPurposeScene();
        this.setupNameScene();
        this.setupDomainsScene();
        this.setupValuesScene();
        this.setupRolesScene();
        this.setupAdminScene();
        this.setupHexScene();
        this.setupAddArrayItemScene();
        this.setupTestScene();
        this.setupAddTestScene();
        this.setupFederationScene();
        this.setupUsersScene();
        this.setupAddUserScene();
        this.setupTextInputScene();
        this.setupArrayInputScene();
        this.setupListPickerScene();
    }
    
    setupPurposeScene() {
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

            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            ctx.scene.state.promptMessageId = ctx.message.message_id - 1;
            
            // Clean up messages
            await this.cleanupSceneMessages(ctx);

            // Show purpose with new UI
            await this.showArraySettingMenu(ctx, 'purpose', false);
            await ctx.scene.leave();
        });
        
        this.purposeScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in purpose scene message:', e)));
    }
    
    setupNameScene() {
        this.nameScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            let settings = await this.getSettings(chatID);
            const currentName = settings.name || i18next.t('settings_not_set');
            await ctx.reply(i18next.t('settings_current', { value: currentName }) + '\n\n' +
                i18next.t('settings_send_new', { type: i18next.t('settings_name', { defaultValue: 'name' }).toLowerCase() }))
                .catch(e => console.log('Error in name scene enter:', e));
        });

        this.nameScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            let settings = await this.getSettings(chatID);
            settings.name = ctx.message.text;
            await this.setSettings(settings);

            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            ctx.scene.state.promptMessageId = ctx.message.message_id - 1;
            
            // Clean up messages
            await this.cleanupSceneMessages(ctx);

            // Show settings menu with updated name
            await this.showSettingsMenu(ctx, false);
            await ctx.scene.leave();
        });

        this.nameScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in name scene message:', e)));
    }
    
    setupDomainsScene() {
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
                await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => { });
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show domains with new UI
            await this.showArraySettingMenu(ctx, 'domains', false);
            await ctx.scene.leave();
        });
        
        this.domainsScene.on('message', ctx => ctx.reply('Please send text only').catch(e => console.log('Error in domains scene message:', e)));
    }
    
    setupValuesScene() {
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
                await ctx.deleteMessage(ctx.message.message_id).catch(() => { });
                await ctx.deleteMessage(ctx.message.message_id - 1).catch(() => { });
            } catch (e) {
                console.log('Error deleting messages:', e);
            }

            // Show values with new UI
            await this.showArraySettingMenu(ctx, 'values', false);
            await ctx.scene.leave();
        });
        
        this.valuesScene.on('message', ctx => ctx.reply('Please send text only'));
    }
    
    setupRolesScene() {
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

            // Append new roles instead of replacing
            settings.roles.push(...newRoles);
            await this.setSettings(settings);

            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            ctx.scene.state.promptMessageId = ctx.message.message_id - 1;
            
            // Clean up messages
            await this.cleanupSceneMessages(ctx);

            // Show roles with new UI
            await this.showArraySettingMenu(ctx, 'roles', false);
            await ctx.scene.leave();
        });
        
        this.rolesScene.on('message', ctx => ctx.reply('Please send text only'));
    }
    
    setupAdminScene() {
        this.adminScene.enter(async (ctx) => {
            // Store original message ID if coming from a callback query
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }
            
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            await ctx.reply(i18next.t('settings_enter_admin_username', { lng: language }));
        });

        this.adminScene.on('text', async (ctx) => {
            // For backward compatibility, also handle text input
            const chatID = ctx.message.chat.id;
            const admin = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            const language = settings.language;

            settings.admin = admin;
            await this.setSettings(settings);
            
            // Store message IDs for cleanup
            ctx.scene.state.userMessageId = ctx.message.message_id;
            ctx.scene.state.promptMessageId = ctx.message.message_id - 1;
            
            // Clean up messages
            await this.cleanupSceneMessages(ctx);
            
            await ctx.scene.leave();

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
    }
    
    setupHexScene() {
        this.hexScene.enter(async (ctx) => {
            // Store original message ID if coming from a callback query
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }
            
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);

            // Send prompt with instructions
            const promptMessage = await ctx.reply(
                i18next.t('settings_send_new', { lng: language, type: i18next.t('settings_hex', { lng: language }).toLowerCase() }) ||
                'Please enter the new hex value:'
            );
            
            // Store the prompt message ID for later deletion
            ctx.scene.state.promptMessageId = promptMessage.message_id;
        });
        
        this.hexScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const hex = ctx.message.text.trim();
            let settings = await this.getSettings(chatID);
            const language = settings.language;

            // Store this message ID for later deletion
            ctx.scene.state.userMessageId = ctx.message.message_id;

            settings.hex = hex;
            await this.setSettings(settings);
            
            // Clean up prompts before leaving
            await this.cleanupSceneMessages(ctx);
            await ctx.scene.leave();

            // Show hex menu (consistent with purpose pattern)
            await this.showHexMenu(ctx, false);
        });
        
        this.hexScene.on('message', ctx => {
            const chatId = ctx.message.chat.id;
            this.getLanguage(chatId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }));
            });
        });
    }
    
    setupAddArrayItemScene() {
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
    }
    
    setupTestScene() {
        this.testScene.enter(async (ctx) => {
            await ctx.reply('You entered the test scene. Type something to continue.');
        });

        this.testScene.on('text', async (ctx) => {
            await ctx.reply(`You typed: ${ctx.message.text}`);
            await ctx.scene.leave();
        });
    }
    
    setupAddTestScene() {
        this.addTestScene.enter(async (ctx) => {
            await ctx.reply('Please enter items to add (comma separated):');
        });
        
        this.addTestScene.on('text', async (ctx) => {
            await ctx.reply(`You would add: ${ctx.message.text}`);
            await ctx.scene.leave();
        });
    }
    
    setupFederationScene() {
        this.federationScene.enter(async (ctx) => {
            // Store original message ID if coming from a callback query
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }
            
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);

            await ctx.reply(i18next.t('settings_enter_federation_id', { lng: language }));
        });

        this.federationScene.on('text', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const federationID = ctx.message.text.trim();
            const language = await this.getLanguage(chatID);

            try {
                // Validate input
                if (!federationID || isNaN(federationID)) {
                    await ctx.reply(i18next.t('settings_invalid_federation_id', { lng: language }));
                    return;
                }

                // Federate with the provided ID
                await this.db.holosphere.federate(chatID.toString(), federationID);

                // Store message IDs for cleanup
                ctx.scene.state.userMessageId = ctx.message.message_id;
                ctx.scene.state.promptMessageId = ctx.message.message_id - 1;
                
                // Clean up messages
                await this.cleanupSceneMessages(ctx);

                await ctx.reply(i18next.t('settings_federation_added', { lng: language, id: federationID }));
                await ctx.scene.leave();

                // Show updated federation menu
                await this.showFederationMenu(ctx, false);
            } catch (error) {
                console.error('Federation error:', error);
                await ctx.reply(i18next.t('settings_federation_error', { lng: language, error: error.message }));
                await ctx.scene.leave();
            }
        });

        this.federationScene.on('message', ctx => {
            const chatId = ctx.message.chat.id;
            this.getLanguage(chatId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }));
            });
        });
    }
    
    setupUsersScene() {
        this.usersScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            
            // Check if we're coming from a callback query (from settings menu)
            const edit = Boolean(ctx.callbackQuery);
            
            // Show users management menu
            await this.showUsersManagementMenu(ctx, edit);
        });

        this.usersScene.action(/user_info_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const userId = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;

            // Show user info
            await this.showUserInfo(ctx, userId);
        });

        // Add handlers for user management
        this.usersScene.action('add_user', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await ctx.scene.enter('add_user_scene');
        });

        this.usersScene.action('enter_remove_mode', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await this.showUsersManagementMenu(ctx, true, true); // Show in remove mode
        });

        this.usersScene.action('exit_remove_mode', async (ctx) => {
            await ctx.answerCbQuery().catch()
            await this.showUsersManagementMenu(ctx, true, false); // Show in normal mode
        });

        this.usersScene.action(/remove_user_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const userId = ctx.match[1];
            const chatID = ctx.callbackQuery.message.chat.id;

            try {
                // Get current users
                let users = await this.db.getAll(chatID + '/users');

                // Find user index
                const userIndex = users.findIndex(u => u.id.toString() === userId);

                if (userIndex === -1) {
                    await ctx.reply('User not found');
                    return;
                }

                // Check if user is admin
                let settings = await this.getSettings(chatID);
                const user = users[userIndex];
                const isAdmin = settings.admin === user.id.toString() ||
                    settings.admin === user.username ||
                    settings.admin === '@' + user.username;

                if (isAdmin) {
                    await ctx.reply('Cannot remove admin user');
                    return;
                }

                await this.db.del(chatID + '/users', user.id.toString());

                await ctx.reply('User removed successfully');

                // Refresh the users list in remove mode
                await this.showUsersManagementMenu(ctx, true, true);

            } catch (error) {
                console.error('Error removing user:', error);
                await ctx.reply('Error removing user: ' + error.message);
            }
        });
    }
    
    setupAddUserScene() {
        this.addUserScene.enter(async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);

            // Store the context for later cleanup
            ctx.scene.state.originalCtx = ctx;

            // Send instructions and store the message ID for later deletion
            const promptMessage = await ctx.reply(
                i18next.t('settings_add_user_instructions', { lng: language }) ||
                'You can add a user in two ways:\n\n1. Mention the user directly with @ (e.g., @username)\n\n2. Enter user details manually in the format:\nID,username,first_name,last_name\n\nOnly ID is required. Example:\n123456789,johndoe,John,Doe'
            );

            // Store the message ID for later deletion
            ctx.scene.state.promptMessageId = promptMessage.message_id;
        });

        this.addUserScene.on('text', async (ctx) => {
            const chatID = ctx.chat.id;
            const language = await this.getLanguage(chatID);
            const messageText = ctx.message.text.trim();

            try {
                // Store this message ID for later deletion
                ctx.scene.state.userMessageId = ctx.message.message_id;

                // Check if the message contains mentions
                if (ctx.message.entities && ctx.message.entities.some(entity => entity.type === 'mention' || entity.type === 'text_mention')) {
                    await this.processUserMentions(ctx);
                    return;
                }

                // Check if this is a manual entry in the @username,ID format
                const isManualEntry = await this.processManualUserEntry(ctx);
                if (isManualEntry) {
                    // The manual entry was processed successfully
                    // Clean up prompts before leaving
                    await this.cleanupSceneMessages(ctx);
                    await ctx.scene.leave();

                    // Refresh the original context
                    await this.showUsersManagementMenu(ctx, false);
                    return;
                }

                // No mentions, process as normal manual entry
                // Parse user data (expects format: "id,username,first_name,last_name")
                const parts = messageText.split(',').map(part => part.trim());

                if (parts.length < 1) {
                    await ctx.reply(i18next.t('settings_invalid_user_format', { lng: language }) ||
                        'Invalid format. Please enter at least the user ID or mention a user with @.');
                    return;
                }

                // Create user object with minimum required field (id)
                const userId = parts[0];
                if (!userId || isNaN(parseInt(userId))) {
                    await ctx.reply(i18next.t('settings_invalid_user_id', { lng: language }) ||
                        'Invalid user ID. Please enter a valid numeric ID.');
                    return;
                }

                const user = {
                    id: parseInt(userId),
                    username: parts.length > 1 ? parts[1].replace('@', '') : '',
                    first_name: parts.length > 2 ? parts[2] : '',
                    last_name: parts.length > 3 ? parts[3] : ''
                };

                await this.addUserToDatabase(chatID, user);

                // Clean up prompts before leaving
                await this.cleanupSceneMessages(ctx);
                await ctx.scene.leave();

                // Refresh the original context
                await this.showUsersManagementMenu(ctx, false);

            } catch (error) {
                console.error('Error adding user:', error);
                await ctx.reply(i18next.t('settings_error_adding_user', { lng: language, error: error.message }) ||
                    'Error adding user: ' + error.message);
            }
        });

        this.addUserScene.action('cancel_add_user', async (ctx) => {
            await ctx.answerCbQuery().catch()

            // Clean up prompts before leaving
            await this.cleanupSceneMessages(ctx);
            await ctx.scene.leave();

            // Return to users management menu
            await this.showUsersManagementMenu(ctx, true);
        });
    }
    
    setupTextInputScene() {
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
    }
    
    setupArrayInputScene() {
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
    }
    
    setupListPickerScene() {
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
    }
    
    // Helper methods that need to be passed from Settings
    async getSettings(chatID) {
        // This would be delegated to Settings class
    }
    
    async setSettings(settings) {
        // This would be delegated to Settings class
    }
    
    async getLanguage(chatID) {
        // This would be delegated to Settings class
    }
    
    async showSettingsMenu(ctx, edit = false) {
        // This would be delegated to Settings class
    }
    
    async showArraySettingMenu(ctx, type, removeMode = false) {
        // This would be delegated to Settings class
    }
    
    async showHexMenu(ctx, edit = false) {
        // This would be delegated to Settings class
    }
    
    async showFederationMenu(ctx, edit = false) {
        // This would be delegated to Settings class 
    }
    
    async showUsersManagementMenu(ctx, edit = false, removeMode = false) {
        // This would be delegated to Settings class
    }
    
    async showUserInfo(ctx, userId) {
        // This would be delegated to Settings class
    }
    
    async processUserMentions(ctx) {
        // This would be delegated to Settings class
    }
    
    async processManualUserEntry(ctx) {
        // This would be delegated to Settings class
    }
    
    async addUserToDatabase(chatID, user) {
        // This would be delegated to Settings class
    }
    
    async cleanupSceneMessages(ctx) {
        // This would be delegated to Settings class
    }
    
    // Register all scenes with the bot
    registerScenes(stage) {
        stage.register(this.purposeScene);
        stage.register(this.nameScene);
        stage.register(this.domainsScene);
        stage.register(this.valuesScene);
        stage.register(this.rolesScene);
        stage.register(this.adminScene);
        stage.register(this.hexScene);
        stage.register(this.addArrayItemScene);
        stage.register(this.testScene);
        stage.register(this.addTestScene);
        stage.register(this.federationScene);
        stage.register(this.usersScene);
        stage.register(this.addUserScene);
        stage.register(this.textInputScene);
        stage.register(this.arrayInputScene);
        stage.register(this.listPickerScene);
    }
}
