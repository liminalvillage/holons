const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
gun.get('Holons').get('federation').once(function(data) {
  if (!data) { process.exit(0); return; }
  var keys = Object.keys(data).filter(k => k !== '_' && k !== '#' && data[k] !== null);
  console.log('Total federation entries:', keys.length);
  var results = [];
  var done = 0;
  keys.forEach(k => {
    gun.get('Holons').get('federation').get(k).once(function(item) {
      done++;
      if (item) {
        if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
        if (item.federation && item.federation.length > 0) {
          results.push({ id: k, name: item.name || k, federation: item.federation, notify: item.notify || [] });
        }
      }
      if (done >= keys.length) {
        console.log('\nActive federations:', results.length);
        results.forEach(r => console.log(JSON.stringify(r)));
        process.exit(0);
      }
    });
  });
});
setTimeout(() => process.exit(0), 10000);
