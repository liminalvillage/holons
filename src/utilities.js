import i18next from "i18next";
import fs from 'fs';
import path from 'path';

export { i18next };

// Helper function to create padded caption for image stretching
export const createPaddedCaption = (text = '') => {
    const minSpaces = 23;
    const padding = '\u2800'.repeat(Math.max(0, minSpaces - text.length));
    return text + padding;
};

/**
 * Get the holon ID from a quest object with backward compatibility.
 * Supports both new 'holon' field and legacy 'chat' field.
 * @param {Object} quest - The quest object
 * @returns {string|number|null} The holon ID
 */
export const getQuestHolon = (quest) => {
    return quest?.holon ?? quest?.chat ?? null;
};

// Use format "functionName_callbackData" with callback functions
export const getCallbackData = (ctx) => ctx.match[0].split("_")[1];

// Regular message & inline button answer
export const getUserId = (ctx) =>
  ctx?.update?.message?.from?.id || ctx?.update?.callback_query?.from?.id || 0;

export const getUser = (ctx) =>
  ctx?.update?.message?.from || ctx?.update?.callback_query?.from || 0;

export const getChatName = async (ctx, holonId) => {
  try {
    const chatInfo = await ctx.telegram.getChat(holonId);
    
    if (chatInfo.type === 'private') {
      return `${chatInfo.first_name} ${chatInfo.last_name || ''}`.trim();
    } else {
      return chatInfo.title || 'unknown';
    }
  } catch (err) {
    // Handle specific "chat not found" error more gracefully
    if (err.response && err.response.error_code === 400 && err.response.description && err.response.description.includes('chat not found')) {
      // console.warn(`Chat not found for ID ${holonId}: ${err.response.description}`);
      return null; // Return null to indicate chat not accessible
    } else {
    console.error('Error getting chat name:', err);
    return 'unknown';
    }
  }
}

export const getUserName = (ctx) =>
  ctx?.from?.first_name ||
  ctx?.chat?.first_name ||
  ctx?.from?.username ||
  ctx?.chat?.username ||
  ctx?.message?.from?.first_name ||
  ctx?.message?.chat?.first_name ||
  ctx?.callback_query?.from?.first_name ||
  ctx?.callback_query?.chat?.first_name ||
  ctx?.message?.from?.username ||
  ctx?.message?.chat?.username ||
  ctx?.callback_query?.from?.username ||
  ctx?.callback_query?.chat?.username ||
  ctx?.update?.message?.from?.first_name ||
  ctx?.update?.message?.chat?.first_name ||
  ctx?.update?.callback_query?.from?.first_name ||
  ctx?.update?.callback_query?.chat?.first_name ||
  ctx?.update?.message?.from?.username ||
  ctx?.update?.message?.chat?.username ||
  ctx?.update?.callback_query?.from?.username ||
  ctx?.update?.callback_query?.chat?.username ||
  "???";

export const getParseModeHTML = () => ({ parse_mode: "HTML" });
export const bold = (text) => `<b>${text}</b>`;
export const italic = (text) => `<i>${text}</i>`;
export const underline = (text) => `<u>${text}</u>`;

export const getUserInput = (ctx) => ctx?.update?.message?.text;
export const getParameters = (ctx) => ctx?.update?.message?.text.split(" ").slice(1).join(" ");

export const getholonId = (ctx) => ctx?.chat?.id || ctx?.update?.message?.chat?.id || ctx?.update?.callback_query?.message?.chat?.id || 0;
export const getMessageId = (ctx) => ctx?.message?.message_id || ctx?.update?.message?.message_id || ctx?.update?.callback_query?.message?.message_id || 0;

export const parseList = (text) => {
  // Split by comma
  text = text.split(' ').slice(1).join(' ')
  const items = text.split(',').map(item => item.trim());
  // Remove empty strings
  return items.filter(x => x);
}

