// @holons/core/commands — registry
//
// In-memory registry mapping command name → CoreCommand. Exposes a default
// singleton (`commandRegistry`) that built-ins register themselves on, plus the
// class for tests/UIs that want isolated registries.

import type { CoreCommand } from './types.js';

export class CommandRegistry {
	#commands = new Map<string, CoreCommand>();

	/** Register a command. Throws if `name` is already taken (use `replace` to override). */
	register(command: CoreCommand): void {
		if (!command || typeof command.name !== 'string' || command.name.length === 0) {
			throw new Error('CommandRegistry.register: command must have a non-empty name');
		}
		if (this.#commands.has(command.name)) {
			throw new Error(
				`CommandRegistry.register: duplicate command "${command.name}" (use replace() to override)`
			);
		}
		this.#commands.set(command.name, command as CoreCommand);
	}

	/** Register or replace a command. */
	replace(command: CoreCommand): void {
		this.#commands.set(command.name, command as CoreCommand);
	}

	/** Look up a command by name; returns undefined if absent. */
	get(name: string): CoreCommand | undefined {
		return this.#commands.get(name);
	}

	has(name: string): boolean {
		return this.#commands.has(name);
	}

	/** List registered command names (sorted for stable output). */
	list(): string[] {
		return Array.from(this.#commands.keys()).sort();
	}

	/** All registered commands, sorted by name. */
	all(): CoreCommand[] {
		return this.list().map((n) => this.#commands.get(n)!);
	}

	/** Remove a command (mainly for tests). */
	unregister(name: string): boolean {
		return this.#commands.delete(name);
	}

	/** Wipe all commands (mainly for tests). */
	clear(): void {
		this.#commands.clear();
	}

	get size(): number {
		return this.#commands.size;
	}
}

/** Default shared registry. Built-ins register themselves here. */
export const commandRegistry = new CommandRegistry();
