/**
 * Signal Diagnostics Module that provides diagnostic commands and utilities
 * to help debug signal issues in the HolonsBot system.
 *
 * @class SignalDiagnostics
 * @module core/SignalDiagnostics
 * @description Provides admin-only commands for debugging signal registration,
 * testing signal patterns, validating required signals, and exporting registry data.
 *
 * @property {Object} bot - The Telegraf bot instance
 * @property {SignalManager} signalManager - The signal manager to diagnose
 *
 * @example
 * const diagnostics = new SignalDiagnostics(bot, signalManager);
 * // Admin can now use /signals_debug, /test_signal, etc.
 */

import { log } from '../utils/logger.js';

export default class SignalDiagnostics {
    /**
     * Creates a new SignalDiagnostics instance and registers diagnostic commands.
     * @constructor
     * @param {Object} bot - The Telegraf bot instance
     * @param {SignalManager} signalManager - The signal manager to diagnose
     */
    constructor(bot, signalManager) {
        this.bot = bot;
        this.signalManager = signalManager;

        this.registerDiagnosticCommands();
    }

    /**
     * Registers all diagnostic commands with the bot (admin only).
     * Commands include: /signals_debug, /test_signal, /reset_signals, /export_signals, /validate_signals
     * @private
     * @returns {void}
     */
    registerDiagnosticCommands() {
        // Command to show signal diagnostics
        this.bot.command('signals_debug', async (ctx) => {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('This command is for administrators only.');
            }
            
            const diagnostics = this.signalManager.getDiagnostics();
            
            let message = '📊 **Signal Diagnostics**\n\n';
            message += `Total Registered Signals: ${diagnostics.totalSignals}\n`;
            message += `Modules with Signals: ${Object.keys(diagnostics.byModule).length}\n\n`;
            
            message += '**Signals by Module:**\n';
            for (const [module, signals] of Object.entries(diagnostics.byModule)) {
                message += `\n📦 ${module} (${signals.length} signals)\n`;
                // Show first 3 signals as examples
                signals.slice(0, 3).forEach(signal => {
                    const pattern = signal.pattern.replace(/regex:|string:/, '').substring(0, 30);
                    message += `  • ${pattern}...\n`;
                });
                if (signals.length > 3) {
                    message += `  • ... and ${signals.length - 3} more\n`;
                }
            }
            
            if (diagnostics.conflicts.length > 0) {
                message += '\n⚠️ **Conflicts Detected:**\n';
                diagnostics.conflicts.forEach(conflict => {
                    message += `• Pattern "${conflict.pattern}" used by: ${conflict.modules.join(', ')}\n`;
                });
            }
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
        });

