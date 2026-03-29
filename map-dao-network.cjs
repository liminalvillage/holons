const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const SKIP = new Set(['_','undefined','schemas','settings','shopping','tags','federation','holons_registry','users','holoni','holonic','quest','announcements','expenses','offers','roles','checklists','null','false','true']);

// Step 1: Get DAO users
gun.get('Holons').get(DAO_ID).get('users').once(function(daoUsers) {
  const daoUserIds = Object.keys(daoUsers).filter(k => k !== '_' && k !== '#' && daoUsers[k] !== null);
  console.log('DAO users:', daoUserIds);

  // Step 2: Scan all holons, find ones that share users with DAO
  gun.get('Holons').once(function(data) {
    const holonIds = Object.keys(data).filter(k => !SKIP.has(k) && k !== '_' && k !== '#' && k.length >= 2 && !k.includes('/'));
    console.log('Scanning', holonIds.length, 'holons for shared users...');
    
    var results = {};
    var checked = 0;
    
    holonIds.forEach(id => {
      if (id === DAO_ID) return;
      
      var holonData = { id: id, name: id, users: [], questCount: 0, sharedUsers: [] };
      results[id] = holonData;
      var pending = 3;
      
      function done() {
        pending--;
        if (pending <= 0) {
          checked++;
          if (checked % 100 === 0) console.log('Checked', checked, '/', holonIds.length);
          if (checked >= holonIds.length - 1) {
            // Output results
            var connected = Object.values(results).filter(r => r.sharedUsers.length > 0);
            connected.sort((a, b) => b.sharedUsers.length - a.sharedUsers.length);
            console.log('\n=== HOLONS CONNECTED TO DAO (' + connected.length + ') ===');
            connected.forEach(h => {
              console.log(JSON.stringify({ id: h.id, name: h.name, quests: h.questCount, users: h.userCount, shared: h.sharedUsers.length, sharedWith: h.sharedUsers }));
            });
            process.exit(0);
          }
        }
      }
      
      // Get name
      gun.get('Holons').get(id).get('settings').map().once(function(s) {
        if (s && typeof s === 'object' && s.name && results[id].name === id) {
          results[id].name = s.name;
        }
      });
      
      gun.get('Holons').get(id).get('users').once(function(udata) {
        if (udata) {
          var ukeys = Object.keys(udata).filter(k => k !== '_' && k !== '#' && udata[k] !== null);
          results[id].userCount = ukeys.length;
          results[id].sharedUsers = ukeys.filter(u => daoUserIds.includes(u));
        }
        done();
      });
      
      gun.get('Holons').get(id).get('quests').once(function(qdata) {
        if (qdata) {
          results[id].questCount = Object.keys(qdata).filter(k => k !== '_' && k !== '#' && qdata[k] !== null).length;
        }
        done();
      });
      
      gun.get('Holons').get(id).get('shopping').once(function(sdata) {
        if (sdata) {
          results[id].shoppingCount = Object.keys(sdata).filter(k => k !== '_' && k !== '#' && sdata[k] !== null).length;
        }
        done();
      });
    });
  });
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(0); }, 30000);
