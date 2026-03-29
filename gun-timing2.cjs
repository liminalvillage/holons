const Gun = require('gun');
require('gun/sea');

const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const start = Date.now();
let callCount = 0;

function elapsed() { return ((Date.now() - start) / 1000).toFixed(2); }

gun.get('Holons').on(function(data) {
  callCount++;
  if (!data) return;
  const keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
  const nullKeys = keys.filter(k => data[k] === null).length;
  const refKeys = keys.filter(k => data[k] && typeof data[k] === 'object').length;
  console.log(`[${elapsed()}s] cb#${callCount}: ${keys.length} keys (${refKeys} refs, ${nullKeys} null)`);
  if (callCount >= 15) { process.exit(0); }
});

setTimeout(() => process.exit(0), 15000);
