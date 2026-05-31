/**
 * @fileoverview Community announcements with federation support.
 * @module src/Announcements
 */

import * as utils from './utilities.js';
import {
  createAnnouncement,
  federationKey as buildFederationKey,
  selectFederationTargets,
  targetAcceptsLens,
} from '@holons/core/announcements';

/**
 * Announcement system for broadcasting messages across holons.
 *
 * @class Announcements
 * @description Manages community announcements with support for federation.
 * Announcements can be shared across federated holons based on lens configuration.
 * Supports multiple languages and tracks announcement history.
 *
 * @property {Object} bot - Telegraf bot instance
 * @property {DB} db - Database instance
 * @property {Settings} settings - Settings manager for language preferences
 * @property {Users} users - Users manager for user data
 *
 * @example
 * const announcements = new Announcements(bot, db, settings, users);
 * // Use /announce <message> to broadcast to the community
 */
class Announcements {
  constructor(bot, db, settings, users) {
    this.bot = bot;
    this.db = db;
    this.settings = settings;
    this.users = users;
    this.bot.command(
      ['announce', 'announcement', 'annuncia', 'annuncio'],
      ctx => this.announce(ctx)
    );
  }

  async announce(ctx) {
    const holonId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId);
    const message = ctx.message.text.split(' ').slice(1).join(' ');

    if (!message || message.length === 0 || message === '') {
      // No message provided, use InputScene to collect it
      // Store the original command message ID in scene state to preserve it
      return ctx.scene.enter('input_scene', {
        promptText: utils.i18next.t('announcementprompt', { lng: language }),
        allowEmpty: false,
        originalCommandMessageId: messageId, // Preserve original command message ID
        onComplete: async (callbackCtx, message) => {
          // Retrieve the original command message ID from scene state
          const originalMessageId =
            callbackCtx.scene.state.originalCommandMessageId ||
            callbackCtx.message.message_id;
          await this.createAndPublishAnnouncement(
            callbackCtx,
            message,
            originalMessageId
          );
        },
      });
    }

