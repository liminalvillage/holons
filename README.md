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

