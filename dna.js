import 'values.js'
import { Markup } from 'telegraf'

export async function value(ctx, orbitdb) {
    
}


export async function valuesSelect(ctx, orbitdb) {

ctx.reply('Values', createButtons(values))
}


function createButtons(requests){
    let buttons = []
    requests.forEach((request) => {
        buttons.push([Markup.button.callback(request.title, 'https://t.me/Bot?quests='+request._id), Markup.button.callback("Claim", 'claim_' + request._id)])
    })
    return Markup.inlineKeyboard(buttons)
}