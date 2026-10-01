// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/privacy
 *
 * A private scope — a lens, or one card of it — is sealed on the relays
 * (NIP-44) and read by an audience of HOLONS: the owner holon always, and
 * whichever holons it is shared with. Core resolves each holon to the keys
 * that read on its behalf (a personal holon's key and its linked keys; a
 * group holon's NIP-29 state) and the holosphere hands those keys out as
 * NIP-17 grants. No surface ever sees or types a key.
 *
 * Verbs: `lock`, `unlock`, `share`, `unshare`; `audience` to read; `sync`
 * when membership changed; `privacyOfHolon` for the flags alone.
 * See packages/holosphere/PRIVACY.md.
 */

export { audience, isLocked, lock, privacyOfHolon, share, sync, syncScope, unlock, unshare } from './audience.js';
export { holonReaders, type HolonReadersOptions } from './readers.js';
export {
  assertPrivatizable,
  audienceTag,
  holonOfTag,
  holonsOf,
  isPubkeyHolonId,
  normScope,
  type PrivatizableContext,
} from './scope.js';
export {
  GRANT_SUBJECT,
  GRANT_TYPE,
  GRANT_VERSION,
  NEVER_PRIVATE_LENSES,
  type Audience,
  type AudienceEntry,
  type AudienceStatus,
  type AudienceTag,
  type GrantPayload,
  type HolonReaders,
  type LockedScopes,
  type ReaderKind,
  type Scope,
  type SyncReport,
} from './types.js';
