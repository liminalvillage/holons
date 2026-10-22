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
	recordStockCommand,
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

	it('shared singleton has the built-ins installed', () => {
		installBuiltInCommands(); // idempotent
		for (const name of ['createTask', 'logHours', 'addToShoppingList', 'stockShelf', 'recordStock']) {
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

describe('stock commands', () => {
	function memoryStore() {
		const lenses = new Map<string, Map<string, Record<string, unknown>>>();
		const key = (h: string, l: string) => `${h}/${l}`;
		return {
			puts: [] as Array<{ lens: string; value: Record<string, unknown> }>,
			async getAll(h: string, l: string) {
				return [...(lenses.get(key(h, l))?.values() ?? [])];
			},
			async put(h: string, l: string, value: Record<string, unknown>) {
				if (!lenses.has(key(h, l))) lenses.set(key(h, l), new Map());
				lenses.get(key(h, l))!.set(String(value.id), value);
				this.puts.push({ lens: l, value });
			}
		};
	}

	it('recordStock validates kind and quantity', () => {
		expect(recordStockCommand.validate?.({ holonId: 'h', item: 'Flour', kind: 'eat', quantity: 1 })).toMatchObject({
			code: 'invalid_params'
		});
		expect(recordStockCommand.validate?.({ holonId: 'h', item: 'Flour', kind: 'add', quantity: -1 })).toMatchObject({
			code: 'invalid_params'
		});
		expect(recordStockCommand.validate?.({ holonId: 'h', item: 'Flour', kind: 'add', quantity: 2 })).toBeFalsy();
	});

	it('creates the item on a first add, folds later movements, and reads back the shelf', async () => {
		const store = memoryStore();
		const ctx = { holosphere: store, userId: 'u1', userName: 'ada' };
		const first = await executeCommand(
			'recordStock',
			{ holonId: 'h', item: 'Flour', kind: 'add', quantity: 10, unit: 'kg', category: 'food' },
			ctx
		);
		expect(first.ok).toBe(true);
		if (first.ok) expect(first.data).toMatchObject({ item: 'flour', created: true, onhand: 10 });
		expect(store.puts.map((p) => p.lens)).toEqual(['stock', 'rea_events']);

		const used = await executeCommand('recordStock', { holonId: 'h', item: 'flour', kind: 'use', quantity: 2.5 }, ctx);
		if (used.ok) expect(used.data).toMatchObject({ onhand: 7.5, created: false });
		const counted = await executeCommand('recordStock', { holonId: 'h', item: 'Flour', kind: 'count', quantity: 6 }, ctx);
		if (counted.ok) expect(counted.data).toMatchObject({ onhand: 6 });
		const same = await executeCommand('recordStock', { holonId: 'h', item: 'Flour', kind: 'count', quantity: 6 }, ctx);
		if (same.ok) expect(same.data).toMatchObject({ unchanged: true });

		const unknown = await executeCommand('recordStock', { holonId: 'h', item: 'Rice', kind: 'use', quantity: 1 }, ctx);
		expect(unknown.ok).toBe(false);

		const shelf = await executeCommand('stockShelf', { holonId: 'h' }, ctx);
		expect(shelf.ok).toBe(true);
		if (shelf.ok)
			expect(shelf.data).toEqual({
				items: [
					{ id: 'flour', name: 'Flour', category: 'food', unit: 'kg', onhand: 6, reserved: 0, incoming: 0, target: null, min: null }
				],
				reorder: []
			});
	});
});
