const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const DAO_ID = '-1002282981272';

// Try both .on() and .once() with delay
setTimeout(function() {
  // Check with .on() for live updates
  gun.get('Holons').get('federation').get(DAO_ID).on(function(item) {
    if (!item) return;
    if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
    console.log('DAO Federation (via .on()):');
    console.log(JSON.stringify(item, null, 2));
    process.exit(0);
  });
  
  // Also scan all federation entries for anything new
  gun.get('Holons').get('federation').once(function(data) {
    if (!data) return;
    var keys = Object.keys(data).filter(k => k !== '_' && k !== '#' && data[k] !== null);
    console.log('Total federation entries now:', keys.length);
    // Check if any entry references the DAO
    keys.forEach(k => {
      gun.get('Holons').get('federation').get(k).once(function(item) {
        if (!item) return;
        if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
        if (item && item.federation && (item.federation.includes(DAO_ID) || k === DAO_ID)) {
          console.log('\nFound DAO reference in:', k);
          console.log(JSON.stringify(item, null, 2));
        }
      });
    });
  });
}, 3000);

setTimeout(() => { console.log('Timeout - no DAO federation found'); process.exit(0); }, 15000);
