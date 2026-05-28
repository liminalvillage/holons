import createHoloSphere from './src/createHoloSphere.js';

async function testSync() {
  const holosphere = createHoloSphere('test');
  await new Promise(r => setTimeout(r, 3000)); // Wait for connection

  const holonId = '12345';

  // Check what's in the relay
  console.log('--- Checking existing quests from relay ---');
  const existing = await holosphere.getAll(holonId, 'quests');
  console.log('Found', existing.length, 'quests');
  for (const q of existing.slice(0, 5)) {
    console.log(' -', q.id, q.title || '(no title)');
  }

  // Write a new quest
  const testQuest = {
    id: 'sync-test-' + Date.now(),
    title: 'Sync Test Quest ' + new Date().toISOString(),
    status: 'pending',
    createdAt: Date.now(),
  };

  console.log('\n--- Writing quest:', testQuest.id);
  await holosphere.put(holonId, 'quests', testQuest);
  console.log('Write completed');

  // Wait a bit for sync
  console.log('\nWaiting 3s for sync...');
  await new Promise(r => setTimeout(r, 3000));

  // Check if it's there
  console.log('\n--- Checking getAll after sync wait ---');
  const afterSync = await holosphere.getAll(holonId, 'quests');
  console.log('Found', afterSync.length, 'quests');
  const found = afterSync.find(q => q.id === testQuest.id);
  console.log('Our quest found:', found ? 'YES' : 'NO');

  // Direct read
  console.log('\n--- Direct get ---');
  const direct = await holosphere.get(holonId, 'quests', testQuest.id);
  console.log(
    'Direct result:',
    direct ? JSON.stringify(direct).slice(0, 100) : 'NOT FOUND'
  );

  console.log('\n--- Relay status ---');
  console.log('Configured relays:', holosphere.config?.relays);

  process.exit(0);
}

testSync().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
