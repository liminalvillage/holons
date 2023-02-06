function printProgramme(){
    var p = "Programme (CEST): \n"
    for (var i = 0; i < programme.length; i++) {
      var d = new Date(programme[i].time)
      p += addZero(d.getHours()) +":"+ addZero(d.getMinutes()) + " - "
      p += programme[i].topic + " by " + programme[i].name + " (On " + programme[i].server +")\n"
    }
    return p
  }

  // Cancel an entry
  {
  if (commandBody[0] ==='cancel') {
    programme = programme.filter(item => item.name !== msg.author.username)
    msg.channel.send(printProgramme())
      .catch(error => {
        console.log(error);
      });
  };


  if (commandBody[0] === 'schedule') {
    var name = msg.author.username
    var time
    if (commandBody[1]) {
     time =  commandBody[1]
    }
    if (!commandBody[1] || !time.match(/^([0-9]|0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/)){
      msg.channel.send("Wrong time format! Usage example: !schedule 10:00 Yoga ")
      .catch(error => {
        console.log(error);
      }); 
      return 
    }
  
    
    let topic = msg.content.toString().slice(msg.content.toString().indexOf(time) + (time.length + 1))
   
    var d = new Date()
    d.setHours(time.split(":")[0])
    d.setMinutes(time.split(":")[1])
    var o = Object()
    o.name = name
    o.topic = topic
    o.time = d.toUTCString()
    o.server = msg.guild.toString()

    programme.push(o)

    programme = programme.sort(function (a, b) {
      return (new Date(a.time)).getTime() - (new Date(b.time)).getTime();
    })
    msg.channel.send(name + " has scheduled " + topic + " at " + time)
      .catch(error => {
        console.log(error);
      });

    msg.channel.send(printProgramme())
      .catch(error => {
        console.log(error);
      });
  }
