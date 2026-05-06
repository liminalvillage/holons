/**
 * NotificationService.js
 *
 * Handles admin notifications for booking/application submissions.
 *
 * Features:
 * - Send notifications to multiple admin IDs
 * - Different notification types (started, submitted, abandoned)
 * - HTML formatted messages with applicant info
 *
 * Usage:
 * ```javascript
 * const notificationService = new NotificationService(bot, config);
 * await notificationService.notifyAdmins('application_submitted', applicationData, ctx);
 * ```
 */

export default class NotificationService {
    /**
     * Create a new NotificationService
     * @param {Telegraf} bot - The Telegraf bot instance
     * @param {object} config - Configuration from booking.json
     */
    constructor(bot, config) {
        this.bot = bot;
        this.config = config;
    }

    /**
     * Send notification to all configured admins
     * @param {string} type - Notification type ('application_started', 'application_submitted', 'application_abandoned')
     * @param {object} data - Application data
     * @param {object} ctx - Telegraf context
     */
    async notifyAdmins(type, data, ctx) {
        const { adminNotification } = this.config.metadata || {};

        if (!adminNotification?.enabled) {
            return;
        }

        const adminIds = adminNotification.adminIds || [];

        if (adminIds.length === 0) {
            console.warn('NotificationService: No admin IDs configured');
            return;
        }

        for (const adminId of adminIds) {
            try {
                const message = this.formatNotification(type, data, ctx);
                await this.bot.telegram.sendMessage(adminId, message, {
                    parse_mode: 'HTML'
                });
            } catch (error) {
                console.error(`NotificationService: Failed to notify admin ${adminId}:`, error.message);
            }
        }
    }

    /**
     * Format notification message based on type
     * @param {string} type - Notification type
     * @param {object} data - Application data
     * @param {object} ctx - Telegraf context
     * @returns {string} - Formatted HTML message
     */
    formatNotification(type, data, ctx) {
        const userName = this.getUserDisplayName(ctx);
        const username = ctx.from?.username ? `@${ctx.from.username}` : 'No username';
        const userId = ctx.from?.id || 'Unknown';

        switch (type) {
            case 'application_started':
                return this.formatStartedNotification(userName, username, userId);

            case 'application_submitted':
                return this.formatSubmittedNotification(data, userName, username, userId);

            case 'application_abandoned':
                return this.formatAbandonedNotification(data, userName, username, userId);

            default:
                return `📬 <b>Booking Notification</b>\n\nType: ${type}\nUser: ${userName}`;
        }
    }

    /**
     * Get display name for user
     * @param {object} ctx - Telegraf context
     * @returns {string} - User's display name
     */
    getUserDisplayName(ctx) {
        if (!ctx.from) return 'Unknown User';

        const firstName = ctx.from.first_name || '';
        const lastName = ctx.from.last_name || '';

        return `${firstName} ${lastName}`.trim() || 'Unknown User';
    }

    /**
     * Format "application started" notification
     */
    formatStartedNotification(userName, username, userId) {
        return `🔔 <b>New Application Started</b>

<b>User:</b> ${this.escapeHtml(userName)}
<b>Username:</b> ${username}
<b>User ID:</b> ${userId}
<b>Started:</b> ${new Date().toISOString()}`;
    }

    /**
     * Format "application submitted" notification
     */
    formatSubmittedNotification(data, userName, username, userId) {
        let message = `✅ <b>New Application Submitted!</b>

<b>Applicant:</b> ${this.escapeHtml(userName)}
<b>Username:</b> ${username}
<b>User ID:</b> ${userId}
<b>Submitted:</b> ${new Date().toISOString()}

<b>━━━ Application Data ━━━</b>
`;

        // Add each field from the application data
        for (const [key, value] of Object.entries(data)) {
            const displayKey = this.formatFieldName(key);
            const displayValue = this.formatFieldValue(value);
            message += `\n<b>${displayKey}:</b> ${displayValue}`;
        }

        return message;
    }

    /**
     * Format "application abandoned" notification
     */
    formatAbandonedNotification(data, userName, username, userId) {
        const lastField = data.lastField || 'Unknown';
        const progress = data.progress || 0;

        return `⚠️ <b>Application Abandoned</b>

<b>User:</b> ${this.escapeHtml(userName)}
<b>Username:</b> ${username}
<b>User ID:</b> ${userId}
<b>Last Field:</b> ${lastField}
<b>Progress:</b> ${progress}%
<b>Time:</b> ${new Date().toISOString()}`;
    }

    /**
     * Format field name for display (snake_case to Title Case)
     * @param {string} key - Field key
     * @returns {string} - Formatted field name
     */
    formatFieldName(key) {
        return key
            .replace(/_/g, ' ')
            .replace(/\b\w/g, char => char.toUpperCase());
    }

    /**
     * Format field value for display
     * @param {any} value - Field value
     * @returns {string} - Formatted value
     */
    formatFieldValue(value) {
        if (value === null || value === undefined) {
            return '<i>Not provided</i>';
        }

        if (Array.isArray(value)) {
            if (value.length === 0) {
                return '<i>None selected</i>';
            }
            return this.escapeHtml(value.join(', '));
        }

        if (typeof value === 'object') {
            // Handle { value, customValue } format from single/multi select
            if (value.value) {
                if (value.customValue) {
                    return `${this.escapeHtml(value.value)}: ${this.escapeHtml(value.customValue)}`;
                }
                return this.escapeHtml(value.value);
            }
            return this.escapeHtml(JSON.stringify(value));
        }

        // Truncate long text values
        const stringValue = String(value);
        if (stringValue.length > 500) {
            return this.escapeHtml(stringValue.substring(0, 500)) + '...';
        }

        return this.escapeHtml(stringValue);
    }

    /**
     * Escape HTML special characters
     * @param {string} text - Text to escape
     * @returns {string} - Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
}
