import { Markup } from 'telegraf';
import  i18next from 'i18next';
import {getLanguage} from './settings.js';
import * as ui from './UI.js';
                
export async function quest(type, ctx, orbitdb) {
 
    if (!orbitdb) return
    console.log('NEW QUEST')
    // Get the message text and sender from the context
    let chatID = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const language = await getLanguage(chatID)
    const text = ctx.message.text? ctx.message.text : ctx.message.caption;
    const picture = ctx.message.picture
    const sender = ctx.from;
    if (!orbitdb) return
    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    const title = text.split(' ').slice(1).join(' ');

    if (!title) {
        ctx.reply(i18next.t('usage', {type:type, lng: language }))
        return;
    }

    // Create a quest object

    let quest = {
        _id: '',
        chat:'',
        initiator: sender,
        title: title,
        date: new Date().getTime(),
        users: [],
        appreciation: [],
        stoppers: [],
        type: type,
        status: 'ongoing'
    }
    // // Add the sender to the list of users
    quest.users.push(sender);

    // let path = await ui.questImage(quest)
    // ctx.replyWithPhoto({ source: fs.createReadStream(path) },markup).then((ctx) => {
    //     // Add the message id to the quest
    //     questObj._id = ctx.message_id;

    //     questsDB.put(questObj)

    //   }); 

    ctx.reply(createMessage(quest,language), markup(quest,language)).then((ctx) => {
        // Add the message id to the quest
        quest._id = messageID;
        quest.chat = chatID
        questsDB.put(quest)

    });
}

export async function join(ctx, orbitdb) {
    if (!orbitdb) return
    console.log("JOIN ACTION");
    // Get the index from the callback data
    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;
    const language = await getLanguage(chatID)
    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    if (quest.status == 'completed') {
        ctx.reply(`Quest "${quest.title}" has already been completed`, { reply_to_message_id: messageID });
        return;
    }

    // Get the user who reacted
    const sender = ctx.callbackQuery.from;

    // Check if the user has already joined the quest
    const userindex = quest.users.findIndex(user => user.id === sender.id)
    if (userindex > -1) {
        ctx.reply(`${sender.first_name}, left the quest "${quest.title}"`, { reply_to_message_id: messageID });
        quest.users.splice(userindex, 1);
    }
    else {
        // Add the user to the quest
        quest.users.push(sender);
        // Send a message to confirm that the user joined the quest
        ctx.reply(`${sender.first_name} has joined the quest "${quest.title}"`, { reply_to_message_id: messageID });
    }

    // Check if the user has already appreciated the quest, remove if so
    const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
    if (appreciationindex > -1) {
        ctx.reply(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`, { reply_to_message_id: messageID });
        quest.appreciation.splice(appreciationindex, 1);
    }

    // Update the message 
    updateMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);
}

export async function appreciate(ctx, orbitdb) {
    if (!orbitdb) return
    
    console.log("APPRECIATE ACTION");
    // Get the quest  from the callback data
    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;
    const language = await getLanguage(chatID)

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    // Get the user who reacted
    const sender = ctx.callbackQuery.from;

    // Check if the user has already appreciated the quest, remove if so
    const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
    if (appreciationindex > -1) {
        ctx.reply(`${sender.first_name}'s appreciation for "${quest.title}" has been removed`, { reply_to_message_id: messageID });
        quest.appreciation.splice(appreciationindex, 1);
    } else {
        // Add the user to the quest
        quest.appreciation.push(sender);
        // Send a message to confirm that the user joined the quest
        ctx.reply(`${sender.first_name} appreciates the quest "${quest.title}"`, { reply_to_message_id: messageID });
    }
    // Check if the user has already joined the quest
    const userindex = quest.users.findIndex(user => user.id === sender.id)
    if (userindex > -1) {
        ctx.reply(`${sender.first_name} has been removed from the quest "${quest.title}"`, { reply_to_message_id: messageID });
        quest.users.splice(userindex, 1);
    }


    // Update the message 
    updateMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);
}




export async function cancel(ctx, orbitdb) {
    if (!orbitdb) return
    console.log("CANCEL ACTION");

    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;
    const language = await getLanguage(chatID)

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    // Handle the reaction to the quest
    if (quest.initiator.id === ctx.from.id) {
        //delete quest from database
        questsDB.del(messageID.toString())
        //delete the telegram message
        ctx.deleteMessage(messageID.toString())

    } else {
        ctx.reply(`Only the creator of the quest can cancel the quest.`, { reply_to_message_id: messageID })

    }
}

