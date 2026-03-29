const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

// Get all federation entries with resolved names
var ids = ['-1002282981272', '-1002352632800', '-1003841848650', '-1002312717667', '-1002490801907'];

setTimeout(function() {
  ids.forEach(function(id) {
    gun.get('Holons').get(id).get('settings').map().once(function(s, key) {
      if (s && typeof s === 'string') try { s = JSON.parse(s); } catch(e) {}
      if (s && typeof s === 'object' && s.name) {
        console.log(id + ' → ' + s.name);
      }
    });
  });
  
  // Also get user counts
  setTimeout(function() {
    ids.forEach(function(id) {
      gun.get('Holons').get(id).get('users').once(function(u) {
        if (u) {
          var count = Object.keys(u).filter(k => k !== '_' && k !== '#' && u[k] !== null).length;
          console.log(id + ' users: ' + count);
        }
      });
      gun.get('Holons').get(id).get('quests').once(function(q) {
        if (q) {
          var count = Object.keys(q).filter(k => k !== '_' && k !== '#' && q[k] !== null).length;
          console.log(id + ' quests: ' + count);
        }
      });
    });
  }, 3000);
}, 2000);

setTimeout(() => process.exit(0), 10000);
