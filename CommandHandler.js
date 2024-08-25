class CommandHandler {
    constructor() {
        this.commands = {};
    }

    registerCommand(command, handler) {
        this.commands[command] = handler;
    }

    async handleCommand(ctx, commandName, args) {
        if (this.commands[commandName]) {
            await this.commands[commandName](ctx, ...args);
        } else {
            console.error(`Command ${commandName} not found.`);
        }
    }
}
