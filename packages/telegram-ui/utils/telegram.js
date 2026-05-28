import { log } from './logger.js';
import { ValidationError } from './errorHandler.js';

/**
 * Telegram-specific utility functions
 */

/**
 * Get user ID from Telegram context
 */
export const getUserId = ctx => {
  return (
    ctx?.update?.message?.from?.id ||
    ctx?.update?.callback_query?.from?.id ||
    ctx?.from?.id ||
    0
  );
};

/**
 * Get user object from Telegram context
 */
export const getUser = ctx => {
  return (
    ctx?.update?.message?.from ||
    ctx?.update?.callback_query?.from ||
    ctx?.from ||
    null
  );
};

/**
 * Get holon ID from Telegram context
 */
export const getholonId = ctx => {
  return (
    ctx?.chat?.id ||
    ctx?.update?.message?.chat?.id ||
    ctx?.update?.callback_query?.message?.chat?.id ||
    0
  );
};

/**
 * Get message ID from Telegram context
 */
export const getMessageId = ctx => {
  return (
    ctx?.message?.message_id ||
    ctx?.update?.message?.message_id ||
    ctx?.update?.callback_query?.message?.message_id ||
    0
  );
};

/**
 * Get user input text from Telegram context
 */
export const getUserInput = ctx => {
  return ctx?.update?.message?.text || ctx?.message?.text;
};

/**
 * Get parameters from command (everything after the first word)
 */
export const getParameters = ctx => {
  const text = getUserInput(ctx);
  if (!text) return '';
  return text.split(' ').slice(1).join(' ');
};

/**
 * Get callback data (used with inline keyboards)
 */
export const getCallbackData = ctx => {
  if (ctx.match && ctx.match[0]) {
    return ctx.match[0].split('_')[1];
  }
  return '';
};

/**
 * Get comprehensive user name from various context sources
 */
export const getUserName = ctx => {
  const sources = [
    ctx?.from?.first_name,
    ctx?.chat?.first_name,
    ctx?.from?.username,
    ctx?.chat?.username,
    ctx?.message?.from?.first_name,
    ctx?.message?.chat?.first_name,
    ctx?.callback_query?.from?.first_name,
    ctx?.callback_query?.chat?.first_name,
    ctx?.message?.from?.username,
    ctx?.message?.chat?.username,
    ctx?.callback_query?.from?.username,
    ctx?.callback_query?.chat?.username,
    ctx?.update?.message?.from?.first_name,
    ctx?.update?.message?.chat?.first_name,
    ctx?.update?.callback_query?.from?.first_name,
    ctx?.update?.callback_query?.chat?.first_name,
    ctx?.update?.message?.from?.username,
    ctx?.update?.message?.chat?.username,
    ctx?.update?.callback_query?.from?.username,
    ctx?.update?.callback_query?.chat?.username,
  ];

  return sources.find(name => name) || '???';
};

/**
 * Get display name for a user (formatted for UI)
 */
export const getDisplayName = user => {
  if (!user) return 'Unknown';

  const firstName = user.first_name || '';
  const lastName = user.last_name || '';

  if (!firstName && !lastName) {
    return user.username || 'Unknown User';
  }

  return firstName + (lastName ? ` ${lastName.charAt(0)}.` : '');
};

/**
 * Get chat name with error handling
 */
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
    if (
      err.response?.error_code === 400 &&
      err.response?.description?.includes('chat not found')
    ) {
      log.warn('Chat not found', { holonId, error: err.response.description });
      return null; // Return null to indicate chat not accessible
    } else {
      log.error('Error getting chat name', { holonId, error: err.message });
      return 'unknown';
    }
  }
};

/**
 * Check if user is admin in the current chat
 */
export const isAdmin = async (ctxOrUserId, holonId) => {
  // Handle case where first parameter is userId and second is holonId
  if (typeof ctxOrUserId === 'number' && holonId) {
    log.warn(
      'isAdmin called with userId and holonId - this needs telegram instance'
    );
    return false; // Default to false for this case until we can properly handle it
  }

  // Handle case where first parameter is ctx
  const ctx = ctxOrUserId;
  if (ctx.telegram) {
    try {
      const chatMember = await ctx.telegram.getChatMember(
        ctx.chat.id,
        ctx.from.id
      );
      const isAdminStatus = ['administrator', 'creator'].includes(
        chatMember.status
      );
      const isPrivateChat = ctx.chat.type === 'private';

      return isAdminStatus || isPrivateChat;
    } catch (error) {
      log.error('Error checking admin status', {
        userId: ctx.from.id,
        holonId: ctx.chat.id,
        error: error.message,
      });
      return false;
    }
  }
  return false;
};

/**
 * Check if the bot has admin rights in the current chat
 */
export const isBotAdmin = async ctx => {
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
      const hasAdminStatus =
        botMember &&
        (botMember.status === 'administrator' ||
          botMember.status === 'creator');
      const canDeleteMessages = botMember.can_delete_messages === true;

      return hasAdminStatus && canDeleteMessages;
    }

    return false;
  } catch (error) {
    log.error('Error checking bot admin status', {
      holonId: getholonId(ctx),
      error: error.message,
    });
    return false;
  }
};

/**
 * HTML formatting helpers
 */
export const getParseModeHTML = () => ({ parse_mode: 'HTML' });
export const bold = text => `<b>${text}</b>`;
export const italic = text => `<i>${text}</i>`;
export const underline = text => `<u>${text}</u>`;

/**
 * Parse comma-separated list from user input
 */
export const parseList = text => {
  // Split by comma
  text = text.split(' ').slice(1).join(' ');
  const items = text.split(',').map(item => item.trim());
  // Remove empty strings
  return items.filter(x => x);
};

/**
 * Create padded caption for image stretching
 */
export const createPaddedCaption = (text = '') => {
  const minSpaces = 23;
  const padding = '\u2800'.repeat(Math.max(0, minSpaces - text.length));
  return text + padding;
};

/**
 * Validate Telegram context
 */
export const validateTelegramContext = ctx => {
  if (!ctx) {
    throw new ValidationError('Telegram context is required');
  }

  const userId = getUserId(ctx);
  const holonId = getholonId(ctx);

  if (!userId) {
    throw new ValidationError('User ID not found in context');
  }

  if (!holonId) {
    throw new ValidationError('Holon ID not found in context');
  }

  return { userId, holonId };
};

export default {
  getUserId,
  getUser,
  getholonId,
  getMessageId,
  getUserInput,
  getParameters,
  getCallbackData,
  getUserName,
  getDisplayName,
  getChatName,
  isAdmin,
  isBotAdmin,
  getParseModeHTML,
  bold,
  italic,
  underline,
  parseList,
  createPaddedCaption,
  validateTelegramContext,
};
