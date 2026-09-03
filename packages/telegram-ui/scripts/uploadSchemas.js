#!/usr/bin/env node

/**
 * Schema Upload Script for HolonsBot
 *
 * This script uploads all JSON schemas to the holosphere for global access.
 * It reads all schema files from the schemas directory and uploads them
 * to the holosphere using the putGlobal method.
 *
 * Usage: node scripts/uploadSchemas.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HoloSphere } from 'holosphere';
import { resolveRelays } from '@holons/core/holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Schemas are public global records (`schemas/<name>`, registry under
// `schema_registry/registry`), signed by this key and published to the relays.
const holosphere = new HoloSphere({
  appName: appName,
  privateKey: privateKey,
  logLevel: 'WARN',
  relays: resolveRelays(process.env.HOLOSPHERE_RELAYS),
  store: { adapter: 'memory' },
});

// Schema directory path
const schemasDir = path.join(__dirname, '..', 'schemas');

// Function to read and upload a schema file
async function uploadSchema(filename) {
  try {
    const filePath = path.join(schemasDir, filename);
    const schemaContent = fs.readFileSync(filePath, 'utf8');
    const schema = JSON.parse(schemaContent);

    // Extract schema name from filename (remove .json extension)
    const schemaName = path.basename(filename, '.json');

    // Add metadata
    const schemaWithMeta = {
      ...schema,
      metadata: {
        ...schema.metadata,
        uploadedAt: new Date().toISOString(),
        version: schema.version || '1.0.0',
        source: 'HolonsBot',
        filename: filename,
      },
    };

    console.log(`📤 Uploading schema: ${schemaName}`);
    await holosphere.putGlobal('schemas', {
      ...schemaWithMeta,
      id: schemaName,
    });

    console.log(`✅ Successfully uploaded: ${schemaName}`);

    return { name: schemaName, success: true };
  } catch (error) {
    console.error(`❌ Error uploading ${filename}:`, error.message);
    return { name: filename, success: false, error: error.message };
  }
}

// Function to upload schema registry/index
async function uploadSchemaRegistry(uploadedSchemas) {
  try {
    const registry = {
      name: 'HolonsBot Schema Registry',
      description: 'Registry of all JSON schemas used in HolonsBot',
      version: '1.0.0',
      created: new Date().toISOString(),
      schemas: uploadedSchemas
        .filter(s => s.success)
        .map(s => ({
          name: s.name,
          path: `schemas/${s.name}`,
          uploaded: new Date().toISOString(),
        })),
      totalSchemas: uploadedSchemas.filter(s => s.success).length,
      errors: uploadedSchemas.filter(s => !s.success),
    };

    console.log(`📤 Uploading schema registry...`);

    await holosphere.putGlobal('schema_registry', {
      ...registry,
      id: 'registry',
    });

    console.log(`✅ Successfully uploaded schema registry`);

    return true;
  } catch (error) {
    console.error(`❌ Error uploading schema registry:`, error.message);
    return false;
  }
}

// Main upload function
async function uploadAllSchemas() {
  console.log('🚀 Starting schema upload to holosphere...');
  console.log(`📁 Schemas directory: ${schemasDir}`);

  try {
    await holosphere.ready();

    // Check if schemas directory exists
    if (!fs.existsSync(schemasDir)) {
      throw new Error(`Schemas directory not found: ${schemasDir}`);
    }

    // Get all JSON files from schemas directory
    const schemaFiles = fs
      .readdirSync(schemasDir)
      .filter(file => file.endsWith('.json'))
      .filter(
        file =>
          !file.includes('_schema') ||
          file.includes('quest') ||
          file.includes('holon')
      ); // Include our new schemas

    console.log(`📋 Found ${schemaFiles.length} schema files:`);
    schemaFiles.forEach(file => console.log(`   - ${file}`));
    console.log('');

    // Upload each schema
    const results = [];
    for (const file of schemaFiles) {
      const result = await uploadSchema(file);
      results.push(result);

      // Add small delay to avoid overwhelming the network
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Upload schema registry
    await uploadSchemaRegistry(results);

    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('\n📊 Upload Summary:');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📈 Total: ${results.length}`);

    if (failed > 0) {
      console.log('\n❌ Failed uploads:');
      results
        .filter(r => !r.success)
        .forEach(r => {
          console.log(`   - ${r.name}: ${r.error}`);
        });
    }

    console.log('\n🎉 Schema upload completed!');

    // Also create a verification script
    await createVerificationScript();

    await holosphere.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('💥 Fatal error during schema upload:', error.message);
    process.exit(1);
  }
}

// Function to create a verification script
async function createVerificationScript() {
  const verificationScript = `#!/usr/bin/env node

/**
 * Schema Verification Script
 * Verifies that all schemas are properly uploaded to holosphere
 */

import { HoloSphere } from 'holosphere';
import { resolveRelays } from '@holons/core/holosphere';
import { getOrCreateKey } from '../utils/key-storage.js';
import { generateSecretKey } from 'nostr-tools';

// Helper to generate hex private key
function generatePrivateKey() {
    const secretKey = generateSecretKey();
    return Buffer.from(secretKey).toString('hex');
}

// Priority: 1) .env HOLOSPHERE_PRIVATE_KEY, 2) stored key, 3) generate new key
const appName = process.env.HOLONS_APP || process.env.APPNAME || 'Holons';
const privateKey = process.env.HOLOSPHERE_PRIVATE_KEY || getOrCreateKey(appName, generatePrivateKey);

const holosphere = new HoloSphere({
    appName: appName,
    privateKey: privateKey,
    logLevel: 'WARN',
    relays: resolveRelays(process.env.HOLOSPHERE_RELAYS),
    store: { adapter: 'memory' },
});

async function verifySchemas() {
    console.log('🔍 Verifying schemas in holosphere...');

    try {
        // Get schema registry
        const registry = await holosphere.getGlobal('schema_registry', 'registry');

        if (!registry) {
            console.log('❌ Schema registry not found');
            return false;
        }

        console.log(\`📋 Registry found with \${registry.totalSchemas} schemas\`);

        // Verify each schema
        let verified = 0;
        for (const schemaInfo of registry.schemas) {
            try {
                const schema = await holosphere.getGlobal('schemas', schemaInfo.name);
                if (schema) {
                    console.log(\`✅ \${schemaInfo.name}: Found\`);
                    verified++;
                } else {
                    console.log(\`❌ \${schemaInfo.name}: Not found\`);
                }
            } catch (error) {
                console.log(\`❌ \${schemaInfo.name}: Error - \${error.message}\`);
            }
        }

        console.log(\`\\n📊 Verification Summary:\`);
        console.log(\`✅ Verified: \${verified}/\${registry.totalSchemas}\`);

        return verified === registry.totalSchemas;

    } catch (error) {
        console.error('💥 Verification error:', error.message);
        return false;
    }
}

// Run verification
verifySchemas().then(async success => {
    await holosphere.close();
    if (success) {
        console.log('🎉 All schemas verified successfully!');
        process.exit(0);
    } else {
        console.log('❌ Schema verification failed');
        process.exit(1);
    }
});
`;

  const verifyScriptPath = path.join(__dirname, 'verifySchemas.js');
  fs.writeFileSync(verifyScriptPath, verificationScript);
  console.log(`📝 Created verification script: ${verifyScriptPath}`);
}

// Run the upload process
uploadAllSchemas();
