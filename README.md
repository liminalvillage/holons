# HoloSphere

HoloSphere is a JavaScript library that provides a spatial data management system using H3 geospatial indexing and GunDB for distributed storage. It enables you to store, validate, and retrieve data organized by geographic location.

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

MIT License

