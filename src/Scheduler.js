import { CronJob } from 'cron';
import { Calendar } from './Calendar.js';
import i18next from 'i18next';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js'; // Import UTC plugin
import timezone from 'dayjs/plugin/timezone.js'; // Import timezone plugin
import { log } from '../utils/logger.js';
import { getQuestHolon } from './utilities.js';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);

class Scheduler {
    constructor(bot, db, quests, settings) {
        this.bot = bot;
        this.db = db;
        this.quests = quests;
        this.settings = settings;
        this.jobs = new Map();
        
        // Initialize calendar with time selector enabled
        this.calendar = new Calendar(bot, {
            date_format: 'YYYY/MM/DD HH:mm:ss',
            time_selector_mod: true,
            language: 'en',
            bot_api: 'telegraf',
            time_range: '00:00-23:59',
            time_step: '30m'
        });
        
        // Load recurring tasks and one-time reminders
        this.loadTasks();
        this.loadReminders();
    
        // Add calendar-related commands and handlers
        this.bot.command('droprecurring', async (ctx) => this.deleteTasks(ctx));
        this.bot.command('recurring', async (ctx) => this.addTask(ctx));
        this.bot.command('when', async (ctx) => this.handleWhenCommand(ctx));
        
        // Add bot actions for callbacks
        this.bot.action(/schedule_quest_(.+)/, async (ctx) => {
            return await this.schedule(ctx);
        });
        
        // Time selection handler
        this.bot.action(/t_(.+)_0$/, async (ctx) => {
            return await this.handleTimeSelection(ctx);
        });

        // Calendar navigation handler
        this.bot.action(/n_(.+)/, async (ctx) => {
            return await this.handleCalendarNavigation(ctx);
        });

        // Back to calendar handler
        this.bot.action(/t_(.+)_back/, async (ctx) => {
            return await this.handleBackToCalendar(ctx);
        });

        // Time navigation handler
        this.bot.action(/t_(.+)_(0|1)[\+\-]/, async (ctx) => {
            return await this.handleTimeNavigation(ctx);
        });

        // Calendar back to quest handler
        this.bot.action(/calendar_back_to_quest/, async (ctx) => {
            return await this.handleBackToQuest(ctx);
        });
    }

    async deleteTasks() {
        // Delete all recurring tasks from database
        await this.db.holosphere.deleteAllGlobal('recurring');
        //await this.db.holosphere.deleteAllGlobal('recurringlookup');
    }

    async loadTasks() {
        // Load all recurring tasks from database and schedule them
        const tasks = await this.db.holosphere.getAllGlobal('recurring');
        
        if (tasks && tasks.length > 0) {
            tasks.forEach(async task => {
                // Create a mock ctx object from the task data
            
                const mockCtx = {
                    message: {
                        chat: {
                            id: task.holonId
                        },
                        from: task.initiator,
                        message_id: task.id,
                        text: `/recurring ${task.frequency} ${task.title}`
                    },
                    from: task.initiator,
                    reply: (text, extra) => {
                        return this.bot.telegram.sendMessage(task.holonId, text, extra);
                    },
                    telegram: this.bot.telegram
                };
                
                this.scheduleTask(task, mockCtx);
            });
            console.log('Successfully scheduled', tasks.length, 'recurring tasks');
        }
    }

    async addTask(ctx) {
        const holonId = ctx.message.chat.id;
        const [frequency, ...taskDetails] = ctx.message.text.split(' ').slice(1);
        
        if (!frequency || taskDetails.length === 0) {
            ctx.reply('Usage: /recurring [frequency] [task description]\nFrequencies: daily, weekly, monthly, quarterly, yearly\nUse /when to set the start time');
            return;
        }

        // Validate frequency
        const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
        if (!validFrequencies.includes(frequency.toLowerCase())) {
            ctx.reply(`Invalid frequency. Please use one of: ${validFrequencies.join(', ')}`);
            return;
        }

        let quest = await this.quests.quest('recurring', ctx);

        const task = {
            id: quest.id,
            holonId: holonId,
            title: taskDetails,
            frequency: frequency,
            when: new Date().toISOString(), // Convert Date to string for Nostr serialization
            createdAt: new Date().toISOString(), // Convert Date to string for Nostr serialization
            initiator: ctx.message.from
        };

        // Save to database
        await this.db.holosphere.putGlobal('recurring', task);
        await this.db.holosphere.putGlobal('recurringlookup', {id: holonId + quest.id, taskID: task.id});
        
        // Schedule the task
        await this.scheduleTask(task,ctx);
        
        const timeStr = new Date(task.when).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        ctx.reply(`Recurring task "${task.title}" scheduled ${task.frequency} starting at ${timeStr}`);
    }

