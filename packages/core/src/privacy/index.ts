// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/privacy
 *
 * Private lenses and key grants. A private lens keeps its content sealed
 * (NIP-44) on the relays; the owner reads on every device holding their key
 * and hands a whole lens or a single item to a pubkey — a personal holon's
 * id, or the key that runs a group holon. Revocation is forward-only.
 *
 * The holosphere instance holds the vaults and keys (`hs.privacy`, see
 * packages/holosphere/PRIVACY.md); this domain owns the rules: which lenses
 * may be private, who a "holon" resolves to, and the public hint.
 */

export {
  acceptGrant,
  getPrivacySnapshot,
  grantItem,
  grantLens,
  listGrants,
  revokeItem,
  revokeLens,
  setLensPrivacy,
} from './api.js';

export { resolveGranteePubkey, type ResolvedGrantee } from './resolve.js';

export {
  assertPrivatizable,
  isPubkeyHolonId,
  lensPrivacy,
  readPrivacy,
  withLensPrivacy,
  type PrivatizableContext,
} from './settings.js';

export { encodeGrant, isLensGrant, parseGrant } from './grants.js';

export {
  GRANT_SUBJECT,
  GRANT_TYPE,
  GRANT_VERSION,
  NEVER_PRIVATE_LENSES,
  type GrantPayload,
  type GranteeView,
  type PrivacyLensMode,
  type PrivacySettings,
  type PrivacySnapshot,
} from './types.js';
