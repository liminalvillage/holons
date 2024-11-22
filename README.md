# HoloSphere

HoloSphere is a decentralized geospatial data management system that combines hierarchical hexagonal tiling (H3) with distributed data storage (GunDB) and AI-powered processing of information.

## Installation

```bash
npm install holosphere
```

## Basic Usage

```javascript
import HoloSphere from 'holosphere';

// Initialize HoloSphere
const holo = new HoloSphere('my-app');

// Optional: Initialize with OpenAI
const holoAI = new HoloSphere('my-app', 'your-openai-key');
```

## Core Features

### User Management

```javascript
// Create a new user
await holo.createUser('username', 'password');

// Login
await holo.login('username', 'password');

// Logout
await holo.logout();
```

### Schema Operations

```javascript
// Define a schema for a lens
const schema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        data: { type: 'string' }
    },
    required: ['id', 'data']
};

// Set schema for a lens
await holo.setLensSchema('myLens', schema);

// Get schema for a lens
const lensSchema = await holo.getLensSchema('myLens');
```

### Global Data Operations

```javascript
// Store data globally
await holo.putGlobalData('settings', {
    id: 'config1',
    theme: 'dark'
});

// Get all data from a table
const allSettings = await holo.getGlobalData('settings');

// Get specific data by key
const config = await holo.getGlobalDataKey('settings', 'config1');

// Delete a global table
await holo.deleteGlobalData('settings');
```

### Hex Data Operations

```javascript
// Store data in a hex
await holo.putHexData('hex123', 'observations', {
    id: 'obs1',
    data: 'value'
});

// Get all data from a hex/lens
const data = await holo.getHexData('hex123', 'observations');

// Get specific data by key
const item = await holo.getHexKey('hex123', 'observations', 'obs1');

// Get raw GunDB node
const node = await holo.getHexNode('hex123', 'observations', 'obs1');

// Delete specific data
await holo.deleteHexData('hex123', 'observations', 'obs1');

// Delete a node by tag
await holo.deleteNode('nodeId', 'tag');

// Clear all data in a lens
await holo.clearlens('hex123', 'observations');
```

### Encrypted Data

```javascript
// Store encrypted data (requires authenticated user)
await holo.putHexData('hex123', 'private', {
    id: 'secret1',
    data: 'sensitive'
}, true, 'encryption-key');

// Encrypt specific data
const encrypted = await holo.encrypt(data, 'secret-key');

// Decrypt data
const decrypted = await holo.decrypt(encrypted, 'secret-key');
```

### Geospatial Operations

```javascript
// Get hex from coordinates
const hex = await holo.getHex(37.7749, -74.0060, 7);

// Get all scales for coordinates
const scales = holo.getScalespace(37.7749, -74.0060);

// Get all parent hexes
const parents = holo.getHexScalespace('hex123');

// Compute operations on hex data
await holo.compute('hex123', 'observations', 'summarize');

// Upcast data to parent hexes
await holo.upcast('hex123', 'observations', data);
```

### Real-time Subscriptions

```javascript
// Subscribe to changes
holo.subscribe('hex123', 'observations', (data, key) => {
    console.log('Updated data:', data);
    console.log('Key:', key);
});
```

### Voting System

```javascript
// Get final vote (including delegations)
const finalVote = holo.getFinalVote(userId, topic, votes);

// Get aggregated votes for a hex
const results = holo.aggregateVotes(hexId, topic);

// Delegate voting power
await holo.delegateVote(userId, topic, delegateId);

// Cast a vote
await holo.vote(userId, hexId, topic, voteChoice);
```

## License

GPL-3.0-or-later

## Dependencies

- h3-js: Uber's H3 geospatial indexing system
- gun: Decentralized graph database
- ajv: JSON Schema validation
- openai: OpenAI API client (optional)