    async scheduleTask(task, ctx) {
        let holonId = task.holonId;
        if (!task.when || !task.frequency) {
            console.error('Invalid task, no when or frequency:', task);
            return;
        }
        // Use the 'when' field for the first occurrence
        const cronTime = this.getCronTime(task.frequency, task.when);
        if (!cronTime) {
            console.error('Invalid frequency:', task.frequency);
            return;
        }

        // Create new cron job with the specific timezone if provided in the quest
        const timezone = task.timezone || 'UTC';
        const job = new CronJob(cronTime, async() => {
            try {
                // Store original task details for reference
                const originalTask = {...task}; // Create a copy to ensure we don't modify the original
                console.log('Running scheduled task for holonId:', originalTask.holonId);
                
                // Ensure we have a valid chat ID
                if (!originalTask.holonId || originalTask.holonId === 0) {
                    console.error('Invalid holonId in task:', originalTask);
                    return;
                }
                
                // Create mock context for quest creation with correct chat ID
                const mockCtx = {
                    chat: { // For utilities like getholonId that might look here first
                        id: originalTask.holonId,
                        type: null // Type is unknown/not applicable for scheduler context at this level
                    },
                    message: {
                        chat: { // To make ctx.message.chat.type checks safer and ctx.message.chat.id available
                            id: originalTask.holonId,
                            type: null // For scheduled tasks, 'type' is not a supergroup/channel in the context of message origin.
                        },
                        from: originalTask.initiator,
                        message_id: Date.now(), // Generate a new message ID
                        text: `/recurring ${originalTask.title}`
                    },
                    from: originalTask.initiator,
                    telegram: this.bot.telegram,
                    reply: (text, extra) => {
                        return this.bot.telegram.sendMessage(originalTask.holonId, text, extra);
                    },
                    platform: 'telegram'
                };
                
                
                // Create the quest using the task type (default to 'task' if not specified)
                const quest = await this.quests.quest('recurring', mockCtx);
                if (!quest) {
                    console.error('Failed to create recurring quest');
                    return;
                }
                
                let questHolonId = getQuestHolon(quest);
                console.log('New quest created, quest ID:', quest.id, 'holon ID:', questHolonId);

                // Ensure quest has the correct holon ID
                if (!questHolonId || questHolonId === 0) {
                    quest.holon = originalTask.holonId;
                    questHolonId = originalTask.holonId;
                    console.log('Corrected quest holon ID to:', questHolonId);
                }

                // Copy details from original task
                quest.frequency = originalTask.frequency === undefined ? null : originalTask.frequency;
                quest.recurringTaskId = originalTask.id;

                // Only set originalTaskId if the questId exists
                if (originalTask.questId) {
                    quest.originalTaskId = originalTask.questId; // Reference to the original task
                    console.log(`Linked to original task ID: ${originalTask.questId}`);
                } else {
                    console.log('No questId found in original task to reference');
                }

                // Copy description if it exists
                if (originalTask.description) {
                    quest.description = originalTask.description;
                }

                // Copy dependencies if they exist
                if (originalTask.dependencies && originalTask.dependencies.length > 0) {
                    quest.dependencies = [...originalTask.dependencies];
                }

                // Copy checklist if it exists
                if (originalTask.checklistId) {
                    try {
                        const originalChecklist = await this.db.get(originalTask.holonId + '/checklists', originalTask.checklistId);
                        if (originalChecklist) {
                            // Create a new checklist with copied items but unchecked
                            const newChecklist = {
                                id: quest.id.toString(),
                                type: 'quest', // Use standardized type
                                items: originalChecklist.items.map(item => ({...item, checked: false})),
                                creator: quest.initiator.id,
                                created: new Date(),
                                questId: quest.id,
                                parentTitle: quest.title,
                                holonId: questHolonId
                            };

                            // Save new checklist
                            await this.db.put(questHolonId + '/checklists', newChecklist);

                            // Update quest with new checklist ID
                            quest.checklistId = quest.id.toString();
                        }
                    } catch (error) {
                        console.error('Error copying checklist:', error);
                    }
                }

                // Save the updated quest
                console.log('Saving quest with holon ID:', questHolonId);
                await this.db.put(questHolonId + '/quests', quest);
                const language = await this.settings.getLanguage(holonId);
                await this.quests.updateMessage(ctx, quest, language, false);
                
                // Add the quest id to the lookup table
                await this.db.holosphere.putGlobal('recurringlookup', {
                    id: holonId + quest.id,
                    taskID: task.id
                });
                console.log('Recurring Lookup TASK', holonId + quest.id, task.id);
                
            } catch (error) {
                console.error('Error in scheduled task execution');
            }
        }, null, true, timezone);

        // Store job reference
        this.jobs.set(task.id, job);
        
        // Start the job
        job.start();
    }

