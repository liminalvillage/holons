/**
 * Centralized Signal Manager for HolonsBot that manages all bot signals (actions/callbacks)
 * to prevent conflicts and ensure signals work consistently across all modules.
 *
 * @class SignalManager
 * @module core/SignalManager
 * @description Solves the following problems:
 * - Multiple modules registering overlapping action patterns
 * - Actions not working when modules are loaded in different orders
 * - Lost action handlers when modules are reinitialized
 * - Difficulty debugging which module handles which signal
 *
 * @property {Object} bot - The Telegraf bot instance
 * @property {Map<string, Object>} registeredActions - Map of pattern keys to action metadata
 * @property {string[]} actionPatterns - Array to maintain order of registered patterns
 * @property {boolean} debugMode - Whether debug logging is enabled
 * @property {Map<string, number>} patternSpecificity - Map of patterns to their specificity scores
 *
 * @example
 * const signalManager = new SignalManager(bot);
 * signalManager.registerAction(/view_quest_(.+)/, handler, 'Quests', 10);
 */

import { log } from '../utils/logger.js';

export default class SignalManager {
    /**
     * Creates a new SignalManager instance and intercepts bot.action registrations.
     * @constructor
     * @param {Object} bot - The Telegraf bot instance to manage signals for
     */
    constructor(bot) {
        this.bot = bot;
        this.registeredActions = new Map();
        this.actionPatterns = [];
        this.debugMode = process.env.SIGNAL_DEBUG === 'true';

        this.interceptBotAction();

        this.patternSpecificity = new Map();
    }

    /**
     * Intercepts the bot.action method to centrally manage all action handlers.
     * @private
     * @returns {void}
     */
    interceptBotAction() {
        const originalAction = this.bot.action.bind(this.bot);
        
        this.bot.action = (pattern, handler) => {
            // Get the calling module from the stack trace
            const callerModule = this.getCallerModule();
            
            // Register the action in our central registry
            this.registerAction(pattern, handler, callerModule);
            
            // Still register with the bot, but we track it
            return originalAction(pattern, handler);
        };
    }

    /**
     * Registers an action handler with metadata including priority and specificity.
     * @param {RegExp|string} pattern - The pattern to match callback data against
     * @param {Function} handler - The handler function to call when pattern matches
     * @param {string} [module='unknown'] - The name of the module registering the action
     * @param {number} [priority=0] - Priority for conflict resolution (higher wins)
     * @returns {void}
     */
    registerAction(pattern, handler, module = 'unknown', priority = 0) {
        const patternKey = this.getPatternKey(pattern);
        
        // Calculate pattern specificity (more specific patterns should win)
        const specificity = this.calculatePatternSpecificity(pattern);
        
        // Check for conflicts
        if (this.registeredActions.has(patternKey)) {
            const existing = this.registeredActions.get(patternKey);
            
            // Use specificity to determine priority if priorities are equal
            const effectivePriority = priority === existing.priority ? 
                (specificity > existing.specificity ? priority + 1 : priority) : priority;
            
            const conflictInfo = {
                pattern: patternKey,
                existingModule: existing.module,
                newModule: module,
                existingSpecificity: existing.specificity,
                newSpecificity: specificity,
                resolution: effectivePriority > existing.priority ? 'new wins' : 'existing wins'
            };
            log.warn(`Signal conflict detected: ${patternKey} - ${existing.module} vs ${module} -> ${conflictInfo.resolution}`, conflictInfo);
            
            // Only override if new effective priority is higher
            if (effectivePriority <= existing.priority) {
                return;
            }
            
            priority = effectivePriority;
        }
        
        // Store the action metadata
        this.registeredActions.set(patternKey, {
            pattern,
            handler,
            module,
            priority,
            specificity,
            registeredAt: new Date().toISOString()
        });
        
        // Maintain pattern order for debugging
        if (!this.actionPatterns.includes(patternKey)) {
            this.actionPatterns.push(patternKey);
        }
        
        if (this.debugMode) {
            log.debug(`Action registered:`, {
                pattern: patternKey,
                module,
                priority,
                totalActions: this.registeredActions.size
            });
        }
    }

    /**
     * Creates a unique key for a pattern for use in the registry.
     * @param {RegExp|string} pattern - The pattern to create a key for
     * @returns {string} A unique key string (prefixed with 'regex:' or 'string:')
     */
    getPatternKey(pattern) {
        if (pattern instanceof RegExp) {
            return `regex:${pattern.source}`;
        }
        return `string:${pattern}`;
    }

    /**
     * Calculates pattern specificity score (higher = more specific patterns).
     * @param {RegExp|string} pattern - The pattern to calculate specificity for
     * @returns {number} Specificity score
     */
    calculatePatternSpecificity(pattern) {
        if (pattern instanceof RegExp) {
            const source = pattern.source;
            let specificity = 0;
            
            // More specific patterns have more literal characters
            specificity += (source.match(/[a-zA-Z_]/g) || []).length;
            
            // Specific patterns for back buttons get higher priority
            if (source.includes('back_from_')) specificity += 10;
            if (source.includes('back_to_')) specificity += 10;
            
            // Generic back pattern gets lower priority
            if (source === 'back_(.+)') specificity -= 5;
            
            return specificity;
        }
        
        // String patterns get base specificity
        return pattern.length;
    }

