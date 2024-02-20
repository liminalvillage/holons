import { CronJob } from 'cron'; // You may need to install the 'cron' package

class Scheduler {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
        this.this.db = null; // Database for tasks
        this.loadTasks();
    }

    async loadTasks() {
        // Initialize or load the tasks database
  
    }

    async addTask(ctx) {
        const chatID = ctx.message.chat.id;
        const [frequency, ...taskDetails] = ctx.message.text.split(' ').slice(1);
        const task = {
            chatID,
            taskDetails: taskDetails.join(' '),
            frequency,
            createdAt: new Date(),
            completed: false
        };
        await this.this.db.put(chatID + '/schedule'task);
        this.scheduleTask(task);
        ctx.reply('Task scheduled successfully.');
    }

    scheduleTask(task) {
        const cronTime = this.getCronTime(task.frequency);
        const job = new CronJob(cronTime, () => {
            this.remindTask(task);
        }, null, true, 'UTC');
        job.start();
    }

    getCronTime(frequency) {
        // Convert frequency to a cron format string
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
                return '0 0 0 * * *'; // Default to every minute (for testing)
        }
    }

    async remindTask(task) {
        const chatID = task.chatID;
        if (!task.completed) {
            this.bot.telegram.sendMessage(chatID, `Reminder: ${task.taskDetails}`);
            // Check if the task is completed and update the database accordingly
        }
    }

    async markTaskCompleted(ctx) {
        const chatID = ctx.message.chat.id;
        const taskDetails = ctx.message.text.split(' ').slice(1).join(' ');
        const tasks = await this.this.db.query((doc) => doc.chatID === chatID && doc.taskDetails === taskDetails);
        if (tasks.length > 0) {
            let task = tasks[0];
            task.completed = true;
            await this.this.db.put(chatID + '/schedule',task);
            ctx.reply('Task marked as completed.');
        } else {
            ctx.reply('Task not found.');
        }
    }

    // Additional methods as needed, such as listTasks, deleteTask, etc.
}

export default Scheduler;