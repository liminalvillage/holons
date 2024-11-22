# HoloSphere

HoloSphere is a decentralized geospatial data management system that combines hierarchical hexagonal tiling (H3) with distributed data storage (GunDB) and AI-powered processing of information.

## Features

- **Hierarchical Spatial Data**: Uses Uber's H3 spatial indexing system for efficient geospatial data organization
- **Decentralized Storage**: Built on GunDB for peer-to-peer data storage and synchronization
- **Schema Validation**: JSON Schema validation for data integrity
- **AI Processing**: Extensible AI-powered content analysis and summarization across hexagonal regions
- **Voting System**: Built-in delegation and voting mechanisms for collaborative decision-making
- **Multi-scale Operations**: Automatic content propagation across different spatial resolutions

## License

GNU Lesser General Public License v3.0 (LGPL-3.0)

This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 3 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.

You should have received a copy of the GNU Lesser General Public License along with this library; if not, see <https://www.gnu.org/licenses/>.

### Key Points of LGPL-3.0

- You can use this library in proprietary applications
- Any modifications to the library itself must be distributed under LGPL
- Applications that use the library don't have to be LGPL
- If you modify the library, you must make the source code available
- You must provide a way for users to relink with a modified version of the library

## Dependencies

### Core Dependencies
- **h3-js**: Uber's H3 geospatial indexing system
- **gun**: Decentralized graph database
- **ajv**: JSON Schema validation
- **lodash**: Utility functions

### Optional Dependencies
- **langchain**: AI/LLM integration framework
- **openai**: OpenAI API client (optional)

## Getting Started

```bash
npm install holosphere
```

## Basic Usage

```javascript
import { HoloSphere } from 'holosphere';

// Initialize HoloSphere with your configuration
const holo = new HoloSphere({
  peers: ['http://localhost:8765/gun'],
  aiProvider: 'local' // or 'openai', 'azure', etc.
});

// Create or access a hexagonal region
const hex = await holo.getHex('8928308280fffff');

// Store data in the region
await hex.put({
  type: 'observation',
  data: {
    temperature: 22.5,
    timestamp: Date.now()
  }
});

// Subscribe to changes
hex.subscribe(data => {
  console.log('New data:', data);
});
```

## Advanced Features

### Spatial Queries

```javascript
// Find all hexagons within a radius
const hexagons = await holo.findWithin({
  lat: 37.7749,
  lng: -122.4194,
  radius: 5000 // meters
});

// Query data across multiple resolutions
const aggregatedData = await holo.aggregate({
  hexIds: hexagons,
  resolution: 7,
  method: 'average'
});
```

### AI Processing

```javascript
// Process content with AI
const summary = await hex.processContent({
  processor: 'summarize',
  options: {
    maxLength: 100
  }
});

// Analyze trends across regions
const analysis = await holo.analyzeRegion({
  hexIds: hexagons,
  timeRange: '7d',
  metrics: ['sentiment', 'topics']
});
```

### Voting and Governance

```javascript
// Create a proposal
const proposal = await hex.createProposal({
  title: 'Update Data Schema',
  description: 'Add new fields for environmental metrics',
  changes: {
    schema: newSchemaDefinition
  }
});

// Cast a vote
await proposal.vote({
  support: true,
  weight: 1.0
});
```

### Schema Validation

```javascript
// Set a schema for a specific lens
const schema = {
  type: 'object',
  properties: {
    temperature: { type: 'number' },
    timestamp: { type: 'number' }
  },
  required: ['temperature', 'timestamp']
};

await holo.setSchema('climate', schema);

// Data will be validated against schema before storage
await hex.put('climate', {
  temperature: 22.5,
  timestamp: Date.now()
});
```

### Hierarchical Data Management

```javascript
// Get hexagons at all scales for a location
const hexStack = holo.getScalespace(37.7749, -122.4194);

// Get parent hexagons for a specific hex
const parentHexes = holo.getHexScalespace('8928308280fffff');

// Automatically upcast content to parent hexagons
await holo.upcast(hex, 'climate', {
  temperature: 22.5,
  timestamp: Date.now()
});
```

### Real-time Subscriptions

```javascript
// Subscribe to changes in a specific hex and lens
holo.subscribe('8928308280fffff', 'climate', (data, key) => {
  console.log('New data:', data);
  console.log('Key:', key);
});
```

### Content Processing

```javascript
// Compute summaries across hexagon hierarchies
await holo.compute(hex, 'observations', 'summarize');

// Clear data from a specific lens
await holo.clearlens(hex, 'temporary_data');

// Get specific content by key
const data = await holo.getKey(hex, 'climate', 'measurement_001');

// Get raw GunDB node reference
const node = holo.getNode(hex, 'climate', 'measurement_001');
```

### Voting System Details

The voting system supports:
- Direct voting on topics within hexagons
- Vote delegation to other users
- Circular delegation detection
- Vote aggregation across regions

```javascript
// Cast a vote
await holo.vote(userId, hexId, 'proposal_123', 'approve');

// Delegate voting power
await holo.delegateVote(userId, 'environmental', delegateUserId);

// Get aggregated votes for a region
const voteResults = holo.aggregateVotes(hexId, 'proposal_123');
```

## Configuration

HoloSphere can be configured with various options:

```javascript
const config = {
  // Network configuration
  peers: ['https://peer1.example.com/gun', 'https://peer2.example.com/gun'],
  
  // Storage options
  storage: {
    type: 'indexeddb',
    namespace: 'my-app'
  },
  
  // AI processing configuration
  ai: {
    provider: 'local',
    model: 'gpt-3.5-turbo',
    apiKey: process.env.AI_API_KEY
  },
  
  // Schema validation
  schema: {
    strict: true,
    customValidators: {}
  }
};

const holo = new HoloSphere(config);
```

