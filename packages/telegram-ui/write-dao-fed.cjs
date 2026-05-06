const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const fedTargets = ['-1002352632800', '-1003841848650', '-1002312717667', '-1002490801907'];

var fedInfo = {
  id: DAO_ID,
  name: 'Holonic DAO',
  federation: fedTargets,
  notify: fedTargets,
  lensConfig: {},
  timestamp: Date.now()
};

// Set default lens config for each target
fedTargets.forEach(function(t) {
  fedInfo.lensConfig[t] = {
    federate: ['quests', 'events', 'announcements'],
    notify: ['quests', 'events', 'announcements'],
    timestamp: Date.now()
  };
});

setTimeout(function() {
  console.log('Writing DAO federation data...');
  console.log(JSON.stringify(fedInfo, null, 2));
  
  gun.get('Holons').get('federation').get(DAO_ID).put(JSON.stringify(fedInfo), function(ack) {
    console.log('Write ack:', JSON.stringify(ack));
    
    // Also write bidirectional entries for each target
    var done = 0;
    fedTargets.forEach(function(targetId) {
      // Check if target already has federation data
      gun.get('Holons').get('federation').get(targetId).once(function(existing) {
        var targetFed;
        if (existing && typeof existing === 'string') {
          try { targetFed = JSON.parse(existing); } catch(e) {}
        }
        if (!targetFed) {
          targetFed = { id: targetId, name: targetId, federation: [], notify: [], lensConfig: {}, timestamp: Date.now() };
        }
        if (!targetFed.federation) targetFed.federation = [];
        if (!targetFed.notify) targetFed.notify = [];
        
        if (!targetFed.federation.includes(DAO_ID)) targetFed.federation.push(DAO_ID);
        if (!targetFed.notify.includes(DAO_ID)) targetFed.notify.push(DAO_ID);
        targetFed.timestamp = Date.now();
        
        gun.get('Holons').get('federation').get(targetId).put(JSON.stringify(targetFed), function(ack2) {
          console.log('Wrote bidirectional for ' + targetId + ':', JSON.stringify(ack2));
          done++;
          if (done >= fedTargets.length) {
            // Verify
            setTimeout(function() {
              gun.get('Holons').get('federation').get(DAO_ID).once(function(data) {
                console.log('\nVerification read:', data ? 'OK (' + data.length + ' bytes)' : 'FAIL');
                process.exit(0);
              });
            }, 2000);
          }
        });
      });
    });
  });
}, 2000);

setTimeout(() => process.exit(0), 20000);
