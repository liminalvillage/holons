import { Markup } from 'telegraf';
import * as utils from './utilities.js';
import { createPaddedCaption } from './utilities.js';
import fs from 'fs';

export default class Roles {

    constructor(bot, db, ui) {
        this.bot = bot;
        this.db = db;
        this.ui = ui;
        this.checklists = null; // Initialize checklists instance

        // Scenes migrated to InputScene - no custom scenes needed

        this.bot.command('roles', async (ctx) => await this.roles(ctx));
        bot.action(/joinrole_(.+)/, async (ctx) => { this.joinrole(ctx) });
        bot.action(/clearroles_(.+)/, async (ctx) => { this.clearroles(ctx) });
        
        // Add checklist-related action handlers
        bot.action(/checklist_role_(.+)/, (ctx) => this.handleChecklistButton(ctx));
        bot.action(/role_check_(.+)/, (ctx) => this.handleCheckItem(ctx));
        bot.action(/add_item_to_role_(.+)/, (ctx) => this.handleAddItem(ctx));
        bot.action(/back_to_role_(.+)/, (ctx) => this.handleBackToRole(ctx));
        
        // Add role management action handlers
        bot.action('new_role', (ctx) => this.handleNewRoleButton(ctx));
        bot.action(/edit_role_(.+)/, (ctx) => this.handleEditRoleButton(ctx));
        bot.action(/delete_role_(.+)/, (ctx) => this.handleDeleteRoleButton(ctx));
        bot.action(/roleinfo_(.+)/, (ctx) => this.handleRoleInfoButton(ctx));
        bot.action('enter_delete_roles_mode', (ctx) => this.enterDeleteRolesMode(ctx));
        bot.action('exit_delete_roles_mode', (ctx) => this.exitDeleteRolesMode(ctx));
        bot.action('enter_edit_roles_mode', (ctx) => this.enterEditRolesMode(ctx));
        bot.action('exit_edit_roles_mode', (ctx) => this.exitEditRolesMode(ctx));
        bot.action('back_to_all_roles', (ctx) => this.handleBackToRoles(ctx));
        bot.action('manage_roles', (ctx) => this.handleManageRolesButton(ctx));
        
        this.bot.command('addrole', (ctx) => this.addrole(ctx));
        this.bot.command('removerole', (ctx) => this.removerole(ctx));
        this.bot.command('clearroles', (ctx) => this.clearroles(ctx));
        this.bot.command('resetroles', (ctx) => this.resetroles(ctx));
        this.bot.command('editrole', (ctx) => this.editrole(ctx));
        this.bot.command('roleinfo', (ctx) => this.roleinfo(ctx));
        this.bot.command('manageroles', (ctx) => this.showRoleManagement(ctx));
    }

    // Method to set the checklists instance (called from main bot file)
    setChecklists(checklists) {
        this.checklists = checklists;
        console.log('Checklists instance set for Roles');
    }


    async roles(ctx) {
        // Load all users
        let holonId = ctx.chat.id;
        let roles = await this.db.getAll(holonId + '/roles');
        //let users = await this.db.getAll(holonId + '/users');
        if (roles.length == 0) {
            // Show role management interface when there are no roles
            await this.showRoleManagement(ctx, { holonId: holonId });
            return;
        }
        
        // Migrate any old string-based participants to user objects
        let hasChanges = false;
        for (const role of roles) {
            if (role.participants && role.participants.length > 0) {
                const hasStringParticipants = role.participants.some(p => typeof p === 'string');
                if (hasStringParticipants) {
                    // Convert string participants to user objects (with minimal info)
                    role.participants = role.participants.map(p => {
                        if (typeof p === 'string') {
                            return {
                                id: null, // We don't have the ID for old string participants
                                username: p,
                                first_name: null,
                                last_name: null
                            };
                        }
                        return p;
                    });
                    hasChanges = true;
                }
            }
        }
        
        // Save any migrated roles
        if (hasChanges) {
            for (const role of roles) {
                await this.db.put(holonId + '/roles', role);
            }
        }
        this.ui.getRolesTable(roles, holonId).then((path) => {
            //send the image
             ctx.replyWithPhoto(
                { source: fs.createReadStream(path) }, 
                { 
                    caption: createPaddedCaption(''),
                    ...Markup.inlineKeyboard(createroles(roles))
                }
             ).catch((error) => { console.log(error) });
            // ctx.replyWithPhoto({ source: fs.createReadStream(path) }, Markup.inlineKeyboard([
            //   //  Markup.button.url('Go to message '+ holonId, 'https://t.me/'+holonId + '/'+quests[0].id.toString()),
            // ])).then((ctx) => { this.bot.telegram.pinChatMessage(holonId, ctx.message_id) });
          });
          
        // Create participation list
        //ctx.reply("Today's roles:", Markup.inlineKeyboard(createroles(roles))).catch((error) => { console.log(error) });

    }

