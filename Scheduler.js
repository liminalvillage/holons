import { CronJob } from 'cron';

class Scheduler {
    constructor(bot, db, quests) {
        this.bot = bot;
        this.db = db;
        this.quests = quests; // Reference to Quests class
        this.jobs = new Map(); // Store active cron jobs
        this.loadTasks();

        this.bot.command('recurring', (ctx) => this.addTask(ctx));
    }

    async loadTasks() {
        // Load all recurring tasks from database and schedule them
        const tasks = await this.db.getAll('recurring');
        if (tasks && tasks.length > 0) {
            tasks.forEach(task => {
                this.scheduleTask(task);
            });
        }
    }

    async addTask(ctx) {
        const chatID = ctx.message.chat.id;
        const [frequency, ...taskDetails] = ctx.message.text.split(' ').slice(1);
        
        if (!frequency || taskDetails.length === 0) {
            ctx.reply('Usage: /recurring [frequency] [task description]\nFrequencies: daily, weekly, monthly, quarterly, yearly');
            return;
        }

        const task = {
            id: Date.now().toString(),
            chatID,
            title: taskDetails.join(' '),
            frequency,
            createdAt: new Date(),
            type: 'recurring',
            initiator: ctx.message.from
        };

        // Save to database
        await this.db.put('recurring', task);
        
        // Schedule the task
        this.scheduleTask(task);
        
        ctx.reply(`Recurring task "${task.title}" scheduled ${frequency}`);
    }

    scheduleTask(task) {
        const cronTime = this.getCronTime(task.frequency);
        if (!cronTime) {
            console.error('Invalid frequency:', task.frequency);
            return;
        }

        // Create new cron job
        const job = new CronJob(cronTime, () => {
            this.createQuest(task);
        }, null, true, 'UTC');

        // Store job reference
        this.jobs.set(task.id, job);
        
        // Start the job
        job.start();
    }

    getCronTime(frequency) {
        switch (frequency.toLowerCase()) {
            case 'daily':
                return '0 9 * * *'; // Every day at 9 AM
            case 'weekly':
                return '0 9 * * 1'; // Every Monday at 9 AM
            case 'monthly':
                return '0 9 1 * *'; // First day of every month at 9 AM
            case 'quarterly':
                return '0 9 1 */3 *'; // First day of every third month at 9 AM
            case 'yearly':
                return '0 9 1 1 *'; // Every January 1st at 9 AM
            default:
                return null;
        }
    }

    async createQuest(task) {
        // Create a new quest context
        const ctx = {
            message: {
                chat: { id: task.chatID },
                from: task.initiator,
                text: `/task ${task.title}`,
                message_id: Date.now()
            }
        };

        // Create the quest using the Quests class
        await this.quests.quest('recurring', ctx);
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
}

export default Scheduler;