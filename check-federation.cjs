const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';

// Check federation lens
gun.get('Holons').get(DAO_ID).get('federation').once(function(data) {
  console.log('=== FEDERATION LENS (raw) ===');
  if (!data) { console.log('null'); return; }
  const keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
  console.log(keys.length + ' keys:', keys.slice(0, 20));
  
  // Get each federation entry
  keys.forEach(k => {
    gun.get('Holons').get(DAO_ID).get('federation').get(k).once(function(item) {
      console.log('\n--- ' + k + ' ---');
      if (typeof item === 'string') {
        try { item = JSON.parse(item); } catch(e) {}
      }
      console.log(JSON.stringify(item, null, 2));
    });
  });
});

// Also check settings for name
gun.get('Holons').get(DAO_ID).get('settings').once(function(data) {
  console.log('\n=== SETTINGS ===');
  if (!data) { console.log('null'); return; }
  const keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
  keys.forEach(k => {
    gun.get('Holons').get(DAO_ID).get('settings').get(k).once(function(item) {
      if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
      console.log(k + ':', JSON.stringify(item));
    });
  });
});

setTimeout(() => process.exit(0), 8000);
