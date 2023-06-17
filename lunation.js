// Original code by Maija Grudule https://github.com/MGrudule/moon_bot

import lune from "lune";
import moment from "moment";
import julian from  "julian";

class lunation {
  
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
    bot.command("today", (ctx) => {
      let age = lune.phase()
        .age.toFixed(0);
      ctx.reply(
        `\u{1F4DC} ${ordinal(age)} day of the '${ordinal(calcLunation(ctx.message.date*1000))} lunation`
      );
    });
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

export default lunation;