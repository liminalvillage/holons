import { log } from './logger.js';

/**
 * Holon-specific utility functions
 */

/**
 * Normalize a Holon ID to the canonical form (e.g., '-4829278292' for 'chat_4829278292')
 * This is needed because holons are registered as 'chat_4829278292' in Solidity contracts
 * (Managed/Zoned) due to issues with the minus sign.
 */
export const normalizeHolonId = holonId => {
  if (typeof holonId === 'string') {
    if (holonId.startsWith('chat_')) {
      return `-${holonId.slice(5)}`;
    } else if (/^-[0-9]+$/.test(holonId)) {
      return holonId;
    }
  }
  return holonId;
};

/**
 * Convert a normalized holon ID back to chat_ format for contract interactions
 */
export const toholonId = holonId => {
  if (typeof holonId === 'string' && holonId.startsWith('-')) {
    return `chat_${holonId.slice(1)}`;
  }
  return holonId;
};

/**
 * Validate that a holon ID is in the correct format
 */
export const validateHolonId = holonId => {
  if (!holonId) {
    throw new Error('Holon ID is required');
  }

  if (typeof holonId !== 'string' && typeof holonId !== 'number') {
    throw new Error('Holon ID must be a string or number');
  }

  const str = holonId.toString();

  // Check if it's a valid format (either chat_XXXX or -XXXX)
  if (!str.startsWith('chat_') && !str.match(/^-[0-9]+$/)) {
    throw new Error('Invalid holon ID format. Must be "chat_XXXX" or "-XXXX"');
  }

  return true;
};

/**
 * Extract the numeric part of a holon ID
 */
export const getHolonNumericId = holonId => {
  validateHolonId(holonId);

  const str = holonId.toString();

  if (str.startsWith('chat_')) {
    return parseInt(str.slice(5), 10);
  } else if (str.startsWith('-')) {
    return parseInt(str.slice(1), 10);
  }

  throw new Error('Invalid holon ID format');
};

/**
 * Check if two holon IDs refer to the same holon
 */
export const isSameHolon = (holonId1, holonId2) => {
  if (!holonId1 || !holonId2) return false;

  try {
    return normalizeHolonId(holonId1) === normalizeHolonId(holonId2);
  } catch (error) {
    log.warn('Error comparing holon IDs', {
      holonId1,
      holonId2,
      error: error.message,
    });
    return false;
  }
};

/**
 * Get holon metadata from database
 */
export const getHolonMetadata = async (db, holonId) => {
  const normalizedId = normalizeHolonId(holonId);

  try {
    const settings = await db.get(
      normalizedId.toString() + '/settings',
      normalizedId.toString()
    );

    return {
      id: normalizedId,
      holonId: toholonId(normalizedId),
      name: settings?.name || 'External Holon',
      settings: settings || {},
    };
  } catch (error) {
    log.error('Error getting holon metadata', {
      holonId,
      normalizedId,
      error: error.message,
    });

    return {
      id: normalizedId,
      holonId: toholonId(normalizedId),
      name: 'External Holon',
      settings: {},
    };
  }
};

/**
 * Check if a holon ID represents a private chat
 */
export const isPrivateHolon = holonId => {
  // Private chats typically have positive IDs, groups have negative IDs
  // But since we normalize everything to negative, we check the original format
  return !holonId.toString().startsWith('-');
};

/**
 * Check if a holon ID represents a group chat
 */
export const isGroupHolon = holonId => {
  return !isPrivateHolon(holonId);
};

export default {
  normalizeHolonId,
  toholonId,
  validateHolonId,
  getHolonNumericId,
  isSameHolon,
  getHolonMetadata,
  isPrivateHolon,
  isGroupHolon,
};
