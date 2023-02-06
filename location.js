import { Telegraf,  Markup } from 'telegraf';
const bot = new Telegraf('5965742096:AAGm8_2mq8lST8goLhMKvq57HUaWf5-0LF4');

// bot.command('location', (ctx) => {
//   ctx.reply('Please share your location:',
  
  
//         Markup.button.locationRequest("test")
      
//   )
  
// });

bot.command('getlocation', (msg) => {
  const opts = {
    reply_markup: JSON.stringify({
      Markup.inlineKeyboard: [
        [{text: 'Location', }request_location: true],
        [{text: 'Contact', request_contact: true}],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    }),
  };
  msg.reply("qWE", opts);
});

bot.on('location', (ctx) => {
  console.log(`Received location: ${ctx.message.location}`);
});
bot.launch();