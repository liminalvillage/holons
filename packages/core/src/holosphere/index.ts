/**
 * `@holons/core/holosphere` — unified entry point for HoloSphere I/O.
 *
 * Both `apps/web` and `packages/telegram-ui` build their HoloSphere instances
 * and identity-aware writes through this module so all UIs run the same
 * factory + permission logic.
 */

export {
  createHoloSphere,
  type CreateHoloSphereOptions,
  type HoloSphereStoreOptions,
  type HoloSphereSigningOptions,
  type HoloSphereNostrOptions,
} from './factory.js';
export {
  writeWithIdentity,
  createHolonWriter,
  type WriteWithIdentityOptions,
  type WriteDeniedInfo,
  type HolonWriter,
} from './write.js';
export {
  DEFAULT_RELAYS,
  parseRelayList,
  resolveRelays,
  parseSigningMode,
  signingOptionsFor,
  type SigningMode,
} from './relays.js';
export { canWriteToHolon, resolveActingAs, type ActingAsResolver } from './identity.js';
export {
  createIdentityContext,
  signerFromSecretKey,
  type IdentityContext,
  type NostrSigner,
  type SignableTemplate,
} from './signers.js';
export { sourceHolonId, sourceRef, recordKey } from './provenance.js';
export {
  HOLONS_REGISTRY_TABLE,
  buildRegistryEntry,
  registerHolon,
  type HolonRegistryEntry,
  type RegisterHolonInput,
} from './registry.js';
