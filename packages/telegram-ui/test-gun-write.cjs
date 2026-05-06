const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const testKey = 'atlas-test-' + Date.now();

// Write
setTimeout(function() {
  console.log('Writing test data with key:', testKey);
  gun.get('Holons').get('federation').get(testKey).put(JSON.stringify({
    id: testKey,
    name: 'Atlas Write Test',
    federation: ['test-target-1'],
    notify: ['test-target-1'],
    timestamp: Date.now()
  }), function(ack) {
    console.log('Write ack:', JSON.stringify(ack));
  });

  // Read back after 3s
  setTimeout(function() {
    console.log('\nReading back...');
    gun.get('Holons').get('federation').get(testKey).once(function(data) {
      console.log('Read result:', data ? String(data).substring(0, 300) : 'null');
      
      // Clean up
      gun.get('Holons').get('federation').get(testKey).put(null, function() {
        console.log('Cleaned up test data');
        process.exit(0);
      });
    });
  }, 3000);
}, 2000);

setTimeout(() => process.exit(0), 12000);
