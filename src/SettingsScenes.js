/**
 * @fileoverview Telegraf scenes for settings management in HolonsBot.
 * @module src/SettingsScenes
 */

/**
 * SettingsScenes class encapsulating all Telegraf scenes for managing holon settings.
 *
 * @class SettingsScenes
 * @description Provides scene-based interfaces for setting purpose, name, domains, values,
 * roles, users, administrators, federations, and hex identifiers. Works in conjunction
 * with the Settings class.
 *
 * @property {DB} db - Database instance
 * @property {Telegraf} bot - The Telegraf bot instance
 * @property {Settings} settings - Settings module reference
 * @property {string} network - Blockchain network name
 * @property {number} chainId - Blockchain chain ID
 * @property {ethers.Wallet} wallet - Ethereum wallet for transactions
 *
 * @example
 * const scenes = new SettingsScenes(bot, db, settings);
 * scenes.registerScenes(stage);
 */
import { ethers } from 'ethers';

import i18next from "i18next";
import { Scenes } from 'telegraf';
import * as utils from './utilities.js';
import { createHolonBundle, createBundleContracts } from '../utils/holonOperations.js';
import * as fs from 'fs';
import Holons from './Holons.js';

export default class SettingsScenes {
    /**
     * Creates a new SettingsScenes instance.
     * @constructor
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {DB} db - The database instance
     * @param {Settings} settings - The settings module instance
     */
    constructor(bot, db, settings) {
        this.db = db;
        this.bot = bot;

        // spagheti
        this.network = process.env.NETWORK;
        this.chainId = parseInt(process.env.CHAINID);
        this.bot = bot;
        this.db = db;
        this.settings = settings;
        this.privateKey = process.env.WEB3KEY;
        this.provider = new ethers.JsonRpcProvider(process.env.WEB3PROVIDER);
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);
        // this.holons = new Holons(this.bot, this.db, this.settings);
        // spagheti
        
        // more spagheti
        const deploymentData = JSON.parse(fs.readFileSync('./contracts/deployment.json', 'utf-8'))[this.network];
        const holonsAddress = deploymentData.Holons;
        const holonsABI = JSON.parse(fs.readFileSync('./contracts/Holons.json', 'utf-8')).abi;
        this.holonsContract = new ethers.Contract(holonsAddress, holonsABI, this.wallet);
    
        // Create Holons instance and pass the contract
        this.holons = null;
        // this.holons.setHolons(this.holons);

        // Scenes migrated to InputScene:
        // - purpose_scene, name_scene, domains_scene, values_scene, roles_scene, hex_scene
        // - text_input_scene, array_input_scene
        // These are now handled via ctx.scene.enter('input_scene', {...}) in Settings.js

        // Remaining scenes that cannot be migrated to InputScene
        this.adminScene = new Scenes.BaseScene('admin_scene');
        this.federationScene = new Scenes.BaseScene('federation_scene');
        this.usersScene = new Scenes.BaseScene('users_scene');
        this.addUserScene = new Scenes.BaseScene('add_user_scene');
        this.listPickerScene = new Scenes.BaseScene('list_picker_scene');

