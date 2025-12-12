import { log } from './logger.js';
import { getChatName } from './telegram.js';

/**
 * Holon-specific utility functions
 */

/**
 * Normalize a Holon ID to the canonical form (e.g., '-4829278292' for 'chat_4829278292')
 * This is needed because holons are registered as 'chat_4829278292' in Solidity contracts
 * (Managed/Zoned) due to issues with the minus sign.
 */
export const normalizeHolonId = (holonId) => {
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
export const toholonId = (holonId) => {
  if (typeof holonId === 'string' && holonId.startsWith('-')) {
    return `chat_${holonId.slice(1)}`;
  }
  return holonId;
};

/**
 * Retrieve the name of a Holon given its ID.
 * It first tries to fetch the name from the Holon's own settings.
 * If that fails and a context `ctx` is provided, it attempts to get the name via `getChatName`.
 * As a last resort, it returns a generic name.
 */
export const getHolonName = async (db, holonId, ctx = null) => {
  if (!holonId) return 'Unknown Holon';
  
  let normalizedHolonId = normalizeHolonId(holonId);

  try {
    // Attempt to get settings for this holonId
    // Settings are stored at holonId + '/settings'
    const settings = await db.get(
      normalizedHolonId.toString() + '/settings', 
      normalizedHolonId.toString()
    );
    
    if (settings && settings.name) {
      return settings.name;
    }
  } catch (error) {
    // Log benignly, as this is an attempt to get a prettier name
    log.warn('Could not fetch settings name for holon', {
      holonId,
      normalizedHolonId,
      error: error.message,
    });
  }

  // Fallback 1: Try Telegram chat name if ctx is provided
  if (ctx && typeof getChatName === 'function') {
    try {
      const chatName = await getChatName(ctx, normalizedHolonId.toString());
      // Ensure getChatName doesn't return an empty, null, or default 'unknown' string
      if (chatName && chatName !== 'unknown' && chatName !== null && chatName.trim() !== '') {
        return chatName;
      }
    } catch (error) {
      log.warn('Could not fetch Telegram chat name for holon', {
        holonId: normalizedHolonId,
        error: error.message,
      });
    }
  }

  // Final fallback: return a generic name instead of the ID
  log.debug('Returning generic name for holon', { holonId });
  return 'External Holon';
};

/**
 * Validate that a holon ID is in the correct format
 */
export const validateHolonId = (holonId) => {
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
export const getHolonNumericId = (holonId) => {
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
    log.warn('Error comparing holon IDs', { holonId1, holonId2, error: error.message });
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
 * Batch get multiple holon names
 */
export const getMultipleHolonNames = async (db, holonIds, ctx = null) => {
  const promises = holonIds.map(id => 
    getHolonName(db, id, ctx).catch(error => {
      log.warn('Failed to get holon name in batch', { 
        holonId: id, 
        error: error.message 
      });
      return 'External Holon';
    })
  );
  
  return await Promise.all(promises);
};

/**
 * Check if a holon ID represents a private chat
 */
export const isPrivateHolon = (holonId) => {
  const numericId = Math.abs(getHolonNumericId(holonId));
  // Private chats typically have positive IDs, groups have negative IDs
  // But since we normalize everything to negative, we check the original format
  return !holonId.toString().startsWith('-');
};

/**
 * Check if a holon ID represents a group chat
 */
export const isGroupHolon = (holonId) => {
  return !isPrivateHolon(holonId);
};

export default {
  normalizeHolonId,
  toholonId,
  getHolonName,
  validateHolonId,
  getHolonNumericId,
  isSameHolon,
  getHolonMetadata,
  getMultipleHolonNames,
  isPrivateHolon,
  isGroupHolon,
};