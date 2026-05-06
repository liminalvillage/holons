const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
const DAO_ID = '-1002282981272';

setTimeout(function() {
  // 1. Check settings for federation field
  gun.get('Holons').get(DAO_ID).get('settings').map().once(function(item, key) {
    if (!item) return;
    if (typeof item === 'string') try { item = JSON.parse(item); } catch(e) {}
    if (typeof item === 'object') {
      console.log('SETTINGS key=' + key + ':');
      // Look for federation-related fields
      for (var k in item) {
        if (k.toLowerCase().includes('feder') || k === 'federation' || k === 'federated' || k === 'spaces') {
          console.log('  ' + k + ':', JSON.stringify(item[k]));
        }
      }
      // Also dump all keys
      console.log('  All keys:', Object.keys(item).join(', '));
    }
  });

  // 2. Check all top-level lenses
  var lenses = ['federation','federated','federations','spaces','children','subholons','holons','members','links','connections','network'];
  lenses.forEach(function(lens) {
    gun.get('Holons').get(DAO_ID).get(lens).once(function(data) {
      if (data) {
        var keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
        if (keys.length > 0) console.log('\nLENS ' + lens + ': ' + keys.length + ' keys — ' + keys.slice(0, 10).join(', '));
      }
    });
  });

  // 3. Check global tables that might store federation
  var globals = ['federation','federations','federationMeta','federation_messages'];
  globals.forEach(function(table) {
    gun.get('Holons').get(table).get(DAO_ID).once(function(data) {
      if (data) console.log('\nGLOBAL ' + table + '/' + DAO_ID + ':', typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200));
    });
  });

  // 4. Check without minus sign
  gun.get('Holons').get('federation').get('1002282981272').once(function(data) {
    if (data) console.log('\nGLOBAL federation/1002282981272 (no minus):', typeof data === 'string' ? data.substring(0, 200) : JSON.stringify(data).substring(0, 200));
  });

}, 3000);

setTimeout(() => process.exit(0), 12000);
