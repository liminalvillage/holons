#!/usr/bin/env node

/**
 * Schema Manager for HolonsBot
 *
 * This script provides utilities to manage schemas in the holosphere:
 * - List all available schemas
 * - Download a specific schema
 * - Update an existing schema
 * - Validate data against a schema
 * - Compare schema versions
 *
 * Usage:
 *   node scripts/schemaManager.js list
 *   node scripts/schemaManager.js get <schema-name>
 *   node scripts/schemaManager.js validate <schema-name> <data-file>
 *   node scripts/schemaManager.js update <schema-file>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import HoloSphere from 'holosphere';
import Gun from 'gun';
import 'gun/sea.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize HoloSphere connection
const holosphere = new HoloSphere('HolonsBotSchemas', null, {
    peers: ['https://gun.holons.io/gun']
});

// Initialize JSON Schema validator
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Authentication configuration
const AUTH_CONFIG = {
    username: process.env.HOLOSPHERE_USER || 'holonsbot-schema-uploader',
    password: process.env.HOLOSPHERE_PASS || 'holons2024schemas!'
};

// Gun user for authentication
let gunUser = null;
let isAuthenticated = false;

// Function to authenticate with Gun/HoloSphere
async function authenticateUser() {
    return new Promise((resolve, reject) => {
        console.log('🔐 Authenticating with holosphere...');

        gunUser = holosphere.gun.user();

        gunUser.auth(AUTH_CONFIG.username, AUTH_CONFIG.password, (ack) => {
            if (ack.err) {
                console.error('❌ Authentication failed:', ack.err);
                console.log('💡 Make sure you have run uploadSchemas.js first to create the user');
                reject(new Error(`Authentication failed: ${ack.err}`));
            } else {
                console.log('✅ Authentication successful');
                isAuthenticated = true;
                resolve(true);
            }
        });
    });
}

// Command handlers
const commands = {
    async list() {
        console.log('📋 Listing all schemas in holosphere...');

        try {
            await authenticateUser();

            const registry = await new Promise((resolve, reject) => {
                gunUser.get('schema_registry').once((data) => {
                    if (data) {
                        resolve(data);
                    } else {
                        resolve(null);
                    }
                });
            });

            if (!registry) {
                console.log('❌ No schema registry found');
                return;
            }

            console.log(\`\\n📊 Schema Registry (\${registry.totalSchemas} schemas):\`);
            console.log(\`Created: \${registry.created}\`);
            console.log(\`Version: \${registry.version}\`);
            console.log('\\n📋 Available Schemas:');

            registry.schemas.forEach((schema, index) => {
                console.log(\`  \${index + 1}. \${schema.name}\`);
                console.log(\`     Path: \${schema.path}\`);
                console.log(\`     Uploaded: \${schema.uploaded}\`);
                console.log('');
            });

            if (registry.errors && registry.errors.length > 0) {
                console.log('❌ Schemas with errors:');
                registry.errors.forEach(error => {
                    console.log(\`   - \${error.name}: \${error.error}\`);
                });
            }

        } catch (error) {
            console.error('💥 Error listing schemas:', error.message);
        }
    },

    async get(schemaName) {
        if (!schemaName) {
            console.log('❌ Please provide a schema name');
            console.log('Usage: node schemaManager.js get <schema-name>');
            return;
        }

        console.log(\`📥 Retrieving schema: \${schemaName}\`);

        try {
            await authenticateUser();

            const schema = await new Promise((resolve, reject) => {
                gunUser.get('schemas').get(schemaName).once((data) => {
                    if (data) {
                        resolve(data);
                    } else {
                        resolve(null);
                    }
                });
            });

            if (!schema) {
                console.log(\`❌ Schema '\${schemaName}' not found\`);
                return;
            }

            console.log(\`✅ Schema '\${schemaName}' found:\`);
            console.log('\\n📄 Schema Content:');
            console.log(JSON.stringify(schema, null, 2));

            // Optionally save to file
            const outputPath = path.join(__dirname, '..', 'schemas', \`\${schemaName}_downloaded.json\`);
            fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2));
            console.log(\`\\n💾 Schema saved to: \${outputPath}\`);

        } catch (error) {
            console.error(\`💥 Error retrieving schema '\${schemaName}':\`, error.message);
        }
    },

    async validate(schemaName, dataFile) {
        if (!schemaName || !dataFile) {
            console.log('❌ Please provide schema name and data file');
            console.log('Usage: node schemaManager.js validate <schema-name> <data-file>');
            return;
        }

        console.log(\`🔍 Validating data against schema '\${schemaName}'\`);

        try {
            // Get schema from holosphere
            const schema = await holosphere.getGlobal('schemas', schemaName);
            if (!schema) {
                console.log(\`❌ Schema '\${schemaName}' not found\`);
                return;
            }

            // Read data file
            const dataPath = path.resolve(dataFile);
            if (!fs.existsSync(dataPath)) {
                console.log(\`❌ Data file not found: \${dataPath}\`);
                return;
            }

            const dataContent = fs.readFileSync(dataPath, 'utf8');
            const data = JSON.parse(dataContent);

            // Validate
            const validate = ajv.compile(schema);
            const valid = validate(data);

            if (valid) {
                console.log('✅ Data is valid according to the schema');
            } else {
                console.log('❌ Data validation failed:');
                validate.errors.forEach(error => {
                    console.log(\`   - \${error.instancePath || 'root'}: \${error.message}\`);
                    if (error.data !== undefined) {
                        console.log(\`     Value: \${JSON.stringify(error.data)}\`);
                    }
                });
            }

        } catch (error) {
            console.error('💥 Validation error:', error.message);
        }
    },

    async update(schemaFile) {
        if (!schemaFile) {
            console.log('❌ Please provide a schema file to update');
            console.log('Usage: node schemaManager.js update <schema-file>');
            return;
        }

        const filePath = path.resolve(schemaFile);
        if (!fs.existsSync(filePath)) {
            console.log(\`❌ Schema file not found: \${filePath}\`);
            return;
        }

        try {
            const schemaContent = fs.readFileSync(filePath, 'utf8');
            const schema = JSON.parse(schemaContent);
            const schemaName = path.basename(filePath, '.json');

            // Add update metadata
            const updatedSchema = {
                ...schema,
                metadata: {
                    ...schema.metadata,
                    updatedAt: new Date().toISOString(),
                    version: schema.version || '1.0.0',
                    source: 'HolonsBot',
                    filename: path.basename(filePath)
                }
            };

            console.log(\`📤 Updating schema: \${schemaName}\`);
            await holosphere.putGlobal('schemas', updatedSchema, schemaName);
            console.log(\`✅ Successfully updated: \${schemaName}\`);

            // Update registry
            try {
                const registry = await holosphere.getGlobal('schema_registry');
                if (registry) {
                    const schemaIndex = registry.schemas.findIndex(s => s.name === schemaName);
                    if (schemaIndex >= 0) {
                        registry.schemas[schemaIndex].uploaded = new Date().toISOString();
                    } else {
                        registry.schemas.push({
                            name: schemaName,
                            path: \`schemas/\${schemaName}\`,
                            uploaded: new Date().toISOString()
                        });
                        registry.totalSchemas++;
                    }

                    await holosphere.putGlobal('schema_registry', registry);
                    console.log('✅ Registry updated');
                }
            } catch (registryError) {
                console.warn('⚠️ Could not update registry:', registryError.message);
            }

        } catch (error) {
            console.error(\`💥 Error updating schema '\${schemaFile}':\`, error.message);
        }
    },

    async compare(schemaName) {
        if (!schemaName) {
            console.log('❌ Please provide a schema name');
            console.log('Usage: node schemaManager.js compare <schema-name>');
            return;
        }

        try {
            // Get schema from holosphere
            const remoteSchema = await holosphere.getGlobal('schemas', schemaName);
            if (!remoteSchema) {
                console.log(\`❌ Schema '\${schemaName}' not found in holosphere\`);
                return;
            }

            // Get local schema
            const localPath = path.join(__dirname, '..', 'schemas', \`\${schemaName}.json\`);
            if (!fs.existsSync(localPath)) {
                console.log(\`❌ Local schema file not found: \${localPath}\`);
                return;
            }

            const localContent = fs.readFileSync(localPath, 'utf8');
            const localSchema = JSON.parse(localContent);

            console.log(\`🔍 Comparing local and remote versions of '\${schemaName}'\`);

            const localVersion = localSchema.version || localSchema.metadata?.version || 'unknown';
            const remoteVersion = remoteSchema.version || remoteSchema.metadata?.version || 'unknown';

            console.log(\`📍 Local version: \${localVersion}\`);
            console.log(\`☁️  Remote version: \${remoteVersion}\`);

            if (remoteSchema.metadata?.updatedAt) {
                console.log(\`🕒 Last updated: \${remoteSchema.metadata.updatedAt}\`);
            }

            // Simple property count comparison
            const localProps = Object.keys(localSchema.properties || {}).length;
            const remoteProps = Object.keys(remoteSchema.properties || {}).length;

            console.log(\`📊 Properties - Local: \${localProps}, Remote: \${remoteProps}\`);

            if (JSON.stringify(localSchema) === JSON.stringify(remoteSchema)) {
                console.log('✅ Schemas are identical');
            } else {
                console.log('⚠️ Schemas differ');
            }

        } catch (error) {
            console.error('💥 Comparison error:', error.message);
        }
    },

    help() {
        console.log(\`
🛠️  HolonsBot Schema Manager

Available Commands:
  list                           - List all schemas in holosphere
  get <schema-name>              - Download a specific schema
  validate <schema-name> <file>  - Validate data against a schema
  update <schema-file>           - Update/upload a schema file
  compare <schema-name>          - Compare local vs remote schema
  help                           - Show this help message

Examples:
  node schemaManager.js list
  node schemaManager.js get quest
  node schemaManager.js validate user ./test-user.json
  node schemaManager.js update ./schemas/quest.json
  node schemaManager.js compare expense

📚 Documentation: See CLAUDE.md for more information
        \`);
    }
};

// Main execution
async function main() {
    const [,, command, ...args] = process.argv;

    if (!command || command === 'help') {
        commands.help();
        return;
    }

    if (!commands[command]) {
        console.log(\`❌ Unknown command: \${command}\`);
        commands.help();
        process.exit(1);
    }

    try {
        await commands[command](...args);
    } catch (error) {
        console.error('💥 Command execution error:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === \`file://\${process.argv[1]}\`) {
    main();
}