    /**
     * Gets the calling module name from the stack trace.
     * @private
     * @returns {string} The name of the module that called this method
     */
    getCallerModule() {
        const stack = new Error().stack;
        const lines = stack.split('\n');
        
        // Skip first 3 lines (Error, this function, interceptBotAction)
        for (let i = 3; i < lines.length; i++) {
            const line = lines[i];
            
            // Extract filename from stack trace
            const match = line.match(/at .* \((.+?):\d+:\d+\)/);
            if (match) {
                const filepath = match[1];
                const filename = filepath.split('/').pop().replace('.js', '');
                
                // Map common filenames to module names
                const moduleMap = {
                    'Quests': 'Quests',
                    'UI': 'UI',
                    'Settings': 'Settings',
                    'Scheduler': 'Scheduler',
                    'Expenses': 'Expenses',
                    'Roles': 'Roles',
                    'Checklists': 'Checklists',
                    'CapitalGame': 'CapitalGame',
                    'Shopping': 'Shopping',
                    'RSVP': 'Participation',
                    'Library': 'Library',
                    'Requests': 'Requests',
                    'Calendar': 'Calendar',
                    'Holons': 'Holons'
                };
                
                return moduleMap[filename] || filename;
            }
        }
        
        return 'unknown';
    }

    /**
     * Validates that all required signals are registered with correct modules.
     * @param {Array<{pattern: RegExp|string, expectedModule: string}>} [requiredSignals=[]] - Required signals to validate
     * @returns {{valid: boolean, missing: Array, conflicts: Array}} Validation results
     */
    validateSignals(requiredSignals = []) {
        const missing = [];
        const conflicts = [];
        
        for (const signal of requiredSignals) {
            const patternKey = this.getPatternKey(signal.pattern);
            
            if (!this.registeredActions.has(patternKey)) {
                missing.push(signal);
            } else {
                const registered = this.registeredActions.get(patternKey);
                if (registered.module !== signal.expectedModule) {
                    conflicts.push({
                        signal,
                        actual: registered.module
                    });
                }
            }
        }
        
        if (missing.length > 0) {
            log.error('Missing required signals:', missing);
        }
        
        if (conflicts.length > 0) {
            log.warn('Signal module conflicts:', conflicts);
        }
        
        return {
            valid: missing.length === 0 && conflicts.length === 0,
            missing,
            conflicts
        };
    }

    /**
     * Gets diagnostic information about all registered signals.
     * @returns {{totalSignals: number, byModule: Object, conflicts: Array, patterns: string[]}} Diagnostics data
     */
    getDiagnostics() {
        const byModule = {};
        const conflicts = [];
        const patterns = {};
        
        // Group by module
        for (const [key, info] of this.registeredActions) {
            if (!byModule[info.module]) {
                byModule[info.module] = [];
            }
            byModule[info.module].push({
                pattern: key,
                priority: info.priority,
                registeredAt: info.registeredAt
            });
            
            // Track pattern usage
            const basePattern = key.replace(/regex:|string:/, '').split('_')[0];
            if (!patterns[basePattern]) {
                patterns[basePattern] = [];
            }
            patterns[basePattern].push(info.module);
        }
        
        // Find conflicts (same base pattern in multiple modules)
        for (const [pattern, modules] of Object.entries(patterns)) {
            if (modules.length > 1) {
                conflicts.push({
                    pattern,
                    modules: [...new Set(modules)]
                });
            }
        }
        
        return {
            totalSignals: this.registeredActions.size,
            byModule,
            conflicts,
            patterns: Object.keys(patterns).sort()
        };
    }

    /**
     * Clears all registered actions for a specific module.
     * @param {string} moduleName - The name of the module whose actions to clear
     * @returns {number} The number of actions that were cleared
     */
    clearModuleActions(moduleName) {
        let cleared = 0;
        
        for (const [key, info] of this.registeredActions) {
            if (info.module === moduleName) {
                this.registeredActions.delete(key);
                cleared++;
            }
        }
        
        log.info(`Cleared ${cleared} actions for module ${moduleName}`);
        return cleared;
    }

    /**
     * Re-registers an action with higher priority to ensure it takes precedence.
     * @param {RegExp|string} pattern - The pattern to register
     * @param {Function} handler - The handler function
     * @param {string} module - The module name
     * @param {number} [priority=10] - Priority level (higher wins)
     * @returns {void}
     */
    ensureActionPriority(pattern, handler, module, priority = 10) {
        this.registerAction(pattern, handler, module, priority);
        
        // Re-register with the bot to ensure it's the active handler
        const originalAction = Object.getPrototypeOf(this.bot).action;
        originalAction.call(this.bot, pattern, handler);
    }

