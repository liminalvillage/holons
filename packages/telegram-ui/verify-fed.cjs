const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
setTimeout(function() {
  gun.get('Holons').get('federation').get('-1002282981272').once(function(d) {
    console.log(d ? 'Found: ' + String(d).substring(0, 200) : 'Not found');
    process.exit(0);
  });
}, 3000);
setTimeout(function() { process.exit(0); }, 10000);
