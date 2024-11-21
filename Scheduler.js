import { CronJob } from 'cron';

class Scheduler {
    constructor(bot, db, quests) {
        this.bot = bot;
        this.db = db;
        this.quests = quests; // Reference to Quests class
        this.jobs = new Map(); // Store active cron jobs
        this.loadTasks();


        this.bot.command('recurring', async (ctx) =>  this.addTask(ctx) );
        this.bot.action(/remove_recurring_(.+)/, (ctx) => this.removeRecurringTask(ctx));
    }

    async deleteTasks() {
        // Delete all recurring tasks from database
        await this.db.drop('recurring');
        await this.db.drop('recurringlookup');
    }

    async loadTasks() {
        // Load all recurring tasks from database and schedule them
        const tasks = await this.db.getAll('recurring');

        
        
        if (tasks && tasks.length > 0) {
            tasks.forEach(async task => {
                console.log('LOAD TASK', task);
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
        if (!task.when || task.when === '' || task.frequency === '') {
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

    async updateTaskSchedule(chatId, messageId, newDate, ctx) {
        // Find the task in recurring database
        console.log('UPDATE TASK SCHEDULE', chatId, messageId, newDate);
        const recurringID = await this.db.holosphere.getGlobalKey('recurringlookup', chatId + '_' + messageId);
        console.log('RECURRING ID', recurringID);
        let task = this.db.holosphere.getGlobalKey('recurring', recurringID.taskID);
        
        if (!task) {
            console.log('No recurring task found to update schedule');
            return;
        }

        // Update the task's when field
        task.when = newDate;

        // Stop the existing cron job
        await this.stopTask(task.id);

         this.db.put('recurring',task)


        // Create new schedule with updated time
        this.scheduleTask(task, ctx);

        console.log(`Updated recurring task schedule: ${task.title} to ${newDate}`);
    }

    async removeRecurringTask(ctx) {
        console.log("REMOVE RECURRING ACTION");
        const [chatId, messageId] = ctx.match[1].split('_');
        
        try {
            // Find the task in recurring lookup
            const lookup = await this.db.holosphere.getGlobalKey('recurringlookup', chatId + '_' + messageId);
            
            if (!lookup) {
                console.log('No recurring task lookup found to remove');
                ctx.answerCbQuery('Task not found');
                return;
            }

            // Get the actual task using the taskID from lookup
            const task = await this.db.holosphere.getGlobalKey('recurring', lookup.taskID);
            
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
}

export default Scheduler;