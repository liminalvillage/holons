const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const DAO_USERS = new Set(['235114395','379982638','449124342','535329585','1971913512','6152474485']);
const SKIP = new Set(['_','undefined','schemas','settings','shopping','tags','federation','holons_registry','users','holoni','holonic','quest','announcements','expenses','offers','roles','checklists','null','false','true']);

gun.get('Holons').once(function(data) {
  const ids = Object.keys(data).filter(k => !SKIP.has(k) && k !== '_' && k !== '#' && k.length >= 2 && !k.includes('/') && k !== DAO_ID);
  
  var results = [];
  var done = 0;
  var total = ids.length;
  
  ids.forEach(id => {
    var counted = false;
    function tick() { if (!counted) { counted = true; done++; if (done >= total) phase2(); } }
    
    gun.get('Holons').get(id).get('users').once(function(udata) {
      if (udata) {
        var ukeys = Object.keys(udata).filter(k => k !== '_' && k !== '#' && udata[k] !== null);
        var shared = ukeys.filter(u => DAO_USERS.has(u));
        if (shared.length > 0) results.push({ id, userCount: ukeys.length, shared: shared.length, sharedUsers: shared });
      }
      tick();
    });
    setTimeout(tick, 8000);
  });
  
  var ran = false;
  function phase2() {
    if (ran) return; ran = true;
    console.log('Found', results.length, 'connected holons. Getting names...');
    
    // Get names only — skip quests to avoid hanging
    var namesDone = 0;
    results.forEach(r => {
      r.name = r.id;
      r.questCount = 0;
      gun.get('Holons').get(r.id).get('settings').map().once(function(s) {
        if (s && typeof s === 'object' && s.name) r.name = s.name;
      });
    });
    
    // Just wait 3s for names to resolve
    setTimeout(function() {
      results.sort((a, b) => b.shared - a.shared || b.userCount - a.userCount);
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    }, 3000);
  }
});

setTimeout(() => process.exit(1), 30000);
