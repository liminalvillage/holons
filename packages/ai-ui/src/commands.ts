// FALLBACK: depends on Unit 15 (core/commands)
//
// Identical-by-design shape to packages/text-ui/src/commands.ts so a future
// extraction into `@holons/core/commands` is a no-op. Until then, both
// packages keep their own copy to avoid a cross-package dependency on a
// not-yet-published module.

export interface CoreCommandParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface CoreCommand {
  name: string;
  description: string;
  params: CoreCommandParam[];
  execute(params: Record<string, unknown>): Promise<{
    ok: boolean;
    message?: string;
    data?: unknown;
  }>;
}

export interface CommandRegistry {
  list(): CoreCommand[];
  get(name: string): CoreCommand | undefined;
}

// FALLBACK: depends on Unit 15 (core/commands)
const fallbackCommands: CoreCommand[] = [
  {
    name: 'createTask',
    description: 'Create a new task in a holon.',
    params: [
      { name: 'holonId', type: 'string', description: 'Holon (community) ID', required: true },
      { name: 'title', type: 'string', description: 'Task title', required: true },
      { name: 'description', type: 'string', description: 'Task details' },
    ],
    async execute(params) {
      return { ok: true, message: `Task "${params.title}" created in ${params.holonId}`, data: params };
    },
  },
  {
    name: 'logHours',
    description: 'Log hours worked against a task.',
    params: [
      { name: 'taskId', type: 'string', description: 'Task ID', required: true },
      { name: 'hours', type: 'number', description: 'Hours worked', required: true },
      { name: 'note', type: 'string', description: 'Optional note' },
    ],
    async execute(params) {
      return { ok: true, message: `Logged ${params.hours}h on ${params.taskId}`, data: params };
    },
  },
  {
    name: 'addToShoppingList',
    description: 'Add an item to a holon shopping list.',
    params: [
      { name: 'holonId', type: 'string', description: 'Holon ID', required: true },
      { name: 'item', type: 'string', description: 'Item name', required: true },
      { name: 'quantity', type: 'number', description: 'Quantity' },
    ],
    async execute(params) {
      return { ok: true, message: `Added ${params.item} to ${params.holonId} shopping list`, data: params };
    },
  },
];

const fallbackRegistry: CommandRegistry = {
  list: () => fallbackCommands,
  get: (name) => fallbackCommands.find((c) => c.name === name),
};

export async function loadRegistry(): Promise<CommandRegistry> {
  try {
    // FALLBACK: depends on Unit 15 (core/commands)
    const mod: unknown = await import(
      /* @vite-ignore */ '@holons/core/commands' as string
    );
    const candidate = (mod as { registry?: CommandRegistry; default?: CommandRegistry })
      .registry ?? (mod as { default?: CommandRegistry }).default;
    if (candidate && typeof candidate.list === 'function' && typeof candidate.get === 'function') {
      return candidate;
    }
  } catch {
    /* fall through to stub */
  }
  return fallbackRegistry;
}

/** Synchronous stub registry — useful for tests that can't await. */
export function getFallbackRegistry(): CommandRegistry {
  return fallbackRegistry;
}