    getCronTime(frequency, whenDate) {
        // Ensure whenDate is a Date object (handle both Date objects and ISO strings)
        const date = (whenDate instanceof Date) ? whenDate : new Date(whenDate);

        // Validate the date
        if (isNaN(date.getTime())) {
            console.error(`Invalid date provided to getCronTime: ${whenDate}`);
            return null;
        }

        // Use UTC components for scheduling
        const minute = date.getUTCMinutes();
        const hour = date.getUTCHours();
        const dayOfMonth = date.getUTCDate();
        const month = date.getUTCMonth() + 1; // Cron months are 1-indexed
        const dayOfWeek = date.getUTCDay(); // 0 for Sunday

        switch (frequency.toLowerCase()) {
            case '1min':
                return '*/1 * * * *'; // Every minute
            case '30sec':
                return '*/30 * * * * *'; // Every 30 seconds
            case 'daily':
                return `${minute} ${hour} * * *`; // Every day at specified UTC hour:minute
            case 'weekly':
                return `${minute} ${hour} * * ${dayOfWeek}`; // Every week on same UTC day at specified UTC hour:minute
            case 'biweekly':
                // Cron doesn't directly support bi-weekly easily.
                // This attempts it but might not be perfect across month/year boundaries.
                // A more robust solution might involve checking the week number within the job.
                // For simplicity here, we schedule for the specific day of week.
                // The execution logic would need to check if it should run this specific week.
                // Alternatively, schedule two monthly jobs? This gets complex.
                // Let's keep the weekly trigger for now.
                console.warn("Bi-weekly scheduling using cron is approximated to weekly. Execution logic should verify week.");
                return `${minute} ${hour} * * ${dayOfWeek}`;
            case 'monthly':
                return `${minute} ${hour} ${dayOfMonth} * *`; // Same day each month at specified UTC hour:minute
            case 'quarterly':
                return `${minute} ${hour} ${dayOfMonth} */3 *`; // Every third month on same day at specified UTC hour:minute
            case 'sixmonths':
                return `${minute} ${hour} ${dayOfMonth} */6 *`; // Every six months on same day
            case 'yearly':
                return `${minute} ${hour} ${dayOfMonth} ${month} *`; // Same date each year at specified UTC hour:minute
            default:
                console.error(`Invalid frequency provided to getCronTime: ${frequency}`);
                return null;
        }
    }

    async stopTask(taskId) {
        try {
            console.log('Stopping task:', taskId);
            
            // Get the task to log details before deletion
            const task = await this.db.holosphere.getGlobal('recurring', taskId);
            if (task) {
                console.log('Found task to stop, chat ID:', task.holonId);
            } else {
                console.log('Task not found, proceeding with cleanup anyway');
            }
            
            // Stop running job if it exists
            const job = this.jobs.get(taskId);
            if (job) {
                job.stop();
                this.jobs.delete(taskId);
                console.log('Stopped recurring job for task:', taskId);
            } else {
                console.log('No running job found for task:', taskId);
            }
            
            // Find all lookup records for this task
            try {
                // Get all lookup records
                const lookups = await this.db.holosphere.getAllGlobal('recurringlookup');
                console.log('Found', lookups ? lookups.length : 0, 'lookup records to check');
                
                if (lookups && lookups.length > 0) {
                    const relatedLookups = lookups.filter(lookup => lookup.taskID === taskId);
                    console.log('Found', relatedLookups.length, 'lookup records to delete');
                    
                    // Delete all related lookup records
                    for (const lookup of relatedLookups) {
                        await this.db.holosphere.deleteGlobal('recurringlookup', lookup.id);
                        console.log('Deleted lookup record:', lookup.id);
                    }
                }
            } catch (error) {
                console.error('Error cleaning up lookup records:', error);
            }
            
            // Delete the main task
            if (task) {
                await this.db.holosphere.deleteGlobal('recurring', taskId);
                console.log('Deleted recurring task:', taskId);
            }
            
            return true;
        } catch (error) {
            console.error('Error stopping task:', error);
            return false;
        }
    }

    async getRecurringTask(taskId) {
        try {
            console.log(`Getting recurring task: ${taskId}`);
            const task = await this.db.holosphere.getGlobal('recurring', taskId);
            if (!task) {
                console.log(`No task found with ID: ${taskId}`);
                return null;
            }
            return task;
        } catch (error) {
            console.error(`Error retrieving recurring task ${taskId}:`, error);
            return null;
        }
    }

    async getRecurringLookup(holonId, questId) {
        return await this.db.holosphere.getGlobal('recurringlookup', `${holonId}${questId}`);
    }

    async updateTaskSchedule(holonId, questId, selectedDate, ctx) {
        try {
            // Get the quest
            const quest = await this.db.get(`${holonId}/quests`, questId);
            if (!quest) {
                console.log('No quest found to update schedule');
                return;
            }

            // Get language setting
            const language = await this.settings.getLanguage(holonId);

            // Update the quest's when field with the selected date
            quest.when = selectedDate;
            
            // Save the updated quest
            await this.db.put(`${holonId}/quests`, quest);

            // If this is a recurring task, update its schedule
            if (quest.type === 'recurring') {
                const recurringID = await this.getRecurringLookup(holonId, questId);
                if (recurringID) {
                    let task = await this.db.holosphere.getGlobal('recurring', recurringID.taskID);
                    if (task) {
                        // Convert Date to ISO string for Nostr serialization
                        task.when = selectedDate instanceof Date ? selectedDate.toISOString() : selectedDate;
                        await this.db.holosphere.putGlobal('recurring', task);
                        await this.scheduleTask(task, ctx);
                    }
                }
            }

            // Update the quest message with language
            await this.quests.updateMessage(ctx, quest, language);

        } catch (error) {
            console.error('Error updating task schedule:', error);
            throw error;
        }
    }

