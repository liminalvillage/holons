import { CronJob } from 'cron';

class Scheduler {
    constructor(bot, db, quests) {
        this.bot = bot;
        this.db = db;
        this.quests = quests; // Reference to Quests class
        this.jobs = new Map(); // Store active cron jobs
        this.loadTasks();

        this.bot.command('recurring', async (ctx) => await this.addTask(ctx));
        this.bot.action(/remove_recurring_(.+)/, (ctx) => this.removeRecurringTask(ctx));
    }

    async loadTasks() {
        // Load all recurring tasks from database and schedule them
        const tasks = await this.db.getAll('recurring');
        if (tasks && tasks.length > 0) {
            tasks.forEach(task => {
                // Create a mock ctx object from the task data
                const mockCtx = {
                    message: {
                        chat: {
                            id: task.chatID
                        },
                        from: task.initiator,
                        message_id: task.id
                    },
                    from: task.initiator
                };
                
                this.scheduleTask(task, mockCtx);
            });
        }
    }

    async addTask(ctx) {
        const chatID = ctx.message.chat.id;
        const [frequency, ...taskDetails] = ctx.message.text.split(' ').slice(1);
        
        if (!frequency || taskDetails.length === 0) {
            ctx.reply('Usage: /recurring [frequency] [task description]\nFrequencies: 30sec, daily, weekly, monthly, quarterly, yearly\nUse /when to set the start time');
            return;
        }

        // Validate frequency
        const validFrequencies = ['30sec', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];
        if (!validFrequencies.includes(frequency.toLowerCase())) {
            ctx.reply(`Invalid frequency. Please use one of: ${validFrequencies.join(', ')}`);
            return;
        }

        let quest = await this.quests.quest('recurring', ctx);
        console.log('QUEST', quest);
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
        await this.db.put('recurring', task);
        
        // Schedule the task
        await this.scheduleTask(task,ctx);
        
        const timeStr = new Date(task.when).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        ctx.reply(`Recurring task "${task.title}" scheduled ${task.frequency} starting at ${timeStr}`);
    }

    scheduleTask(task,ctx) {
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
         this.quests.quest('recurring', ctx);
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
            await this.db.del('recurring', taskId);
            return true;
        }
        return false;
    }

    async updateTaskSchedule(chatId, questId, newDate) {
        // Find the task in recurring database
        const tasks = await this.db.getAll('recurring');
        const task = tasks.find(t => 
            t.chatID === chatId && 
            t.title === questId // Using title to match since questId is likely the title
        );

        if (!task) {
            console.log('No recurring task found to update schedule');
            return;
        }

        // Update the task's when field
        task.when = newDate;

        // Stop the existing cron job
        const existingJob = this.jobs.get(task.id);
        if (existingJob) {
            existingJob.stop();
            this.jobs.delete(task.id);
        }

        // Update in database
        await this.db.put('recurring', task);

        // Create new schedule with updated time
        this.scheduleTask(task);

        console.log(`Updated recurring task schedule: ${task.title} to ${newDate}`);
    }

    async removeRecurringTask(ctx) {
        console.log("REMOVE RECURRING ACTION");
        const [chatId, messageId] = ctx.match[1].split('_');
        
        try {
            // Find the task in recurring database
            const tasks = await this.db.getAll('recurring');
            const task = tasks.find(t => 
                t.chatID.toString() === chatId && 
                t.id.toString() === messageId
            );

            if (!task) {
                console.log('No recurring task found to remove');
                ctx.answerCbQuery('Task not found');
                return;
            }

            // Check if user is initiator or admin
            if (task.initiator.id !== ctx.from.id) {
                ctx.answerCbQuery('Only the task creator can remove recurring tasks');
                return;
            }

            // Stop the cron job
            const job = this.jobs.get(task.id);
            if (job) {
                job.stop();
                this.jobs.delete(task.id);
            }

            // Remove from database
            await this.db.del('recurring', task.id);

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