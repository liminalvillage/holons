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
import { ethers } from 'ethers';

import i18next from "i18next";
import { Scenes } from 'telegraf';
import * as utils from './utilities.js';
// spagheti
import { createHolonBundle, createBundleContracts } from './utils/holonOperations.js';
import * as fs from 'fs';
import Holons from './Holons.js';
// spagheti
export default class SettingsScenes {
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

                // Check if it's completely numeric (traditional Telegram chat ID)
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
                const isGroup = federationID < 0;
                console.log("Federation is happening with the individual, or with the group?", isGroup);

                if (isGroup) {
                    // Define ABIs at the start
                    const splitterABI = JSON.parse(fs.readFileSync('./contracts/Splitter.json', 'utf-8')).abi;
                    const zonedABI = JSON.parse(fs.readFileSync('./contracts/Zoned.json', 'utf-8')).abi;

                    // Check if the child group (being federated to) has a bundle
                    const childGroupInfo = await this.holons.checkGroupAddress(federationID);
                    console.log("Child bundle: ", childGroupInfo);
                    
                    // Check if the parent group (current group) has a bundle
                    const parentGroupInfo = await this.holons.checkGroupAddress(holonId);
                    console.log("Parent bundle: ", parentGroupInfo);
                    
                    let childZonedAddress;
                    let childSplitterAddress;
                    let parentSplitterAddress;
                    let parentZonedAddress;
                    let childSplitterContract; // Define this variable at the top level

                    // Handle child group bundle
                    if (!childGroupInfo.exists) {
                        console.log("Child group does not have a bundle yet");
                        // Create bundle for child group
                        const childBundleResult = await this.holons.createHolonBundle(
                            this.holonsContract,
                            federationID.toString(),
                            `chat_${Math.abs(federationID)}`,
                            0 // parameterValue set to 0 for now
                        );
                    
                        if (!childBundleResult.success) {
                            throw new Error(`Failed to create child bundle: ${childBundleResult.error}`);
                        }
                    
                        console.log("Child bundle created successfully at address:", childBundleResult.bundleAddress);

                        // Get the Splitter contract instance for child
                        childSplitterAddress = childBundleResult.bundleAddress;
                        childSplitterContract = new ethers.Contract(childSplitterAddress, splitterABI, this.wallet);
                    
                        // Create managed and zoned contracts for child bundle
                        const childContractsResult = await this.holons.createBundleContracts(
                            childSplitterContract,
                            federationID.toString(),
                            `chat_${Math.abs(federationID)}`,
                            0 // parameterValue set to 0 for now
                        );
                    
                        if (!childContractsResult.success) {
                            throw new Error(`Failed to create child bundle contracts: ${childContractsResult.error}`);
                        }
                    
                        console.log("Child bundle contracts created successfully:", {
                            managed: childContractsResult.managedAddress,
                            zoned: childContractsResult.zonedAddress
                        });

                        childZonedAddress = childContractsResult.zonedAddress;
                    } else {
                        // If bundle exists, get the Zoned contract address from the existing bundle
                        console.log("Child group has existing bundle at address:", childGroupInfo.address);
                        childSplitterAddress = childGroupInfo.address;
                        childSplitterContract = new ethers.Contract(childSplitterAddress, splitterABI, this.wallet);
                        
                        // Get the Zoned contract address from the Splitter
                        const zonedContractKey = `chat_${Math.abs(federationID)}_zoned`;
                        childZonedAddress = await childSplitterContract.contractsByType(zonedContractKey);
                    }

                    // Handle parent group bundle
                    if (!parentGroupInfo.exists) {
                        console.log("Parent group does not have a bundle yet");
                        // Create bundle for parent group
                        const parentBundleResult = await this.holons.createHolonBundle(
                            this.holonsContract,
                            holonId.toString(),
                            `chat_${Math.abs(holonId)}`,
                            0 // parameterValue set to 0 for now
                        );
                    
                        if (!parentBundleResult.success) {
                            throw new Error(`Failed to create parent bundle: ${parentBundleResult.error}`);
                        }
                    
                        console.log("Parent bundle created successfully at address:", parentBundleResult.bundleAddress);
                        parentSplitterAddress = parentBundleResult.bundleAddress;

                        // Create managed and zoned contracts for parent bundle
                        const parentSplitterContract = new ethers.Contract(parentSplitterAddress, splitterABI, this.wallet);
                        
                        // Use the same format as in the Splitter contract: name + "_zoned"
                        const parentZonedContractKey = `chat_${Math.abs(holonId)}_zoned`;
                        
                        console.log("Parent Splitter address:", parentSplitterAddress);
                        console.log("Parent Zoned contract key:", parentZonedContractKey);
                        
                        // Get all contract keys and addresses
                        const [keys, addresses] = await parentSplitterContract.getContractAddresses();
                        console.log("All contracts in parent Splitter:");
                        for (let i = 0; i < keys.length; i++) {
                            console.log(`Key: ${keys[i]}, Address: ${addresses[i]}`);
                        }

                        // Get specific contract info
                        parentZonedAddress = await parentSplitterContract.getContractInfo(parentZonedContractKey);
                        console.log(`Parent Zoned contract (${parentZonedContractKey}):`, parentZonedAddress);

                        // If we still don't have a Zoned address, create it
                        if (parentZonedAddress === '0x0000000000000000000000000000000000000000') {
                            console.log("Parent Zoned contract not found, creating it now...");
                            const parentContractsResult = await this.holons.createBundleContracts(
                                parentSplitterContract,
                                holonId.toString(),
                                `chat_${Math.abs(holonId)}`,
                                0 // parameterValue set to 0 for now
                            );

                            if (!parentContractsResult.success) {
                                throw new Error(`Failed to create parent bundle contracts: ${parentContractsResult.error}`);
                            }

                            console.log("Parent bundle contracts created successfully:", {
                                managed: parentContractsResult.managedAddress,
                                zoned: parentContractsResult.zonedAddress
                            });

                            parentZonedAddress = parentContractsResult.zonedAddress;
                        }
                    } else {
                        console.log("Parent group has existing bundle at address:", parentGroupInfo.address);
                        parentSplitterAddress = parentGroupInfo.address;
                        
                        // Get the Zoned contract address from the existing parent Splitter
                        const parentSplitterContract = new ethers.Contract(parentSplitterAddress, splitterABI, this.wallet);
                        
                        // Use the same format as in the Splitter contract: name + "_zoned"
                        const parentZonedContractKey = `chat_${Math.abs(holonId)}_zoned`;
                        
                        console.log("Parent Splitter address:", parentSplitterAddress);
                        console.log("Parent Zoned contract key:", parentZonedContractKey);
                        
                        // Get all contract keys and addresses
                        console.log("We want to know all the contracts keys and their addresses!");
                        const [keys, addresses] = await parentSplitterContract.getContractAddresses();
                        console.log("All contracts in parent Splitter:");
                        for (let i = 0; i < keys.length; i++) {
                            console.log(`Key: ${keys[i]}, Address: ${addresses[i]}`);
                        }

                        // Get specific contract info
                        parentZonedAddress = await parentSplitterContract.getContractInfo(parentZonedContractKey);
                        console.log(`Parent Zoned contract (${parentZonedContractKey}):`, parentZonedAddress);
                    }

                    // Now both groups have bundles, proceed with federation
                    console.log("Both groups have bundles, proceeding with federation");
                    console.log("Child Splitter address:", childSplitterAddress);
                    console.log("Parent Zoned address:", parentZonedAddress);

                    try {
                        // Get parent's Zoned contract
                        const parentZonedContract = new ethers.Contract(parentZonedAddress, zonedABI, this.wallet);

                        // We need to add member here to the parent contract

                        // Add federation member to parent's Zoned contract
                        const userID = utils.getUserId(ctx)
                        console.log("Adding federation member to parent's Zoned contract");
                        const federationId = `chat_${Math.abs(federationID)}`;
                        const addFederationMemberTx = await this.holons.addFederationMember(parentZonedAddress, userID, federationId);
                        console.log("Federation member added successfully to Zoned contract");
                        
                        // Call claim from parent Zoned to child Splitter
                        console.log("Calling claim from parent Zoned to child Splitter");
                        console.log("Child group ID:", `chat_${Math.abs(federationID)}`);
                        console.log("Child Splitter address:", childSplitterAddress);

                        // Check if the group has already claimed
                        const groupId = `chat_${Math.abs(federationID)}`;
                        const hasClaimed = await parentZonedContract.hasClaimed(groupId);
                        
                        if (hasClaimed) {
                            console.log(`Group ${groupId} has already claimed`);
                            await ctx.reply(i18next.t('settings_federation_already_claimed', { lng: language, id: federationID }));
                            await ctx.scene.leave();
                            return;
                        }
                        
                        const claimTx = await parentZonedContract.claim(
                            `chat_${Math.abs(federationID)}`,  // childGroupId
                            childSplitterAddress // childSplitterAddress
                        );
                        await claimTx.wait();
                        console.log("Claim successful");

                        // 4. Get list of all members from the child group
                        console.log("Getting members from child group");
                        const childGroupMembers = await this.db.getAll(federationID + '/users');
                        console.log("Found members:", childGroupMembers);


                        console.log("Federation process completed successfully");

                    } catch (error) {
                        console.error("Error during federation process:", error);
                        throw new Error(`Federation failed: ${error.message}`);
                    }
                }

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
                let users = await this.db.getAll(holonId + '/users');

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

                await this.db.del(holonId + '/users', user.id.toString());

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
