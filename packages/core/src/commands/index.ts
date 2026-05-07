// @holons/core/commands — public barrel
//
// Subpath import surface for the abstract command/intent layer:
//
//   import {
//     commandRegistry,
//     executeCommand,
//     type CoreCommand,
//     type CommandContext,
//     type CommandResult
//   } from '@holons/core/commands';
//
// Importing this module also installs the built-in commands as a side effect,
// so any UI that touches the registry sees `createTask`, `logHours`, and
// `addToShoppingList` without further setup.

export type {
	CommandContext,
	CommandError,
	CommandLogger,
	CommandResult,
	CoreCommand
} from './types.js';

export { CommandRegistry, commandRegistry } from './registry.js';
export { executeCommand, type ExecuteOptions } from './executor.js';

// Re-exporting from `./built-in.js` evaluates the module, which installs the
// built-in commands on the shared registry as a side effect.
export {
	addToShoppingListCommand,
	createTaskCommand,
	installBuiltInCommands,
	logHoursCommand,
	type AddToShoppingListParams,
	type CreateTaskParams,
	type LogHoursParams
} from './built-in.js';
