const Gun = require('gun');
require('gun/sea');
const gun = Gun({ peers: ['https://gun.holons.io/gun'], localStorage: false, radisk: false });

const DAO_ID = '-1002282981272';
const LENSES = ['quests','users','shopping','announcements','expenses','offers','roles','tags','checklists','settings','federation','holons','children','members','subholons'];

LENSES.forEach(lens => {
  gun.get('Holons').get(DAO_ID).get(lens).once(function(data) {
    if (!data) { console.log(lens + ': (empty)'); return; }
    const keys = Object.keys(data).filter(k => k !== '_' && k !== '#');
    const nonNull = keys.filter(k => data[k] !== null);
    console.log(lens + ': ' + nonNull.length + ' items — ' + nonNull.slice(0, 5).join(', '));
  });
});

setTimeout(() => process.exit(0), 5000);