export async function stop(ctx, orbitdb) {
    if (!orbitdb) return
    console.log("STOP ACTION");

    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;
    const language = await getLanguage(chatID)

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    // Get the user who reacted
    const sender = ctx.callbackQuery.from;

    const stopperindex = quest.stoppers.findIndex(user => user.id === sender.id)
    if (stopperindex > -1) {
        ctx.reply(`${sender.first_name} has revoked its veto for the quest "${quest.title}"`, { reply_to_message_id: messageID });
        quest.stoppers.splice(stopperindex, 1);
    }
    else {
        // Add the user to the quest
        quest.stoppers.push(sender);
        // Send a message to confirm that the user joined the quest
        ctx.reply(`${sender.first_name} has stopped the quest "${quest.title}"`, { reply_to_message_id: messageID });
    }
    if (quest.stoppers.length > 0)
        quest.status = 'stopped'
    else
        quest.status = 'ongoing'

    // Update the message 
    updateMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);
}


export async function complete(ctx, orbitdb) {
    if (!orbitdb) return
    console.log("COMPLETE ACTION");

    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;
    const language = await getLanguage(chatID)

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    // Handle the reaction to the quest
    if (quest.initiator.id === ctx.from.id) {
        quest.status = "completed";
        // Update the message 
        updateMessage(ctx, quest);
        // Update the db
        questsDB.put(quest);
  

    } else {
        ctx.reply(`Only the creator of the quest can mark it as completed.`, { reply_to_message_id: messageID });
    }
    // ================================ APPRECIATION ========================== 
    let appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
    await appreciationDB.load()
    let usersDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.users', { indexBy: 'username' })
    await usersDB.load()
    //await saveUserAction(ctx.callbackQuery.from, quest.title, usersDB) //register monouser in debug mode
    //loop through all users and add appreciation to their account
    for (let i = 0; i < quest.appreciation.length; i++) {
        let sender = quest.appreciation[i];
        await sendToken(sender, 1, appreciationDB)
        // Calculate the number of appreciation to send to each user
        const appreciationPerUser = 1  // / quest.users.length;

        // Send the appreciation to each user
        for (let i = 0; i < quest.users.length; i++) {
            // Get the recipient
            const recipient = quest.users[i]
            // Check if the recipient is the sender
            if (recipient.id === sender.id) {
                continue;
            }
            // Send the appreciation to each user
            await recieveToken(recipient, appreciationPerUser, appreciationDB)
            // save user with action to the database
            await saveUserAction(recipient, quest.title, usersDB)
        }
    }
    // ================================ APPRECIATION ==========================
    ctx.reply(`Quest "${quest.title}" completed! 🎊 `, { reply_to_message_id: messageID });
}

export async function sendAppreciation(ctx, orbitdb) {
    if (!orbitdb) return
    console.log("SEND APPRECIATION ACTION");
    const chatID = ctx.message.chat.id;
    const language = await getLanguage(chatID)
    const sender = ctx.from;
    const entities = ctx.message.entities;

    // Setup the necessary databases
    const usersDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.users', { indexBy: 'username' })
    await usersDB.load()
    let appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
    await appreciationDB.load()
    console.log(entities)
    const mentions = entities.filter((entity) => (entity.type === 'mention'|| entity.type === 'text_mention'));
    if (mentions.length === 0) {
        ctx.reply(`Please mention the users you want to send appreciation to using '@', followed by the reason.`, { reply_to_message_id: ctx.message.message_id });
        return
    }

    const lastMention = mentions[mentions.length - 1];
    const action = ctx.message.text.substring(lastMention.offset + lastMention.length).trim();

    // Check if the message contains a mention
    for (let i = 0; i < mentions.length; i++) {
        const entity = mentions[i];
        let recipient = ''

        if (entity.type === 'text_mention')
            recipent = await ctx.telegram.users.getFullUser(entity.user.id)// ctx.text.substring(entity.offset, entity.offset + entity.length)
        if (entity.type === 'mention') {
            // get the user from the database
            recipient = await usersDB.get(ctx.message.text.substring(entity.offset + 1, entity.offset + entity.length))[0]
        }

        if (!recipient || recipient == '') {
            ctx.reply(`The user is not registered. Ask the user to complete a task first.`, { reply_to_message_id: ctx.message.message_id });
            return;
        }

        // Check if the recipient is the sender
        if (recipient.id === sender.id) {
            ctx.reply(i18next.t(`You cannot send appreciation to yourself.`), { reply_to_message_id: ctx.message.message_id });
            return;
        }

        // Send the appreciation to the recipient
        await recieveToken(recipient, 1, appreciationDB)
        // save the user action
        await saveUserAction(recipient, action, usersDB)
    }

    // Update the sent appreciation of the sender
    await sendToken(sender, 1, appreciationDB)
    ctx.reply(`You have sent 1 appreciation to ${mentions.length} ${mentions.length > 1 ? 'users' : 'user'}.`, { reply_to_message_id: ctx.message.message_id });
    listUsersActions(usersDB)
}