    async removeRecurringTask(ctx) {
        console.log("REMOVE RECURRING ACTION");
        const [holonId, messageId] = ctx.match[1].split('_');
        
        try {
            // Find the task in recurring lookup
            const lookup = await this.getRecurringLookup(holonId, messageId);
            
            if (!lookup) {
                console.log('No recurring task lookup found to remove');
                ctx.answerCbQuery('Task not found');
                return;
            }

            // Get the actual task using the taskID from lookup
            const task = await this.db.holosphere.getGlobal('recurring', lookup.taskID);
            
            if (!task) {
                console.log('No recurring task found to remove');
                ctx.answerCbQuery('Task not found');
                return;
            }

            // Stop the task (this will clean up all records)
            await this.stopTask(task.id);

            // Notify user
            ctx.answerCbQuery('Recurring task removed');
            
            // Delete the message
            ctx.deleteMessage().catch(err => console.error('Error deleting message:', err));

        } catch (error) {
            console.error('Error removing recurring task:', error);
            ctx.answerCbQuery('Error removing recurring task');
        }
    }

    async handleWhenCommand(ctx) {
        const holonId = ctx.message.chat.id;
        const messageId = ctx.message.message_id;
        
        // Show calendar for selecting date/time
        await this.showCalendar(holonId, messageId);
    }

    async showCalendar(ctx, questId) {
        try {
            const holonId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;
            
            // Store quest ID for later retrieval
            this.calendar.questIds.set(holonId, questId);
            
            // Get the quest to keep its message
            const quest = await this.db.get(`${holonId}/quests`, questId);
            if (!quest) {
                console.log('Quest not found for calendar');
                return;
            }

            // Generate calendar markup using Calendar class's createNavigationKeyboard
            const now = new Date();
            now.setDate(1);
            const calendarMarkup = this.calendar.createNavigationKeyboard(now, holonId);
            
            // Update only the markup, keeping the original message
            await this.bot.telegram.editMessageReplyMarkup(
                holonId,
                messageId,
                null,
                calendarMarkup
            );
            
        } catch (error) {
            console.error('Error showing calendar:', error);
            console.error(error.stack); // Add stack trace for debugging
            throw error;
        }
    }

    async handleCalendarNavigation(ctx) {
        try {
            // Let the Calendar class handle the navigation
            const result = await this.calendar.clickButtonCalendar(ctx);
            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling calendar navigation:', error);
            await ctx.answerCbQuery('Error navigating calendar');
        }
    }

    async handleTimeSelection(ctx) {
        try {
            const holonId = ctx.callbackQuery.message.chat.id;
            const calendarMsgId = ctx.callbackQuery.message.message_id;
            // Assuming dateTimeStr is 'YYYY-MM-DD HH:mm' from the calendar callback
            const dateTimeStr = ctx.match[1].split('_')[0];

            // --- Use dayjs for timezone-aware parsing --- 
            let chatTimezone = await this.settings.getTimezone(holonId);

            // Validate timezone and set default if invalid
            if (!chatTimezone || typeof chatTimezone !== 'string') {
                console.log(`Invalid timezone for chat ${holonId}, using UTC.`);
                chatTimezone = 'UTC';
            }

            // Parse the date/time string in the specified chat timezone
            const localSelectedDayjs = dayjs.tz(dateTimeStr, "YYYY-MM-DD HH:mm", chatTimezone);

            // Validate the parsed date (this will catch invalid timezones passed to dayjs.tz)
            if (!localSelectedDayjs.isValid()) {
                console.error(`Could not parse dateTimeStr into a valid dayjs object: ${dateTimeStr} with timezone ${chatTimezone}`);
                await ctx.answerCbQuery('Error parsing selected time.');
                return;
            }

            // Convert to standard JavaScript Date object (which is always UTC)
            const selectedDate = localSelectedDayjs.toDate(); 
            // -------------------------------------------

            // Get quest ID from calendar
            const questId = this.calendar.questIds.get(holonId);
            
            if (!questId) {
                console.log('No quest ID found');
                await ctx.answerCbQuery('Could not find associated task');
                return;
            }
            
            // Get quest
            const quest = await this.db.get(`${holonId}/quests`, questId);

            
            if (!quest) {
                await ctx.answerCbQuery('Task not found');
                return;
            }
            
            // Update quest
            quest.status = 'scheduled';
            quest.when = selectedDate; // Store the UTC Date object
            await this.db.put(`${holonId}/quests`, quest);
            
            // Schedule reminder using the scheduler instead of setTimeout
            await this.scheduleOneTimeReminder(quest, ctx);
            

            // Get language
            const language = await this.settings.getLanguage(holonId);
            
            // Update calendar message with quest info using centralized helper
            const markup = this.quests.markup(quest, language);
            await this.quests.updateQuestMessage(ctx, quest, holonId, calendarMsgId, language, markup);
              
          // Clear stored quest ID
            this.calendar.questIds.delete(holonId);
            
            await ctx.answerCbQuery('Task scheduled successfully!');
        } catch (error) {
            console.error('Error in time selection:', error);
            console.error(error.stack);
            await ctx.answerCbQuery('Error scheduling task');
        }
    }

