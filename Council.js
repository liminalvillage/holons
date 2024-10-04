
import OpenAI from 'openai';
import h3 from 'h3-js';


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


class Council {
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
            chatID = ctx.message.chat.id
            let hex = ctx.message.text.split('/summary ')[1];
            let summary = await this.db.get('cells').get(hex).get('summary')
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

        await this.db.put('cell', cellinfo)

        return
    }

    async summarize(history) {
        //const run = await this.openai.beta.threads.runs.retrieve(thread.id,run.id)
        const assistant = await this.openai.beta.assistants.retrieve("asst_qhk79F8wV9BDNuwfOI80TqzC")
        const thread = await this.openai.beta.threads.create()
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
        // Polling mechanism to see if runStatus is completed
        // This should be made more robust.
        while (runStatus.status !== "completed") {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            runStatus = await this.openai.beta.threads.runs.retrieve(thread.id, run.id);
        }
        // Get the latest messages from the thread
        const messages = await this.openai.beta.threads.messages.list(thread.id)
        const summary = messages.data[0].content[0].text.value.replace(/\`\`\`json\n/, '').replace(/\`\`\`/, '').trim()
        return summary
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
        // Polling mechanism to see if runStatus is completed
        // This should be made more robust.
        while (true) {
            let returned = 0
            await new Promise((resolve) => setTimeout(resolve, 2000));
            for (let i = 0; i < councilWisdom.threads.length; i++) {
                runStatus = await this.openai.beta.threads.runs.retrieve(councilWisdom.threads[i].id, runs[i].id);
                if (runStatus.status == "completed")
                    returned += 1
            }
            console.log(returned)
            if (returned == councilWisdom.threads.length)
                break
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
        let cellInfo = await this.db.get('cell', id)
        if (!cellInfo) {
            cellInfo = emptycell(id)
            await this.db.put('cell', cellInfo)
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