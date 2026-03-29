const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

// Try different possible appnames
var appnames = ['Holons', 'holons', 'HolonsBot', 'holonsbot', 'holonic', 'Holonic'];
var DAO_ID = '-1002282981272';

setTimeout(function() {
  appnames.forEach(function(app) {
    // Check federation global table
    gun.get(app).get('federation').get(DAO_ID).once(function(data) {
      if (data) console.log('FOUND! appname=' + app + ' federation/' + DAO_ID + ':', String(data).substring(0, 300));
    });
    
    // Also check if settings exist under this appname
    gun.get(app).get(DAO_ID).get('settings').once(function(data) {
      if (data) {
        var keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
        if (keys.length > 0) console.log('Settings found under appname=' + app + ': ' + keys.length + ' keys');
      }
    });
  });
  
  // Also try: maybe federation is stored as a lens under the holon itself
  gun.get('Holons').get(DAO_ID).map().once(function(data, key) {
    if (key && key !== '_' && key !== '#') {
      var hasData = data && (typeof data === 'string' ? data.length > 2 : Object.keys(data).filter(k => k !== '_' && k !== '#').length > 0);
      if (hasData) console.log('Holon lens: ' + key + ' (has data)');
    }
  });
}, 3000);

setTimeout(() => process.exit(0), 10000);
