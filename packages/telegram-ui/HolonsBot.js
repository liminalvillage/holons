import HolonsBot from './core/HolonsBotCore.js';

const bot = new HolonsBot();

bot.init().then(() => {
  console.log('HolonsBot started successfully');
}).catch((err) => {
  console.error('Bot init failed:', err);
  process.exit(1);
});
