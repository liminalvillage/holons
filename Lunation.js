// Original code by Maija Grudule https://github.com/MGrudule/moon_bot

import lune from "lune";
import moment from "moment";
import julian from  "julian";


const prompts = [
"Day 1: Group Dreaming Session: Share your dreams and aspirations in a circle, encouraging openness and understanding.",
"Day 2: Emotional Mapping: Individually draw out a map of emotions associated with your dreams, then discuss as a team.",
"Day 3: Dream Visioning Workshop: Create a collaborative vision board for your shared dream.",
"Day 4: Impact Theater: Enact short plays on how achieving your dream will positively impact your lives and the community.",
"Day 5: Fear Combat Workshop: Discuss common fears and obstacles, then brainstorm solutions together.",
"Day 6: Resource Circle: Identify team skills, knowledge, and external resources you can call upon to support your dream.",
"Day 7: New Moon Meditation: Conduct a group meditation session to visualize your dream coming to life.",
"Day 8: Action Planning Workshop: As a team, break down your dream into actionable steps and tasks.",
"Day 9: Flowchart Challenge: In groups, create flowcharts of task sequences and discuss their effectiveness.",
"Day 10: Resource Rally: Organize a game where teams compete to gather resources for the tasks.",
"Day 11: Risk Management Forum: Discuss potential risks and collaboratively plan for contingencies.",
"Day 12: Task Trading: Negotiate and delegate tasks, allowing team members to take on roles that best utilize their skills.",
"Day 13: Plan Exhibition: Present your final plan to the rest of the team for a comprehensive review.",
"Day 14: Moonlight Celebration: Host a team gathering under the First Quarter Moon to celebrate your planning achievements.",
"Day 15: Step-By-Step Relay: In a relay race style, start executing the first steps of your plan.",
"Day 16: Progress Puzzle: Compile each day's progress into a team 'puzzle' that visually represents your journey.",
"Day 17: Checkpoint Chats: Set aside time for team discussions about daily progress.",
"Day 18: Wellness Workshop: Hold a yoga or mindfulness session to ensure the team is feeling good about the work.",
"Day 19: Revision Roundtable: Review the plan and make necessary adjustments together.",
"Day 20: Energy Exchange: Mix up the tasks among the team members to maintain energy levels.",
"Day 21: Full Moon Reflection: Share progress updates in a circle under the Full Moon.",
"Day 22: Success Showcase: Exhibit your accomplishments as a team to appreciate the efforts of everyone.",
"Day 23: Victory Party: Host a party to celebrate your achievements, big and small.",
"Day 24: Story Circles: Share personal experiences and learnings in a storytelling circle.",
"Day 25: Inspiration Interviews: Pair up and interview each other about your experiences and inspirations.",
"Day 26: Idea Improvement Workshop: Host a workshop where you collectively brainstorm on how to enhance your strategy for the next cycle.",
"Day 27: Relaxation Retreat: Have a team day out or a rest day to rejuvenate before the next cycle begins.",
"Day 28: Gratitude Gathering: Assemble and express your gratitude for each other and for the journey you've completed under the Last Quarter Moon."
]
class Lunation {
  
  constructor(bot){
    this.bot = bot;
    bot.command("fullmoon", (ctx) => {
      let fullMoon = lune.phase_hunt()
        .full_date;
      let prefix = lune.phase()
        .phase > 0.5 ? "was" : "will be";
      ctx.reply(
        `Hello ${ctx.message.from.first_name}, the full moon ${prefix}  ${moment(
          fullMoon
        ).fromNow()} \u{1F315} <i>on ${moment(fullMoon).format("dddd, MMM Do")}</i>`
      );
    });
    
    bot.command("newmoon", (ctx) => {
      let newMoon = lune.phase_hunt()
        .nextnew_date;
    
      ctx.reply(
        `<strong>The '${ordinal(calcLunation(newMoon))} lunar cycle starts ${moment(
          newMoon
        ).fromNow()}</strong> \u{1F311} <i>on ${moment(newMoon).format(
          "dddd, MMM Do"
        )}</i>`
      );
    });
    
    bot.command("phase", (ctx) => {
      ctx.reply(
        `The moon phase is at ${Math.floor(
          lune.phase().phase * 100
        )} % \u{1F318}`
      ); //@TODO: % to moon phase names
    });
    
    bot.command("age", (ctx) =>
      ctx.reply(
        `Thanks for asking ${ctx.message.from.first_name} , I'm ${lune
          .phase()
          .age.toFixed(1)} days old \u{1F318}`
      )
    );
    bot.command("lunation", (ctx) => {
      let age = lune.phase()
        .age.toFixed(0);
      ctx.reply(
        `\u{1F4DC} ${ordinal(age)} day of the '${ordinal(calcLunation(ctx.message.date*1000))} lunation`
      );
    });
    bot.command("prompt" , (ctx) => {
      let age = lune.phase()
        .age.toFixed(0);
      let prompt = prompts[age];
      ctx.reply(
        `\u{1F4DC} ${prompt}`
      );
    })
  }

  progress(){
    return lune.phase()
        .age.toFixed(0);
  }

}
/******* lunation date***** */
 function calcLunation(date) {
  const synodicMonth = 29.530588861,
    lunationBase = 2423436.40347;
  return Math.ceil((julian(date) - lunationBase) / synodicMonth) - 1200;
}

 function ordinal(num) {
  const int = parseInt(num),
    digits = [int % 10, int % 100],
    ordinals = ["st", "nd", "rd", "th"],
    oPattern = [1, 2, 3, 4],
    tPattern = [11, 12, 13, 14, 15, 16, 17, 18, 19];
  return oPattern.includes(digits[0]) && !tPattern.includes(digits[1]) ?
    int + ordinals[digits[0] - 1] :
    int + ordinals[3];
}

export default Lunation;