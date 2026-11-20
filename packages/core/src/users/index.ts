/**
 * `@holons/core/users` — user profile, values/needs, and holon membership.
 *
 * UI-agnostic. Pass any object that implements the {@link UserDB} surface
 * (Holosphere instances satisfy it natively) plus a {@link TelegramUserLike}
 * descriptor for the acting user.
 */

export type { TelegramUserLike, UserDB, UserProfile } from './types.js';

export {
  createDefaultProfile,
  getUserProfile,
  ensureUserProfile,
  saveUserProfile,
  getUsers,
} from './profile.js';

export { addUserValues, addUserNeeds } from './values-needs.js';

export { joinHolon, leaveHolon, type JoinResult } from './membership.js';

export {
  normalizePubkey,
  linkedKeysOf,
  personalHolonOf,
  getLinkedKeys,
  linkUserKey,
  unlinkUserKey,
  buildKeyLinkChallenge,
  keyLinkProofFilter,
  verifyKeyLinkProof,
  buildKeyLinkOffer,
  keyLinkProofTemplate,
  keyLinkDeepLinkPayload,
  parseKeyLinkPayload,
  keyLinkProofByCodeFilter,
  keyLinkProofPubkey,
  createLinkedKeysResolver,
  KEY_LINK_CODE_PREFIX,
  KEY_LINK_DEEPLINK_PREFIX,
  KEY_LINK_TAG,
  KEY_LINK_TTL_SEC,
  type KeyLinkOffer,
  type TaggedProofEventLike,
  type LinkKeyOptions,
  type KeyLinkChallenge,
  type ProofEventLike,
  type LinkedKeysResolverOptions,
} from './keys.js';