    async scheduleOneTimeReminder(quest, ctx) {
        try {
            // Enhanced debug logging to help diagnose issues
            
            if (ctx && ctx.callbackQuery) {
                // Context available
            }
            
            if (!quest.when) {
                console.error('Cannot schedule reminder: no when date provided for quest', quest.id);
                return;
            }
            
            const reminderDate = new Date(quest.when);
            const now = new Date();
            
            
            // If the date is in the past, don't schedule
            if (reminderDate <= now) {
                console.log(`Reminder date ${reminderDate} is in the past, not scheduling`);
                return;
            }
            
            // Cancel any existing reminder for this quest
            if (quest.reminderId) {
                await this.cancelReminder(quest.reminderId);
                console.log(`Cancelled existing reminder ${quest.reminderId} for quest ${quest.id}`);
            }
            
            
            // Create a unique ID for this reminder job
            const reminderId = `reminder_${quest.id}_${now.getTime()}`;
            
            // Calculate cron expression for the specific date and time using UTC components
            const minute = reminderDate.getUTCMinutes();
            const hour = reminderDate.getUTCHours();
            const day = reminderDate.getUTCDate();
            const month = reminderDate.getUTCMonth() + 1; // Months are 1-indexed in JS, Cron months are 1-indexed
            const cronExpression = `${minute} ${hour} ${day} ${month} *`; // At specific UTC minute/hour/day/month


            const schedQuestHolon = getQuestHolon(quest);

            // Create the job, explicitly setting the timezone to UTC
            const job = new CronJob(cronExpression, async() => {
                try {
                    console.log(`Executing reminder for quest ${quest.id}`);

                    // Get fresh copy of the quest in case it was updated
                    const freshQuest = await this.db.get(`${schedQuestHolon}/quests`, quest.id);
                    if (!freshQuest) {
                        console.log(`Quest ${quest.id} no longer exists, skipping reminder`);
                        // Clean up the reminder record since the quest no longer exists
                        await this.deleteReminderRecord(reminderId);
                        return;
                    }

                    const freshQuestHolon = getQuestHolon(freshQuest);

                    // Check if the quest is still scheduled (not completed or cancelled)
                    if (freshQuest.status !== 'scheduled') {
                        console.log(`Quest ${quest.id} is no longer scheduled (status: ${freshQuest.status}), skipping reminder`);
                        // Clean up the reminder record since the quest is not scheduled
                        await this.deleteReminderRecord(reminderId);
                        return;
                    }

                    // Create mockCtx for the reminder with proper telegram instance
                    const mockCtx = {
                        callbackQuery: {
                            message: {
                                chat: {
                                    id: freshQuestHolon
                                },
                                message_id: freshQuest.id
                            }
                        },
                        telegram: this.bot.telegram,
                        reply: (text, options) => {
                            return this.bot.telegram.sendMessage(freshQuestHolon, text, options);
                        }
                    };

                    // Try direct message approach first
                    try {
                        const language = await this.settings.getLanguage(freshQuestHolon);
                        await this.bot.telegram.sendMessage(
                            freshQuestHolon,
                            'Reminder: "' + freshQuest.title + '" is starting now!',
                            { reply_to_message_id: freshQuest.id }
                        );
                        console.log(`Direct reminder sent for quest ${freshQuest.id} in holon ${freshQuestHolon}`);
                    } catch (directError) {
                        console.error('Error sending direct reminder message:', directError);

                        // Fall back to using the remind method
                        try {
                            await this.quests.remind(mockCtx, freshQuest);
                            console.log(`Fallback reminder sent for quest ${freshQuest.id}`);
                        } catch (remindError) {
                            console.error('Error in fallback reminder method:', remindError);
                        }
                    }

                    // Stop and remove this job after execution
                    this.jobs.delete(reminderId);
                    job.stop();

                    // Clean up the reminder from the global table
                    await this.deleteReminderRecord(reminderId);

                } catch (error) {
                    console.error('Error executing reminder:', error);
                }
            }, null, false, 'UTC'); // Explicitly set timezone to UTC

            // Store the job
            this.jobs.set(reminderId, job);

            // Start the job
            job.start();


            // Save the reminder ID with the quest for potential cancellation
            quest.reminderId = reminderId;
            await this.db.put(`${schedQuestHolon}/quests`, quest);

            // Store reminder data in global reminders table for persistence across restarts
            await this.saveReminderRecord({
                id: reminderId,
                questId: quest.id,
                holonId: schedQuestHolon,
                when: reminderDate.toISOString(), // Convert Date to string for Nostr serialization
                cronExpression: cronExpression,
                title: quest.title || "Task reminder",
                createdAt: now.toISOString() // Convert Date to string for Nostr serialization
            });
            
            return reminderId;
        } catch (error) {
            console.error('Error scheduling one-time reminder:', error);
            return null;
        }
    }

