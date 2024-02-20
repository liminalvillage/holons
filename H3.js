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
        content:{},
    }

}

class H3 {
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;    
        this.gun = GUN({
            peers: ['http://localhost:8765/gun','https://59.src.eco/gun'],
            axe:false
        });


        (async () => {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI,
            });

        })();
        this.bot.command('resethex', async (ctx) => {
            let chatID = ctx.message.chat.id;
            let hex = (await this.db.get('settings', chatID)).hex
            this.delete(hex, ctx.message.text.split(' ')[1])
        })

        this.bot.command('get', async (ctx) => {
            const chatID = ctx.message.chat.id;
            const tag = ctx.message.text.split(' ')[1];
            if (!tag) {
                return ctx.reply('Please specify a tag.');
            }
            let hex = (await this.db.get('settings', chatID)).hex
            //let hex = settings.hex
            console.log('hex',hex)
          
            let data = await this.get(ctx, hex, tag)
            
        }
        )

        this.bot.command('cast', async (ctx) => {
            if (!ctx.message.reply_to_message) {
                return ctx.reply('Please reply to a message you want to tag.');
              }
              const tags = ctx.message.text.split(' ').slice(1);
              if (tags.length === 0) {
                return ctx.reply('Please provide at least one tag.');
              }
        
              const messageID = ctx.message.reply_to_message.message_id;
              const chatID = ctx.message.chat.id;
              const messageContent = ctx.message.reply_to_message.text;
              let settings = await this.db.get('settings', chatID)
              let id = settings.hex
              //create root node for the item
              let node = await this.gun.get(chatID+'/'+messageID).put({ id: chatID+'/'+messageID, content: messageContent })
              for (let tag of tags) {
               await this.gun.get(id).get(tag).set(node)
               this.upcast(id, tag, node)
              }
        })

        this.bot.command('publish', async (ctx) => {
            if (!ctx.message.reply_to_message) {
              return ctx.reply('Please reply to a message you want to tag.');
            }
            const tags = ctx.message.text.split(' ').slice(1);
            if (tags.length === 0) {
              return ctx.reply('Please provide at least one tag.');
            }
      
            const messageID = ctx.message.reply_to_message.message_id;
            const chatID = ctx.message.chat.id;
            const messageContent = ctx.message.reply_to_message.text;
            let settings = await this.db.get('settings', chatID)
            let id = settings.hex
      
            for (let tag of tags) {
                
             await this.put(id,tag,{ content: messageContent, done:false })
            }
    
            ctx.reply('Tag published.');
          });
      

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
        await this.gun.get('WeQuestDebug').get(id).get(tag).put(null)
    }

    async put(id, tag, content) {
        // Assuming 'this.gun' is properly initialized and available
       // return new Promise((resolve, reject) => {
          // Reference to the tag node where multiple contents will be added
          console.log(id, tag, content.content)
        // this.gun.get(id.toString()).get(tag).set(content.content).put(content);
         await this.gun.get(id).get(tag).set(content);
          // Adding the content object to the set under the specified tag
        //   tagRef.set(content, ack => {
        //     if (ack.err) {
        //       console.error('Failed to add content:', ack.err);
        //       reject(ack.err); // Reject the promise on error
        //     } else {
        //       console.log('Content added successfully under tag:', tag);
        //       resolve(ack); // Resolve the promise on success
        //     }
        //   });
      //  });
      }

    //async put(id, tag, content){
    //    return this.gun.get('WeQuestDebug').get(id).set(tag).put(content)
        // let info = await this.getCellInfo(id)
        // if (!info.content[tag]) {
        //     info.content[tag] = {}
        // }
        // if (!info.content[tag][content.id]) {
        //     info.content[tag][content.id] = content
        //     info.content[tag][content.id].count = 1
        // }
        // else   
        //     info.content[tag][content.id].count += 1
        // // let item = this.gun.get('WeQuestDebug').get(id).get('content').put(content)
        // // this.gun.get('WeQuestDebug').get(id).get(tag).set(item)

        // await this.db.put('cell',info)
   // }

    async get(ctx,id, tag){           
            this.gun.get(id.toString()).get(tag).map().once((data,key) => {
                // if (!data?.content)
                // this.gun.get('WeQuestDebug').get(id).get(tag).get(key).put(null)
                //if (data) {
                    ctx.reply(JSON.stringify(data))
                    console.log('data', data); // Optional: log the data content if needed
                   
                //}
            }
            
            )

        // await this.gun.get('WeQuestDebug').get(id).get(tag).on((data) => {
        //     console.log(data)
        //     return data = info.content[tag]
        // })
        // let info = await this.getCellInfo(id)
        // return info.content[tag]?info.content[tag]:null
        
    }


   async  upcast(id, tag, content){
  
        let res = h3.getResolution(id)
        if (res == 0)
            return content

        console.log('upcasting ', id, tag, content)
        let parent = h3.cellToParent(id, res-1)
        this.gun.get(parent).get(tag).set(content)
        return this.upcast(parent, tag, content)
        // let info = await this.getCellInfo(parent)
        // if (!info.content[tag]) {
        //     info.content[tag] = {}
        // }
        // if (!info.content[tag][content]) {
        //     info.content[tag][content] = 1
        // }
        // else   
        //     info.content[tag][content] += 1
        
        // await this.put(parent, tag, info.content[tag])

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

// let db = new DB('WeQuestDebug')
// await db.init()

// let hexamap = new H3(new Telegraf(process.env.TELEGRAM), db);
// await hexamap.init()

// await hexamap.db.put('cell',emptycell('802bfffffffffff'))
// var result = await hexamap.db.get('cell','802bfffffffffff')
// console.log('Result:',result)

// let base = '801ffffffffffff'// await hexamap.getHex(40.689167, -74.044444,14);
// // console.log('Base:',base)
// // //hexamap.delete (base, "thoughts")
//  //await hexamap.put (base, "link", "https://www.youtube.com/watch?v=Qq2XsYX6k3I")
//  console.log(await hexamap.get(base, "gibberish"))

//hexamap.upcast(base, "thoughts", "i am thinking about climate change")

//hexamap.updateParent(base, "i am thinking about climate change")
//hexamap.getChildSummary(base)
//hexamap.askQuestion("What is the meaning of life?", "802bfffffffffff");
//console.log(hexamap.getScalespace(40.689167, -74.044444));