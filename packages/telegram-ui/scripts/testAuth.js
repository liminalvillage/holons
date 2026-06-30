#!/usr/bin/env node

/**
 * Simple authentication test for Gun/HoloSphere
 * This script tests if we can authenticate and write to the holosphere
 */

import { HoloSphere } from 'holosphere';
import { getRelays } from '../relay-config.js';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';
import 'gun/sea.js';

console.log('🧪 Testing holosphere authentication...');

// Helper to generate hex private key
function generatePrivateKey() {
  const secretKey = generateSecretKey();
  return Buffer.from(secretKey).toString('hex');
}

// Initialize HoloSphere connection
// Priority: 1) .env HOLOSPHERE_PRIVATE_KEY, 2) stored key, 3) generate new key
const appName = process.env.HOLONS_APP || process.env.APPNAME || 'Holons';
const privateKey =
  process.env.HOLOSPHERE_PRIVATE_KEY ||
  getOrCreateKey(appName, generatePrivateKey);

const holosphere = new HoloSphere({
  appName: appName,
  privateKey: privateKey,
  logLevel: 'WARN',
  relays: getRelays('production'),
});

// Authentication configuration
const AUTH_CONFIG = {
  username: process.env.HOLOSPHERE_USER || 'holonsbot-schema-uploader',
  password: process.env.HOLOSPHERE_PASS || 'holons2024schemas!',
  autoCreate: true,
};

async function testAuthentication() {
  return new Promise((resolve, reject) => {
    console.log('🔐 Getting Gun user instance...');
    const gunUser = holosphere.gun.user();

    console.log(`👤 Attempting to authenticate as: ${AUTH_CONFIG.username}`);

    // First try to authenticate
    gunUser.auth(AUTH_CONFIG.username, AUTH_CONFIG.password, ack => {
      if (ack.err && AUTH_CONFIG.autoCreate) {
        console.log('👤 User not found, creating new user...');

        // Create new user if authentication failed
        gunUser.create(
          AUTH_CONFIG.username,
          AUTH_CONFIG.password,
          createAck => {
            if (createAck.err) {
              console.error('❌ Failed to create user:', createAck.err);
              reject(new Error(`Failed to create user: ${createAck.err}`));
              return;
            }

            console.log('✅ User created successfully');

            // Now authenticate with the new user
            gunUser.auth(
              AUTH_CONFIG.username,
              AUTH_CONFIG.password,
              authAck => {
                if (authAck.err) {
                  console.error(
                    '❌ Failed to authenticate new user:',
                    authAck.err
                  );
                  reject(new Error(`Failed to authenticate: ${authAck.err}`));
                  return;
                }

                console.log('✅ Authentication successful');
                testWriteData(gunUser, resolve, reject);
              }
            );
          }
        );
      } else if (ack.err) {
        console.error('❌ Authentication failed:', ack.err);
        reject(new Error(`Authentication failed: ${ack.err}`));
      } else {
        console.log('✅ Authentication successful');
        testWriteData(gunUser, resolve, reject);
      }
    });
  });
}

function testWriteData(gunUser, resolve, reject) {
  console.log('📝 Testing write operation...');

  const testData = {
    message: 'Hello from HolonsBot Schema System!',
    timestamp: Date.now(),
    version: '1.0.0',
  };

  gunUser.get('test_data').put(testData, ack => {
    if (ack.err) {
      console.error('❌ Failed to write test data:', ack.err);
      reject(new Error(`Failed to write data: ${ack.err}`));
      return;
    }

    console.log('✅ Successfully wrote test data');

    // Try to read it back
    gunUser.get('test_data').once(readData => {
      if (readData && readData.message) {
        console.log('✅ Successfully read back test data:', readData.message);
        resolve(true);
      } else {
        console.log('⚠️ Could not read back test data');
        resolve(false);
      }
    });
  });
}

// Run the test
testAuthentication()
  .then(success => {
    if (success) {
      console.log('🎉 Authentication and write test successful!');
      console.log('💡 You can now run uploadSchemas.js');
      process.exit(0);
    } else {
      console.log('❌ Test completed with issues');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('💥 Test failed:', error.message);
    process.exit(1);
  });
