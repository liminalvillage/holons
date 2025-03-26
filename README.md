# HoloSphere

HoloSphere is a JavaScript library that provides a spatial data management system using H3 geospatial indexing and GunDB for distributed storage. It enables you to store, validate, and retrieve data organized by geographic location using holonic principles.

## What is a Holon?

A holon (from Greek 'holos' meaning whole, with suffix 'on' meaning part) is simultaneously a whole and a part. In HoloSphere, holons are implemented as hierarchical geographic cells that can:

1. Act as autonomous units (storing their own data)
2. Be part of larger holons (through H3's hierarchical structure)
3. Contain smaller holons (through subdivision)
4. Interact with peer holons (through the distributed network)

### Holonic Architecture

HoloSphere implements holonic architecture in two ways:

#### 1. Spatial Hierarchy
```javascript
// Get holons at different scales for a location
const holon = await sphere.getHolon(lat, lng, 7);  // City level
const parent = h3.cellToParent(holon, 6);          // Region level
const children = h3.cellToChildren(holon, 8);       // Neighborhood level

// Get entire hierarchy
const scales = sphere.getHolonScalespace(holon);    // All containing holons
```

#### 2. Data Organization
```javascript
// Store data in different aspects (lenses) of a holon
await sphere.put(holon, 'environment', {
    id: 'air-001',
    temperature: 22.5,
    humidity: 65
});

await sphere.put(holon, 'social', {
    id: 'event-001',
    type: 'gathering',
    participants: 50
});
```

### Use Cases

1. **Localized Structures**
   - Local environmental monitoring
   - Community event coordination
   - Neighborhood resource sharing
   - Municipal service management

```javascript
// Example: Local air quality monitoring
async function monitorLocalAir(lat, lng) {
    const neighborhood = await sphere.getHolon(lat, lng, 9);
    
    // Store reading
    await sphere.put(neighborhood, 'air-quality', {
        id: `reading-${Date.now()}`,
        pm25: 12.5,
        timestamp: Date.now()
    });
    
    // Get local trends
    const readings = await sphere.getAll(neighborhood, 'air-quality');
}
```

2. **Delocalized Structures**
   - Regional data aggregation
   - Cross-boundary collaboration
   - Distributed decision making
   - Resource flow tracking

```javascript
// Example: Regional resource coordination
async function coordinateResources(region) {
    // Get all sub-holons
    const localities = h3.cellToChildren(region, h3.getResolution(region) + 1);
    
    // Gather resource data from each locality
    const resources = await Promise.all(
        localities.map(async locality => {
            return sphere.getAll(locality, 'resources');
        })
    );
    
    // Compute summaries for parent holon
    await sphere.compute(region, 'resources', 'summarize');
}
```

3. **Hybrid Structures**
   - Adaptive governance systems
   - Scalable social networks
   - Emergency response coordination
   - Supply chain management

```javascript
// Example: Emergency response system
async function coordinateEmergency(incident) {
    const epicenter = await sphere.getHolon(incident.lat, incident.lng, 8);
    const region = h3.cellToParent(epicenter, 6);
    
    // Local response
    await sphere.put(epicenter, 'emergencies', {
        id: incident.id,
        type: incident.type,
        severity: incident.severity
    });
    
    // Regional coordination
    const nearbyResources = await sphere.getAll(region, 'resources');
    
    // Subscribe to updates
    sphere.subscribe(epicenter, 'emergencies', (data) => {
        updateResponsePlan(data);
    });
}
```

### Key Benefits

1. **Scalability**: Holons can be nested infinitely, allowing systems to scale organically
2. **Autonomy**: Each holon manages its own data while participating in larger structures
3. **Flexibility**: Systems can be organized both hierarchically and peer-to-peer
4. **Resilience**: Distributed storage ensures no single point of failure
5. **Adaptability**: Structures can evolve based on changing needs

## Installation

```bash
npm install holosphere
```

## Quick Start

```javascript
import HoloSphere from 'holosphere';

// Initialize HoloSphere
const sphere = new HoloSphere('my-app');

// Store data at a location
const holon = await sphere.getHolon(40.7128, -74.0060, 7); // NYC at resolution 7
await sphere.put(holon, 'observations', {
    id: 'obs-001',
    temperature: 22.5,
    timestamp: Date.now()
});
```

## Real-World Examples

### Environmental Monitoring System

```javascript
// Define a schema for temperature readings
const tempSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        temperature: { type: 'number' },
        humidity: { type: 'number' },
        timestamp: { type: 'number' }
    },
    required: ['id', 'temperature', 'timestamp']
};

// Set up the system
const sphere = new HoloSphere('env-monitor', true); // strict mode enabled
await sphere.setSchema('temperature', tempSchema);

// Store a reading
async function storeReading(lat, lng, temp, humidity) {
    const holon = await sphere.getHolon(lat, lng, 8);
    const reading = {
        id: `temp-${Date.now()}`,
        temperature: temp,
        humidity: humidity,
        timestamp: Date.now()
    };
    
    return sphere.put(holon, 'temperature', reading);
}

// Get all readings for an area
async function getAreaReadings(lat, lng) {
    const holon = await sphere.getHolon(lat, lng, 8);
    return sphere.getAll(holon, 'temperature');
}

// Monitor an area for new readings
function monitorArea(lat, lng, callback) {
    const holon = sphere.getHolon(lat, lng, 8);
    sphere.subscribe(holon, 'temperature', callback);
}
```

### Location-Based Content System

```javascript
// Initialize with AI capabilities for content summarization
const sphere = new HoloSphere('local-content', false, 'your-openai-key');

// Define content schema
const contentSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        author: { type: 'string' },
        timestamp: { type: 'number' }
    },
    required: ['id', 'title', 'content', 'author']
};

await sphere.setSchema('articles', contentSchema);

// Post content for a location
async function postLocalContent(lat, lng, title, content, author) {
    const holon = await sphere.getHolon(lat, lng, 7);
    const article = {
        id: `article-${Date.now()}`,
        title,
        content,
        author,
        timestamp: Date.now()
    };
    
    await sphere.put(holon, 'articles', article);
    
    // Generate summaries for parent areas
    await sphere.compute(holon, 'articles', 'summarize');
}

// Get content for multiple zoom levels
async function getAreaContent(lat, lng) {
    const holon = await sphere.getHolon(lat, lng, 7);
    const scales = sphere.getHolonScalespace(holon);
    
    const content = {};
    for (const scale of scales) {
        content[scale] = await sphere.getAll(scale, 'articles');
    }
    
    return content;
}
```

### Data Validation Example

```javascript
// Strict validation with custom schema
const sphere = new HoloSphere('validated-data', true);

const measurementSchema = {
    type: 'object',
    properties: {
        id: { type: 'string' },
        value: { type: 'number' },
        unit: { type: 'string' },
        accuracy: { type: 'number' },
        timestamp: { type: 'number' }
    },
    required: ['id', 'value', 'unit'],
    additionalProperties: false
};

await sphere.setSchema('measurements', measurementSchema);

// This will succeed
await sphere.put(holon, 'measurements', {
    id: 'measure-1',
    value: 42.5,
    unit: 'celsius',
    accuracy: 0.1,
    timestamp: Date.now()
});

// This will fail due to schema validation
await sphere.put(holon, 'measurements', {
    id: 'measure-2',
    value: "invalid", // wrong type
    extra: "field"    // not allowed
});
```

## API Reference

### Constructor
```javascript
new HoloSphere(
    appName,    // String: Namespace for your application
    strict,     // Boolean: Enable strict schema validation (default: false)
    openaikey   // String: Optional OpenAI API key for AI features
)
```

### Core Methods

- `async getHolon(lat, lng, resolution)` - Get H3 index for coordinates
- `async put(holon, lens, data)` - Store data
- `async get(holon, lens, key)` - Retrieve specific data
- `async getAll(holon, lens)` - Retrieve all data
- `async delete(holon, lens, key)` - Delete specific data
- `async deleteAll(holon, lens)` - Delete all data
- `async setSchema(lens, schema)` - Set JSON schema for validation
- `async getSchema(lens)` - Get current schema
- `subscribe(holon, lens, callback)` - Listen for changes

## Storage Architecture

Data in HoloSphere is organized by:
- **Holons**: H3 geographic indexes
- **Lenses**: Data categories/types
- **Items**: Individual data entries with unique IDs

## Dependencies

- h3-js: Uber's H3 geospatial indexing
- gun: Decentralized database
- ajv: JSON Schema validation
- openai: AI capabilities (optional)

## License

GPL-3.0-or-later

# HoloSphere Federation

HoloSphere provides a robust federation system that allows spaces to share data and messages across different chats. This document outlines the federation functionality and how to use it.

## Core Federation Features

### Space Federation
- Create bidirectional relationships between spaces
- Control data propagation between federated spaces
- Manage notification settings for each space

### Message Federation
- Track messages across federated spaces
- Maintain message relationships between original and federated copies
- Update messages consistently across all federated spaces

## API Reference

### Space Federation

#### `federate(holosphere, spaceId1, spaceId2, password1, password2, bidirectional)`
Creates a federation relationship between two spaces.

```javascript
await federate(holosphere, 'space1', 'space2', 'pass1', 'pass2', true);
```

Parameters:
- `holosphere`: HoloSphere instance
- `spaceId1`: First space ID
- `spaceId2`: Second space ID
- `password1`: Optional password for first space
- `password2`: Optional password for second space
- `bidirectional`: Whether to set up bidirectional notifications (default: true)

### Message Federation

#### `federateMessage(holosphere, originalChatId, messageId, federatedChatId, federatedMessageId, type)`
Tracks a federated message across different chats.

```javascript
await federateMessage(holosphere, 'chat1', 'msg1', 'chat2', 'msg2', 'quest');
```

Parameters:
- `holosphere`: HoloSphere instance
- `originalChatId`: Original chat ID
- `messageId`: Original message ID
- `federatedChatId`: Federated chat ID
- `federatedMessageId`: Message ID in federated chat
- `type`: Message type (e.g., 'quest', 'announcement')

#### `getFederatedMessages(holosphere, originalChatId, messageId)`
Gets all federated messages for a given original message.

```javascript
const messages = await getFederatedMessages(holosphere, 'chat1', 'msg1');
```

#### `updateFederatedMessages(holosphere, originalChatId, messageId, updateCallback)`
Updates a message across all federated chats.

```javascript
await updateFederatedMessages(holosphere, 'chat1', 'msg1', async (chatId, messageId) => {
    // Update message in this chat
});
```

## Usage Example

```javascript
import { federate, federateMessage, updateFederatedMessages } from './federation.js';

// Create federation between spaces
await federate(holosphere, 'space1', 'space2');

// Track a federated message
await federateMessage(holosphere, 'chat1', 'msg1', 'chat2', 'msg2', 'quest');

// Update message across all federated chats
await updateFederatedMessages(holosphere, 'chat1', 'msg1', async (chatId, messageId) => {
    await updateMessageInChat(chatId, messageId);
});
```

## Data Structure

### Federation Info
```javascript
{
    id: string,
    name: string,
    federation: string[],  // List of federated space IDs
    notify: string[],      // List of spaces to notify
    timestamp: number
}
```

### Message Tracking
```javascript
{
    id: string,
    originalChatId: string,
    originalMessageId: string,
    type: string,
    messages: [
        {
            chatId: string,
            messageId: string,
            timestamp: number
        }
    ]
}
```

## Best Practices

1. Always use the federation functions to track messages across spaces
2. Keep federation relationships bidirectional when possible
3. Use appropriate message types for better tracking
4. Handle errors gracefully in update callbacks
5. Clean up old federation data when relationships are removed