    /**
     * Provides a safe way for modules to register actions with conflict handling.
     * @param {string} module - The module name registering the action
     * @param {RegExp|string} pattern - The pattern to match
     * @param {Function} handler - The handler function
     * @param {Object} [options={}] - Registration options
     * @param {number} [options.priority=0] - Priority level
     * @param {boolean} [options.override=false] - Whether to override existing handlers
     * @param {boolean} [options.warnOnConflict=true] - Whether to log warnings on conflicts
     * @returns {boolean} True if registration succeeded
     */
    safeRegisterAction(module, pattern, handler, options = {}) {
        const { 
            priority = 0, 
            override = false,
            warnOnConflict = true 
        } = options;
        
        const patternKey = this.getPatternKey(pattern);
        const existing = this.registeredActions.get(patternKey);
        
        if (existing && !override) {
            if (warnOnConflict) {
                log.warn(`Action already registered for ${patternKey} by ${existing.module}`);
            }
            return false;
        }
        
        this.registerAction(pattern, handler, module, priority);
        return true;
    }

    /**
     * Debug helper to log all signals for a specific chat/context.
     * @param {Object} ctx - Telegraf context object
     * @returns {void}
     */
    logSignalsForContext(ctx) {
        if (!this.debugMode) return;
        
        const holonId = ctx.chat?.id || ctx.callbackQuery?.message?.chat?.id;
        const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;
        const callbackData = ctx.callbackQuery?.data;
        
        log.debug('Signal context:', {
            holonId,
            userId,
            callbackData,
            matchingPatterns: this.findMatchingPatterns(callbackData)
        });
    }

    /**
     * Finds all registered patterns that would match given callback data.
     * @param {string} callbackData - The callback data to match against
     * @returns {Array<{pattern: string, module: string, priority: number}>} Matching patterns sorted by priority
     */
    findMatchingPatterns(callbackData) {
        if (!callbackData) return [];
        
        const matches = [];
        
        for (const [key, info] of this.registeredActions) {
            if (key.startsWith('regex:')) {
                const pattern = new RegExp(key.replace('regex:', ''));
                if (pattern.test(callbackData)) {
                    matches.push({
                        pattern: key,
                        module: info.module,
                        priority: info.priority
                    });
                }
            } else if (key.startsWith('string:')) {
                const pattern = key.replace('string:', '');
                if (callbackData === pattern || callbackData.startsWith(pattern)) {
                    matches.push({
                        pattern: key,
                        module: info.module,
                        priority: info.priority
                    });
                }
            }
        }
        
        // Sort by priority (highest first)
        return matches.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Exports the signal registry for debugging or backup purposes.
     * @returns {Array<{pattern: string, module: string, priority: number, registeredAt: string}>} Registry entries
     */
    exportRegistry() {
        const registry = [];
        
        for (const [key, info] of this.registeredActions) {
            registry.push({
                pattern: key,
                module: info.module,
                priority: info.priority,
                registeredAt: info.registeredAt
            });
        }
        
        return registry;
    }

    /**
     * Imports a signal registry (useful for testing or recovery).
     * @param {Array<{pattern: string, module: string, priority: number, registeredAt: string}>} registry - Registry to import
     * @returns {void}
     */
    importRegistry(registry) {
        this.registeredActions.clear();
        this.actionPatterns = [];
        
        for (const entry of registry) {
            this.registeredActions.set(entry.pattern, {
                pattern: entry.pattern,
                handler: null, // Handler can't be serialized
                module: entry.module,
                priority: entry.priority,
                registeredAt: entry.registeredAt
            });
            this.actionPatterns.push(entry.pattern);
        }
        
        log.info(`Imported ${registry.length} signal registrations`);
    }
}

/**
 * Factory function to create and initialize a SignalManager instance.
 * @param {Object} bot - The Telegraf bot instance
 * @returns {SignalManager} A new SignalManager instance
 */
export function createSignalManager(bot) {
    return new SignalManager(bot);
}

/**
 * Required signals that must be registered for core functionality.
 * @constant {Array<{pattern: RegExp|string, expectedModule: string}>}
 */
export const REQUIRED_SIGNALS = [
    // Quest signals
    { pattern: /view_original_quest_(.+)/, expectedModule: 'Quests' },
    { pattern: /participate_quest_(.+)/, expectedModule: 'Quests' },
    { pattern: /complete_quest_(.+)/, expectedModule: 'Quests' },
    { pattern: /cancel_quest_(.+)/, expectedModule: 'Quests' },
    
    // Settings signals
    { pattern: 'settings', expectedModule: 'Settings' },
    { pattern: 'settings_back', expectedModule: 'Settings' },
    
    // Calendar signals
    { pattern: /calendar_/, expectedModule: 'Calendar' },
    
    // Scheduler signals
    { pattern: /schedule_quest_(.+)/, expectedModule: 'Scheduler' }
];
