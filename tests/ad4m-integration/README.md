# AD4M Integration Tests

Integration tests for the Harvest AD4M adapter using a real AD4M executor process.

## Prerequisites

### 1. Build the AD4M executor

```bash
cd ~/Desktop/ad4m
cargo build --release -p ad4m-executor
```

The binary must exist at `~/Desktop/ad4m/target/release/ad4m-executor`.

### 2. Install kitsune2-bootstrap-srv (for multi-user tests)

Required for local Holochain networking. If not available, tests will fall back to public bootstrap servers.

### 3. Install test dependencies

```bash
cd tests/ad4m-integration
npm install
```

## Running Tests

```bash
# Run all integration tests
npm test

# Run specific test suites
npm run test:crud            # Basic CRUD operations
npm run test:multi-user      # Multi-user scenarios
npm run test:sync            # Data sync from HoloSphere
npm run test:schema-bridge   # Schema bridge validation
```

## Test Architecture

- **holons-crud.test.ts** — CRUD operations for all subject classes (settings, quests, members, shopping, chromosomes, DNA, roles)
- **holons-multi-user.test.ts** — Multi-user scenarios with perspective isolation, link authorship, and federation
- **holons-sync.test.ts** — Data migration from mock HoloSphere to AD4M
- **holons-schema-bridge.test.ts** — JSON Schema → AD4M Subject Class bridge validation

### Test Utilities

`utils/utils.ts` provides:
- `startExecutor()` — Start an AD4M executor process with clean data
- `apolloClient()` — Create an authenticated Apollo WebSocket client
- `runHcLocalServices()` — Start local Holochain bootstrap services
- `sleep()`, `killProcess()` — Helper functions

### How It Works

1. Each test suite starts a fresh AD4M executor process
2. Creates test perspectives (local data stores)
3. Registers Holons subject classes (SDNA)
4. Performs CRUD operations and verifies results
5. Shuts down the executor and cleans up

Tests are automatically skipped if the ad4m-executor binary is not found.

## Port Allocation

Each test suite uses different ports to avoid conflicts:
- CRUD: 16100-16102
- Multi-User: 16200-16202
- Sync: 16300-16302
- Schema Bridge: 16400-16402
