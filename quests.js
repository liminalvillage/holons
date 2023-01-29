import { Markup } from 'telegraf';

export async function quest(ctx, orbitdb) {
    // Get the message text and sender from the context

    let chatID = ctx.message.chat.id;
    let messageID = ctx.message.message_id;
    const text = ctx.message.text;
    const sender = ctx.from;

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    const quest = text.split(' ').slice(1).join(' ');

    if (!quest) {
        ctx.reply('Please enter a quest as part of the command. Example: /quest Do the dishes');
        return;
    }

    // Create a quest object

    let questObj = {
        _id: '',
        initiator: sender,
        quest: quest,
        date: new Date().getTime(),
        users: [],
        appreciation: [],
        status: 'ongoing'
    }
    // // Add the sender to the list of users
    questObj.users.push(sender);

    // let path = await ui.questImage(questObj)
    // ctx.replyWithPhoto({ source: fs.createReadStream(path) },markup).then((ctx) => {
    //     // Add the message id to the quest
    //     questObj._id = ctx.message_id;

    //     questsDB.put(questObj)

    //   }); 

    ctx.reply(createMessage(questObj), markup (questObj)).then((ctx) => {
        // Add the message id to the quest
        questObj._id = ctx.message_id;

        questsDB.put(questObj)

    });
}

export async function join(ctx, orbitdb) {
    console.log("JOIN ACTION");
    // Get the index from the callback data
    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    if (quest.status == 'completed') {
        ctx.reply(`Quest "${quest.quest}" has already been completed`);
        return;
    }

    // Get the user who reacted
    const sender = ctx.callbackQuery.from;

    // Check if the user has already joined the quest
    const userindex = quest.users.findIndex(user => user.id === sender.id)
    if (userindex > -1) {
        ctx.reply(`${sender.first_name}, left the quest "${quest.quest}"`);
        quest.users.splice(userindex, 1);
    }
    else {
        // Add the user to the quest
        quest.users.push(sender);
        // Send a message to confirm that the user joined the quest
        ctx.reply(`${sender.first_name} has joined the quest "${quest.quest}"`);
    }

    // Check if the user has already appreciated the quest, remove if so
    const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
    if (appreciationindex > -1) {
        ctx.reply(`${sender.first_name}'s appreciation for "${quest.quest}" has been removed`);
        quest.appreciation.splice(appreciationindex, 1);
    }

    // Update the message 
    updateMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);
}

export async function appreciate(ctx, orbitdb) {
    console.log("APPRECIATE ACTION");
    // Get the quest  from the callback data
    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;

    let questsDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.quests')
    await questsDB.load()

    let quest = await questsDB.get(messageID.toString())[0]

    if (!quest || quest == '') { console.log('QUEST IS NOT FOUND'); return }

    // Get the user who reacted
    const sender = ctx.callbackQuery.from;

    // Check if the user has already appreciated the quest, remove if so
    const appreciationindex = quest.appreciation.findIndex(user => user.id === sender.id)
    if (appreciationindex > -1) {
        ctx.reply(`${sender.first_name}'s appreciation for "${quest.quest}" has been removed`);
        quest.appreciation.splice(appreciationindex, 1);
    } else {
        // Add the user to the quest
        quest.appreciation.push(sender);
        // Send a message to confirm that the user joined the quest
        ctx.reply(`${sender.first_name} appreciates the quest "${quest.quest}"`);
    }
    // Check if the user has already joined the quest
    const userindex = quest.users.findIndex(user => user.id === sender.id)
    if (userindex > -1) {
        ctx.reply(`${sender.first_name} has been removed from the quest "${quest.quest}"`);
        quest.users.splice(userindex, 1);
    }


    // Update the message 
    updateMessage(ctx, quest);

    // Update the db
    questsDB.put(quest);
}




export async function cancel(ctx, orbitdb) {
    console.log("CANCEL ACTION");

    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;

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
        ctx.reply(`Only the creator of the quest can cancel the quest.`);
    }
}

export async function complete(ctx, orbitdb) {
    console.log("COMPLETE ACTION");

    let chatID = ctx.callbackQuery.message.chat.id;
    let messageID = ctx.callbackQuery.message.message_id;

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
        ctx.reply(`Only the creator of the quest can mark it as completed.`);
    }
    // ================================ APPRECIATION ========================== 
    let appreciationDB = await orbitdb.docs('WeQuest.' + chatID.toString() + '.appreciation')
    await appreciationDB.load()

    //loop through all users and add appreciation to their account
    for (let i = 0; i < quest.appreciation.length; i++) {
        let sender = quest.appreciation[i];
        let senderappreciation = await appreciationDB.get(sender.id)[0]
        if (!senderappreciation || senderappreciation == '') {

            // Initialize the sender's points if they do not exist yet
            senderappreciation = {
                _id: sender.id,
                username: sender.first_name,
                received: 0,
                sent: 0,
                appreciation: 0,

            }
        }

        // Update the sent appreciation of the sender
        senderappreciation.sent += 1;
        // Update the db
        await appreciationDB.put(senderappreciation)

        // Calculate the number of appreciation to send to each user
        const appreciationPerUser = 1  // / quest.users.length;

        // Send the appreciation to each user
        for (let i = 0; i < quest.users.length; i++) {
            // Get the recipient
            const recipient = quest.users[i]
            // // Check if the recipient is the sender
            // if (recipient.id === sender.id ) {
            //   continue;
            // }
            // Send the appreciation to each user
            let recipientappreciation = await appreciationDB.get(recipient.id)[0]
            // Initialize the receiver's points if they do not exist yet
            if (!recipientappreciation || recipientappreciation == '') {
                recipientappreciation = {
                    _id: recipient.id,
                    username: recipient.first_name,
                    received: 0,
                    sent: 0,
                    appreciation: 0
                }
            }
            recipientappreciation.received += appreciationPerUser;
            // Add the received appreciation to the recipient
            appreciationDB.put(recipientappreciation)
        }
    }
    // ================================ APPRECIATION ==========================
}

// ============== UTILITY FUNCTIONS

// Function to update messages for a quest
async function updateMessage(ctx, quest) {
    try {
        // Update the message 
        await ctx.telegram.editMessageText(
            ctx.update.callback_query.message.chat.id,
            ctx.update.callback_query.message.message_id,
            null,
            createMessage(quest),
            markup(quest)
        );
    } catch (e) {
        console.log(e);
    }
}

// Function to create the message for a quest TODO 
function createMessage(quest) {
    let message = `Quest: ${quest.quest}\n`;
    message += `Initiated by: ${quest.initiator.first_name}\n`;
    message += `Participants: ${[...quest.users].map(u => u.first_name).join(', ')}\n`;
    message += `Appreciated by: ${[...quest.appreciation].map(u => u.first_name).join(', ')}\n`;
    message += `Status: ${quest.status}\n`;
    return message;
}

function markup(quest) {
    let mu = Markup.inlineKeyboard([[
        Markup.button.callback('❤️ Join', 'join_quest'),
        Markup.button.callback('👍 Appreciate', 'appreciate_quest')
    ], [
        Markup.button.callback('❌ Cancel', 'cancel_quest'),
        Markup.button.callback('✔️ Complete', 'complete_quest')
    ]])
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