    async saveReminderRecord(reminder) {
        try {
            // Store in the global reminders table
            await this.db.holosphere.putGlobal('reminders', reminder);

            // Create lookup reference for easy retrieval
            const lookupKey = `${reminder.holonId}${reminder.questId}`;
            const lookupData = {
                id: lookupKey,
                reminderId: reminder.id
            };

            await this.db.holosphere.putGlobal('reminderslookup', lookupData);

            return true;
        } catch (error) {
            console.error('Error saving reminder record:', error);
            console.error('Failed reminder data:', JSON.stringify(reminder, null, 2));
            return false;
        }
    }
    
    async deleteReminderRecord(reminderId) {
        try {
            console.log(`Deleting reminder record: ${reminderId}`);
            
            // Get the reminder to find associated lookup
            const reminder = await this.db.holosphere.getGlobal('reminders', reminderId);
            if (reminder) {
                // Delete the lookup record if it exists
                const lookupId = `${reminder.holonId}${reminder.questId}`;
                await this.db.holosphere.deleteGlobal('reminderslookup', lookupId);
                console.log(`Deleted reminder lookup: ${lookupId}`);
            }
            
            // Delete the main reminder record
            await this.db.holosphere.deleteGlobal('reminders', reminderId);
            console.log(`Deleted reminder record: ${reminderId}`);
            
            return true;
        } catch (error) {
            console.error(`Error deleting reminder record ${reminderId}:`, error);
            return false;
        }
    }

    async cancelReminder(reminderId) {
        try {
            if (!reminderId) {
                console.log('No reminder ID provided to cancel');
                return false;
            }
            
            console.log(`Cancelling reminder: ${reminderId}`);
            
            // Get the job from the jobs map
            const job = this.jobs.get(reminderId);
            
            if (job) {
                job.stop();
                this.jobs.delete(reminderId);
                console.log(`Stopped running reminder job: ${reminderId}`);
            } else {
                console.log(`No running job found for reminder: ${reminderId}`);
            }
            
            // Delete the reminder from the global table
            await this.deleteReminderRecord(reminderId);
            
            console.log(`Successfully cancelled reminder: ${reminderId}`);
            return true;
        } catch (error) {
            console.error(`Error cancelling reminder ${reminderId}:`, error);
            return false;
        }
    }

    async handleTimeNavigation(ctx) {
        try {
            // Let the Calendar class handle the navigation
            const result = await this.calendar.clickButtonCalendar(ctx);
            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error handling time navigation:', error);
            await ctx.answerCbQuery('Error navigating time');
        }
    }

    async handleBackToQuest(ctx) {
        try {
            const holonId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;
            
            // Get quest ID from calendar
            const questId = this.calendar.questIds.get(holonId);
            
            if (!questId) {
                await ctx.answerCbQuery('Could not find associated task');
                return;
            }
            
            // Get quest
            const quest = await this.db.get(`${holonId}/quests`, questId);
            if (!quest) {
                await ctx.answerCbQuery('Task not found');
                return;
            }
            
            // Get language
            const language = await this.settings.getLanguage(holonId);
            
            // Use the quest's updateMessage method to properly restore the quest
            // This will handle both text and image quests correctly
            await this.quests.updateMessage(ctx, quest, language);
            
            // Clear stored quest ID
            this.calendar.questIds.delete(holonId);
            
            await ctx.answerCbQuery('Returned to task');
        } catch (error) {
            console.error('Error returning to quest:', error);
            await ctx.answerCbQuery('Error returning to task');
        }
    }

    async handleBackToCalendar(ctx) {
        try {
            // Get the quest ID and show calendar again
            const holonId = ctx.callbackQuery.message.chat.id;
            const questId = this.calendar.questIds.get(holonId);
            
            if (!questId) {
                console.log('No quest ID found for calendar');
                await ctx.answerCbQuery('Could not find associated task');
                return;
            }

            // Show calendar again
            await this.showCalendar(ctx, questId);
            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error going back to calendar:', error);
            await ctx.answerCbQuery('Error showing calendar');
        }
    }