## Documentation

For detailed documentation, please visit our [documentation site](https://docs.holons.io).

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on:
- Code of Conduct
- Development setup
- Testing guidelines
- Pull request process

## Support

- [GitHub Issues](https://github.com/liminalvillage/holosphere/issues)
- [Discord Community](https://discord.gg/liminalvillage)

## Roadmap

- [ ] Enhanced spatial indexing algorithms
- [ ] Additional AI model integrations
- [ ] Improved data replication strategies
- [ ] Extended governance mechanisms
- [ ] Mobile SDK development

## Citation

If you use HoloSphere in your research, please cite:

```bibtex
@software{holosphere2024,
  author = {Roberto Valenti},
  title = {HoloSphere: Decentralized Geospatial Data Management},
  year = {2024},
  url = {https://github.com/holosphere/holosphere}
}
```

## Technical Details

### Data Storage

HoloSphere uses GunDB for decentralized storage with the following features:
- Content-addressable storage (SHA-256 hashing)
- User-defined IDs for updatable content
- Automatic peer synchronization
- Schema validation before storage

### Spatial Indexing

The system uses Uber's H3 library for:
- Converting lat/long to hexagon IDs
- Managing parent-child relationships
- Multi-resolution operations
- Spatial queries and containment

### AI Integration

The AI processing system supports:
- Multiple AI providers (OpenAI, local models, etc.)
- Content summarization across regions
- Hierarchical content processing
- Customizable processing operations

## Error Handling

HoloSphere includes built-in error handling for:
- Schema validation failures
- Network connectivity issues
- Invalid spatial coordinates
- Circular vote delegations
- Data parsing errors

## Performance Considerations

- Use appropriate H3 resolution levels (0-15) for your use case
- Consider data volume when computing summaries
- Monitor real-time subscriptions for memory usage
- Cache frequently accessed schemas
- Use batch operations for bulk data processing

## Security Notes

- Store API keys securely
- Implement appropriate access control
- Validate all user input
- Monitor delegation chains
- Protect against vote manipulation

### Global Data Management

HoloSphere provides methods for managing global (non-hex-specific) data:

```javascript
// Store data in a global table
await holo.putGlobal('settings', {
  id: 'app_config',
  theme: 'dark',
  language: 'en'
});

// Retrieve all data from a global table
const settings = await holo.getGlobal('settings');

// Get specific item from a global table
const config = await holo.getGlobalKey('settings', 'app_config');

// Delete a global table
await holo.deleteGlobal('settings');
```

### Data Retrieval and Management

HoloSphere offers multiple ways to retrieve and manage data:

```javascript
// Get all items from a specific hex and lens
const allItems = await holo.getAll('8928308280fffff', 'climate');

// Get all items from a lens across all hexes
const allClimateData = await holo.getAllTable('climate');

// Drop (delete) all content under a specific hex and lens
await holo.drop('8928308280fffff', 'climate');
```

## Implementation Details

### Data Storage Patterns

HoloSphere implements two storage patterns:
1. **Content-Addressable Storage**: For immutable data, using SHA-256 hashing
2. **ID-Based Storage**: For updatable content, using user-defined IDs

```javascript
// Store updatable content with ID
await holo.put(hex, 'climate', {
  id: 'station_001',
  temperature: 22.5
});

// Store immutable content (auto-generated hash ID)
await holo.put(hex, 'observations', {
  temperature: 22.5,
  timestamp: Date.now()
});
```

### Data Validation

All data operations include:
- Schema validation before storage
- JSON parsing validation
- Null checks for required parameters
- Error handling for invalid data

### Performance Optimizations

The system includes several optimizations:
- Efficient data retrieval using GunDB's `.once()` method
- Parallel processing for bulk operations
- Automatic cleanup of invalid data
- Smart timeout handling for network operations

### Error Handling Examples

```javascript
// Example with schema validation
try {
  await holo.put(hex, 'climate', invalidData);
} catch (error) {
  console.error('Validation failed:', error);
}

// Example with data retrieval
const data = await holo.getKey(hex, 'climate', 'missing_key');
if (data === null) {
  console.log('No data found for key');
}
```

### Global Data Management (Additional Features)

```javascript
// Get all items from a global table with filtering
const allItems = await holo.getAllTable('settings');

// Subscribe to changes in a global table
holo.subscribe('settings', null, (data, key) => {
  console.log('Settings updated:', data);
});

// Delete specific items from a global table
await holo.delete('settings', 'old_config');
```

### Data Management Patterns

HoloSphere supports three types of data storage:

1. **Hex-specific Data**: Stored under hexagonal regions
```javascript
await holo.put(hex, 'climate', data);
```

2. **Global Data**: Stored independently of hexagons
```javascript
await holo.putGlobal('settings', data);
```

3. **Cross-referenced Data**: Data that can be accessed from both global and hex contexts
```javascript
// Store in global context
await holo.putGlobal('shared_data', {
  id: 'shared_item',
  data: 'value'
});

// Reference in hex context
await holo.put(hex, 'local_lens', {
  id: 'local_reference',
  ref: 'shared_item'
});
```

### Global Schema Management

Schemas can be managed globally and applied to multiple lenses:

```javascript
// Set a global schema template
await holo.putGlobal('schemas', {
  id: 'measurement_template',
  schema: {
    type: 'object',
    properties: {
      value: { type: 'number' },
      timestamp: { type: 'number' }
    }
  }
});

// Apply global schema to a lens
const template = await holo.getGlobalKey('schemas', 'measurement_template');
await holo.setSchema('climate', template.schema);
```

