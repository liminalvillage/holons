// @holons/core/commands — built-in commands
//
// Three example commands wired end-to-end so text-ui (Unit 19) and ai-ui (Unit
// 20) have something concrete to call. Each delegates to a sibling
// `@holons/core/<domain>` module via dynamic relative import so we don't hard-
// fail typecheck/build if the sibling unit hasn't landed yet — instead we
// throw a clear "TODO: depends on @holons/core/<X> (Unit Y)" at execute time.

import { commandRegistry } from './registry.js';
import type { CommandContext, CommandError, CoreCommand } from './types.js';

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

export interface CreateTaskParams {
	holonId: string;
	title: string;
	description?: string;
	location?: string;
}

export const createTaskCommand: CoreCommand<CreateTaskParams, unknown> = {
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
		const mod = await loadDomain('tasks', 'Unit 7');
		const fn = pickFn(mod, ['createTask', 'addTask', 'create'], 'tasks', 'Unit 7');
		return await fn(params, ctx);
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
	installed = true;
}

installBuiltInCommands();
