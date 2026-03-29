const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const targets = ['-1002352632800', '-1003841848650', '-1002312717667', '-1002490801907'];
var done = 0;

setTimeout(function() {
  targets.forEach(function(tid) {
    // Read existing, merge, write back
    gun.get('Holons').get('federation').get(tid).once(function(existing) {
      var fed;
      if (existing && typeof existing === 'string') try { fed = JSON.parse(existing); } catch(e) {}
      if (!fed || typeof fed !== 'object') {
        fed = { id: tid, name: tid, federation: [], notify: [], timestamp: Date.now() };
      }
      if (!fed.federation) fed.federation = [];
      if (!fed.notify) fed.notify = [];
      if (!fed.federation.includes(DAO_ID)) fed.federation.push(DAO_ID);
      if (!fed.notify.includes(DAO_ID)) fed.notify.push(DAO_ID);
      fed.timestamp = Date.now();

      gun.get('Holons').get('federation').get(tid).put(JSON.stringify(fed));
      console.log('Wrote ' + tid + ': federation=' + JSON.stringify(fed.federation));
      done++;
      if (done >= targets.length) {
        setTimeout(function() {
          console.log('\nVerifying all...');
          gun.get('Holons').get('federation').once(function(data) {
            var keys = Object.keys(data).filter(k => k !== '_' && k !== '#' && data[k] !== null);
            console.log('Total federation entries:', keys.length);
            process.exit(0);
          });
        }, 3000);
      }
    });
  });
}, 2000);

setTimeout(function() { process.exit(0); }, 20000);
