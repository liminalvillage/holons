const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const DAO_ID = '-1002282981272';

setTimeout(function() {
  // List ALL federation entries
  gun.get('Holons').get('federation').map().once(function(item, key) {
    if (!item) return;
    var raw = item;
    if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
    // Check if key matches DAO or federation array contains DAO
    var isRelevant = key === DAO_ID || key === '1002282981272' || 
      (item.federation && (item.federation.includes(DAO_ID) || item.federation.includes('1002282981272')));
    
    console.log(key + ': fed=' + JSON.stringify(item.federation || []) + (isRelevant ? ' *** RELEVANT ***' : ''));
  });
}, 2000);

setTimeout(() => process.exit(0), 10000);
