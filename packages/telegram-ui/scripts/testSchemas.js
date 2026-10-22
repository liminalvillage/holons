#!/usr/bin/env node

/**
 * Schema Testing Script
 *
 * This script demonstrates how to use the uploaded schemas for validation
 * and creates sample test data for each schema type.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HoloSphere } from 'holosphere';
import { getRelays } from '../relay-config.js';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to generate hex private key
function generatePrivateKey() {
  const secretKey = generateSecretKey();
  return Buffer.from(secretKey).toString('hex');
}

// Priority: 1) .env HOLOSPHERE_NSEC, 2) stored key, 3) generate new key
const appName = process.env.HOLONS_APP || process.env.APPNAME || 'Holons';
const privateKey =
  process.env.HOLOSPHERE_NSEC || getOrCreateKey(appName, generatePrivateKey);

const holosphere = new HoloSphere({
  appName: appName,
  privateKey: privateKey,
  logLevel: 'WARN',
  relays: getRelays('production'),
});

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Sample test data for each schema
const testData = {
  quest: {
    id: 'test-quest-123',
    version: '0.1',
    chat: '123456789',
    message_thread_id: null,
    initiator: 'testuser',
    title: 'Test Quest',
    description: 'This is a test quest',
    picture: '',
    document: '',
    type: 'task',
    status: 'ongoing',
    date: Date.now(),
    where: { latitude: '40.7128', longitude: '-74.0060' },
    when: '2023-12-01T10:00:00Z',
    until: '2023-12-01T12:00:00Z',
    completed: '',
    participants: ['user1', 'user2'],
    appreciation: [],
    stoppers: [],
    dependencies: [],
    frequency: null,
    recurringTaskId: null,
    timeTracking: {},
    checklistId: null,
    reminderId: null,
    activeHolograms: [],
    category: 'work',
  },

  expense: {
    id: 'exp-123',
    date: Date.now(),
    amount: 25.5,
    currency: 'USD',
    description: 'Coffee and lunch',
    paidBy: 'user123',
    splitWith: ['user123', 'user456'],
  },

  user: {
    id: 123456789,
    username: 'testuser',
    first_name: 'Test',
    last_name: 'User',
    language_code: 'en',
    values: ['collaboration', 'transparency'],
    needs: ['mentoring', 'feedback'],
    offers: ['programming', 'design'],
    wants: ['learning opportunities'],
    initiated: ['quest1', 'quest2'],
    completed: ['quest3'],
    participated: ['quest4', 'quest5'],
    balance: { USD: 10.5, EUR: 5.25 },
    roles: ['developer', 'mentor'],
  },

  shopping: {
    id: 'milk',
    done: false,
    from: 'testuser',
    date: Date.now(),
    category: 'dairy',
    priority: 'medium',
    quantity: 2,
    notes: 'Organic if possible',
  },

  checklist: {
    id: 'checklist-123',
    type: 'checklist',
    items: [
      { id: 'item1', text: 'First task', done: false, priority: 'high' },
      { id: 'item2', text: 'Second task', done: true, priority: 'medium' },
    ],
    created: new Date().toISOString(),
    creator: 'testuser',
  },

  announcement: {
    id: 'ann-123',
    user: {
      id: 123456789,
      username: 'testuser',
      first_name: 'Test',
      last_name: 'User',
    },
    date: new Date().toISOString(),
    content: 'This is a test announcement',
    chat: '123456789',
    federated: false,
    federatedTo: [],
  },

  role: {
    id: 'role-123',
    title: 'Project Manager',
    description: 'Manages project tasks and timeline',
    created: new Date().toISOString(),
    creator: 'testuser',
    members: ['user1', 'user2'],
    permissions: ['manage_quests', 'view_reports'],
    responsibilities: ['Planning', 'Coordination'],
    active: true,
    color: '#3366cc',
    icon: '👑',
  },

  tag: {
    id: 'tag-123',
    name: 'urgent',
    description: 'Items requiring immediate attention',
    color: '#ff0000',
    icon: '🚨',
    category: 'priority',
    created: new Date().toISOString(),
    creator: 'testuser',
    usageCount: 15,
    aliases: ['high-priority', 'asap'],
    relatedTags: ['important', 'deadline'],
  },

  settings: {
    id: '123456789',
    name: 'Test Holon',
    purpose: 'Testing and development',
    language: 'en',
    timezone: 'UTC',
    admin: '123456789',
    hex: '801ffffffffffff',
    values: ['innovation', 'collaboration'],
    domains: ['technology', 'education'],
    roles: ['admin', 'member', 'guest'],
    currencies: ['USD', 'EUR'],
    lenses: ['quests', 'expenses', 'users'],
    federation: [],
    notify: [],
    lensConfig: {},
    questImageMode: 'image',
    showQuestsAsImages: true,
    autoArchive: false,
    defaultQuestType: 'task',
  },

  hologram: {
    id: 'hologram-123',
    sourceQuestId: 'quest-456',
    sourceholonId: '123456789',
    targetholonId: '987654321',
    targetMessageId: 12345,
    userId: '789012345',
    type: 'telegram',
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    active: true,
    syncStatus: 'synced',
    errorCount: 0,
    metadata: {},
  },
};

async function validateTestData() {
  console.log('🧪 Running schema validation tests...\n');

  const results = [];

  for (const [schemaName, data] of Object.entries(testData)) {
    console.log(`🔍 Testing ${schemaName} schema...`);

    try {
      // Get schema from holosphere
      const schema = await holosphere.getGlobal('schemas', schemaName);

      if (!schema) {
        console.log(`❌ Schema '${schemaName}' not found in holosphere`);
        results.push({
          schema: schemaName,
          success: false,
          error: 'Schema not found',
        });
        continue;
      }

      // Validate data
      const validate = ajv.compile(schema);
      const valid = validate(data);

      if (valid) {
        console.log(`✅ ${schemaName}: Valid`);
        results.push({ schema: schemaName, success: true });
      } else {
        console.log(`❌ ${schemaName}: Invalid`);
        validate.errors.forEach(error => {
          console.log(`   - ${error.instancePath || 'root'}: ${error.message}`);
        });
        results.push({
          schema: schemaName,
          success: false,
          error: validate.errors.map(e => e.message).join(', '),
        });
      }

      // Save test data to file
      const testDataDir = path.join(__dirname, 'test-data');
      if (!fs.existsSync(testDataDir)) {
        fs.mkdirSync(testDataDir);
      }

      const testFilePath = path.join(testDataDir, `${schemaName}-test.json`);
      fs.writeFileSync(testFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.log(`💥 ${schemaName}: Error - ${error.message}`);
      results.push({
        schema: schemaName,
        success: false,
        error: error.message,
      });
    }

    console.log(''); // Empty line for readability
  }

  // Summary
  const successful = results.filter(r => r.success).length;
  const total = results.length;

  console.log('📊 Test Summary:');
  console.log(`✅ Passed: ${successful}/${total}`);
  console.log(`❌ Failed: ${total - successful}/${total}`);

  if (successful < total) {
    console.log('\n❌ Failed tests:');
    results
      .filter(r => !r.success)
      .forEach(r => {
        console.log(`   - ${r.schema}: ${r.error}`);
      });
  }

  console.log(
    `\n📁 Test data files saved to: ${path.join(__dirname, 'test-data')}`
  );

  return successful === total;
}

// Create integration example
async function createIntegrationExample() {
  const exampleCode = `
// Example: Using schemas in HolonsBot code

import { HoloSphere } from 'holosphere';
import { getRelays } from '../relay-config.js';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Helper to generate hex private key
function generatePrivateKey() {
    const secretKey = generateSecretKey();
    return Buffer.from(secretKey).toString('hex');
}

// Priority: 1) .env HOLOSPHERE_NSEC, 2) stored key, 3) generate new key
const appName = process.env.HOLONS_APP || process.env.APPNAME || 'Holons';
const privateKey = process.env.HOLOSPHERE_NSEC || getOrCreateKey(appName, generatePrivateKey);

const holosphere = new HoloSphere({
    appName: appName,
    privateKey: privateKey,
    logLevel: 'WARN',
    relays: getRelays('production')
});

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Function to validate quest data before saving
async function validateQuestData(questData) {
    try {
        // Get quest schema from holosphere
        const schema = await holosphere.getGlobal('schemas', 'quest');

        if (!schema) {
            throw new Error('Quest schema not found');
        }

        // Compile validator
        const validate = ajv.compile(schema);

        // Validate data
        const valid = validate(questData);

        if (!valid) {
            const errors = validate.errors.map(err =>
                \`\${err.instancePath || 'root'}: \${err.message}\`
            ).join(', ');
            throw new Error(\`Quest validation failed: \${errors}\`);
        }

        return true;
    } catch (error) {
        console.error('Quest validation error:', error.message);
        return false;
    }
}

// Usage in Quests.js
export default class Quests {
    async createQuest(questData) {
        // Validate before saving
        const isValid = await validateQuestData(questData);

        if (!isValid) {
            throw new Error('Invalid quest data');
        }

        // Save to database
        await this.db.put(\`\${holonId}/quests\`, questData);

        return questData;
    }
}
`;

  const examplePath = path.join(__dirname, 'schema-integration-example.js');
  fs.writeFileSync(examplePath, exampleCode.trim());
  console.log(`📝 Integration example saved to: ${examplePath}`);
}

// Main execution
async function main() {
  try {
    const success = await validateTestData();
    await createIntegrationExample();

    if (success) {
      console.log('\n🎉 All schema tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some schema tests failed');
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Test execution error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { testData, validateTestData };
