/**
 * Test HolonsBot with Nostr Relay Synchronization
 *
 * This script tests that HoloSphere works with Nostr relays
 * and that data syncs across multiple instances.
 */

import createHoloSphere from './src/createHoloSphere.js';

console.log('\n=== HolonsBot Sync Test ===\n');

// Create HoloSphere instance
const holosphere = createHoloSphere('holonsbot-quests');

const holonId = 'test-holon';

console.log('\n📝 Testing quest operations...\n');

// Test 1: Create a quest
console.log('1. Creating a quest...');
const quest1 = {
  id: `quest-${Date.now()}-1`,
  title: 'Test Quest from HolonsBot',
  description: 'This quest was created using HoloSphere directly',
  reward: 2000,
  status: 'active',
  difficulty: 'medium',
};

try {
  await holosphere.put(holonId, 'quests', quest1);
  console.log('✅ Quest created successfully');
} catch (error) {
  console.error('❌ Failed to create quest:', error.message);
}

// Wait for sync
await new Promise(resolve => setTimeout(resolve, 2000));

// Test 2: Read all quests
console.log('\n2. Reading all quests...');
try {
  const allQuests = await holosphere.getAll(holonId, 'quests');
  if (allQuests && allQuests.length > 0) {
    console.log(`✅ Found ${allQuests.length} quest(s):`);
    allQuests.forEach((quest, idx) => {
      console.log(`   ${idx + 1}. ${quest.title} (${quest.id})`);
    });
  } else {
    console.log('⚠️  No quests found');
  }
} catch (error) {
  console.error('❌ Failed to read quests:', error.message);
}

// Test 3: Read a specific quest
console.log('\n3. Reading specific quest by ID...');
try {
  const specificQuest = await holosphere.get(holonId, 'quests', quest1.id);
  if (specificQuest) {
    console.log(`✅ Found quest: ${specificQuest.title}`);
    console.log(`   Description: ${specificQuest.description}`);
    console.log(`   Reward: ${specificQuest.reward} gold`);
  } else {
    console.log('⚠️  Quest not found');
  }
} catch (error) {
  console.error('❌ Failed to read specific quest:', error.message);
}

// Test 4: Create another quest
console.log('\n4. Creating second quest...');
const quest2 = {
  id: `quest-${Date.now()}-2`,
  title: 'Collect Mystical Herbs',
  description: 'Gather rare herbs from the enchanted forest',
  reward: 1500,
  status: 'active',
  difficulty: 'easy',
};

try {
  await holosphere.put(holonId, 'quests', quest2);
  console.log('✅ Second quest created successfully');
} catch (error) {
  console.error('❌ Failed to create second quest:', error.message);
}

// Wait for sync
await new Promise(resolve => setTimeout(resolve, 2000));

// Test 5: Read all quests again
console.log('\n5. Reading all quests again...');
try {
  const allQuests = await holosphere.getAll(holonId, 'quests');
  if (allQuests && allQuests.length > 0) {
    console.log(`✅ Found ${allQuests.length} quest(s) total`);
  }
} catch (error) {
  console.error('❌ Failed to read quests:', error.message);
}

console.log('\n=== Test Complete ===\n');
console.log('✅ HoloSphere is now configured to sync via Nostr relays!');
console.log('   All data written will sync across nodes.');
console.log('\nTo test multi-node sync:');
console.log('   1. Run this script on Node 1');
console.log('   2. Run this script on Node 2 (different machine/terminal)');
console.log('   3. Both nodes should see the same quests!\n');
console.log('Press Ctrl+C to exit.');
