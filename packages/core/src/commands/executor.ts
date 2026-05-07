// @holons/core/commands — executor
//
// Thin wrapper that resolves a command from the registry, runs `validate` if
// present, invokes `execute`, and normalises any thrown error into a failure
// `CommandResult`. UIs should call this rather than touching commands directly
// so error handling stays consistent.

import { commandRegistry, CommandRegistry } from './registry.js';
import type { CommandContext, CommandError, CommandResult, CoreCommand } from './types.js';

export interface ExecuteOptions {
	/** Override the registry (defaults to the shared singleton). */
	registry?: CommandRegistry;
}

export async function executeCommand<TResult = unknown>(
	name: string,
	params: unknown,
	ctx: CommandContext = {},
	options: ExecuteOptions = {}
): Promise<CommandResult<TResult>> {
	const registry = options.registry ?? commandRegistry;
	const command = registry.get(name);

	if (!command) {
		return failure(name, {
			code: 'unknown_command',
			message: `No command registered with name "${name}"`
		});
	}

	if (typeof command.validate === 'function') {
		try {
			const result = command.validate(params);
			if (result && typeof result === 'object' && 'code' in result) {
				return failure(name, result as CommandError);
			}
		} catch (err) {
			return failure(name, normaliseError('invalid_params', err));
		}
	}

	try {
		const data = (await (command as CoreCommand<unknown, TResult>).execute(params, ctx)) as TResult;
		return { ok: true, command: name, data };
	} catch (err) {
		return failure(name, normaliseError('execution_failed', err));
	}
}

function failure(command: string, error: CommandError): CommandResult<never> {
	return { ok: false, command, error };
}

function normaliseError(code: CommandError['code'], err: unknown): CommandError {
	if (err instanceof Error) {
		return { code, message: err.message, details: err };
	}
	return { code, message: String(err), details: err };
}
