// FALLBACK: depends on Unit 15 (core/commands)
//
// Once `@holons/core/commands` exists, this module re-exports it. Until then,
// it ships an in-package stub registry so the CLI is self-bootstrapping for
// the smoke test. The shape mirrors the target interface so consumers don't
// need to change when the real registry lands.

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

// Privacy: a lens or one card is locked (sealed on the relays) and shared
// with holons — by id or name, never by key (see @holons/core/privacy).
const PRIVACY_SCOPE: CoreCommandParam[] = [
  { name: 'holonId', type: 'string', description: 'Holon ID', required: true },
  { name: 'lens', type: 'string', description: 'Lens (quests, library, …)', required: true },
  { name: 'item', type: 'string', description: 'One card id; omit for the whole lens' },
];
fallbackCommands.push(
  {
    name: 'lock',
    description: 'Make a lens, or one card, private: only this holon and the holons it is shared with can read it.',
    params: PRIVACY_SCOPE,
    async execute(params) {
      return { ok: true, message: `Locked ${params.lens}${params.item ? `/${params.item}` : ''} of ${params.holonId}`, data: params };
    },
  },
  {
    name: 'unlock',
    description: 'Make a private lens or card public again.',
    params: PRIVACY_SCOPE,
    async execute(params) {
      return { ok: true, message: `Unlocked ${params.lens}${params.item ? `/${params.item}` : ''} of ${params.holonId}`, data: params };
    },
  },
  {
    name: 'share',
    description: 'Let another holon read a private lens or card.',
    params: [...PRIVACY_SCOPE, { name: 'with', type: 'string', description: 'The holon that may read it', required: true }],
    async execute(params) {
      return { ok: true, message: `Shared ${params.lens} of ${params.holonId} with ${params.with}`, data: params };
    },
  },
  {
    name: 'unshare',
    description: 'Stop a holon from reading a private lens or card.',
    params: [...PRIVACY_SCOPE, { name: 'with', type: 'string', description: 'The holon to remove', required: true }],
    async execute(params) {
      return { ok: true, message: `Stopped sharing ${params.lens} of ${params.holonId} with ${params.with}`, data: params };
    },
  },
  {
    name: 'audience',
    description: 'Who may read a private lens or card: the holons it is shared with.',
    params: PRIVACY_SCOPE,
    async execute(params) {
      return { ok: true, message: `Audience of ${params.lens} of ${params.holonId}`, data: params };
    },
  },
);

const fallbackRegistry: CommandRegistry = {
  list: () => fallbackCommands,
  get: (name) => fallbackCommands.find((c) => c.name === name),
};

/**
 * Resolve the command registry. Tries `@holons/core/commands` first; falls
 * back to the in-package stub if that module isn't published yet (Unit 15).
 */
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
    // Module not available yet — use fallback.
  }
  return fallbackRegistry;
}
