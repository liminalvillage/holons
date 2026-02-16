/**
 * AD4M Integration Layer for Harvest (Holons)
 *
 * This module provides the bridge between Harvest's HoloSphere data layer
 * and AD4M's Subject Class / Perspective / Neighbourhood system.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { HoloSphereAd4mAdapter } from '$lib/ad4m';
 *
 * // Create adapter (drop-in replacement for HoloSphere)
 * const adapter = new HoloSphereAd4mAdapter({
 *   executorUrl: 'ws://localhost:12000/graphql',
 *   token: 'your-jwt-token'
 * });
 * await adapter.connect();
 *
 * // Use exactly like HoloSphere:
 * const quests = await adapter.getAll(holonId, 'quests');
 * await adapter.put(holonId, 'quests', { title: 'New Quest', status: 'ongoing' });
 *
 * // Or use AD4M directly for advanced operations:
 * import { Quest, HolonSettings } from '$lib/ad4m';
 * const allQuests = await Quest.findAll(perspective);
 * ```
 *
 * ## Architecture
 *
 * ```
 * ┌─────────────────────────────────────────────────┐
 * │  Svelte Components (unchanged)                   │
 * │  holosphere.get/put/subscribe/delete             │
 * └───────────────────┬─────────────────────────────┘
 *                     │  (same API)
 * ┌───────────────────▼─────────────────────────────┐
 * │  HoloSphereAd4mAdapter                           │
 * │  Translates HoloSphere calls → AD4M operations   │
 * └───────────────────┬─────────────────────────────┘
 *                     │
 * ┌───────────────────▼─────────────────────────────┐
 * │  AD4M Subject Classes (models/)                  │
 * │  HolonSettings, Quest, Member, Shopping, etc.    │
 * └───────────────────┬─────────────────────────────┘
 *                     │
 * ┌───────────────────▼─────────────────────────────┐
 * │  AD4M Executor (local or remote)                 │
 * │  Perspectives / Neighbourhoods / SurrealDB       │
 * └─────────────────────────────────────────────────┘
 * ```
 *
 * @module ad4m
 */

// ---------------------------------------------------------------------------
// Models — AD4M Subject Class definitions for Holons data types
// ---------------------------------------------------------------------------
export {
  HolonSettings,
  Quest,
  HolonMember,
  ShoppingItem,
  CouncilAdvisor,
  Chromosome,
  DNASequence,
  QuestTreeNode,
  FederationLink,
  OfferWant,
  Role,
  Badge,
  Invite,
  GenericData,
  LENS_MODEL_MAP,
  ALL_SUBJECT_CLASSES,
} from './models/index';

// ---------------------------------------------------------------------------
// Adapter — HoloSphere-compatible API backed by AD4M
// ---------------------------------------------------------------------------
export { HoloSphereAd4mAdapter } from './adapter';
export type { PutOptions, Subscription } from './adapter';

// ---------------------------------------------------------------------------
// Connection — AD4M executor connection management
// ---------------------------------------------------------------------------
export {
  Ad4mConnection,
  connectLocal,
  connectRemote,
  LOCAL_EXECUTOR_URL,
  REMOTE_EXECUTOR_URL,
} from './connection';
export type {
  Ad4mConnectionConfig,
  ConnectionState,
  ConnectionStateCallback,
} from './connection';

// ---------------------------------------------------------------------------
// Registry — Agent-centric holon discovery
// ---------------------------------------------------------------------------
export { AgentHolonIndex, HolonIndexEntry, SharedHolonRef } from './registry';

// ---------------------------------------------------------------------------
// Schema Bridge — JSON Schema → AD4M Subject Class conversion
// ---------------------------------------------------------------------------
export {
  bridgeSchema,
  bridgeCustomSchema,
  createBridgedSchemas,
  inspectBridgedSDNA,
  getSchemaMapping,
  SCHEMA_BRIDGE_CONFIGS,
} from './schema-bridge';
export type { SchemaBridgeConfig, BridgedSchema } from './schema-bridge';

// ---------------------------------------------------------------------------
// Phase 1: Integration Layer
// ---------------------------------------------------------------------------

// Config — AD4M connection settings with localStorage persistence
export { ad4mConfig, isAd4mEnabled, isDualMode, isHoloSphereActive, isAd4mPrimary } from './config';
export type { BackendMode, Ad4mConfig } from './config';

// Dual Adapter — transparent backend multiplexer
export { DualWriteAdapter } from './dual-adapter';
export type { DualAdapterConfig, DiscrepancyLogger } from './dual-adapter';

// Provider — Svelte context integration
export {
  createDualAdapter,
  initAd4mAdapter,
  switchMode,
  AD4M_CONTEXT_KEY,
  AD4M_STATUS_KEY,
} from './provider';

// Sync — HoloSphere → AD4M data migration
export { syncHolonToAd4m, syncLensToAd4m } from './sync';
export type { SyncReport, LensSyncResult, SyncProgressCallback } from './sync';
