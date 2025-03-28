import { CronJob } from 'cron';
import { Calendar } from './Calendar.js';

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
        
        this.loadTasks();

        // Add calendar-related commands and handlers
        this.bot.command('droprecurring', async (ctx) => this.deleteTasks(ctx));
        this.bot.command('recurring', async (ctx) => this.addTask(ctx));
        this.bot.command('when', async (ctx) => this.handleWhenCommand(ctx));
        
        // Add bot actions for callbacks
        this.bot.action(/schedule_quest_(.+)/, async (ctx) => {
            console.log("SCHEDULE ACTION - STARTING");
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
                            id: task.chatID
                        },
                        from: task.initiator,
                        message_id: task.id,
                        text: `/recurring ${task.title}`
                    },
                    from: task.initiator,
                    reply: (text, extra) => {
                        return this.bot.telegram.sendMessage(task.chatID, text, extra);
                    },
                    telegram: this.bot.telegram
                };
                
                this.scheduleTask(task, mockCtx);
            });
        }
    }

    async addTask(ctx) {
        const chatID = ctx.message.chat.id;
        const [frequency, ...taskDetails] = ctx.message.text.split(' ').slice(1);
        
        if (!frequency || taskDetails.length === 0) {
            ctx.reply('Usage: /recurring [frequency] [task description]\nFrequencies: 1min, 30sec, daily, weekly, monthly, quarterly, yearly\nUse /when to set the start time');
            return;
        }

        // Validate frequency
        const validFrequencies = ['1min', '30sec', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
        if (!validFrequencies.includes(frequency.toLowerCase())) {
            ctx.reply(`Invalid frequency. Please use one of: ${validFrequencies.join(', ')}`);
            return;
        }

        let quest = await this.quests.quest('recurring', ctx);

        const task = {
            id: quest.id,
            chatID: chatID,
            title: taskDetails,
            frequency: frequency,
            when: new Date(),
            createdAt: new Date(),
            initiator: ctx.message.from
        };

        // Save to database
        await this.db.holosphere.putGlobal('recurring', task);
        await this.db.holosphere.putGlobal('recurringlookup', {id: chatID + '_' + quest.id,  taskID: task.id});
        
        // Schedule the task
        await this.scheduleTask(task,ctx);
        
        const timeStr = new Date(task.when).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        ctx.reply(`Recurring task "${task.title}" scheduled ${task.frequency} starting at ${timeStr}`);
    }

    async scheduleTask(task, ctx) {
        let chatID = task.chatID;
        if (!task.when || !task.frequency) {
            console.error('Invalid task, no when or frequency:', task);
            return;
        }
        console.log('SCHEDULING TASK', task);
        // Use the 'when' field for the first occurrence
        const cronTime = this.getCronTime(task.frequency, task.when);
        if (!cronTime) {
            console.error('Invalid frequency:', task.frequency);
            return;
        }

        // Create new cron job with the specific timezone if provided in the quest
        const timezone = task.timezone || 'UTC';
        const job = new CronJob(cronTime, async() => {
            // Only create and send the quest when the timer triggers
            const quest = await this.quests.quest('recurring', ctx);
            if (!quest) {
                console.error('Failed to create recurring quest');
                return;
            }
            //add the quest id to the lookup table
            await this.db.holosphere.putGlobal('recurringlookup', {id: chatID + '_' + quest.id,  taskID: task.id});
            console.log('Recurring Lookup TASK', chatID + '_' + quest.id, task.id);
        }, null, true, timezone);

        // Store job reference
        this.jobs.set(task.id, job);
        
        // Start the job
        job.start();
    }

    getCronTime(frequency, whenDate) {
        const date = new Date(whenDate);
        const hour = date.getHours();
        const minute = date.getMinutes();
        
        switch (frequency.toLowerCase()) {
            case '1min':
                return '*/1 * * * *'; // Every minute
            case '30sec':
                return '*/30 * * * * *'; // Every 30 seconds
            case 'daily':
                return `${minute} ${hour} * * *`; // Every day at specified hour:minute
            case 'weekly':
                return `${minute} ${hour} * * ${date.getDay()}`; // Every week on same day at specified hour:minute
            case 'monthly':
                return `${minute} ${hour} ${date.getDate()} * *`; // Same day each month at specified hour:minute
            case 'quarterly':
                return `${minute} ${hour} ${date.getDate()} */3 *`; // Every third month on same day at specified hour:minute
            case 'yearly':
                return `${minute} ${hour} ${date.getDate()} ${date.getMonth() + 1} *`; // Same date each year at specified hour:minute
            default:
                return null;
        }
    }


    async stopTask(taskId) {
        const job = this.jobs.get(taskId);
        if (job) {
            job.stop();
            this.jobs.delete(taskId);
            
            // Get all lookup records for this task
            const lookups = await this.db.getAll('recurringlookup');
            const relatedLookups = lookups.filter(lookup => lookup.taskID === taskId);
            
            // Delete all lookup records
            for (const lookup of relatedLookups) {
                await this.db.del('recurringlookup', lookup.id);
            }
            
            // Delete the main task
            await this.db.del('recurring', taskId);
            return true;
        }
        return false;
    }

    async updateTaskSchedule(chatId, questId, selectedDate, ctx) {
        try {
            // Get the quest
            const quest = await this.db.get(`${chatId}/quests`, questId);
            if (!quest) {
                console.log('No quest found to update schedule');
                return;
            }

            // Get language setting
            const language = await this.settings.getLanguage(chatId);

            // Update the quest's when field with the selected date
            quest.when = selectedDate;
            
            // Save the updated quest
            await this.db.put(`${chatId}/quests`, quest);

            // If this is a recurring task, update its schedule
            if (quest.type === 'recurring') {
                const recurringID = await this.db.holosphere.getGlobal('recurringlookup', chatId + '_' + questId);
                if (recurringID) {
                    let task = await this.db.holosphere.getGlobal('recurring', recurringID.taskID);
                    if (task) {
                        task.when = selectedDate;
                        await this.db.put('recurring', task);
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
        const [chatId, messageId] = ctx.match[1].split('_');
        
        try {
            // Find the task in recurring lookup
            const lookup = await this.db.holosphere.getGlobal('recurringlookup', chatId + '_' + messageId);
            
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
        const chatId = ctx.message.chat.id;
        const messageId = ctx.message.message_id;
        
        // Show calendar for selecting date/time
        await this.showCalendar(chatId, messageId);
    }

    async showCalendar(ctx, questId) {
        try {
            const chatId = ctx.callbackQuery.message.chat.id;
            const messageId = ctx.callbackQuery.message.message_id;
            
            // Store quest ID for later retrieval
            this.calendar.questIds.set(chatId, questId);
            
            // Get the quest to keep its message
            const quest = await this.db.get(`${chatId}/quests`, questId);
            if (!quest) {
                console.log('Quest not found for calendar');
                return;
            }

            // Generate calendar markup using Calendar class's createNavigationKeyboard
            const now = new Date();
            now.setDate(1);
            const calendarMarkup = this.calendar.createNavigationKeyboard(now);
            
            // Update only the markup, keeping the original message
            await this.bot.telegram.editMessageReplyMarkup(
                chatId,
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
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling calendar navigation:', error);
            await ctx.answerCbQuery('Error navigating calendar');
        }
    }

    async handleTimeSelection(ctx) {
        try {
            const chatId = ctx.callbackQuery.message.chat.id;
            const calendarMsgId = ctx.callbackQuery.message.message_id;
            const dateTimeStr = ctx.match[1].split('_')[0];
            const selectedDate = new Date(dateTimeStr);
            // Get quest ID from calendar
            const questId = this.calendar.questIds.get(chatId);
            
            if (!questId) {
                console.log('No quest ID found');
                await ctx.answerCbQuery('Could not find associated task');
                return;
            }
            
            // Get quest
            const quest = await this.db.get(`${chatId}/quests`, questId);

            
            if (!quest) {
                await ctx.answerCbQuery('Task not found');
                return;
            }
            
            // Update quest
            quest.status = 'scheduled';
            quest.when = selectedDate;
            await this.db.put(`${chatId}/quests`, quest);
            
            // Set reminder
            setTimeout(() => {
                this.quests.remind(ctx, quest);
            }, new Date(selectedDate).getTime() - Date.now());

            // Get language
            const language = await this.settings.getLanguage(chatId);
            
            // Update calendar message with quest info
            const messageText = await this.quests.createMessage(quest, language);
            const markup = this.quests.markup(quest, language);
            
            await ctx.telegram.editMessageText(
                chatId,
                calendarMsgId,
                null,
                messageText,
                markup
            );
              
          // Clear stored quest ID
            this.calendar.questIds.delete(chatId);
            
            await ctx.answerCbQuery('Task scheduled successfully!');
        } catch (error) {
            console.error('Error in time selection:', error);
            console.error(error.stack);
            await ctx.answerCbQuery('Error scheduling task');
        }
    }

    async handleTimeNavigation(ctx) {
        try {
            // Let the Calendar class handle the navigation
            const result = await this.calendar.clickButtonCalendar(ctx);
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error handling time navigation:', error);
            await ctx.answerCbQuery('Error navigating time');
        }
    }

    async handleBackToCalendar(ctx) {
        try {
            // Get the quest ID and show calendar again
            const chatId = ctx.callbackQuery.message.chat.id;
            const questId = this.calendar.questIds.get(chatId);
            
            if (!questId) {
                console.log('No quest ID found for calendar');
                await ctx.answerCbQuery('Could not find associated task');
                return;
            }

            // Show calendar again
            await this.showCalendar(ctx, questId);
            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error going back to calendar:', error);
            await ctx.answerCbQuery('Error showing calendar');
        }
    }

    async schedule(ctx) {
        console.log("SCHEDULE ACTION - STARTING");
        try {
            const chatId = ctx.callbackQuery.message.chat.id;
            const questId = ctx.callbackQuery.data.split('_')[3];

            console.log('Schedule parameters:', {
                chatId,
                questId,
                callbackData: ctx.callbackQuery.data,
                messageId: ctx.callbackQuery.message.message_id
            });
            
            // Verify quest exists
            const quest = await this.db.get(`${chatId}/quests`, questId);
            console.log('Quest found:', quest ? 'YES' : 'NO');
            
            if (!quest) {
                console.log(`Quest ${questId} not found`);
                await ctx.answerCbQuery('Could not find the task');
                return;
            }

            // Store quest ID for later retrieval
            this.calendar.questIds.set(chatId, questId);
            console.log('Stored quest ID in calendar:', questId);

            // Generate calendar markup
            const now = new Date();
            now.setDate(1);
            const calendarMarkup = this.calendar.createNavigationKeyboard(now);
            console.log('Calendar markup generated - will show calendar');

            // Show calendar
            await ctx.editMessageReplyMarkup(calendarMarkup);
            console.log('Calendar displayed - waiting for user to select date/time');

            await ctx.answerCbQuery();
        } catch (error) {
            console.error('Error in schedule:', error);
            console.error('Error stack:', error.stack);
            await ctx.answerCbQuery('Error showing calendar');
        }
    }
}

export default Scheduler;