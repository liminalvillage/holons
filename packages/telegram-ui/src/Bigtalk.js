/**
 * @fileoverview Deep conversation prompts for community bonding.
 * @module src/Bigtalk
 */

import { Markup } from 'telegraf';

/**
 * Deep conversation prompt generator for meaningful group discussions.
 *
 * @class Bigtalk
 * @description Provides random thought-provoking questions to spark deep
 * conversations in community groups. Includes questions in English and Italian
 * covering topics like personal growth, relationships, and life experiences.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {Settings} settings - Settings manager for language preferences
 *
 * @example
 * const bigtalk = new Bigtalk(bot, settings);
 * // Use /bigtalk to get a random conversation prompt
 */
class Bigtalk {
  constructor(bot, settings) {
    this.bot = bot;
    this.settings = settings;
    this.bot.command('bigtalk', ctx => this.pickQuestion(ctx));
    const gameShortName = 'holons';
    const gameUrl = 'https://bigtalk.com';

    const markup = Markup.inlineKeyboard([
      Markup.button.game('🎮 Play now!'),
      Markup.button.url('Telegraf help', 'http://telegraf.js.org'),
    ]);

    bot.command('foo', ctx => ctx.replyWithGame(gameShortName, markup));
    bot.gameQuery(ctx => ctx.answerGameQuery(gameUrl));
  }

  async pickQuestion(ctx) {
    const holonId = ctx.message.chat.id;
    const language = await this.settings.getLanguage(holonId);
    const questions = language === 'it' ? domande : questions;
    //pick a random number
    const number = Math.floor(Math.random() * questions.length);
    const question = questions[number];
    ctx.reply(question);
  }
}

const domande = [
  'Cosa ti tiene con i piedi per terra?',
  'Quali sono state le conversazioni più difficili che hai avuto nelle ultime due settimane?',
  'Cosa è necessario imparare adesso?',
  'Quando ti sei sentito isolato o solo, e quali sono i tuoi rimedi?',
  'Che tipo di vita familiare sogni?',
  'Quali parti della tua vita sono state una perdita di tempo?',
  'Contro cosa hai combattuto in passato e contro cosa stai combattendo ora?',
  'Cosa delizia maggiormente ciascuno dei tuoi cinque sensi e quali sensazioni eviti?',
  "Cosa hai imparato sulle diverse varietà dell'amore nel corso della tua vita?",
  'Che tipo di amicizie desideri?',
  "Quanto sei stato motivato dalla ricerca di potere, denaro, rispetto o qualcos'altro? (Scala da 1 a 10)",
  'Quali delle tue paure sono cambiate e quale paura vedi più frequentemente negli altri?',
  'Quali sono i limiti della tua compassione?',
  'In quale tipo di compagnia ti senti a casa?',
  'Dove sei più tollerante o intollerante?',
  'Cosa hai scoperto attraverso i viaggi?',
  'Cosa pensi delle tue abitudini di spesa e cosa ti serve che il denaro non può comprare?',
  'Quali effetti morali, intellettuali, estetici e sociali ha il lavoro che fai sugli altri e su te stesso?',
  'Di cosa ha bisogno il mondo per essere un posto migliore e cosa desideri contribuire?',
  'Quali decisioni del passato ti hanno più formato?',
  'Cosa ti fa sentire in pace con te stesso?',
  'Qual è stato il momento più trasformativo della tua vita?',
  'Cosa temi di più del futuro?',
  'Quali sono i tuoi modi preferiti per rilassarti?',
  'Quali valori ti guidano nelle decisioni quotidiane?',
  'Cosa desideri insegnare agli altri?',
  'In quali momenti ti senti più vulnerabile?',
  'Cosa ti dà più senso di appartenenza?',
  'Quali sono stati i tuoi successi più gratificanti?',
  'Che ruolo ha la spiritualità nella tua vita?',
  'Quali esperienze hanno cambiato la tua prospettiva di vita?',
  'Cosa significa per te la libertà?',
  'Quale talento vorresti sviluppare ulteriormente?',
  'Quali sono i tuoi più grandi rimpianti?',
  'Come affronti il cambiamento nella tua vita?',
  'Cosa ti fa sentire realizzato professionalmente?',
  'Quali sono i tuoi sogni irrealizzati?',
  'Cosa ti motiva a continuare anche quando le cose si fanno difficili?',
  'Quali sono i tuoi punti di forza e debolezza nelle relazioni interpersonali?',
  'Cosa desideri lasciar andare?',
  'In che modo le tue radici culturali influenzano la tua vita quotidiana?',
  "Quale libro, film o opera d'arte ha influenzato di più la tua visione del mondo?",
  "Qual è la lezione più importante che hai imparato quest'anno?",
  'Cosa significa per te il successo?',
  'Qual è stata la tua esperienza più illuminante?',
  'Come ti prepari ad affrontare sfide personali o professionali?',
  'In cosa senti di aver fallito e cosa hai imparato da esso?',
  'Cosa ti fa sentire autentico?',
  'Quali sogni o aspirazioni ti porti dietro da molto tempo?',
  'Cosa hai imparato dalle tue più grandi sconfitte?',
  'Come ti poni rispetto al concetto di felicità?',
  'Qual è la tua più grande paura e come la gestisci?',
  'Quali relazioni hanno avuto il maggior impatto su di te?',
  "Come ti connetti con il tuo 'io' interiore?",
  'Qual è stata la tua più grande scoperta personale fino a oggi?',
  'Cosa ti spinge a migliorarti ogni giorno?',
  'Cosa desideri che gli altri sappiano di te, ma non dici spesso?',
  'Quali sono i tuoi confini personali e come li comunichi agli altri?',
  'Cosa ti ispira creativamente?',
  'Come bilanci il tuo tempo tra lavoro e vita personale?',
  'Cosa ti fa sentire più vicino agli altri?',
  'Quale parte di te vuoi esplorare di più?',
  'Come affronti i conflitti nelle relazioni personali?',
  'Cosa ti rende orgoglioso di te stesso?',
  'Quali valori desideri trasmettere alle future generazioni?',
  'Quali sono i tuoi obiettivi a lungo termine?',
  'Quali sono le tue aspettative per il futuro?',
  'Cosa ti fa sentire più vivo?',
  'Qual è il tuo più grande desiderio per il mondo?',
  'Cosa ti rende unico?',
  'Quali sono i tuoi più grandi dubbi e paure?',
  'Cosa ti fa sentire più apprezzato?',
  'Qual è il tuo più grande rimpianto?',
  'Cosa ti rende più vulnerabile?',
  'Qual è il tuo più grande sogno?',
];

export default Bigtalk;
