/**
 * Cross-Holosphere Federation Integration Test
 *
 * Tests real federation between two separate HoloSphere instances
 * connecting to the actual Nostr relay at wss://relay.holons.io
 *
 * Run with: npx tsx src/tests/federation.test.ts
 */

import { HoloSphere } from 'holosphere';

// Configuration
const RELAY = 'wss://relay.holons.io';
const APP_NAME = `federation-test-${Date.now()}`;
const RELAY_SYNC_WAIT = 5000; // 5 seconds for relay propagation

// Two distinct private keys for separate holosphere instances
const PRIVATE_KEY_A = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const PRIVATE_KEY_B = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

// Test results tracking
let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function assertThrows(fn: () => Promise<any>, pattern: RegExp, message: string): Promise<void> {
  try {
    await fn();
    console.error(`  ✗ ${message} - Expected error but none thrown`);
    failed++;
  } catch (error: any) {
    if (pattern.test(error.message)) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ ${message} - Wrong error: ${error.message}`);
      failed++;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFederationTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Cross-Holosphere Federation Integration Test');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Relay: ${RELAY}`);
  console.log(`  App Name: ${APP_NAME}`);
  console.log('');

  let holosphereA: HoloSphere | null = null;
  let holosphereB: HoloSphere | null = null;

  try {
    // ═══════════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Setup: Initializing HoloSphere instances...');

    holosphereA = new HoloSphere({
      appName: APP_NAME,
      privateKey: PRIVATE_KEY_A,
      backend: 'nostr',
      relays: [RELAY],
      logLevel: 'ERROR'
    });

    holosphereB = new HoloSphere({
      appName: APP_NAME,
      privateKey: PRIVATE_KEY_B,
      backend: 'nostr',
      relays: [RELAY],
      logLevel: 'ERROR'
    });

    console.log('  Waiting for relay connections...');
    await holosphereA.ready();
    await holosphereB.ready();

    const publicKeyA = holosphereA.client.publicKey;
    const publicKeyB = holosphereB.client.publicKey;

    console.log(`  HoloSphere A: ${publicKeyA.substring(0, 16)}...`);
    console.log(`  HoloSphere B: ${publicKeyB.substring(0, 16)}...`);

    // Create test holon (San Francisco coordinates)
    const testHolonId = await holosphereA.toHolon(37.7749, -122.4194, 9);
    console.log(`  Test Holon: ${testHolonId}`);

    // Wait for connections to stabilize
    await sleep(2000);
    console.log('  Setup complete!\n');

    // Test data
    const testQuestId = `quest-fed-test-${Date.now()}`;
    const testQuest = {
      id: testQuestId,
      title: 'Federation Test Quest',
      when: new Date().toISOString(),
      status: 'ongoing',
      participants: [{ username: 'tester-a' }],
    };

    let capabilityToken: string = '';
    let capabilityId: string = '';

    // ═══════════════════════════════════════════════════════════════
    // TEST 1: A can write quest data
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 1: A can write quest data');

    const writeResult = await holosphereA.write(testHolonId, 'quests', testQuest);
    assert(!!writeResult, 'Write operation returned result');

    console.log(`  Waiting ${RELAY_SYNC_WAIT}ms for relay propagation...`);
    await sleep(RELAY_SYNC_WAIT);

    const readData = await holosphereA.read(testHolonId, 'quests', testQuestId);
    assert(!!readData, 'A can read written data');
    assert(readData.id === testQuestId, 'Quest ID matches');
    assert(readData.title === testQuest.title, 'Quest title matches');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 2: B cannot read A's data without capability
    // ═══════════════════════════════════════════════════════════════
    console.log("▸ Test 2: B cannot read A's data without capability");

    // Add A as partner without capability
    await holosphereB.addFederatedHolosphere(publicKeyA);

    await assertThrows(
      () => holosphereB!.readFromFederatedSource(publicKeyA, testHolonId, 'quests', testQuestId),
      /No valid capability/,
      'Access denied without capability'
    );
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 3: A issues capability to B
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 3: A issues capability to B');

    capabilityToken = await holosphereA.issueCapabilityForFederation(
      publicKeyB,
      { holonId: testHolonId, lensName: 'quests' },
      ['read'],
      { expiresIn: 3600000, trackInRegistry: true }
    );

    assert(typeof capabilityToken === 'string', 'Capability token is a string');
    assert(capabilityToken.length > 0, 'Capability token is not empty');

    // Try to decode the capability to get its ID
    try {
      const { decodeCapability } = await import('holosphere');
      const decoded = await decodeCapability(capabilityToken);
      capabilityId = decoded?.id || '';
      console.log(`  Capability ID: ${capabilityId.substring(0, 20)}...`);
    } catch (e) {
      console.log('  (Could not decode capability ID - will skip revocation test)');
    }

    await sleep(RELAY_SYNC_WAIT);

    const registryA = await holosphereA.getFederationRegistry();
    const partnerInA = registryA?.federatedWith?.find((p: any) => p.pubKey === publicKeyB);
    assert(!!partnerInA, 'B is in A\'s federation registry');
    assert((partnerInA?.outboundCapabilities?.length || 0) > 0, 'Outbound capability recorded');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 4: B can read A's quest after storing capability
    // ═══════════════════════════════════════════════════════════════
    console.log("▸ Test 4: B can read A's quest after storing capability");

    await holosphereB.storeInboundCapability(publicKeyA, {
      token: capabilityToken,
      scope: { holonId: testHolonId, lensName: 'quests' },
      permissions: ['read'],
      expires: Date.now() + 3600000
    });

    await sleep(RELAY_SYNC_WAIT);

    const federatedData = await holosphereB.readFromFederatedSource(
      publicKeyA,
      testHolonId,
      'quests',
      testQuestId
    );

    assert(!!federatedData, 'B can read federated data');
    assert(federatedData.id === testQuestId, 'Federated quest ID matches');
    assert(federatedData.title === testQuest.title, 'Federated quest title matches');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 5: New data from A is visible to B
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 5: New data from A is visible to B');

    // Create a NEW quest (Nostr events are immutable, so updates create new events)
    const newQuestId = `quest-new-${Date.now()}`;
    const newQuest = {
      id: newQuestId,
      title: 'Second Federation Quest',
      when: new Date().toISOString(),
      status: 'scheduled',
      participants: [{ username: 'tester-a' }],
    };

    await holosphereA.write(testHolonId, 'quests', newQuest);

    // Verify A can read the new quest
    await sleep(RELAY_SYNC_WAIT);
    const aVerify = await holosphereA.read(testHolonId, 'quests', newQuestId);
    assert(aVerify.title === 'Second Federation Quest', 'A sees its new quest');

    console.log(`  Waiting ${RELAY_SYNC_WAIT}ms for propagation to B...`);
    await sleep(RELAY_SYNC_WAIT);

    // B reads the new data (using existing capability for quests lens)
    const newData = await holosphereB.readFromFederatedSource(
      publicKeyA,
      testHolonId,
      'quests',
      newQuestId
    );

    console.log(`  B received: id="${newData?.id}", title="${newData?.title}"`);
    assert(!!newData, 'B can read newly created quest');
    assert(newData.id === newQuestId, 'New quest ID matches');
    assert(newData.title === 'Second Federation Quest', 'New quest title matches');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 6: Capability revocation blocks access
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 6: Capability revocation blocks access');

    if (!capabilityId) {
      console.log('  ⊘ Skipping - no capability ID available');
    } else {
      await holosphereA.revokeCapability(capabilityId, 'Test revocation');

      const isRevoked = await holosphereA.isCapabilityRevoked(capabilityId);
      assert(isRevoked === true, 'Capability is marked as revoked');

      await sleep(RELAY_SYNC_WAIT);

      const isValid = await holosphereA.verifyCapability(
        capabilityToken,
        'read',
        { holonId: testHolonId, lensName: 'quests' }
      );
      assert(isValid === false, 'Revoked capability fails verification');
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 7: Scope boundary enforcement
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 7: Scope boundary enforcement');

    const questsOnlyToken = await holosphereA.issueCapabilityForFederation(
      publicKeyB,
      { holonId: testHolonId, lensName: 'quests' },
      ['read'],
      { expiresIn: 3600000 }
    );

    const isValidQuests = await holosphereA.verifyCapability(
      questsOnlyToken,
      'read',
      { holonId: testHolonId, lensName: 'quests' }
    );
    assert(isValidQuests === true, 'Capability valid for quests lens');

    const isValidOffers = await holosphereA.verifyCapability(
      questsOnlyToken,
      'read',
      { holonId: testHolonId, lensName: 'offers' }
    );
    assert(isValidOffers === false, 'Capability invalid for offers lens');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // TEST 8: Permission boundary enforcement
    // ═══════════════════════════════════════════════════════════════
    console.log('▸ Test 8: Permission boundary enforcement');

    const readOnlyToken = await holosphereA.issueCapabilityForFederation(
      publicKeyB,
      { holonId: testHolonId, lensName: 'quests' },
      ['read'],
      { expiresIn: 3600000 }
    );

    const canRead = await holosphereA.verifyCapability(
      readOnlyToken,
      'read',
      { holonId: testHolonId, lensName: 'quests' }
    );
    assert(canRead === true, 'Read permission granted');

    const canWrite = await holosphereA.verifyCapability(
      readOnlyToken,
      'write',
      { holonId: testHolonId, lensName: 'quests' }
    );
    assert(canWrite === false, 'Write permission denied');
    console.log('');

    // ═══════════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (failed === 0) {
      console.log('\n  ✓ All federation tests passed!\n');
    } else {
      console.log('\n  ✗ Some tests failed\n');
      process.exit(1);
    }

  } catch (error: any) {
    console.error('\n  ✗ Test failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Cleanup
    console.log('▸ Cleanup: Closing connections...');
    if (holosphereA?.client?.close) {
      try {
        await holosphereA.client.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    if (holosphereB?.client?.close) {
      try {
        await holosphereB.client.close();
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    console.log('  Cleanup complete.\n');
  }
}

// Run tests
runFederationTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