        // Command to test a specific signal
        this.bot.command('test_signal', async (ctx) => {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('This command is for administrators only.');
            }
            
            const args = ctx.message.text.split(' ').slice(1).join(' ');
            if (!args) {
                return ctx.reply('Usage: /test_signal <callback_data>\nExample: /test_signal view_original_quest_123_456');
            }
            
            const matches = this.signalManager.findMatchingPatterns(args);
            
            if (matches.length === 0) {
                return ctx.reply(`❌ No handlers found for signal: "${args}"`);
            }
            
            let message = `✅ Found ${matches.length} handler(s) for signal: "${args}"\n\n`;
            matches.forEach((match, index) => {
                message += `${index + 1}. Module: ${match.module}\n`;
                message += `   Pattern: ${match.pattern}\n`;
                message += `   Priority: ${match.priority}\n\n`;
            });
            
            message += `\n🎯 The handler with highest priority (${matches[0].priority}) from module "${matches[0].module}" will be executed.`;
            
            await ctx.reply(message);
        });

        // Command to clear and re-register signals for a module
        this.bot.command('reset_signals', async (ctx) => {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('This command is for administrators only.');
            }
            
            const args = ctx.message.text.split(' ').slice(1);
            const moduleName = args[0];
            
            if (!moduleName) {
                return ctx.reply('Usage: /reset_signals <module_name>\nExample: /reset_signals Quests');
            }
            
            const cleared = this.signalManager.clearModuleActions(moduleName);
            await ctx.reply(`Cleared ${cleared} signals for module ${moduleName}. Module will need to re-register its handlers.`);
        });

        // Command to export signal registry
        this.bot.command('export_signals', async (ctx) => {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('This command is for administrators only.');
            }
            
            const registry = this.signalManager.exportRegistry();
            const json = JSON.stringify(registry, null, 2);
            
            // Send as a file
            await ctx.replyWithDocument({
                source: Buffer.from(json),
                filename: `signal_registry_${Date.now()}.json`
            }, {
                caption: `Signal Registry Export\nTotal Signals: ${registry.length}`
            });
        });

        // Command to validate required signals
        this.bot.command('validate_signals', async (ctx) => {
            if (!await this.isAdmin(ctx)) {
                return ctx.reply('This command is for administrators only.');
            }
            
            const { REQUIRED_SIGNALS } = await import('./SignalManager.js');
            const validation = this.signalManager.validateSignals(REQUIRED_SIGNALS);
            
            let message = '🔍 **Signal Validation Results**\n\n';
            
            if (validation.valid) {
                message += '✅ All required signals are properly registered!\n';
            } else {
                if (validation.missing.length > 0) {
                    message += '❌ **Missing Signals:**\n';
                    validation.missing.forEach(signal => {
                        const pattern = signal.pattern.toString().substring(0, 50);
                        message += `• ${pattern} (expected in ${signal.expectedModule})\n`;
                    });
                }
                
                if (validation.conflicts.length > 0) {
                    message += '\n⚠️ **Module Conflicts:**\n';
                    validation.conflicts.forEach(conflict => {
                        const pattern = conflict.signal.pattern.toString().substring(0, 50);
                        message += `• ${pattern}\n`;
                        message += `  Expected: ${conflict.signal.expectedModule}\n`;
                        message += `  Actual: ${conflict.actual}\n`;
                    });
                }
            }
            
            await ctx.reply(message, { parse_mode: 'Markdown' });
        });

        // Auto-diagnostic on signal registration issues
        this.bot.on('callback_query', async (ctx, next) => {
            const data = ctx.callbackQuery.data;
            
            // Log signal context in debug mode
            if (process.env.SIGNAL_DEBUG === 'true') {
                this.signalManager.logSignalsForContext(ctx);
            }
            
            // Check if this is a known problematic pattern
            if (data && data.startsWith('view_original_quest_')) {
                const matches = this.signalManager.findMatchingPatterns(data);
                if (matches.length === 0) {
                    log.error('No handler found for view_original_quest signal:', {
                        data,
                        holonId: ctx.callbackQuery.message.chat.id,
                        userId: ctx.callbackQuery.from.id
                    });
                    
                    // Notify admin if configured
                    if (process.env.SIGNAL_ALERT_ADMIN) {
                        await this.notifyAdmin(
                            `⚠️ Signal handler missing!\n\nSignal: ${data}\nUser: ${ctx.callbackQuery.from.id}\nChat: ${ctx.callbackQuery.message.chat.id}`
                        );
                    }
                }
            }
            
            return next();
        });
    }

    /**
     * Checks if the current user is a bot administrator.
     * @async
     * @private
     * @param {Object} ctx - Telegraf context
     * @returns {Promise<boolean>} True if user is admin
     */
    async isAdmin(ctx) {
        const userId = ctx.from?.id;
        const adminIds = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id)) || [];
        return adminIds.includes(userId);
    }

    /**
     * Sends a notification message to the admin chat.
     * @async
     * @private
     * @param {string} message - The message to send
     * @returns {Promise<void>}
     */
    async notifyAdmin(message) {
        const adminholonId = process.env.ADMIN_CHAT_ID;
        if (adminholonId) {
            try {
                await this.bot.telegram.sendMessage(adminholonId, message);
            } catch (error) {
                log.error('Failed to notify admin:', error);
            }
        }
    }

    /**
     * Generates a detailed report of signal health including statistics and recommendations.
     * @async
     * @returns {Promise<{timestamp: string, health: string, statistics: Object, modules: Object, conflicts: Array, missingSignals: Array, recommendations: Array}>} Health report
     */
    async generateHealthReport() {
        const diagnostics = this.signalManager.getDiagnostics();
        const { REQUIRED_SIGNALS } = await import('./SignalManager.js');
        const validation = this.signalManager.validateSignals(REQUIRED_SIGNALS);
        
        return {
            timestamp: new Date().toISOString(),
            health: validation.valid ? 'healthy' : 'unhealthy',
            statistics: {
                totalSignals: diagnostics.totalSignals,
                moduleCount: Object.keys(diagnostics.byModule).length,
                conflictCount: diagnostics.conflicts.length,
                missingRequired: validation.missing.length
            },
            modules: diagnostics.byModule,
            conflicts: diagnostics.conflicts,
            missingSignals: validation.missing,
            recommendations: this.generateRecommendations(diagnostics, validation)
        };
    }

    /**
     * Generates recommendations based on diagnostic and validation results.
     * @private
     * @param {Object} diagnostics - Diagnostics data from SignalManager
     * @param {Object} validation - Validation results from SignalManager
     * @returns {Array<{severity: string, issue: string, action: string}>} Array of recommendations
     */
    generateRecommendations(diagnostics, validation) {
        const recommendations = [];
        
        if (validation.missing.length > 0) {
            recommendations.push({
                severity: 'high',
                issue: 'Missing required signals',
                action: 'Ensure all modules are properly initialized and registering their handlers'
            });
        }
        
        if (diagnostics.conflicts.length > 0) {
            recommendations.push({
                severity: 'medium',
                issue: 'Signal conflicts detected',
                action: 'Review conflicting patterns and use priority system or unique patterns'
            });
        }
        
        // Check for modules with too many signals
        for (const [module, signals] of Object.entries(diagnostics.byModule)) {
            if (signals.length > 50) {
                recommendations.push({
                    severity: 'low',
                    issue: `Module ${module} has ${signals.length} signals`,
                    action: 'Consider breaking down the module or optimizing signal patterns'
                });
            }
        }
        
        return recommendations;
    }
}

/**
 * Factory function to create and initialize a SignalDiagnostics instance.
 * @param {Object} bot - The Telegraf bot instance
 * @param {SignalManager} signalManager - The signal manager to diagnose
 * @returns {SignalDiagnostics} A new SignalDiagnostics instance
 */
export function createSignalDiagnostics(bot, signalManager) {
    return new SignalDiagnostics(bot, signalManager);
}

