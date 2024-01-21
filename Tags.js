import { Markup } from 'telegraf';
import * as utils from './utilities.js';


export default class Tags {
    /**
     * Creates a new instance of the Tags class.
     * @param {Object} bot - The bot object.
     * @param {Object} db - The database object.
     */
    constructor(bot, db) {
        this.bot = bot;
        this.db = db;
   
        
        this.bot.command('tag', async (ctx) => {
            if (!ctx.message.reply_to_message) {
              return ctx.reply('Please reply to a message you want to tag.');
            }
      
            const tags = ctx.message.text.split(' ').slice(1);
            if (tags.length === 0) {
              return ctx.reply('Please provide at least one tag.');
            }
      
            const messageId = ctx.message.reply_to_message.message_id;
            const chatId = ctx.message.chat.id;
            const messageContent = ctx.message.reply_to_message.text;
            
            let tagsDB = await this.db.docs('WeQuest.'+ chatId +'.tags')
            await tagsDB.load()
    
            tags.forEach(tag => {
              let tagobject = tagsDB.get(tag)[0]
              if (tagobject.content) {
                tagobject.content.push({ chatId, messageId, messageContent });
              } else {
                tagobject = {'id':tag, 'content':[{ chatId, messageId, messageContent }]};
              }
              tagsDB.put(tagobject)

            });
      
            //saveDb();
            ctx.reply('Message tagged successfully.');
          });
      
          // Query tagged messages
          this.bot.command('gettag', async (ctx) => {
            const chatId = ctx.message.chat.id;
            const tag = ctx.message.text.split(' ')[1];
            if (!tag) {
              return ctx.reply('Please specify a tag.');
            }

            let tagsDB = await this.db.docs('WeQuest.'+ chatId +'.tags')
            await tagsDB.load()
            let tagobject = await tagsDB.get(tag)[0]
            console.log(tagobject)
            
            
      
            if (!tagobject || !tagobject.content ) {
              return ctx.reply('No messages found for this tag.');
            }
      
            const response = tagobject.content.map(entry => entry.messageContent).join('\n');
            ctx.reply(response);
          });
    }
}
