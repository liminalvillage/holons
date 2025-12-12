/**
 * Test script to verify that Nostr relay deletions are working properly
 *
 * This script will:
 * 1. Write test data to the relay
 * 2. Verify the data exists
 * 3. Delete the data
 * 4. Verify the deletion was successful
 * 5. Check if the relay properly handles NIP-09 deletion events
 */

import DB from './DB.js';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testRelayDeletion() {
  log('\n=== Testing Relay Deletion Behavior ===\n', 'cyan');

  // Initialize DB
  const db = new DB('relay-deletion-test');
  await db.init();

  const testholonId = 'test-deletion-chat-' + Date.now();
  const testTable = testholonId + '/quests';

  try {
    // Step 1: Write test data
    log('Step 1: Writing test data to relay...', 'blue');
    const testQuest1 = {
      id: 'quest-1',
      title: 'Test Quest 1',
      description: 'This is a test quest'
    };
    const testQuest2 = {
      id: 'quest-2',
      title: 'Test Quest 2',
      description: 'This is another test quest'
    };

    await db.put(testTable, testQuest1);
    await db.put(testTable, testQuest2);
    log('✅ Test data written successfully', 'green');

    // Wait a bit for relay to process
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Verify data exists
    log('\nStep 2: Verifying test data exists...', 'blue');
    const quest1 = await db.get(testTable, 'quest-1');
    const quest2 = await db.get(testTable, 'quest-2');

    if (quest1 && quest2) {
      log('✅ Both quests found:', 'green');
      log(`  - Quest 1: ${quest1.title}`, 'green');
      log(`  - Quest 2: ${quest2.title}`, 'green');
    } else {
      log('❌ Failed to retrieve test data from relay', 'red');
      return;
    }

    // Step 3: Delete single item
    log('\nStep 3: Deleting single quest (quest-1)...', 'blue');
    await db.del(testTable, 'quest-1');
    log('✅ Delete command executed', 'green');

    // Wait for relay to process deletion
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 4: Verify single deletion
    log('\nStep 4: Verifying quest-1 is deleted...', 'blue');
    const deletedQuest = await db.get(testTable, 'quest-1');

    if (deletedQuest === null || deletedQuest._deleted === true) {
      log('✅ Quest 1 successfully deleted from relay', 'green');
    } else {
      log('❌ Quest 1 still exists on relay!', 'red');
      log('   Data:', JSON.stringify(deletedQuest), 'yellow');
    }

    // Verify quest-2 still exists
    const remainingQuest = await db.get(testTable, 'quest-2');
    if (remainingQuest && !remainingQuest._deleted) {
      log('✅ Quest 2 still exists (correct)', 'green');
    } else {
      log('❌ Quest 2 was unexpectedly deleted', 'red');
    }

    // Step 5: Delete entire table
    log('\nStep 5: Dropping entire table...', 'blue');
    await db.drop(testTable);
    log('✅ Drop command executed', 'green');

    // Wait for relay to process
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 6: Verify table deletion
    log('\nStep 6: Verifying entire table is deleted...', 'blue');
    const allQuests = await db.getAll(testTable);

    if (!allQuests || allQuests.length === 0 || allQuests.every(q => q._deleted === true)) {
      log('✅ All quests successfully deleted from relay', 'green');
    } else {
      log('❌ Some quests still exist on relay!', 'red');
      log('   Remaining quests:', JSON.stringify(allQuests), 'yellow');
    }

    // Step 7: Check relay configuration
    log('\nStep 7: Checking relay configuration...', 'blue');
    log(`  Relay URL: ${db.holosphere.config.relays[0]}`, 'cyan');
    log(`  Public Key: ${db.holosphere.client.publicKey}`, 'cyan');

    // Summary
    log('\n=== Test Complete ===\n', 'cyan');
    log('If deletions are showing as failed:', 'yellow');
    log('1. Check the console logs for "NIP-09 deletion event" messages', 'yellow');
    log('2. The relay might not support NIP-09 deletion events', 'yellow');
    log('3. The external dashboard might be caching old data', 'yellow');
    log('4. There might be a timing delay for relay propagation', 'yellow');
    log('\nRecommendation:', 'cyan');
    log('- If relay deletions are failing, the external dashboard may be reading cached data', 'cyan');
    log('- Try refreshing the dashboard or clearing its cache', 'cyan');
    log('- Check if the relay properly supports NIP-09 (kind 5) deletion events', 'cyan');

  } catch (error) {
    log('\n❌ Test failed with error:', 'red');
    console.error(error);
  }

  process.exit(0);
}

// Run the test
testRelayDeletion();
