// @holons/core/commands — built-in commands
//
// Commands wired for text-ui, ai-ui, and MCP. Each delegates to a sibling
// `@holons/core/<domain>` module via dynamic relative import. Domains that are
// not implemented yet throw a clear "TODO: depends on @holons/core/<X>" at
// execute time.

import { commandRegistry } from './registry.js';
import type { CommandContext, CommandError, CoreCommand } from './types.js';
import { createTask } from '../tasks/creation.js';
import { saveTaskToHolon } from '../tasks/persistence.js';
import type { Quest } from '../tasks/types.js';
import {
	STOCK_LENS,
	buildStockEvent,
	correctionKind,
	createStockItemSpec,
	demandsOf,
	foldStock,
	readStockItemSpecs,
	reorderList,
	reserve,
	stockItemId,
	type StockEventLike
} from '../inventory/index.js';

// ---------- shared helpers ----------

type DomainModule = Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;

function todo(domain: string, unit: string, detail: string): Error {
	return new Error(`TODO: depends on @holons/core/${domain} (${unit}) — ${detail}`);
}

/**
 * Load a sibling domain module via relative path so the import resolves
 * against the built `dist/<domain>/index.js` (or `src/<domain>/index.ts` under
 * a TS-aware loader). Throws a clear TODO error if the sibling unit hasn't
 * shipped yet so failures are loud and self-explanatory.
 */
async function loadDomain(domain: string, unit: string): Promise<DomainModule> {
	let mod: DomainModule;
	try {
		mod = (await import(`../${domain}/index.js`)) as DomainModule;
	} catch (err) {
		throw todo(
			domain,
			unit,
			`module not importable yet: ${err instanceof Error ? err.message : String(err)}`
		);
	}
	if (!mod || Object.keys(mod).length === 0) {
		throw todo(domain, unit, 'module is a placeholder (no exports)');
	}
	return mod;
}

/** Find the first export matching one of `names`; throw a TODO error otherwise. */
function pickFn(mod: DomainModule, names: string[], domain: string, unit: string): AnyFn {
	for (const n of names) {
		const candidate = mod[n];
		if (typeof candidate === 'function') return candidate as AnyFn;
	}
	throw todo(
		domain,
		unit,
		`expected exported function ${names.map((n) => `"${n}"`).join(' / ')}`
	);
}

function requireString(params: Record<string, unknown>, key: string): string {
	const v = params[key];
	if (typeof v !== 'string' || v.length === 0) {
		throw new Error(`Missing required string param "${key}"`);
	}
	return v;
}

function asObject(params: unknown): Record<string, unknown> {
	if (!params || typeof params !== 'object' || Array.isArray(params)) {
		throw new Error('Params must be an object');
	}
	return params as Record<string, unknown>;
}

/**
 * Wrap a validation function so any thrown error becomes a structured
 * `invalid_params` CommandError, matching what executor.ts already does for
 * thrown errors but keeping each command's `validate` body free of try/catch.
 */
function validateBy(
	fn: (params: Record<string, unknown>) => true | void | CommandError
): (raw: unknown) => true | void | CommandError {
	return (raw) => {
		try {
			return fn(asObject(raw));
		} catch (err) {
			return {
				code: 'invalid_params',
				message: err instanceof Error ? err.message : String(err)
			};
		}
	};
}

// ---------- createTask ----------

/** Task ids must not contain underscores (Telegram callback_data parsing). */
function generateTaskId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function initiatorFromContext(ctx: CommandContext, holonId: string): Quest['initiator'] {
	const id = ctx.userId ?? holonId;
	return {
		id,
		username: ctx.userName,
		firstName: ctx.userName
	};
}

export interface CreateTaskParams {
	holonId: string;
	title: string;
	description?: string;
	location?: string;
}

export interface CreateTaskResult {
	task: Quest;
	persisted: boolean;
}

export const createTaskCommand: CoreCommand<CreateTaskParams, CreateTaskResult> = {
	name: 'createTask',
	description: 'Create a new task in the given holon',
	paramsSchema: {
		type: 'object',
		required: ['holonId', 'title'],
		properties: {
			holonId: { type: 'string' },
			title: { type: 'string' },
			description: { type: 'string' },
			location: { type: 'string' }
		}
	},
	validate: validateBy((p) => {
		requireString(p, 'holonId');
		requireString(p, 'title');
	}),
	async execute(params, ctx: CommandContext) {
		const task = createTask({
			holonId: params.holonId,
			title: params.title,
			initiator: initiatorFromContext(ctx, params.holonId)
		});
		task.id = generateTaskId();
		if (params.description) task.description = params.description;
		if (params.location) task.location = params.location;

		let persisted = false;
		if (ctx.holosphere) {
			persisted = await saveTaskToHolon(
				ctx.holosphere as import('../tasks/types.js').HoloSphereLike,
				params.holonId,
				task
			);
		}

		return { task, persisted };
	}
};

