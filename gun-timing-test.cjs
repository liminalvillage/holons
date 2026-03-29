const Gun = require('gun');
require('gun/sea');

const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const SKIP = new Set(['_','undefined','schemas','settings','shopping','tags','federation','holons_registry','users','holoni','holonic','quest','announcements','expenses','offers','roles','checklists','null','false','true']);

const start = Date.now();
const allKeys = {};
let callCount = 0;
let lastCount = 0;

function elapsed() { return ((Date.now() - start) / 1000).toFixed(2); }

console.log(`[${elapsed()}s] Connected. Listening with .on()...`);

gun.get('Holons').on(function(data) {
  callCount++;
  if (!data) return;
  const keys = Object.keys(data).filter(k => k !== '_' && k !== '#' && !SKIP.has(k) && k.length >= 2 && !k.includes('/'));
  keys.forEach(k => { allKeys[k] = true; });
  const total = Object.keys(allKeys).length;
  if (total !== lastCount) {
    console.log(`[${elapsed()}s] callback #${callCount}: ${keys.length} in batch → ${total} total`);
    lastCount = total;
  }
});

// Log every 5s for 30s then exit
let checks = 0;
const iv = setInterval(() => {
  checks++;
  console.log(`[${elapsed()}s] --- ${Object.keys(allKeys).length} total keys, ${callCount} callbacks ---`);
  if (checks >= 6) { clearInterval(iv); process.exit(0); }
}, 5000);
