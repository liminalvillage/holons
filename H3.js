import 'dotenv/config'
import h3 from 'h3-js';
import DB from './DB.js';
import OpenAI from 'openai';
import { Telegraf } from 'telegraf';
import GUN from 'gun';

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
        threads:[],
        content:{},
        wisdom:[],
        summary:''
    }

}

class H3 {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;    
        this.gun = GUN({
            peers: ['https://59.src.eco/gun']
        });


        (async () => {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI,
            });

        })();

        this.bot.command("wisdom", async (ctx) => {
            let question = ctx.message.text.split('/wisdom ')[1];
            let answer = await this.askQuestion(question, '802bfffffffffff')
            ctx.reply(answer)
        })

        this.bot.command("summary", async (ctx) => {
            let hex = ctx.message.text.split('/summary ')[1];
            let summary = await this.db.get('cells', { indexBy: 'id' }).get(hex)[0].summary
            if (!summary){
                summary = await this.getChildSummary(hex)
            }
            ctx.reply(summary)
        })

    }

    async init() {
       await this.db.open('cell')
    }
    async delete(id, tag){
        await this.gun.get('WeQuest').get(id).get(tag).put(null)
    }

    async put(id, tag, content){
        let res = h3.getResolution(id)
        let info = await this.getCellInfo(id)
        if (!info.content[tag]) {
            info.content[tag] = {}
        }
        if (!info.content[tag][content]) {
            info.content[tag][content] = 1
        }
        else   
            info.content[tag][content] += 1
        // let item = this.gun.get('WeQuest').get(id).get('content').put(content)
        // this.gun.get('WeQuest').get(id).get(tag).set(item)

        await this.db.put('cell',info)
    }

    async get(id, tag){
        // await this.gun.get('WeQuest').get(id).get(tag).on((data) => {console.log(data)})
        let info = await this.getCellInfo(id)
        return info.content[tag]
    }


   async  upcast(id, tag, content){
        let res = h3.getResolution(id)
        let parent = h3.cellToParent(id, res-1)
        let info = await this.getCellInfo(parent)
        if (!info.content[tag]) {
            info.content[tag] = {}
        }
        if (!info.content[tag][content]) {
            info.content[tag][content] = 1
        }
        else   
            info.content[tag][content] += 1
        
        await this.db.put('cell', info)
        return info

    }

    // send information upwards, triggers the parent to update its summary
    async updateParent(id, report){
        let cellinfo = await this.getCellInfo(id)
        let res = h3.getResolution(id)
        let parent = h3.cellToParent(id, res-1)
        let parentInfo = await this.getCellInfo(parent)
        parentInfo.wisdom[id] = report
        //update summary
        let summary = await this.summarize(Object.values(parentInfo.wisdom).join('\n'))
        parentInfo.summary = summary
        
        await this.db.put('cell', parentInfo)
        return parentInfo
    }

    async getChildSummary(hex){
        let cellinfo = await this.getCellInfo(hex) 
        let res = h3.getResolution(hex)
        //let parent = h3.h3ToParent(hex, res-1)
        let children = h3.cellToChildren(hex,res+1)
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

    
    async  summarize(history) {
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
        let councilWisdom = await this.getCouncilWisdom(councilID)
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
                assistant_id: assistant.id ,
                instructions:council[i]
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

        for (let i = 0; i < councilWisdom.threads.length; i++) {
            // Get the latest messages from the thread
            const messages = await this.openai.beta.threads.messages.list(councilWisdom.threads[i].id)
            const answer = messages.data[0].content[0].text.value
            councilWisdom.wisdom.push(answer)
        }
        let summary = await this.summarize(councilWisdom.wisdom.join('\n'))
        //await this.db.open('wisdom', { indexBy: 'id' }).put(councilWisdom)
        console.log(councilWisdom.wisdom)
        console.log('--------------------')
        console.log(summary)
        return summary
    }

    async getCellInfo(id){
        let cellInfo = await this.db.get('cell',id)
        if (!cellInfo) {
            cellInfo = emptycell(id)
            await this.db.put('cell', cellInfo)
        }
        return cellInfo
        
    }

    async getCouncilWisdom(id) {
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


    async getHex(lat, lng, resolution) {
        return h3.latLngToCell(lat, lng, resolution);
    }
    // returns the list of all the containing hexagons at xall scales
    getScalespace(lat, lng) {
        let list = []
        let cell = h3.latLngToCell(lat, lng, 14);
        list.push(cell)
        for (let i = 13; i >= 0; i--) {
            list.push(h3.cellToParent(cell, i))
        }
        return list
    }
}

export default H3;

// let db = new DB('WeQuest')
// await db.init()

// let hexamap = new H3(new Telegraf(process.env.TELEGRAM), db);
// await hexamap.init()

// await hexamap.db.open('cell');
// await hexamap.db.put('cell',emptycell('802bfffffffffff'))
// var result = await hexamap.db.get('cell','802bfffffffffff')
// console.log('Result:',result)

// let base = await hexamap.getHex(40.689167, -74.044444,14);
// // console.log('Base:',base)
// // //hexamap.delete (base, "thoughts")
//  hexamap.put (base, "link", "https://www.youtube.com/watch?v=Qq2XsYX6k3I")
//  console.log(await hexamap.get(base, "link"))

// hexamap.upcast(base, "thoughts", "i am thinking about climate change")

// hexamap.updateParent(base, "i am thinking about climate change")
// hexamap.getChildSummary(base)
// hexamap.askQuestion("What is the meaning of life?", "802bfffffffffff");
// console.log(hexamap.getScalespace(40.689167, -74.044444));