    async addrole(ctx) {
        if (!utils.isAdmin(ctx)) {
            ctx.reply('Only admins can add roles');
            return;
        }

        let holonId = ctx.chat.id;
        let messageText = ctx.message.text;
        
        // Parse command: /addrole Title | Description (description is optional)
        let commandParts = messageText.substring(9).trim(); // Remove '/addrole '
        if (!commandParts) {
            ctx.reply('Please provide a title for the role. Eg: /addrole Space Angel | Responsible for welcoming new members');
            return;
        }
        
        // Split by | to separate title and description
        let [title, description] = commandParts.split('|').map(part => part.trim());
        
        if (!title) {
            ctx.reply('Please provide a title for the role. Eg: /addrole Space Angel | Responsible for welcoming new members');
            return;
        }
        
        let role = {
            title: title,
            id: title,
            description: description || '', // Add description field
            participants: [],
            checklistId: null, // Add checklist ID field
            created: new Date() // Add creation timestamp
        }
        await this.db.put(holonId + '/roles', role);
        let successMessage = `Role "${title}" added`;
        if (description) {
            successMessage += `\nDescription: ${description}`;
        }
        ctx.reply(successMessage);
    }
    //clears participants in all roles
    async clearroles(ctx) {
        let holonId = ctx.callbackQuery.message.chat.id;
        let messageID = ctx.callbackQuery.message.message_id;
        if (!utils.isAdmin(ctx)) {
            ctx.answerCbQuery('Only admins can clear all roles');
            return;
        }
        let roles = await this.db.getAll(holonId + '/roles');
        roles.forEach(role => {
            //TODO: save actions for currrent settings before removing them

            role.participants.forEach(user => {
                // Handle both string and object participants
                const userId = typeof user === 'string' ? user : user.id;
                if (userId) {
                    this.db.get(holonId + '/users', userId).then(userData => {
                        if (userData) {
                            if (!userData.roles) {
                                userData.roles = {};
                            }
                            if (!userData.roles[role.id]) {
                                userData.roles[role.id] = 0;
                            }
                            userData.roles[role.id] += 1;
                            this.db.put(holonId + '/users', userData);
                        }
                    }).catch(err => console.log('Error updating user roles:', err));
                }
            });
            role.participants = []; 
            this.db.put(holonId + '/roles', role)
        });

         roles = await this.db.getAll(holonId + '/roles');

        //update picture:
        this.ui.getRolesTable(roles, holonId).then((path) => {
            //send the image
            ctx.editMessageMedia(
                { type: 'photo', media: { source: path }, caption: createPaddedCaption('') }, 
                Markup.inlineKeyboard(createroles(roles, messageID))
            ).catch((error) => { });
        }) //update message

        ctx.answerCbQuery('All roles cleared');
    }
    // finds role by its title and removes it
    async removerole(ctx) {
        let holonId = ctx.chat.id;
        if (!utils.isAdmin(ctx)) {
            ctx.answerCbQuery('Only admins can remove roles');
            return;
        }
        let title = ctx.message.text.split(' ').slice(1).join(' ');
        let roles = await this.db.getAll(holonId + '/roles');
        let role = roles.find(role => role.title == title);
        if (role) {
            // Also remove associated checklist if it exists
            if (role.checklistId) {
                await this.db.del(holonId + '/checklists', role.checklistId).catch(() => {});
            }
            await this.db.del(holonId + '/roles', role.id);
            ctx.reply('Role ' + title + ' removed');
        }
        else {
            ctx.reply('Role ' + title + ' not found');
        }
    }