export const capitalize = (string) => {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

export const isAdmin = async (ctxOrUserId, holonId) => {
  // Handle case where first parameter is userId and second is holonId
  if (typeof ctxOrUserId === 'number' && holonId) {
    // This is the case where it's called as isAdmin(userId, holonId)
    // We need to construct a mock ctx object or handle this differently
    // For now, we'll need to pass the telegram instance somehow
    console.warn('isAdmin called with userId and holonId - this needs telegram instance');
    return false; // Default to false for this case until we can properly handle it
  }
  
  // Handle case where first parameter is ctx
  const ctx = ctxOrUserId;
  if (ctx.telegram) { // TODO: HANDLE DISCORD CASE
    try {
      const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      if (['administrator', 'creator'].includes(chatMember.status) || (ctx.chat.type === 'private'))
        return true;
      else
        return false;
    } catch (error) {
      console.error('Error checking admin status:', error);
      return false;
    }
  }
  return false;
}

/**
 * Check if the bot has admin rights in the current chat
 * @param {Object} ctx - The Telegram context object
 * @returns {Promise<boolean>} - True if bot has admin rights (or in private chat), false otherwise
 */
export const isBotAdmin = async (ctx) => {
  try {
    const holonId = getholonId(ctx);
    
    // Private chats don't require admin permissions
    if (ctx.chat?.type === 'private') {
      return true;
    }
    
    // Group chats - check if the bot is an admin
    if (holonId < 0) {
      const botId = ctx.botInfo.id;
      const botMember = await ctx.telegram.getChatMember(holonId, botId);
      
      // Check if bot is admin/creator and has necessary permissions
      return botMember && 
        (botMember.status === 'administrator' || botMember.status === 'creator') &&
        (botMember.can_delete_messages === true);
    }
    
    return false;
  } catch (error) {
    console.error('Error checking bot admin status:', error);
    return false;
  }
}

export const getDisplayName = (user) => {
  if (!user) return "Unknown";
  
  const firstName = user.first_name || "";
  const lastName = user.last_name || "";
  
  if (!firstName && !lastName) return user.username || "Unknown User";
  
  return firstName + (lastName ? ` ${lastName.charAt(0)}.` : "");
};

/**
 * Retrieves the name of a Holon given its ID.
 * It first tries to fetch the name from the Holon's own settings.
 * If that fails and a context `ctx` is provided, it attempts to get the name via `getChatName`.
 * As a last resort, it returns the Holon ID itself.
 * @param {object} db - The database instance (e.g., HoloSphere) with a `get` method.
 * @param {string} holonId - The ID of the Holon.
 * @param {object} [ctx=null] - Optional Telegraf context, used for `getChatName` fallback.
 * @returns {Promise<string>} - The Holon's name or its ID as a fallback.
 */
export const getHolonName = async (db, holonId, ctx = null) => {
  if (!holonId) return 'Unknown Holon';
  let normalizedHolonId = holonId;

    // New: Handle chat_ prefix, as that's how holons are registered in Managed / Zoned
    if (typeof holonId === 'string' && holonId.startsWith('chat_')) {
      const idPart = holonId.slice(5); // Remove 'chat_'
      normalizedHolonId = idPart;
    }

    // Only normalize if it starts with 'chat_'. If already normalized (starts with '-' and is numeric), leave as is.
    if (typeof holonId === 'string') {
      if (holonId.startsWith('chat_')) {
        normalizedHolonId = `-${holonId.slice(5)}`;
      } else if (/^-[0-9]+$/.test(holonId)) {
        normalizedHolonId = holonId;
        // Already normalized, do nothing
      }
    }

  try {
    // Attempt to get settings for this holonId
    // Settings are stored at holonId + '/settings'
    const settings = await db.get(normalizedHolonId.toString() + '/settings', normalizedHolonId.toString());
    if (settings && settings.name) {
      return settings.name;
    }
  } catch (error) {
    // Log benignly, as this is an attempt to get a prettier name
    console.warn(`Could not fetch settings name for holon ${holonId} which is normalized to${normalizedHolonId}: ${error.message}`);
  }

  // Fallback 1: Try Telegram chat name if ctx is provided and getChatName is available
  if (ctx && typeof getChatName === 'function') {
    try {
      const chatName = await getChatName(ctx, normalizedHolonId.toString());
      // Ensure getChatName doesn't return an empty, null, or default 'unknown' string
      if (chatName && chatName !== 'unknown' && chatName !== null && chatName.trim() !== '') {
        return chatName;
      }
    } catch (error) {
      console.warn(`Could not fetch Telegram chat name for ${normalizedHolonId}: ${error.message}`);
    }
  }

  // Final fallback: return a generic name instead of the ID
  console.log("This is the id that is being passed to this function", holonId);
  console.log("This is being displayed when we are listing the holons in the Zoned")
  return `External Holon`;
};

/**
 * Generates the avatar URL for a user, optimized for fast rendering.
 * @param {Object} user - The user object containing id or other identifying information
 * @returns {string} - The avatar URL or fallback to default avatar
 */
export const getAvatarUrl = (user) => {
  // For screenshot performance, just use default avatar for now
  // This avoids file system checks and loading delays
  return `file://${process.cwd()}/public/default-avatar.png`;
  
  // TODO: Implement base64 encoding or caching for better performance
  // if (user && user.id) {
  //   const avatarPath = path.join(process.cwd(), 'public', 'avatars', `${user.id}.jpg`);
  //   if (fs.existsSync(avatarPath)) {
  //     return `file://${avatarPath}`;
  //   }
  // }
};

/**
 * Normalizes a Holon ID to the canonical form (e.g., '-4829278292' for 'chat_4829278292')
 * as this chat_4829278292 is how holons are registered in Solidity contracts ( Managed / Zoned ), 
 * because of the issues with - sign.
 * If already normalized, returns as is.
 * @param {string} holonId - The Holon ID to normalize.
 * @returns {string} - The normalized Holon ID.
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