// ---------- logHours ----------

export interface LogHoursParams {
	holonId: string;
	taskId: string;
	userId: string;
	hours: number;
}

export const logHoursCommand: CoreCommand<LogHoursParams, unknown> = {
	name: 'logHours',
	description: 'Log hours worked by a user on a task',
	paramsSchema: {
		type: 'object',
		required: ['holonId', 'taskId', 'userId', 'hours'],
		properties: {
			holonId: { type: 'string' },
			taskId: { type: 'string' },
			userId: { type: 'string' },
			hours: { type: 'number', minimum: 0 }
		}
	},
	validate: validateBy((p) => {
		requireString(p, 'holonId');
		requireString(p, 'taskId');
		requireString(p, 'userId');
		const h = p.hours;
		if (typeof h !== 'number' || !isFinite(h) || h < 0) {
			return { code: 'invalid_params', message: 'hours must be a non-negative number' };
		}
	}),
	async execute(params, ctx: CommandContext) {
		// Try scoring first (more specific), then fall back to tasks.
		let mod: DomainModule;
		let domain: 'scoring' | 'tasks' = 'scoring';
		let unit = 'Unit 5';
		try {
			mod = await loadDomain('scoring', 'Unit 5');
		} catch {
			try {
				mod = await loadDomain('tasks', 'Unit 7');
				domain = 'tasks';
				unit = 'Unit 7';
			} catch (err) {
				throw new Error(
					`TODO: depends on @holons/core/scoring (Unit 5) or @holons/core/tasks (Unit 7) — neither importable yet: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}
		}
		const fn = pickFn(mod, ['logHours', 'recordHours', 'addHours'], domain, unit);
		return await fn(params, ctx);
	}
};

// ---------- addToShoppingList ----------

export interface AddToShoppingListParams {
	holonId: string;
	name: string;
	quantity?: number;
}

export const addToShoppingListCommand: CoreCommand<AddToShoppingListParams, unknown> = {
	name: 'addToShoppingList',
	description: 'Add an item to the shopping list of the given holon',
	paramsSchema: {
		type: 'object',
		required: ['holonId', 'name'],
		properties: {
			holonId: { type: 'string' },
			name: { type: 'string' },
			quantity: { type: 'number', minimum: 0 }
		}
	},
	validate: validateBy((p) => {
		requireString(p, 'holonId');
		requireString(p, 'name');
		if (p.quantity !== undefined) {
			const q = p.quantity;
			if (typeof q !== 'number' || !isFinite(q) || q < 0) {
				return { code: 'invalid_params', message: 'quantity must be a non-negative number' };
			}
		}
	}),
	async execute(params, ctx: CommandContext) {
		const mod = await loadDomain('shopping', 'Unit 9');
		const fn = pickFn(mod, ['addToShoppingList', 'addItem', 'add'], 'shopping', 'Unit 9');
		return await fn(params, ctx);
	}
};

// ---------- stock ----------

/** The little the stock commands need from a Holosphere handle. */
interface StockStoreLike {
	getAll(holonId: string, lens: string): Promise<unknown>;
	put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}

const asArray = (raw: unknown): unknown[] =>
	Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];

async function readShelf(store: StockStoreLike, holonId: string) {
	const [specsRaw, eventsRaw, questsRaw] = await Promise.all([
		store.getAll(holonId, STOCK_LENS),
		store.getAll(holonId, 'rea_events'),
		store.getAll(holonId, 'quests')
	]);
	const specs = readStockItemSpecs(asArray(specsRaw));
	const needs = asArray(questsRaw).filter((q) => (q as { type?: string } | null)?.type === 'need');
	const demands = demandsOf(needs as Parameters<typeof demandsOf>[0], holonId);
	const levels = reserve(foldStock(asArray(eventsRaw) as StockEventLike[], holonId), demands);
	return { specs, levels, demands };
}

export interface StockShelfParams {
	holonId: string;
}

export const stockShelfCommand: CoreCommand<StockShelfParams, unknown> = {
	name: 'stockShelf',
	description:
		'What the holon keeps in stock: each item with its level on hand (folded from REA events) and what to buy to reach the restock targets',
	paramsSchema: {
		type: 'object',
		required: ['holonId'],
		properties: { holonId: { type: 'string' } }
	},
	validate: validateBy((p) => {
		requireString(p, 'holonId');
	}),
	async execute(params, ctx: CommandContext) {
		if (!ctx.holosphere) throw new Error('stockShelf needs a holosphere in the command context');
		const { specs, levels } = await readShelf(ctx.holosphere as StockStoreLike, params.holonId);
		const byItem = new Map(levels.map((l) => [l.itemId, l]));
		return {
			items: specs.map((spec) => ({
				id: spec.id,
				name: spec.name,
				category: spec.category,
				unit: spec.unit,
				onhand: byItem.get(spec.id)?.onhand ?? 0,
				reserved: byItem.get(spec.id)?.reserved ?? 0,
				incoming: byItem.get(spec.id)?.incoming ?? 0,
				target: spec.target ?? null,
				min: spec.min ?? null
			})),
			reorder: reorderList(levels, specs)
		};
	}
};

export interface RecordStockParams {
	holonId: string;
	item: string;
	/** add = came in, use = went out, count = the level observed now. */
	kind: 'add' | 'use' | 'count';
	quantity: number;
	unit?: string;
	category?: string;
	note?: string;
}

export const recordStockCommand: CoreCommand<RecordStockParams, unknown> = {
	name: 'recordStock',
	description:
		'Record a stock movement for an item the holon keeps: add (came in), use (went out) or count (what is on the shelf now). An unknown item is created on the fly for "add".',
	paramsSchema: {
		type: 'object',
		required: ['holonId', 'item', 'kind', 'quantity'],
		properties: {
			holonId: { type: 'string' },
			item: { type: 'string' },
			kind: { type: 'string', enum: ['add', 'use', 'count'] },
			quantity: { type: 'number', minimum: 0 },
			unit: { type: 'string' },
			category: { type: 'string' },
			note: { type: 'string' }
		}
	},
	validate: validateBy((p) => {
		requireString(p, 'holonId');
		requireString(p, 'item');
		const kind = requireString(p, 'kind');
		if (!['add', 'use', 'count'].includes(kind)) {
			return { code: 'invalid_params', message: 'kind must be add, use or count' };
		}
		const q = p.quantity;
		if (typeof q !== 'number' || !isFinite(q) || q < 0) {
			return { code: 'invalid_params', message: 'quantity must be a non-negative number' };
		}
	}),
	async execute(params, ctx: CommandContext) {
		if (!ctx.holosphere) throw new Error('recordStock needs a holosphere in the command context');
		const store = ctx.holosphere as StockStoreLike;
		const { specs, levels } = await readShelf(store, params.holonId);
		const id = stockItemId(params.item);
		let spec = specs.find((s) => s.id === id) ?? null;
		let created = false;
		if (!spec) {
			if (params.kind !== 'add') {
				throw new Error(
					`Unknown stock item "${params.item}"; the shelf has: ${specs.map((s) => s.name).join(', ') || 'nothing'}`
				);
			}
			spec = createStockItemSpec({
				name: params.item,
				category: params.category,
				unit: params.unit,
				createdBy: ctx.userId
			});
			await store.put(params.holonId, STOCK_LENS, spec);
			created = true;
		}
		const onhand = levels.find((l) => l.itemId === spec!.id)?.onhand ?? 0;
		let kind: 'stock:produced' | 'stock:consumed' | 'stock:raised' | 'stock:lowered';
		let quantity = params.quantity;
		if (params.kind === 'add') kind = 'stock:produced';
		else if (params.kind === 'use') kind = 'stock:consumed';
		else {
			const delta = params.quantity - onhand;
			if (Math.abs(delta) < 0.0005) return { item: spec.id, onhand, unchanged: true, created };
			kind = correctionKind(delta);
			quantity = Math.abs(delta);
		}
		if (quantity <= 0) return { item: spec.id, onhand, unchanged: true, created };
		const event = buildStockEvent({
			holonId: params.holonId,
			kind,
			itemId: spec.id,
			quantity,
			unit: spec.unit,
			actor: { id: ctx.userId ?? params.holonId, username: ctx.userName },
			note: params.note ?? null
		});
		await store.put(params.holonId, 'rea_events', event);
		const after =
			kind === 'stock:produced' || kind === 'stock:raised' ? onhand + quantity : onhand - quantity;
		return { item: spec.id, event, onhand: Math.round(after * 1000) / 1000, created };
	}
};

// ---------- registration ----------

let installed = false;

/**
 * Idempotently register the built-in commands on the shared registry.
 * Called automatically at module load (side-effect of importing `built-in.ts`),
 * but exported for tests/UIs that want to opt in explicitly.
 */
export function installBuiltInCommands(): void {
	if (installed) return;
	commandRegistry.replace(createTaskCommand as CoreCommand);
	commandRegistry.replace(logHoursCommand as CoreCommand);
	commandRegistry.replace(addToShoppingListCommand as CoreCommand);
	commandRegistry.replace(stockShelfCommand as CoreCommand);
	commandRegistry.replace(recordStockCommand as CoreCommand);
	installed = true;
}

installBuiltInCommands();
