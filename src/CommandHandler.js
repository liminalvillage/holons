/**
 * @fileoverview Command registration and dispatch handler.
 * @module src/CommandHandler
 */

/**
 * Dynamic command handler for registering and dispatching bot commands.
 *
 * @class CommandHandler
 * @description Provides a centralized registry for bot commands with
 * dynamic registration and dispatch. Commands can be registered at
 * runtime and executed by name.
 *
 * @property {Object} commands - Map of command names to handler functions
 *
 * @example
 * const handler = new CommandHandler();
 * handler.registerCommand('hello', (ctx) => ctx.reply('Hello!'));
 * await handler.handleCommand(ctx, 'hello', []);
 */
class CommandHandler {
    constructor() {
        /** @type {Object.<string, Function>} */
        this.commands = {};
    }

    /**
     * Register a command handler
     * @param {string} command - Command name
     * @param {Function} handler - Handler function
     */
    registerCommand(command, handler) {
        this.commands[command] = handler;
    }

    /**
     * Execute a registered command
     * @param {Object} ctx - Telegraf context
     * @param {string} commandName - Command to execute
     * @param {Array} args - Command arguments
     * @returns {Promise<void>}
     */
    async handleCommand(ctx, commandName, args) {
        if (this.commands[commandName]) {
            await this.commands[commandName](ctx, ...args);
        } else {
            console.error(`Command ${commandName} not found.`);
        }
    }
}
