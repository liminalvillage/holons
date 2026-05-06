/**
 * `@holons/core/holosphere` — unified entry point for HoloSphere I/O.
 *
 * Both `apps/web` and `packages/telegram-ui` build their HoloSphere instances
 * and identity-aware writes through this module so all UIs run the same
 * factory + permission logic.
 */

export { createHoloSphere, type CreateHoloSphereOptions } from './factory.js';
export {
  writeWithIdentity,
  createHolonWriter,
  type WriteWithIdentityOptions,
  type WriteDeniedInfo,
  type HolonWriter,
} from './write.js';
export { canWriteToHolon, resolveActingAs, type ActingAsResolver } from './identity.js';
