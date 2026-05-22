// @holons/core/commands — tests
//
// Cover the registry/executor contract end-to-end. Built-in commands exercise
// validation in-process; createTask runs against @holons/core/tasks; other
// built-ins still fail loudly until their sibling domains ship.

import { describe, expect, it, vi } from 'vitest';
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

	it('createTask execute builds a task (persists when holosphere is in context)', async () => {
		const withoutStore = await executeCommand(
			'createTask',
			{ holonId: 'h1', title: 'My task', description: 'details' },
			{ userId: 'u1', userName: 'alice' }
		);
		expect(withoutStore.ok).toBe(true);
		if (withoutStore.ok) {
			expect(withoutStore.data.persisted).toBe(false);
			expect(withoutStore.data.task.title).toBe('My task');
			expect(withoutStore.data.task.description).toBe('details');
			expect(withoutStore.data.task.holon).toBe('h1');
			expect(withoutStore.data.task.id).toBeTruthy();
			expect(String(withoutStore.data.task.id)).not.toContain('_');
		}

		const put = vi.fn().mockResolvedValue(undefined);
		const withStore = await executeCommand(
			'createTask',
			{ holonId: 'h1', title: 'Saved' },
			{ userId: 'u1', holosphere: { put } }
		);
		expect(withStore.ok).toBe(true);
		if (withStore.ok) {
			expect(withStore.data.persisted).toBe(true);
			expect(put).toHaveBeenCalledWith('h1', 'quests', expect.objectContaining({ title: 'Saved' }));
		}
	});
});
