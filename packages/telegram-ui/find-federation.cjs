const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

// Sample some holons to find any with federation data
const SKIP = new Set(['_','undefined','schemas','settings','shopping','tags','federation','holons_registry','users','holoni','holonic','quest','announcements','expenses','offers','roles','checklists','null','false','true']);
var checked = 0;
var found = [];

gun.get('Holons').once(function(data) {
  const keys = Object.keys(data).filter(k => !SKIP.has(k) && k !== '_' && k !== '#' && k.length >= 2 && !k.includes('/'));
  console.log('Total holons:', keys.length);
  
  // Check first 100 for federation data
  keys.slice(0, 100).forEach(id => {
    gun.get('Holons').get(id).get('federation').once(function(fed) {
      checked++;
      if (fed) {
        const fkeys = Object.keys(fed).filter(k => k !== '_' && k !== '#');
        if (fkeys.length > 0) {
          found.push({ id, count: fkeys.length });
          console.log('FOUND federation on ' + id + ': ' + fkeys.length + ' entries');
        }
      }
      if (checked >= 100) {
        console.log('Checked 100, found ' + found.length + ' with federation data');
      }
    });
  });
});

setTimeout(() => process.exit(0), 8000);
