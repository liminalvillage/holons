/**
 * @fileoverview AI-powered council for multi-perspective wisdom generation.
 * @module src/Council
 */

import OpenAI from 'openai';
import h3 from 'h3-js';

const MAX_POLLING_ATTEMPTS = 150; // 5 minutes at 2-second intervals

/**
 * Council perspective prompts for diverse viewpoints.
 * @type {string[]}
 */
let council = [
    'Answer the questions from the embodied perspective of Values and Worldview',
    'Answer the questions from the embodied perspective of Health & Wellbeing',
    'Answer the questions from the embodied perspective of Food & Agriculture',
    'Answer the questions from the embodied perspective of Business & Trade',
    'Answer the questions from the embodied perspective of Energy & Resources',
    'Answer the questions from the embodied perspective of Climate Change',
    'Answer the questions from the embodied perspective of Ecosystems & Biosphere',
    'Answer the questions from the embodied perspective of Water Availability',
    'Answer the questions from the embodied perspective of Habitat & Infrastructure',
    'Answer the questions from the embodied perspective of Economy & Wealth',
    'Answer the questions from the embodied perspective of Governance & Institutions',
    'Answer the questions from the embodied perspective of Community & Resilience'
]

function emptycell(id){
    return {
        id:id,
        content:{},
    }

}


/**
 * AI-powered council system for generating multi-perspective wisdom.
 *
 * @class Council
 * @description Uses OpenAI Assistants API to generate wisdom from 12 different
 * perspectives representing various domains (health, business, climate, etc.).
 * Each perspective contributes to a holistic understanding of complex questions.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance for cell storage
 * @property {OpenAI} openai - OpenAI client for AI operations
 *
 * @example
 * const council = new Council(bot, db);
 * // Use /wisdom <question> to get multi-perspective insights
 */
