// @holons/core/commands — tests
//
// Cover the registry/executor contract end-to-end without depending on
// sibling domain modules (which other Phase B units own). Built-in commands
// are also exercised: validation paths run in-process, while the execute path
// is asserted to fail loudly with a "TODO: depends on @holons/core/<X>" error
// while the upstream domains are still placeholders.

import { describe, expect, it } from 'vitest';
import {
	CommandRegistry,
	addToShoppingListCommand,
	commandRegistry,
	createTaskCommand,
	executeCommand,
	installBuiltInCommands,
	logHoursCommand,
	type CoreCommand
} from './index.js';

describe('CommandRegistry', () => {
	it('registers and looks up commands by name', () => {
		const reg = new CommandRegistry();
		const cmd: CoreCommand = { name: 'noop', execute: () => 'ok' };
		reg.register(cmd);
		expect(reg.has('noop')).toBe(true);
		expect(reg.get('noop')).toBe(cmd);
		expect(reg.list()).toEqual(['noop']);
		expect(reg.size).toBe(1);
	});

	it('rejects duplicate registrations but allows replace()', () => {
		const reg = new CommandRegistry();
		const a: CoreCommand = { name: 'x', execute: () => 1 };
		const b: CoreCommand = { name: 'x', execute: () => 2 };
		reg.register(a);
		expect(() => reg.register(b)).toThrow(/duplicate command/);
		reg.replace(b);
		expect(reg.get('x')).toBe(b);
	});

	it('rejects nameless commands', () => {
		const reg = new CommandRegistry();
		expect(() =>
			reg.register({ name: '', execute: () => null } as unknown as CoreCommand)
		).toThrow(/non-empty name/);
	});

	it('shared singleton has the three built-ins installed', () => {
		installBuiltInCommands(); // idempotent
		for (const name of ['createTask', 'logHours', 'addToShoppingList']) {
			expect(commandRegistry.has(name)).toBe(true);
		}
	});
});

describe('executeCommand', () => {
	it('returns unknown_command for unregistered names', async () => {
		const reg = new CommandRegistry();
		const result = await executeCommand('nope', {}, {}, { registry: reg });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe('unknown_command');
	});

	it('runs validate before execute and surfaces invalid_params', async () => {
		const reg = new CommandRegistry();
		reg.register({
			name: 'needsTitle',
			validate: (p) =>
				p && typeof (p as { title?: unknown }).title === 'string'
					? true
					: { code: 'invalid_params', message: 'title required' },
			execute: () => 'never reached'
		});
		const bad = await executeCommand('needsTitle', {}, {}, { registry: reg });
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error.code).toBe('invalid_params');

		const good = await executeCommand('needsTitle', { title: 'hi' }, {}, { registry: reg });
		expect(good.ok).toBe(true);
		if (good.ok) expect(good.data).toBe('never reached');
	});

	it('wraps thrown errors from execute as execution_failed', async () => {
		const reg = new CommandRegistry();
		reg.register({
			name: 'boom',
			execute: () => {
				throw new Error('kaboom');
			}
		});
		const result = await executeCommand('boom', {}, {}, { registry: reg });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('execution_failed');
			expect(result.error.message).toBe('kaboom');
		}
	});

	it('passes context through to execute', async () => {
		const reg = new CommandRegistry();
		let seen: unknown;
		reg.register({
			name: 'ctxEcho',
			execute: (_p, ctx) => {
				seen = ctx;
				return ctx.userId;
			}
		});
		const result = await executeCommand(
			'ctxEcho',
			{},
			{ userId: 'u1', source: 'text' },
			{ registry: reg }
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data).toBe('u1');
		expect((seen as { source?: string }).source).toBe('text');
	});
});

describe('built-in commands', () => {
	it('createTask validates required params', () => {
		expect(createTaskCommand.validate?.({})).toMatchObject({ code: 'invalid_params' });
		expect(createTaskCommand.validate?.({ holonId: 'h1', title: 't1' })).toBeFalsy();
	});

	it('logHours rejects non-numeric hours', () => {
		const v = logHoursCommand.validate?.({
			holonId: 'h',
			taskId: 't',
			userId: 'u',
			hours: 'lots'
		});
		expect(v).toMatchObject({ code: 'invalid_params' });
	});

	it('addToShoppingList accepts optional quantity', () => {
		expect(addToShoppingListCommand.validate?.({ holonId: 'h', name: 'apples' })).toBeFalsy();
		expect(
			addToShoppingListCommand.validate?.({ holonId: 'h', name: 'apples', quantity: 3 })
		).toBeFalsy();
		expect(
			addToShoppingListCommand.validate?.({ holonId: 'h', name: 'apples', quantity: -1 })
		).toMatchObject({ code: 'invalid_params' });
	});

	it('createTask execute fails loudly while @holons/core/tasks is a placeholder', async () => {
		const result = await executeCommand('createTask', { holonId: 'h', title: 't' });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('execution_failed');
			expect(result.error.message).toMatch(/TODO: depends on @holons\/core\/tasks/);
		}
	});
});
