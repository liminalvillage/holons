const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const payload = JSON.stringify({
  id: DAO_ID,
  name: 'Holonic DAO',
  federation: ['-1002352632800', '-1003841848650', '-1002312717667', '-1002490801907'],
  notify: ['-1002352632800', '-1003841848650', '-1002312717667', '-1002490801907'],
  timestamp: Date.now()
});

setTimeout(function() {
  // Method 1: Use the HoloSphere putGlobal pattern exactly
  var path = gun.get('Holons').get('federation');
  var item = path.get(DAO_ID);
  
  console.log('Writing via .put(string)...');
  item.put(payload, function(ack) {
    console.log('Ack:', JSON.stringify(ack));
  });

  // Wait and verify
  setTimeout(function() {
    console.log('\nVerifying with .once()...');
    gun.get('Holons').get('federation').get(DAO_ID).once(function(d) {
      console.log('Result:', d ? String(d).substring(0, 150) : 'null/undefined');
    });
    
    // Also try .on()
    setTimeout(function() {
      console.log('\nVerifying with .on()...');
      gun.get('Holons').get('federation').get(DAO_ID).on(function(d) {
        console.log('on() result:', d ? String(d).substring(0, 150) : 'null/undefined');
        process.exit(0);
      });
    }, 2000);
  }, 3000);
}, 2000);

setTimeout(function() { console.log('Timeout'); process.exit(0); }, 15000);