class Council {
    /**
     * @param {Object} bot - Telegraf bot instance
     * @param {DB} db - Database instance
     */
    constructor(bot, db) {
        this.bot = bot;
        this.db = db
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI,
        });
        
        this.bot.command("wisdom", async (ctx) => {
            let question = ctx.message.text.split('/wisdom ')[1];
            let answer = await this.askQuestion(question, '802bfffffffffff')
            ctx.reply(answer)
        })

        this.bot.command("summary", async (ctx) => {
            holonId = ctx.message.chat.id
            let hex = ctx.message.text.split('/summary ')[1];
            let cell = await this.db.getGlobal('cell', hex);
            let summary = cell?.summary;
            if (!summary) {
                summary = await this.getChildSummary(hex)
            }
            ctx.reply(summary)
        })
    }

    async getChildSummary(hex) {
        let cellinfo = await this.getCellInfo(hex)
        let res = h3.getResolution(hex)
        //let parent = h3.h3ToParent(hex, res-1)
        let children = h3.cellToChildren(hex, res + 1)
        console.log(children)
        let childwisdom = []
        // loop through the children to get the information

        let summarized

        for (let i = 0; i < children.length; i++) {
            summarized = await this.getCellInfo(children[i]).summary
            childwisdom.push(summarized)
        }
        // summarize the cell
        let summary = await this.summarize(childwisdom.join('\n'))
        cellinfo.summary = summary
        // save the summary

        await this.db.putGlobal('cell', cellinfo)

        return
    }

    async summarize(history) {
        //const run = await this.openai.beta.threads.runs.retrieve(thread.id,run.id)
        const assistant = await this.openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
        const thread = await this.openai.beta.threads.create()
        try {
            const message = await this.openai.beta.threads.messages.create(thread.id, {
                role: "user",
                content: history
            })
            const run = await this.openai.beta.threads.runs.create(thread.id, {
                assistant_id: assistant.id //,
                //instructions: "What is the meaning of life?",
            });

            let runStatus = await this.openai.beta.threads.runs.retrieve(
                thread.id,
                run.id
            );
            // Polling mechanism with timeout to prevent infinite loops
            let attempts = 0;
            while (runStatus.status !== "completed" && attempts < MAX_POLLING_ATTEMPTS) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
                attempts++;
                if (runStatus.status === "failed" || runStatus.status === "cancelled") {
                    throw new Error(`Run ${runStatus.status}: ${runStatus.last_error?.message || 'Unknown error'}`);
                }
            }
            if (attempts >= MAX_POLLING_ATTEMPTS) {
                throw new Error('Polling timeout: run did not complete within 5 minutes');
            }
            // Get the latest messages from the thread
            const messages = await this.openai.beta.threads.messages.list(thread.id)
            const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
            return summary
        } finally {
            // Clean up thread to prevent orphaned resources
            try {
                await this.openai.beta.threads.del(thread.id);
            } catch (cleanupError) {
                console.error('Error cleaning up thread:', cleanupError.message);
            }
        }
    }

    async askQuestion(question, councilID) {
        let assistant = await this.openai.beta.assistants.retrieve("asst_wMvKw4yfH8rn0Uv9yAPn1UMb")
        let councilWisdom = await this.getThreads(councilID)
        //for each thread, create a message
        for (let i = 0; i < councilWisdom.threads.length; i++) {
            let message = await this.openai.beta.threads.messages.create(councilWisdom.threads[i].id, {
                role: "user",
                content: question
            })
        }
        let runs = []
        for (let i = 0; i < councilWisdom.threads.length; i++) {
            runs[i] = await this.openai.beta.threads.runs.create(councilWisdom.threads[i].id, {
                assistant_id: assistant.id,
                instructions: council[i]
            });
        }
        let runStatus;
        // Polling mechanism with timeout to prevent infinite loops
        let attempts = 0;
        while (attempts < MAX_POLLING_ATTEMPTS) {
            let returned = 0
            let failed = 0
            await new Promise((resolve) => setTimeout(resolve, 2000));
            for (let i = 0; i < councilWisdom.threads.length; i++) {
                runStatus = await this.openai.beta.threads.runs.retrieve(councilWisdom.threads[i].id, runs[i].id);
                if (runStatus.status == "completed")
                    returned += 1
                else if (runStatus.status === "failed" || runStatus.status === "cancelled")
                    failed += 1
            }
            console.log(returned)
            if (returned == councilWisdom.threads.length)
                break
            if (failed > 0)
                throw new Error(`${failed} council member(s) failed to respond`);
            attempts++;
        }
        if (attempts >= MAX_POLLING_ATTEMPTS) {
            throw new Error('Polling timeout: council did not complete within 5 minutes');
        }
        //reset wisdom array
        councilWisdom.content.wisdom = []
        //save results
        for (let i = 0; i < councilWisdom.threads.length; i++) {
            // Get the latest messages from the thread
            const messages = await this.openai.beta.threads.messages.list(councilWisdom.threads[i].id)
            const answer = messages.data[0].content[0].text.value
            councilWisdom.content.wisdom.push(answer)
        }
        let summary = await this.summarize(councilWisdom.content.wisdom.join('\n'))
        //await this.db.open('wisdom', { indexBy: 'id' }).put(councilWisdom)
        console.log(councilWisdom.wisdom)
        console.log('--------------------')
        console.log(summary)
        return summary
    }

    async getCellInfo(id) {
        let cellInfo = await this.db.getGlobal('cell', id)
        if (!cellInfo) {
            cellInfo = emptycell(id)
            await this.db.putGlobal('cell', cellInfo)
        }
        return cellInfo

    }

    async getThreads(id) {
        let cell = await this.getCellInfo(id)
        if (!cell.threads) {
            //create 12 threads
            let threads = []
            for (let i = 0; i < 12; i++) {
                threads.push(await this.openai.beta.threads.create())
            }
            cell.threads = threads
        }
        return cell
    }

}

export default Council