    async schedule(ctx) {
        try {
            const holonId = ctx.callbackQuery.message.chat.id;
            const questId = ctx.callbackQuery.data.split('_')[3];
            
            // Verify quest exists
            const quest = await this.db.get(`${holonId}/quests`, questId);
            
            if (!quest) {
                console.log(`Quest ${questId} not found`);
                await ctx.answerCbQuery('Could not find the task');
                return;
            }
            
            // Get language for the message
            const language = await this.settings.getLanguage(holonId);

            // Store quest ID for later retrieval
            this.calendar.questIds.set(holonId, questId);

            // Generate calendar markup
            const now = new Date();
            now.setDate(1);
            const calendarMarkup = this.calendar.createNavigationKeyboard(now, holonId);

            // Check if quest is shown as image
            const showImages = process.env.SHOW_QUESTS_AS_IMAGES === 'true';

            if (showImages) {
                // For image messages, only edit the reply markup
                await ctx.editMessageReplyMarkup(calendarMarkup).catch((err) => {
                    // Ignore "message is not modified" error
                    if (!err.response?.description?.includes('message is not modified')) {
                        throw err;
                    }
                });
            } else {
                // For text messages, edit both text and markup
                const originalMessage = await this.quests.createMessage(quest, language);
                await ctx.editMessageText(
                    originalMessage,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: calendarMarkup
                    }
                ).catch((err) => {
                    // Ignore "message is not modified" error
                    if (!err.response?.description?.includes('message is not modified')) {
                        throw err;
                    }
                });
            }

            await ctx.answerCbQuery().catch()
        } catch (error) {
            console.error('Error in schedule:', error);
            console.error('Error stack:', error.stack);
            await ctx.answerCbQuery('Error showing calendar');
        }
    }

    async createRecurringTask(task) {
        try {
            // Generate a unique ID if not provided
            if (!task.id) {
                task.id = Date.now().toString();
            }
            
            // Validate the chat ID - check both holonId and chat properties
            const holonId = task.holonId || task.chat;
            if (!holonId || holonId === 0) {
                console.error('Invalid holonId in createRecurringTask:', task);
                throw new Error('Invalid chat ID');
            }

            // Ensure the task has the holonId property for consistency
            task.holonId = holonId;
            
            console.log('Creating recurring task with chat ID:', task.holonId);
            console.log('Task details:', {
                id: task.id,
                title: task.title,
                frequency: task.frequency,
                questId: task.questId || 'not set'
            });
            
            // Save to database
            await this.db.holosphere.putGlobal('recurring', task);

            // Create lookup reference
            const lookupId = task.holonId + task.questId;
            await this.db.holosphere.putGlobal('recurringlookup', {
                id: lookupId,
                taskID: task.id
            });
            console.log(`Created lookup reference: ${lookupId} -> ${task.id}`);
            
            // Create a valid context for scheduling
            const mockCtx = {
                message: {
                    chat: { 
                        id: task.holonId
                    },
                    from: task.initiator,
                    text: `/recurring ${task.title}`
                },
                telegram: this.bot.telegram,
                reply: (text, extra) => {
                    return this.bot.telegram.sendMessage(task.holonId, text, extra);
                }
            };
            
            // Schedule the task
            await this.scheduleTask(task, mockCtx);
            
            console.log('Created recurring task:', task.id, 'for chat ID:', task.holonId);
            return task.id;
        } catch (error) {
            console.error('Error creating recurring task:', error);
            throw error;
        }
    }

    async updateRecurringTask(taskId, updates) {
        try {
            // Get existing task
            const task = await this.db.holosphere.getGlobal('recurring', taskId);
            if (!task) {
                throw new Error(`Task with ID ${taskId} not found`);
            }
            
            console.log('Updating recurring task:', taskId, 'for chat ID:', task.holonId);
            
            // Verify holonId exists and is valid
            if (!task.holonId || task.holonId === 0) {
                console.error('Invalid holonId in task to update:', task);
                throw new Error('Invalid chat ID in existing task');
            }
            
            // Update task properties but preserve the original holonId
            const originalholonId = task.holonId;
            Object.assign(task, updates);
            
            // Ensure holonId wasn't lost or changed incorrectly
            if (!task.holonId || task.holonId === 0) {
                task.holonId = originalholonId;
                console.log('Restored original holonId:', originalholonId);
            }
            
            // Save updated task
            await this.db.holosphere.putGlobal('recurring', task);
            
            // Stop existing job
            const existingJob = this.jobs.get(taskId);
            if (existingJob) {
                existingJob.stop();
                this.jobs.delete(taskId);
            }
            
            // Create a valid context for rescheduling
            const mockCtx = {
                message: {
                    chat: { 
                        id: task.holonId 
                    },
                    from: task.initiator,
                    text: `/task ${task.title}`
                },
                telegram: this.bot.telegram,
                reply: (text, extra) => {
                    return this.bot.telegram.sendMessage(task.holonId, text, extra);
                }
            };
            
            // Reschedule with updated parameters
            await this.scheduleTask(task, mockCtx);
            
            console.log('Updated recurring task:', taskId, 'for chat ID:', task.holonId);
            return true;
        } catch (error) {
            console.error('Error updating recurring task:', error);
            return false;
        }
    }

    async loadReminders() {
        console.log('Loading saved one-time reminders...');
        try {
            // Get all reminders from the global reminders table
            const reminders = await this.db.holosphere.getAllGlobal('reminders');
            let loadedReminders = 0;
            
            if (reminders && reminders.length > 0) {
                console.log(`Found ${reminders.length} reminder(s) to load`);
                
                for (const reminder of reminders) {
                    try {
                        // Check if reminder is still valid
                        const reminderDate = new Date(reminder.when);
                        const now = new Date();
                        
                        // Skip reminders in the past
                        if (reminderDate <= now) {
                            console.log(`Reminder ${reminder.id} for quest ${reminder.questId} has passed, removing it`);
                            await this.deleteReminderRecord(reminder.id);
                            continue;
                        }
                        
                        // Check if quest still exists
                        try {
                            const quest = await this.db.get(`${reminder.holonId}/quests`, reminder.questId);
                            
                            // Skip if quest doesn't exist anymore or is not scheduled
                            if (!quest) {
                                console.log(`Quest ${reminder.questId} for reminder ${reminder.id} no longer exists, removing reminder`);
                                await this.deleteReminderRecord(reminder.id);
                                continue;
                            }
                            
                            if (quest.status !== 'scheduled') {
                                console.log(`Quest ${reminder.questId} is no longer scheduled (status: ${quest.status}), removing reminder ${reminder.id}`);
                                await this.deleteReminderRecord(reminder.id);
                                continue;
                            }
                            
                            // Create a CronJob for this reminder
                            console.log(`Scheduling reminder ${reminder.id} for quest ${reminder.questId} at ${reminderDate}`);
                            
                            // Create the job with the saved cron expression
                            const job = new CronJob(reminder.cronExpression, async() => {
                                try {
                                    console.log(`Executing reminder for quest ${reminder.questId}`);
                                    
                                    // Get fresh copy of the quest
                                    const freshQuest = await this.db.get(`${reminder.holonId}/quests`, reminder.questId);
                                    if (!freshQuest) {
                                        console.log(`Quest ${reminder.questId} no longer exists, skipping reminder`);
                                        await this.deleteReminderRecord(reminder.id);
                                        return;
                                    }
                                    
                                    // Check if the quest is still scheduled
                                    if (freshQuest.status !== 'scheduled') {
                                        console.log(`Quest ${reminder.questId} is no longer scheduled (status: ${freshQuest.status}), skipping reminder`);
                                        await this.deleteReminderRecord(reminder.id);
                                        return;
                                    }
                                    
                                    // Create mockCtx for the reminder
                                    const mockCtx = {
                                        callbackQuery: {
                                            message: {
                                                chat: {
                                                    id: reminder.holonId
                                                },
                                                message_id: reminder.questId
                                            }
                                        },
                                        telegram: this.bot.telegram,
                                        reply: (text, options) => {
                                            return this.bot.telegram.sendMessage(reminder.holonId, text, options);
                                        }
                                    };
                                    
                                    // Try direct message approach first
                                    try {
                                        
                                        const language = await this.settings.getLanguage(reminder.holonId);
                                        const timezone =
                                        await this.bot.telegram.sendMessage(
                                            reminder.holonId,
                                            'Reminder: "' + freshQuest.title + '" is starting now!',
                                            { reply_to_message_id: reminder.questId }
                                        );
                                        console.log(`Direct reminder sent for quest ${reminder.questId} in chat ${reminder.holonId}`);
                                    } catch (directError) {
                                        console.error('Error sending direct reminder message:', directError);
                                        
                                        // Fall back to using the remind method
                                        try {
                                            await this.quests.remind(mockCtx, freshQuest);
                                            console.log(`Fallback reminder sent for quest ${reminder.questId}`);
                                        } catch (remindError) {
                                            console.error('Error in fallback reminder method:', remindError);
                                        }
                                    }
                                    
                                    // Clean up after execution
                                    this.jobs.delete(reminder.id);
                                    job.stop();
                                    await this.deleteReminderRecord(reminder.id);
                                    
                                } catch (error) {
                                    console.error(`Error executing reminder ${reminder.id}:`, error);
                                }
                            }, null, false, 'UTC');
                            
                            // Store job reference
                            this.jobs.set(reminder.id, job);
                            
                            // Start the job
                            job.start();
                            
                            loadedReminders++;
                            
                        } catch (error) {
                            console.error(`Error verifying quest for reminder ${reminder.id}:`, error);
                            // Clean up invalid reminders
                            await this.deleteReminderRecord(reminder.id);
                        }
                        
                    } catch (error) {
                        console.error(`Error loading reminder ${reminder.id}:`, error);
                    }
                }
            } else {
                log.debug('No saved reminders found');
            }

            log.info(`Loaded ${loadedReminders} reminder(s)`);
            
        } catch (error) {
            console.error('Error loading reminders:', error);
        }
    }

    async migrateRecurringLookup() {
        console.log('Migrating recurring lookup from underscore to pipe format...');
        try {
            const lookups = await this.db.holosphere.getAllGlobal('recurringlookup');
            let migratedCount = 0;

            if (lookups && lookups.length > 0) {
                console.log(`Found ${lookups.length} recurring lookup records to migrate.`);
                for (const lookup of lookups) {
                    if (lookup?.id?.includes('_')) {
                        const [holonId, questId] = lookup.id.split('_');
                        const newLookupId = `${holonId}|${questId}`;
                        await this.db.holosphere.deleteGlobal('recurringlookup', lookup.id);
                        await this.db.holosphere.putGlobal('recurringlookup', {
                            id: newLookupId,
                            taskID: lookup.taskID
                        });
                        console.log(`Migrated lookup: ${lookup.id} -> ${newLookupId}`);
                        migratedCount++;
                    }
                }
                console.log(`Successfully migrated ${migratedCount} recurring lookup records.`);
            } else {
                console.log('No recurring lookup records to migrate.');
            }
        } catch (error) {
            console.error('Error migrating recurring lookup:', error);
        }
    }
}

export default Scheduler;