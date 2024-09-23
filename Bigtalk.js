import { Markup } from 'telegraf'

class Bigtalk {
  
    constructor(bot){
        this.bot = bot
        this.bot.command('bigtalk',(ctx) => this.pickQuestion(ctx))
        const gameShortName = 'holons'
        const gameUrl = 'https://bigtalk.com'

        const markup = Markup.inlineKeyboard([
        Markup.button.game('🎮 Play now!'),
        Markup.button.url('Telegraf help', 'http://telegraf.js.org')
        ])

       // bot.start((ctx) => ctx.replyWithGame(gameShortName))
        bot.command('foo', (ctx) => ctx.replyWithGame(gameShortName, markup))
        bot.gameQuery((ctx) => ctx.answerGameQuery(gameUrl))
    }

    pickQuestion(ctx){
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

  export default Bigtalk;