// ============== UTILITY FUNCTIONS



async function listUsersActions(db) {
    if (!db) return

    let users = await db.get('')
    console.log(users)
    for (let i = 0; i < users.length; i++) {
        let user = users[i];
        if (user.actions && user.actions.length > 0) {
            console.log(user.first_name + ':' + user.actions.join(', '))
        }
    }
}

// save user action
async function saveUserAction(userobj, action, db) {
    console.log('SAVE USER ACTION')
    if (!db) return
    let user = await db.get(userobj.username)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!user || user == '') {
        user = {
            id: userobj.id,
            username: userobj.username? userobj.username : '',
            first_name: userobj.first_name? userobj.first_name : '',
            last_name: userobj.last_name ? userobj.last_name : '',
            actions: []
        }
    }
    user.actions.push(action)
    // Save the user to the database
    await db.put(user)
}

// send appreciation 
async function recieveToken(recipient, amount, db) {
    if (!db) return

    let recipientinfo = await db.get(recipient.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!recipientinfo || recipientinfo == '') {
        recipientinfo = {
            _id: recipient.id,
            username: recipient.first_name,
            received: 0,
            sent: 0,
            appreciation: 0
        }
    }
    recipientinfo.received += amount;
    // Add the received appreciation to the recipient
    await db.put(recipientinfo)
}


async function sendToken(sender, amount, db) {
    if (!db) return

    let senderinfo = await db.get(sender.id)[0]
    // Initialize the receiver's points if they do not exist yet
    if (!senderinfo || senderinfo == '') {
        senderinfo = {
            _id: sender.id,
            username: sender.first_name,
            received: 0,
            sent: 0,
            appreciation: 0
        }
    }
    senderinfo.sent += amount;
    // Add the received appreciation to the recipient
    await db.put(senderinfo)
}

// Function to update messages for a quest
async function updateMessage(ctx, quest, language) {
    try {
        // Update the message 
        await ctx.telegram.editMessageText(
            ctx.update.callback_query.message.chat.id,
            ctx.update.callback_query.message.message_id,
            null,
            createMessage(quest,language),
            markup(quest,language)
        );
    } catch (e) {
        console.log(e);
    }
}

// Function to create the message for a quest TODO 
function createMessage(quest,language ) {
    let message = `| ${quest.type.charAt(0).toUpperCase() + quest.type.slice(1)}: ${quest.title} \n`;
    message += `| By: ${quest.initiator.first_name} \n`;
    if (quest.users.length > 0)
        message += `| Participants: ${[...quest.users].map(u => u.first_name).join(', ')} \n`;
    if (quest.appreciation.length > 0)
        message += `| Appreciated by: ${[...quest.appreciation].map(u => u.first_name).join(', ')} \n`;
    if (quest.status === "stopped")
        message += `| Stopped by: ${[...quest.stoppers].map(u => u.first_name).join(', ')} \n`;
    message += `| Status: ${quest.status}\n`;
    return message;
}

function markup(quest,language) {
    let mu = Markup.inlineKeyboard([[
        Markup.button.callback(i18next.t('join',{lng:language}), 'join_quest'),
        Markup.button.callback(i18next.t('appreciate',{lng:language}), 'appreciate_quest'),
        Markup.button.callback(i18next.t('stop',{lng:language}), 'stop_quest')
    ], [
        Markup.button.callback(i18next.t('cancel',{lng:language}), 'cancel_quest'),
        Markup.button.callback(i18next.t('complete',{lng:language}), 'complete_quest')
    ]])

    if (quest.type === "request" || quest.type === "offer") {
        mu = Markup.inlineKeyboard([[
            Markup.button.callback(i18next.t('Geolocate',{lng:language}), 'geolocate', { requestlocation: true }),
            Markup.button.callback(i18next.t('Take',{lng:language}), 'join_quest'),
            Markup.button.callback(i18next.t('Cancel',{lng:language}), 'cancel_quest'),
        ]])
    }

    if (quest.status === "completed") {
        return null
    }
    else return mu
}
// Function to update messages for a quest
async function updateQuestImage(ctx, quest) {
    try {
        // update the image
        let path = await ui.getQuestImage(quest)
        await ctx.telegram.editMessageMedia(
            ctx.update.callback_query.message.chat.id,
            ctx.update.callback_query.message.message_id,
            null,
            {
                source: fs.createReadStream
                    (path)
            },
        );
    } catch (e) {
        console.log(e);
    }
}
