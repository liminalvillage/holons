/**
 * @fileoverview Deep conversation prompts for community bonding.
 * @module src/Bigtalk
 */

import { Markup } from 'telegraf'

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
  
    constructor(bot, settings){
        this.bot = bot
        this.settings = settings
        this.bot.command('bigtalk',(ctx) => this.pickQuestion(ctx))
        const gameShortName = 'holons'
        const gameUrl = 'https://bigtalk.com'

        const markup = Markup.inlineKeyboard([
        Markup.button.game('🎮 Play now!'),
        Markup.button.url('Telegraf help', 'http://telegraf.js.org')
        ])


        bot.command('foo', (ctx) => ctx.replyWithGame(gameShortName, markup))
        bot.gameQuery((ctx) => ctx.answerGameQuery(gameUrl))
    }

    async pickQuestion(ctx){
        let holonId = ctx.message.chat.id;
        const language = await this.settings.getLanguage(holonId)
        let questions = language === 'it' ? domande : questions
        //pick a random number
        let number = Math.floor(Math.random()*questions.length)
        let question = questions[number];
        ctx.reply(question)
    }
}

const questions = [
    "What's your biggest accomplishment?",
    "What's your worst fear?",
    "What's your current challenge?",
    "If I had all the resources in the world, I would...",
    "Favorite childhood memory?",
    "How did you first learn about sex?",
    "How old were you when you had your first sexual encounter?",
    "Most people don't know this about me:",
    "If it didn't have to be perfect, I would...",
    "Something I've been afraid to share is:",
    "My worst sexual experience was:",
    "Pick a person in the group and describe a fantasy you have about them.",
    "If I were to rule the universe, first thing I would do is...",
    "When I do my self pleasuring, I imagine...",
    "I feel a lot of pain when...",
    "I feel a lot of pleasure when...",
    "Ask someone in the group a question",
    "My favorite activity is...",
    "This is how I center myself:",
    "Something I'm insecure about is:",
    "Pick a person in the group and share your judgement about them.",
    "What are you most grateful for?",
    "What's your vision for yourself?",
    "What, if any, do you feel shame or guilt about?",
    "What's your gift/medicine to the world?",
    "Worst childhood memory.",
    "What do you find most attractive in a person?",
    "What turns you off sexually?",
    "What's your biggest sexual turn on?",
    "Ask the group for what you want from them?",
    "What are some of your erogenous zones?",
    "Describe your favorite sexual fantasy.",
    "What does love mean to you?",
    "If your Mom/Dad is your best friend, what would you tell them?",
    "Share a significant transformation experience that changed the course of your life.",
    "Share a significant transformation experience that changed the course of your sex life.",
    "What's the most embarrassing moment in your life?",
    "When did you start masturbating?",
    "Outside your family, who's the most influential person in your life?",
    "How do you imagine your life 5 years from now?",
    "What awards/prizes are you most proud of?",
    "Is there something you wish you could do over again?",
    "Go around the room and acknowledge each person present for at least one thing.",
    "What childhood dreams have you accomplished?",
    "What's the riskiest thing you have done?",
    "Pick a question from the list and give it to someone else.",
    "What moves you and makes you feel connected on a deep level?",
    "What do you like most about yourself?",
    "What would you like to disappear from your life?",
    "What is your secret talent?",
    "Describe your ideal community.",
    "Did you ever question reality? If so, when and how?",
    "What do you have in abundance?",
    "What's the first word that comes to your mind when you hear the word 'money'?",
    "What's your biggest energy drain?",
    "Who would you like to acknowledge the most?",
    "What, if anything, have you always wanted to do but haven't yet?",
    "What's one of the most meaningful experiences you've had?",
    "Why and how did you choose your current car? (If no car, pick your favorite possession)",
    "What's currently missing in your life that you'd like to have?",
    "Was there an event that changed the course of your life? How?",
    "What childhood dream have you forgotten about?",
    "What childhood dream do you still want to accomplish?",
    "Why is your best friend your best friend?",
    "What things do you do that you'd rather say NO to?",
    "If you only had 6 months to live, what would you do in this time?",
    "What's the scariest moment of your life?",
    "Who was your childhood hero?",
    "What's your biggest energy booster?",
    "Ask someone in the room for anything you want from them, no filters.",
    "What makes you cry?",
    "What do you like to be acknowledged for?",
    "Who is your current hero?",
    "What do you find most impressive in a person?",
    "What/Who makes you laugh from your heart?",
    "If you were to write a letter to your younger self, what would you say about sex?",
    "What do you think is attractive about you?",
    "What would you like to tell your beloved?",
    "How would you like to die?",
    "What would you like to tell your parents?",
    "What would you like to tell your Mom?",
    "What would you like to tell your Dad?",
    "If you were to write a letter to your younger self, what would you tell them?",
    "What do you spend too much time doing?",
    "What don’t you spend enough time doing?",
    "Who do you need to get in touch with because it’s been too long?",
    "What is something new you recently tried and enjoyed?",
    "What makes you feel most alive?",
    "What advice would you offer to yourself five years ago? One year ago? Today?",
    "What holds you back from doing the things you really want to do?",
    "What are you proud of?",
    "What is something you know you do differently than most people?",
    "What is your next great adventure?",
    "What’s one thing that could happen today that would make it great?",
    "What does home mean to you?",
    "What do you want to do before you die?",
    "How do you show your love?",
    "How do you act when you're nervous?",
    "How do you act when you're embarrassed?",
    "How do you act when you're afraid and you don't want to show it?"
  ];


  const domande = [
    "Cosa ti tiene con i piedi per terra?",
    "Quali sono state le conversazioni più difficili che hai avuto nelle ultime due settimane?",
    "Cosa è necessario imparare adesso?",
    "Quando ti sei sentito isolato o solo, e quali sono i tuoi rimedi?",
    "Che tipo di vita familiare sogni?",
    "Quali parti della tua vita sono state una perdita di tempo?",
    "Contro cosa hai combattuto in passato e contro cosa stai combattendo ora?",
    "Cosa delizia maggiormente ciascuno dei tuoi cinque sensi e quali sensazioni eviti?",
    "Cosa hai imparato sulle diverse varietà dell'amore nel corso della tua vita?",
    "Che tipo di amicizie desideri?",
    "Quanto sei stato motivato dalla ricerca di potere, denaro, rispetto o qualcos'altro? (Scala da 1 a 10)",
    "Quali delle tue paure sono cambiate e quale paura vedi più frequentemente negli altri?",
    "Quali sono i limiti della tua compassione?",
    "In quale tipo di compagnia ti senti a casa?",
    "Dove sei più tollerante o intollerante?",
    "Cosa hai scoperto attraverso i viaggi?",
    "Cosa pensi delle tue abitudini di spesa e cosa ti serve che il denaro non può comprare?",
    "Quali effetti morali, intellettuali, estetici e sociali ha il lavoro che fai sugli altri e su te stesso?",
    "Di cosa ha bisogno il mondo per essere un posto migliore e cosa desideri contribuire?",
    "Quali decisioni del passato ti hanno più formato?",
    "Cosa ti fa sentire in pace con te stesso?",
    "Qual è stato il momento più trasformativo della tua vita?",
    "Cosa temi di più del futuro?",
    "Quali sono i tuoi modi preferiti per rilassarti?",
    "Quali valori ti guidano nelle decisioni quotidiane?",
    "Cosa desideri insegnare agli altri?",
    "In quali momenti ti senti più vulnerabile?",
    "Cosa ti dà più senso di appartenenza?",
    "Quali sono stati i tuoi successi più gratificanti?",
    "Che ruolo ha la spiritualità nella tua vita?",
    "Quali esperienze hanno cambiato la tua prospettiva di vita?",
    "Cosa significa per te la libertà?",
    "Quale talento vorresti sviluppare ulteriormente?",
    "Quali sono i tuoi più grandi rimpianti?",
    "Come affronti il cambiamento nella tua vita?",
    "Cosa ti fa sentire realizzato professionalmente?",
    "Quali sono i tuoi sogni irrealizzati?",
    "Cosa ti motiva a continuare anche quando le cose si fanno difficili?",
    "Quali sono i tuoi punti di forza e debolezza nelle relazioni interpersonali?",
    "Cosa desideri lasciar andare?",
    "In che modo le tue radici culturali influenzano la tua vita quotidiana?",
    "Quale libro, film o opera d'arte ha influenzato di più la tua visione del mondo?",
    "Qual è la lezione più importante che hai imparato quest'anno?",
    "Cosa significa per te il successo?",
    "Qual è stata la tua esperienza più illuminante?",
    "Come ti prepari ad affrontare sfide personali o professionali?",
    "In cosa senti di aver fallito e cosa hai imparato da esso?",
    "Cosa ti fa sentire autentico?",
    "Quali sogni o aspirazioni ti porti dietro da molto tempo?",
    "Cosa hai imparato dalle tue più grandi sconfitte?",
    "Come ti poni rispetto al concetto di felicità?",
    "Qual è la tua più grande paura e come la gestisci?",
    "Quali relazioni hanno avuto il maggior impatto su di te?",
    "Come ti connetti con il tuo 'io' interiore?",
    "Qual è stata la tua più grande scoperta personale fino a oggi?",
    "Cosa ti spinge a migliorarti ogni giorno?",
    "Cosa desideri che gli altri sappiano di te, ma non dici spesso?",
    "Quali sono i tuoi confini personali e come li comunichi agli altri?",
    "Cosa ti ispira creativamente?",
    "Come bilanci il tuo tempo tra lavoro e vita personale?",
    "Cosa ti fa sentire più vicino agli altri?",
    "Quale parte di te vuoi esplorare di più?",
    "Come affronti i conflitti nelle relazioni personali?",
    "Cosa ti rende orgoglioso di te stesso?",
    "Quali valori desideri trasmettere alle future generazioni?",
    "Quali sono i tuoi obiettivi a lungo termine?",
    "Quali sono le tue aspettative per il futuro?",
    "Cosa ti fa sentire più vivo?",
    "Qual è il tuo più grande desiderio per il mondo?",
    "Cosa ti rende unico?",
    "Quali sono i tuoi più grandi dubbi e paure?",
    "Cosa ti fa sentire più apprezzato?",
    "Qual è il tuo più grande rimpianto?",
    "Cosa ti rende più vulnerabile?",
    "Qual è il tuo più grande sogno?"
  ]


  export default Bigtalk;