    async resetroles(ctx) {
        let holonId = ctx.chat.id;
        if (!utils.isAdmin(ctx)) {
            ctx.reply('Only admins can reset all roles');
            return;
        }
        
        // Remove associated checklists before removing roles
        let roles = await this.db.getAll(holonId + '/roles');
        for (let role of roles) {
            if (role.checklistId) {
                await this.db.del(holonId + '/checklists', role.checklistId).catch(() => {});
            }
        }
        
        this.db.drop(holonId + '/roles');
        // let roles = await this.db.getAll(holonId + '/roles');
        // roles.forEach(role => this.db.del(holonId + '/roles', role.id));
        ctx.reply('All roles removed');
    }

    async editrole(ctx) {
        if (!utils.isAdmin(ctx)) {
            ctx.reply('Only admins can edit roles');
            return;
        }

        let holonId = ctx.chat.id;
        let messageText = ctx.message.text;
        
        // Parse command: /editrole "Role Title" | New Description
        let commandParts = messageText.substring(10).trim(); // Remove '/editrole '
        if (!commandParts) {
            ctx.reply('Please provide role title and new description. Eg: /editrole Space Angel | Updated description of responsibilities');
            return;
        }
        
        // Split by | to separate title and description
        let [title, newDescription] = commandParts.split('|').map(part => part.trim());
        
        if (!title || !newDescription) {
            ctx.reply('Please provide both role title and description. Eg: /editrole Space Angel | Updated description of responsibilities');
            return;
        }
        
        // Remove quotes if present
        title = title.replace(/^["']|["']$/g, '');
        
        let roles = await this.db.getAll(holonId + '/roles');
        let role = roles.find(role => role.title === title);
        
        if (!role) {
            ctx.reply(`Role "${title}" not found.`);
            return;
        }
        
        // Update the description
        role.description = newDescription;
        await this.db.put(holonId + '/roles', role);
        
        ctx.reply(`Updated description for role "${title}": ${newDescription}`);
    }

    async roleinfo(ctx) {
        let holonId = ctx.chat.id;
        let messageText = ctx.message.text;
        
        // Parse command: /roleinfo Role Title
        let roleTitle = messageText.substring(10).trim(); // Remove '/roleinfo '
        if (!roleTitle) {
            ctx.reply('Please provide a role title. Eg: /roleinfo Space Angel');
            return;
        }
        
        // Remove quotes if present
        roleTitle = roleTitle.replace(/^["']|["']$/g, '');
        
        let roles = await this.db.getAll(holonId + '/roles');
        let role = roles.find(role => role.title === roleTitle);
        
        if (!role) {
            ctx.reply(`Role "${roleTitle}" not found.`);
            return;
        }
        
        // Format role information
        let infoMessage = `**${role.title}**\n`;
        
        if (role.description && role.description.trim()) {
            infoMessage += `📝 Description: ${role.description}\n`;
        }
        
        infoMessage += `👥 Participants: ${role.participants.length}\n`;
        
        if (role.participants.length > 0) {
            const participantNames = role.participants.map(p => {
                if (typeof p === 'string') {
                    return p; // Handle old string format
                } else {
                    return utils.getDisplayName(p); // Handle new object format
                }
            });
            infoMessage += `Members: ${participantNames.join(', ')}\n`;
        }
        
        if (role.checklistId) {
            infoMessage += `📋 Has checklist\n`;
        }
        
        if (role.created) {
            infoMessage += `📅 Created: ${new Date(role.created).toLocaleDateString()}`;
        }
        
        ctx.reply(infoMessage, { parse_mode: 'Markdown' });
    }

    async showRoleManagement(ctx, options = {}) {
        const deleteMode = options.deleteMode || false;
        const editMode = options.editMode || false;
        const editMessageId = options.hasOwnProperty('editMessageId') ? options.editMessageId : (ctx.callbackQuery ? ctx.callbackQuery.message.message_id : null);
        const holonId = options.holonId || ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;

        if (!holonId) {
            console.error("Could not determine chat ID in showRoleManagement");
            if (ctx.callbackQuery) await ctx.answerCbQuery("Error: Could not find chat.").catch(() => {});
            return;
        }

        const roles = await this.db.getAll(holonId + '/roles');
        
        const buttons = roles.map(role => {
            if (deleteMode) {
                return [Markup.button.callback(
                    `❌ ${role.title}`,
                    `delete_role_${role.id}`
                )];
            } else if (editMode) {
                return [Markup.button.callback(
                    `✏️ ${role.title}`,
                    `edit_role_${role.id}`
                )];
            } else {
                const participantCount = role.participants.length;
                return [Markup.button.callback(
                    `${role.title}`,
                    `roleinfo_${role.id}`
                )];
            }
        });

        // Add control buttons at the bottom
        if (deleteMode) {
            buttons.push([
                Markup.button.callback('🔙 Back', 'exit_delete_roles_mode')
            ]);
        } else if (editMode) {
            buttons.push([
                Markup.button.callback('🔙 Back', 'exit_edit_roles_mode')
            ]);
        } else {
            buttons.push([
                Markup.button.callback('➕ New Role', 'new_role'),
                Markup.button.callback('✏️ Edit Roles', 'enter_edit_roles_mode')
            ]);
            buttons.push([
                Markup.button.callback('🗑️ Delete Roles', 'enter_delete_roles_mode'),
                Markup.button.callback('🔙 Back to Roles', 'back_to_all_roles')
            ]);
        }

        let message;
        if (deleteMode) {
            message = 'Select roles to delete:';
        } else if (editMode) {
            message = 'Select roles to edit:';
        } else {
            message = 'Role Management:';
        }

        const keyboard = Markup.inlineKeyboard(buttons);

        try {
            if (editMessageId) {
                await ctx.telegram.editMessageText(holonId, editMessageId, null, message, keyboard);
            } else {
                await ctx.reply(message, keyboard);
            }
            
            if (ctx.callbackQuery && (options.hasOwnProperty('editMessageId') && options.editMessageId === null)) {
                await ctx.answerCbQuery().catch(() => {});
            }
        } catch (error) {
            console.error(`Error in showRoleManagement:`, error);
            if (editMessageId && !(error.description && error.description.includes("message is not modified"))) {
                if (ctx.reply) {
                    await ctx.reply("Failed to update the role management interface.").catch(() => {});
                } else {
                    await this.bot.telegram.sendMessage(holonId, "Failed to update the role management interface.").catch(() => {});
                }
            }
            
            if (ctx.callbackQuery && (options.hasOwnProperty('editMessageId') && options.editMessageId === null)) {
                await ctx.answerCbQuery("Error updating interface").catch(() => {});
            }
        }
    }

    // Button handlers
    async handleNewRoleButton(ctx) {
        await ctx.answerCbQuery().catch();
        const originalMessageId = ctx.callbackQuery.message.message_id;
        const holonId = ctx.callbackQuery.message.chat.id;

        // Use InputScene with pipe separator for role input
        return ctx.scene.enter('input_scene', {
            promptText: 'Please enter role details in format:\nTitle | Description\n\nDescription is optional. Example:\nSpace Angel | Welcomes new members',
            inputType: 'array',
            separator: 'pipe',
            allowEmpty: false,
            validate: async (parts, ctx) => {
                const [title] = parts;
                const holonId = ctx.chat.id;

                if (!title || title.trim() === '') {
                    return { valid: false, error: 'Please provide at least a title for the role.' };
                }

                // Check if role already exists
                const existingRoles = await this.db.getAll(holonId + '/roles');
                if (existingRoles.find(role => role.title === title.trim())) {
                    return { valid: false, error: `Role "${title.trim()}" already exists.` };
                }

                return { valid: true };
            },
            onComplete: async (ctx, parts) => {
                const holonId = ctx.chat.id;
                let [title, description] = parts.map(p => p.trim());

                // Create the new role
                const role = {
                    title: title,
                    id: title,
                    description: description || '',
                    participants: [],
                    checklistId: null,
                    created: new Date()
                };

                // Save role to database and wait for Nostr confirmation
                await this.db.put(holonId + '/roles', role);

                // Return holonId for the onConfirm callback
                return { holonId };
            },
            // onConfirm is called after onComplete finishes (data is confirmed in Nostr)
            onConfirm: async (ctx, result) => {
                // Show updated role management after data is confirmed
                await this.showRoleManagement(ctx, { holonId: result.holonId });
            }
        });
    }

    async handleEditRoleButton(ctx) {
        await ctx.answerCbQuery().catch();
        const roleId = ctx.match[1];
        const originalMessageId = ctx.callbackQuery.message.message_id;
        const holonId = ctx.callbackQuery.message.chat.id;

        try {
            const role = await this.db.get(holonId + '/roles', roleId);
            if (!role) {
                await ctx.answerCbQuery('Role not found');
                return;
            }

            // Use InputScene for role description editing
            return ctx.scene.enter('input_scene', {
                promptText: `Editing role: ${role.title}\nCurrent description: ${role.description || 'None'}\n\nEnter new description:`,
                allowEmpty: true,
                onComplete: async (ctx, newDescription) => {
                    const holonId = ctx.chat.id;

                    const role = await this.db.get(holonId + '/roles', roleId);
                    if (!role) {
                        await ctx.reply('Role not found');
                        return;
                    }

                    role.description = newDescription;
                    // Save role to database and wait for Nostr confirmation
                    await this.db.put(holonId + '/roles', role);

                    // Return holonId for the onConfirm callback
                    return { holonId };
                },
                // onConfirm is called after onComplete finishes (data is confirmed in Nostr)
                onConfirm: async (ctx, result) => {
                    // Show updated role management after data is confirmed
                    await this.showRoleManagement(ctx, { holonId: result.holonId });
                }
            });

        } catch (error) {
            console.error('Error setting up role edit:', error);
            await ctx.answerCbQuery('Error editing role');
        }
    }

    async handleDeleteRoleButton(ctx) {
        const roleId = ctx.match[1];
        const holonId = ctx.callbackQuery.message.chat.id;

        try {
            const role = await this.db.get(holonId + '/roles', roleId);
            if (!role) {
                await ctx.answerCbQuery('Role not found');
                return;
            }

            // Remove associated checklist if it exists
            if (role.checklistId) {
                await this.db.del(holonId + '/checklists', role.checklistId).catch(() => {});
            }

            await this.db.del(holonId + '/roles', roleId);
            await ctx.answerCbQuery(`Deleted role "${role.title}"`);

            // Refresh the delete mode view
            await this.showRoleManagement(ctx, { deleteMode: true });

        } catch (error) {
            console.error('Error deleting role:', error);
            await ctx.answerCbQuery('Error deleting role');
        }
    }

    async enterDeleteRolesMode(ctx) {
        await ctx.answerCbQuery().catch();
        await this.showRoleManagement(ctx, { deleteMode: true });
    }

    async exitDeleteRolesMode(ctx) {
        await ctx.answerCbQuery().catch();
        await this.showRoleManagement(ctx, { deleteMode: false });
    }

    async enterEditRolesMode(ctx) {
        await ctx.answerCbQuery().catch();
        await this.showRoleManagement(ctx, { editMode: true });
    }

    async exitEditRolesMode(ctx) {
        await ctx.answerCbQuery().catch();
        await this.showRoleManagement(ctx, { editMode: false });
    }

    async handleBackToRoles(ctx) {
        await ctx.answerCbQuery().catch();
        // Go back to the main roles view (with image)
        let holonId = ctx.callbackQuery.message.chat.id;
        let roles = await this.db.getAll(holonId + '/roles');
        
        // Migrate any old string-based participants to user objects
        let hasChanges = false;
        for (const role of roles) {
            if (role.participants && role.participants.length > 0) {
                const hasStringParticipants = role.participants.some(p => typeof p === 'string');
                if (hasStringParticipants) {
                    // Convert string participants to user objects (with minimal info)
                    role.participants = role.participants.map(p => {
                        if (typeof p === 'string') {
                            return {
                                id: null, // We don't have the ID for old string participants
                                username: p,
                                first_name: null,
                                last_name: null
                            };
                        }
                        return p;
                    });
                    hasChanges = true;
                }
            }
        }
        
        // Save any migrated roles
        if (hasChanges) {
            for (const role of roles) {
                await this.db.put(holonId + '/roles', role);
            }
        }
        
        this.ui.getRolesTable(roles, holonId).then((path) => {
            // Delete the management message and show main roles view
            ctx.deleteMessage().catch(() => {});
            ctx.replyWithPhoto(
                { source: fs.createReadStream(path) }, 
                { 
                    caption: createPaddedCaption(''),
                    ...Markup.inlineKeyboard(createroles(roles))
                }
            ).catch((error) => { console.log(error) });
        });
    }

    async handleRoleInfoButton(ctx) {
        await ctx.answerCbQuery().catch();
        const roleId = ctx.match[1];
        const holonId = ctx.callbackQuery.message.chat.id;
        
        const role = await this.db.get(holonId + '/roles', roleId);
        if (!role) {
            await ctx.answerCbQuery('Role not found');
            return;
        }
        
        // Format role information
        let infoMessage = `**${role.title}**\n`;
        
        if (role.description && role.description.trim()) {
            infoMessage += `📝 Description: ${role.description}\n`;
        }
        
        infoMessage += `👥 Participants: ${role.participants.length}\n`;
        
        if (role.participants.length > 0) {
            const participantNames = role.participants.map(p => {
                if (typeof p === 'string') {
                    return p; // Handle old string format
                } else {
                    return utils.getDisplayName(p); // Handle new object format
                }
            });
            infoMessage += `Members: ${participantNames.join(', ')}\n`;
        }
        
        if (role.checklistId) {
            infoMessage += `📋 Has checklist\n`;
        }
        
        if (role.created) {
            infoMessage += `📅 Created: ${new Date(role.created).toLocaleDateString()}`;
        }
        
        await ctx.reply(infoMessage, { parse_mode: 'Markdown' });
    }

    async handleManageRolesButton(ctx) {
        await ctx.answerCbQuery().catch();
        // Send a new message since the original contains an image
        await this.showRoleManagement(ctx, { editMessageId: null });
    }

    async joinrole(ctx) {
        let topic = ctx.match[1];
        let holonId = ctx.callbackQuery.message.chat.id
        let userID = ctx.callbackQuery.from.id;
        let username = ctx.callbackQuery.from.username;
        let messageID = ctx.callbackQuery.message.message_id;
        let roleid = ctx.match[1];

        let role = await this.db.get(holonId + '/roles', roleid);

        // Migrate old string-based participants to user objects if needed
        if (role.participants && role.participants.length > 0) {
            const hasStringParticipants = role.participants.some(p => typeof p === 'string');
            if (hasStringParticipants) {
                // Convert string participants to user objects (with minimal info)
                role.participants = role.participants.map(p => {
                    if (typeof p === 'string') {
                        return {
                            id: null, // We don't have the ID for old string participants
                            username: p,
                            first_name: null,
                            last_name: null
                        };
                    }
                    return p;
                });
                // Save the migrated role
                await this.db.put(holonId + '/roles', role);
            }
        }

        // Create a user object with full information
        const userObject = {
            id: userID,
            username: username,
            first_name: ctx.callbackQuery.from.first_name,
            last_name: ctx.callbackQuery.from.last_name
        };

        // Check if user is already in the role (by ID)
        const existingUserIndex = role.participants?.findIndex(user => 
            (typeof user === 'string' && user === username) || 
            (typeof user === 'object' && user.id === userID)
        );

        if (existingUserIndex !== -1) {
            // Remove user from role
            role.participants.splice(existingUserIndex, 1);
            ctx.answerCbQuery('You have removed yourself from this role');
        } else {
            // Add user to role
            if (!role.participants) role.participants = [];
            role.participants.push(userObject);
            ctx.answerCbQuery('You joined the role');
        }

        await this.db.put(holonId + '/roles', role); // saves changes to the role

        // user.participated[messageID] = !user.participated[messageID];

        // await this.db.put(holonId + '/users', user);


        let roles = await this.db.getAll(holonId + '/roles');

        //update picture and markup:
        this.ui.getRolesTable(roles, holonId).then((path) => {
            //send the image
            ctx.editMessageMedia(
                { type: 'photo', media: { source: path }, caption: createPaddedCaption('') }, 
                Markup.inlineKeyboard(createroles(roles, messageID))
            ).catch((error) => { console.log(error) });
        })

    }

    // Handle checklist button for roles
    async handleChecklistButton(ctx) {
        await ctx.answerCbQuery().catch();
        const roleId = ctx.match[1];
        let holonId = ctx.callbackQuery.message.chat.id;
        let messageId = ctx.callbackQuery.message.message_id;
        
        let role = await this.db.get(holonId + '/roles', roleId);
        if (!role) {
            await ctx.answerCbQuery('Role not found');
            return;
        }

        // Create or get checklist for this role
        if (!role.checklistId) {
            // Create a new checklist for this role using standardized creation
            const checklist = {
                id: messageId.toString(), // Use message ID as checklist ID
                type: 'role', // Use standardized type
                items: [],
                creator: ctx.from.id,
                created: new Date(),
                roleId: role.id,
                parentTitle: role.title,
                holonId: holonId
            };
            
            await this.db.put(holonId + '/checklists', checklist);
            
            // Update role with checklist ID
            role.checklistId = messageId.toString();
            await this.db.put(holonId + '/roles', role);
        }

        const checklist = await this.db.get(holonId + '/checklists', role.checklistId);
        if (!checklist) {
            await ctx.answerCbQuery('Checklist not found');
            return;
        }

        // Replace the role interface with the checklist interface
        const checklistMarkup = this.getRoleChecklistKeyboard(checklist);
        
        // Delete the current message and send a new one with the checklist
        await ctx.deleteMessage().catch(() => {});
        await ctx.reply(
            `👥 ${role.title} Checklist:`,
            checklistMarkup
        ).catch(error => console.log(error));
    }

    // Handle checking/unchecking items in role checklist
    async handleCheckItem(ctx) {
        const [checklistId, itemIndex] = ctx.match[1].split('_');
        let holonId = ctx.chat.id;
        let checklist = await this.db.get(holonId + '/checklists', checklistId);
        
        if (!checklist || !checklist.items[itemIndex]) {
            await ctx.answerCbQuery('Item not found');
            return;
        }

        checklist.items[itemIndex].checked = !checklist.items[itemIndex].checked;
        await this.db.put(holonId + '/checklists', checklist);

        await ctx.editMessageText(
            `👥 ${checklist.parentTitle || 'Role'} Tasks:`,
            this.getRoleChecklistKeyboard(checklist)
        ).catch(error => console.log(error));
        
        await ctx.answerCbQuery().catch();
    }

    // Handle adding items to role checklist
    async handleAddItem(ctx) {
        await ctx.answerCbQuery().catch();
        const roleId = ctx.match[1];
        
        if (!this.checklists) {
            console.error('Checklists instance not set in Roles');
            await ctx.answerCbQuery('Error: Checklist functionality not available');
            return;
        }

        // Get the role to find its checklist ID
        let holonId = ctx.callbackQuery.message.chat.id;
        let role = await this.db.get(holonId + '/roles', roleId);
        
        if (!role || !role.checklistId) {
            await ctx.answerCbQuery('Role checklist not found');
            return;
        }

        // Enter the add item scene with the role's checklist ID
        await ctx.scene.enter('add_item_scene', { 
            checklistId: role.checklistId,
            holonId: holonId,
            messageId: ctx.callbackQuery.message.message_id
        });
    }

    // Handle returning to role from checklist
    async handleBackToRole(ctx) {
        const roleId = ctx.match[1];
        let holonId = ctx.callbackQuery.message.chat.id;
        
        try {
            const role = await this.db.get(holonId + '/roles', roleId);
            if (!role) {
                await ctx.answerCbQuery('Role not found');
                return;
            }

            // Delete the checklist message since we're going back to the main roles view
            await ctx.deleteMessage().catch(() => {});
            
            // Send roles view again
            let roles = await this.db.getAll(holonId + '/roles');
            this.ui.getRolesTable(roles, holonId).then((path) => {
                ctx.replyWithPhoto(
                    { source: fs.createReadStream(path) }, 
                    { 
                        caption: createPaddedCaption(''),
                        ...Markup.inlineKeyboard(createroles(roles))
                    }
                ).catch((error) => { console.log(error) });
            });
            
            await ctx.answerCbQuery().catch();

        } catch (error) {
            console.error('Error handling back to role:', error);
            await ctx.answerCbQuery('Error returning to role');
        }
    }

    // Get keyboard markup for role checklist
    getRoleChecklistKeyboard(checklist) {
        let buttons = [];
        
        // Add item buttons if there are any
        if (checklist.items.length > 0) {
            buttons = checklist.items.map((item, index) => {
                const status = item.checked ? '✅' : '⬜️';
                return [Markup.button.callback(
                    `${status} ${item.text}`,
                    `role_check_${checklist.id}_${index}` // Use checklist ID (message ID) here
                )];
            });
        }

        // Add control buttons
        buttons.push([
            Markup.button.callback('➕ Add Item', `add_item_to_role_${checklist.roleId}`),
            Markup.button.callback('🔙 Back to Role', `back_to_role_${checklist.roleId}`)
        ]);

        return Markup.inlineKeyboard(buttons);
    }
}

function createroles(roles, messageID) {
    let mu = []
    roles.forEach(function (role) {
        // Add checklist indicator if role has a checklist
        let checklistIndicator = '';
        if (role.checklistId) {
            checklistIndicator = ' 📋';
        }
        
        // Add description indicator if role has a description
        let descriptionIndicator = '';
        if (role.description && role.description.trim()) {
            descriptionIndicator = ' 📝';
        }
        
        // Create 3 buttons per row: role name, join checkbox, and checklist
        let row = [
            Markup.button.callback(role.title, `roleinfo_${role.id}`),
            Markup.button.callback(
                role.participants.length ? '✅' : '☑️', 
                `joinrole_${role.id}`
            ),
            Markup.button.callback('📋', `checklist_role_${role.id}`)
        ];
        
        mu.push(row);
    })
    
    // Add management and clear buttons
    mu.push([
        Markup.button.callback('⚙️ Manage Roles', 'manage_roles'),
        Markup.button.callback('🧹 Clear all roles', `clearroles_${messageID}`)
    ]);
    
    return mu;
}
