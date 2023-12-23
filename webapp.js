import { Telegraf, Markup } from "telegraf";

const bot = new Telegraf("6152474485:AAFDog3N-JSCgKB4APgrtktyF8WBnKtrDb0");

bot.command("register", (ctx) => {
  return ctx.reply(
    "open webapp",
    Markup.keyboard([
      Markup.button.webApp(
        "Open",
        "https://robertovalenti.github.io/webapp/index.html"
      ),
    ])
  );
});

bot.on("message", async (ctx) => {
  if (!ctx.message.web_app_data) {
    console.error('Web app data is not present');
    return;
  }

  console.log(ctx.message.web_app_data);

  if (typeof ctx.message.web_app_data.data !== 'string') {
    console.error('Web app data is not a string');
    return;
  }

  return ctx.reply(ctx.message.web_app_data.data);
});

bot.launch();