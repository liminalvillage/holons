const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const DAO_ID = '-1002282981272';

gun.get('Holons').get('federation').get(DAO_ID).once(function(item) {
  if (!item) { console.log('No federation data for DAO'); process.exit(0); return; }
  if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
  console.log('DAO Federation:');
  console.log(JSON.stringify(item, null, 2));
  process.exit(0);
});

setTimeout(() => process.exit(0), 8000);