    // Message provided in command, process directly
    await this.createAndPublishAnnouncement(ctx, message, messageId);
  }

  async createAndPublishAnnouncement(ctx, message, originalMessageId = null) {
    const holonId = ctx.chat.id;
    // Use provided originalMessageId if available, otherwise fall back to current message ID
    // This ensures consistency: command message ID is used whether invoked directly or via InputScene
    const messageId =
      originalMessageId !== null ? originalMessageId : ctx.message.message_id;
    const language = await this.settings.getLanguage(holonId);

    // @holons/core owns the announcement shape (created: ISO).
    const announcement = createAnnouncement({
      id: messageId,
      content: message,
      chat: holonId,
      user: ctx.from,
    });

    await this.db.put(holonId.toString(), 'announcements', announcement);

    // Send formatted announcement in local chat
    const formattedMessage = this.createAnnouncementMessage(
      announcement,
      language
    );
    await ctx.reply(formattedMessage, { parse_mode: 'Markdown' });

    // Check federation lens and replicate to other chats
    await this.handleFederatedAnnouncements(ctx, announcement, language);
  }

  async handleFederatedAnnouncements(ctx, announcement, language) {
    try {
      console.log(
        `[handleFederatedAnnouncements] Starting for announcement ${announcement.id} in chat ${announcement.chat}`
      );

      // Get federation info to find out which spaces to notify
      const fedInfo = await this.db.getFederation(announcement.chat);
      console.log(
        `[handleFederatedAnnouncements] Federation info for chat ${announcement.chat}:`,
        fedInfo
      );

      if (!fedInfo?.outbound?.length) {
        console.log(
          `[handleFederatedAnnouncements] No federated chats to notify for announcement ${announcement.id}`
        );
        return;
      }

      console.log(
        `[handleFederatedAnnouncements] Found ${fedInfo.outbound.length} federated chats to notify:`,
        fedInfo.outbound
      );

      // Get existing federation tracking info (@holons/core owns the key).
      const federationKey = buildFederationKey(announcement.chat, announcement.id);
      const federatedMessages = (await this.db.getGlobal(
        'federation_messages',
        federationKey
      )) || {
        id: federationKey,
        holonId: announcement.chat,
        announcementId: announcement.id,
        messages: [],
      };

      // @holons/core selects targets (outbound minus self).
      for (const federatedholonId of selectFederationTargets(fedInfo, announcement.chat)) {
        console.log(
          `[handleFederatedAnnouncements] Processing federated chat ${federatedholonId}`
        );

        // Only deliver if the target accepts the 'announcements' lens FROM us.
        try {
          const targetFedInfo = await this.db.getFederation(federatedholonId);
          const sourceholonId = announcement.chat.toString();

          if (!targetAcceptsLens(targetFedInfo, sourceholonId, 'announcements')) {
            console.log(
              `[handleFederatedAnnouncements] Skipping ${federatedholonId} - 'announcements' lens not accepted from ${sourceholonId}`
            );
            continue;
          }
        } catch (error) {
          console.error(
            `[handleFederatedAnnouncements] Error checking federation settings for chat ${federatedholonId}:`,
            error
          );
          continue; // Skip this chat if we can't verify federation settings
        }

        // Find existing message for this federated chat
        const existingMsgIndex = federatedMessages.messages.findIndex(
          m => m.holonId === federatedholonId
        );
        const existingMsg =
          existingMsgIndex > -1
            ? federatedMessages.messages[existingMsgIndex]
            : null;

        try {
          if (existingMsg) {
            console.log(
              `[handleFederatedAnnouncements] Updating existing announcement ${existingMsg.messageId} in chat ${federatedholonId}`
            );
            // Update existing message
            const originalHolonName = await utils.getHolonName(
              this.db,
              announcement.chat,
              ctx
            );
            const hologramMessageText = this.createAnnouncementMessage(
              announcement,
              language,
              originalHolonName
            );

            await ctx.telegram
              .editMessageText(
                federatedholonId,
                existingMsg.messageId,
                null,
                hologramMessageText,
                { parse_mode: 'Markdown' }
              )
              .catch(err =>
                console.error(
                  `Error updating federated announcement in ${federatedholonId}:`,
                  err
                )
              );
          } else {
            console.log(
              `[handleFederatedAnnouncements] Creating new federated announcement in chat ${federatedholonId}`
            );
            // Create new announcement message
            const originalHolonName = await utils.getHolonName(
              this.db,
              announcement.chat,
              ctx
            );
            const hologramMessageText = this.createAnnouncementMessage(
              announcement,
              language,
              originalHolonName
            );

            const newMessage = await ctx.telegram.sendMessage(
              federatedholonId,
              hologramMessageText,
              { parse_mode: 'Markdown' }
            );

            console.log(
              `[handleFederatedAnnouncements] Created new federated announcement ${newMessage.message_id} in chat ${federatedholonId}`
            );

            // Store the new message information
            federatedMessages.messages.push({
              holonId: federatedholonId,
              messageId: newMessage.message_id,
              timestamp: Date.now(),
            });
          }
        } catch (error) {
          console.error(
            `[handleFederatedAnnouncements] Failed to handle announcement in federated chat ${federatedholonId}:`,
            error
          );
          // If we've failed to update an existing message, remove it from tracking
          if (existingMsgIndex > -1) {
            federatedMessages.messages.splice(existingMsgIndex, 1);
          }
        }
      }

      // Save the updated federation message tracking information
      if (federatedMessages.messages.length > 0) {
        await this.db.putGlobal('federation_messages', federatedMessages);
        console.log(
          `[handleFederatedAnnouncements] Saved federation tracking for ${federatedMessages.messages.length} messages`
        );
      }
    } catch (error) {
      console.error(
        '[handleFederatedAnnouncements] Error handling federated announcements:',
        error
      );
    }
  }

  createAnnouncementMessage(announcement, language, originalHolonName = null) {
    const userDisplayName =
      announcement.user.first_name || announcement.user.username || 'Unknown';
    const dateStr = new Date(announcement.created ?? announcement.date).toLocaleString();

    let message = `📢 *${utils.i18next.t('announcement', { lng: language, defaultValue: 'Announcement' })}*\n\n`;
    message += `${announcement.content}\n\n`;
    message += `👤 ${userDisplayName}\n`;
    message += `📅 ${dateStr}\n`;

    // Only show "Linked from" for federated messages
    if (originalHolonName) {
      message += `🔗 ${utils.i18next.t('linked_view', { lng: language, holonName: originalHolonName, defaultValue: `Linked from ${originalHolonName}` })}\n`;
    }

    return message;
  }
}

export default Announcements;
