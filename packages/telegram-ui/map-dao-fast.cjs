const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const DAO_USERS = new Set(['235114395','379982638','449124342','535329585','1971913512','6152474485']);
const SKIP = new Set(['_','undefined','schemas','settings','shopping','tags','federation','holons_registry','users','holoni','holonic','quest','announcements','expenses','offers','roles','checklists','null','false','true']);

// Scan all holons' users lens only
gun.get('Holons').once(function(data) {
  const ids = Object.keys(data).filter(k => !SKIP.has(k) && k !== '_' && k !== '#' && k.length >= 2 && !k.includes('/') && k !== DAO_ID);
  console.log('Scanning', ids.length, 'holons...');
  
  var results = [];
  var done = 0;
  
  ids.forEach(id => {
    gun.get('Holons').get(id).get('users').once(function(udata) {
      done++;
      if (udata) {
        var ukeys = Object.keys(udata).filter(k => k !== '_' && k !== '#' && udata[k] !== null);
        var shared = ukeys.filter(u => DAO_USERS.has(u));
        if (shared.length > 0) {
          results.push({ id, userCount: ukeys.length, shared: shared.length, sharedUsers: shared });
        }
      }
      if (done >= ids.length) finish();
    });
    // Force timeout per holon
    setTimeout(function() { 
      done++; 
      if (done >= ids.length) finish(); 
    }, 10000);
  });
  
  var finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    console.log('\nFound', results.length, 'holons sharing users with DAO');
    
    // Now get names + quests for connected holons
    var pending = results.length;
    if (pending === 0) { output(); return; }
    
    results.forEach(r => {
      gun.get('Holons').get(r.id).get('settings').map().once(function(s) {
        if (s && typeof s === 'object' && s.name) r.name = s.name;
      });
      gun.get('Holons').get(r.id).get('quests').once(function(q) {
        if (q) r.questCount = Object.keys(q).filter(k => k !== '_' && k !== '#' && q[k] !== null).length;
        pending--;
        if (pending <= 0) setTimeout(output, 2000); // wait for names
      });
    });
  }
  
  function output() {
    results.sort((a, b) => b.shared - a.shared || b.userCount - a.userCount);
    console.log('\n=== DAO NETWORK ===');
    results.forEach(r => console.log(JSON.stringify(r)));
    process.exit(0);
  }
});

setTimeout(() => { console.log('HARD TIMEOUT'); process.exit(0); }, 60000);
