const Gun = require('gun'); require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });
var ids = ['-1003841848650', '-1002312717667'];
setTimeout(function() {
  ids.forEach(function(id) {
    gun.get('Holons').get(id).once(function(data) {
      if (data) {
        var keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
        console.log(id + ' lenses: ' + keys.join(', '));
      } else {
        console.log(id + ': no data');
      }
    });
  });
}, 2000);
setTimeout(() => process.exit(0), 8000);
