const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

// Federation is stored globally: gun.get('Holons').get('federation').get(spaceId)
gun.get('Holons').get('federation').once(function(data) {
  if (!data) { console.log('No global federation data'); process.exit(0); return; }
  var keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
  console.log('Global federation entries:', keys.length);
  
  keys.forEach(k => {
    gun.get('Holons').get('federation').get(k).once(function(item) {
      if (!item) return;
      if (typeof item === 'string') {
        try { item = JSON.parse(item); } catch(e) {}
      }
      console.log('\n=== ' + k + ' ===');
      if (typeof item === 'object') {
        console.log('Name:', item.name);
        console.log('Federation:', JSON.stringify(item.federation));
        console.log('Notify:', JSON.stringify(item.notify));
        console.log('LensConfig keys:', item.lensConfig ? Object.keys(item.lensConfig) : 'none');
      } else {
        console.log(String(item).substring(0, 200));
      }
    });
  });
});

setTimeout(() => process.exit(0), 8000);