        this.setupScenes();
    }
    
    setupScenes() {
        // Migrated to InputScene: purpose, name, domains, values, roles, hex, text_input, array_input
        // Remaining scenes that require custom logic:
        this.setupAdminScene();
        this.setupFederationScene();
        this.setupUsersScene();
        this.setupAddUserScene();
        this.setupListPickerScene();
    }

    setupAdminScene() {
        this.adminScene.enter(async (ctx) => {
            // Store original message ID if coming from a callback query
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }
            
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
            await ctx.reply(i18next.t('settings_enter_admin_username', { lng: language }));
        });

        this.adminScene.on('text', async (ctx) => {
            // For backward compatibility, also handle text input
            const holonId = ctx.message.chat.id;
            const admin = ctx.message.text.trim();
            let settings = await this.getSettings(holonId);
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
            const holonId = ctx.message.chat.id;
            this.getLanguage(holonId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }))
                    .catch(e => console.log('Error in admin scene message:', e));
            });
        });
    }

    // Migrated scenes removed: hex_scene, add_array_item_scene, test_scene, add_test_scene
    // These are now handled via InputScene in Settings.js

    setupFederationScene() {
        this.federationScene.enter(async (ctx) => {
            // Store original message ID if coming from a callback query
            if (ctx.callbackQuery) {
                ctx.scene.state.originalMessageId = ctx.callbackQuery.message.message_id;
            }
            
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);

            await ctx.reply(i18next.t('settings_enter_federation_id', { lng: language }));
        });

        this.federationScene.on('text', async (ctx) => {
            const holonId = ctx.message.chat.id;
            const federationID = ctx.message.text.trim();
            const language = await this.getLanguage(holonId);

            try {
                // Validate input - accept completely numeric or hex holon IDs
                if (!federationID) {
                    await ctx.reply(i18next.t('settings_invalid_federation_id', { lng: language }));
                    return;
                }

                // Check if it's completely numeric (traditional Telegram holon ID)
                const isNumeric = /^-?\d+$/.test(federationID);
                
                // Check if it's a valid hex string (with or without 0x prefix)
                const isHex = /^(0x)?[0-9a-fA-F]+$/.test(federationID);
                
                if (!isNumeric && !isHex) {
                    await ctx.reply(i18next.t('settings_invalid_federation_id_format', { 
                        lng: language, 
                        defaultValue: 'Invalid holon ID format. Please enter a numeric ID (e.g., -1001234567890) or a hex address (e.g., 0x1234abcd).' 
                    }));
                    return;
                }

                // Here is where the federation happens: Federate with the provided ID using holon-level API
                // console.log('Federation actually happens here, in the scenes!');
                await this.db.federateHolon(holonId.toString(), federationID.toString(), {
                    lensConfig: { inbound: [], outbound: [] }
                });

                // Success message
                await ctx.reply(i18next.t('settings_federation_success', {
                    lng: language,
                    defaultValue: `✅ Federated with ${federationID}. Configure lenses below.`
                }));

                // Store message IDs for cleanup
                ctx.scene.state.userMessageId = ctx.message.message_id;
                ctx.scene.state.promptMessageId = ctx.message.message_id - 1;

                // Clean up messages
                await this.cleanupSceneMessages(ctx);

                await ctx.scene.leave();

                // Show updated federation menu - edit the original message if we have the ID
                const shouldEdit = Boolean(ctx.scene.state.originalMessageId);
                if (shouldEdit && ctx.scene.state.originalMessageId) {
                    // Create a fake callback query context to allow editing
                    ctx.callbackQuery = {
                        message: {
                            chat: { id: holonId },
                            message_id: ctx.scene.state.originalMessageId
                        }
                    };
                }
                await this.showFederationMenu(ctx, shouldEdit);
            } catch (error) {
                console.error('Federation error:', error);
                await ctx.reply(i18next.t('settings_federation_error', { lng: language, error: error.message }));
                await ctx.scene.leave();
            }
        });

        this.federationScene.on('message', ctx => {
            const holonId = ctx.message.chat.id;
            this.getLanguage(holonId).then(language => {
                ctx.reply(i18next.t('settings_send_text_only', { lng: language }));
            });
        });
    }
    
    setupUsersScene() {
        this.usersScene.enter(async (ctx) => {
            const holonId = ctx.chat.id;
            
            // Check if we're coming from a callback query (from settings menu)
            const edit = Boolean(ctx.callbackQuery);
            
            // Show users management menu
            await this.showUsersManagementMenu(ctx, edit);
        });

        this.usersScene.action(/user_info_(.+)/, async (ctx) => {
            await ctx.answerCbQuery().catch()
            const userId = ctx.match[1];
            const holonId = ctx.callbackQuery.message.chat.id;

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
            const holonId = ctx.callbackQuery.message.chat.id;

            try {
                // Get current users
                let users = await this.db.getAll(holonId.toString(), 'users');

                // Find user index
                const userIndex = users.findIndex(u => u.id.toString() === userId);

                if (userIndex === -1) {
                    await ctx.reply('User not found');
                    return;
                }

                // Check if user is admin
                let settings = await this.getSettings(holonId);
                const user = users[userIndex];
                const isAdmin = settings.admin === user.id.toString() ||
                    settings.admin === user.username ||
                    settings.admin === '@' + user.username;

                if (isAdmin) {
                    await ctx.reply('Cannot remove admin user');
                    return;
                }

                await this.db.delete(holonId.toString(), 'users', user.id.toString());

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
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);

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
            const holonId = ctx.chat.id;
            const language = await this.getLanguage(holonId);
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

                await this.addUserToDatabase(holonId, user);

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

    // Migrated to InputScene: textInputScene, arrayInputScene
    // These are now handled via ctx.scene.enter('input_scene', {...}) in Settings.js

    setupListPickerScene() {
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
    }
    
    // Helper methods that need to be passed from Settings
    async getSettings(holonId) {
        // This would be delegated to Settings class
    }
    
    async setSettings(settings) {
        // This would be delegated to Settings class
    }
    
    async getLanguage(holonId) {
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
    
    async addUserToDatabase(holonId, user) {
        // This would be delegated to Settings class
    }
    
    async cleanupSceneMessages(ctx) {
        // This would be delegated to Settings class
    }
    
    // Register all scenes with the bot
    // Migrated scenes (now using InputScene): purpose, name, domains, values, roles, hex,
    // text_input, array_input, add_array_item, test, add_test
    registerScenes(stage) {
        stage.register(this.adminScene);
        stage.register(this.federationScene);
        stage.register(this.usersScene);
        stage.register(this.addUserScene);
        stage.register(this.listPickerScene);
    }

    // async checkGroupAddress(federationID) {
    //     try {
    //         // Convert federationID to string and normalize it for the contract
    //         const groupId = `chat_${Math.abs(federationID)}`;
            
    //         // Get the address from the toAddress mapping
    //         const address = await this.holons.holonsContract.toAddress(groupId);
            
    //         // Check if the address is not the zero address
    //         const exists = address !== '0x0000000000000000000000000000000000000000';
            
    //         return {
    //             exists,
    //             address: exists ? address : null
    //         };
    //     } catch (error) {
    //         console.error("Error checking group address:", error);
    //         return {
    //             exists: false,
    //             address: null,
    //             error: error.message
    //         };
    //     }
    // }

    setHolons(holons) {
        this.holons = holons;
    }
}
