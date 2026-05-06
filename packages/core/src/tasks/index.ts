// @holons/core/tasks
//
// Defensive stub matching the *target* interface that Phase B unit `core/tasks`
// will fully populate. Consumers (telegram-ui, web) import `Quest`,
// `createTasksFromQuestTree`, and `saveTasksToHolon` from here so domain logic
// stays UI-agnostic.
//
// Until the real unit lands, this file exposes:
//   - `Quest`: a structural type that accepts both the harvest/web shape
//     (string ids, council-created tasks) and the telegram bot shape
//     (numeric ids, telegram user objects, holograms) without forcing either
//     codebase to refactor its persisted schema.
//   - `createTasksFromQuestTree(questTree, holonID)`: pure transformer.
//   - `saveTasksToHolon(holosphere, holonID, tasks)`: thin persistence helper
//     that mirrors the current harvest implementation
//     (`apps/web/src/utils/holonCreator.ts`).
//
// When the real `core/tasks` unit replaces this file, both signatures and
// the `Quest` shape MUST stay backwards compatible.

/**
 * Minimal HoloSphere-shaped persistence interface used by `saveTasksToHolon`.
 * Kept structural so we don't pull `holosphere` types into every consumer.
 */
export interface TasksHoloSphere {
	put(holonID: string, lens: string, value: unknown): Promise<unknown>;
}

/**
 * Telegram-style user reference. Mirrors the subset of Telegram's User object
 * the bot persists onto quests. String unions cover non-Telegram contexts.
 */
export interface QuestActor {
	id: string | number;
	username?: string;
	first_name?: string;
	firstName?: string;
	last_name?: string;
	lastName?: string;
	[key: string]: unknown;
}

/**
 * Hologram (federated/personal copy) reference attached to a quest.
 */
export interface QuestHologram {
	platform?: string;
	holonId: string | number;
	messageId: string | number;
	type?: string;
	[key: string]: unknown;
}

/**
 * Quest type unifies the harvest/web schema and the telegram-bot schema.
 *
 * Harvest/web tasks (council-created, quest-tree-derived) use string ids,
 * `pending|recurring|repeating|completed|ongoing` statuses, and `dependsOn`.
 * Telegram bot quests use numeric Telegram message ids, `participants` as
 * Telegram user objects, and the federation-tracking `activeHolograms`.
 *
 * Fields are intentionally optional so consumers can persist either shape
 * without refactoring their existing data. The real `core/tasks` unit may
 * tighten this with branded subtypes — keep BOTH callable.
 */
export interface Quest {
	id: string | number;
	title: string;
	description?: string;
	status?: 'ongoing' | 'completed' | 'recurring' | 'repeating' | 'pending' | 'stopped' | 'scheduled' | string;
	type?: 'task' | 'quest' | 'event' | 'proposal' | 'recurring' | 'offer' | 'request' | string;
	category?: string;
	created?: string;
	date?: number | string;
	orderIndex?: number;

	// Authorship
	initiator?: QuestActor;

	// Participation / appreciation. Harvest/web stores ids or actor objects;
	// the bot stores actor objects. Accept both.
	participants?: Array<QuestActor | string | number>;
	appreciation?: Array<QuestActor | string | number>;
	stoppers?: Array<QuestActor | string | number>;

	// Telegram-bot fields
	holon?: string | number;
	chat?: string | number;
	picture?: string | null;
	message_thread_id?: number | null;
	when?: string | number;
	until?: string | number;
	completed?: string | number;
	where?: { latitude?: string | number; longitude?: string | number; lat?: string | number; lon?: string | number; name?: string };
	frequency?: string | null;
	recurringTaskId?: string | null;
	timeTracking?: Record<string | number, number>;
	checklistId?: string | null;
	reminderId?: string | null;
	document?: string;
	version?: string;
	published?: boolean;
	broadcasted?: boolean;
	activeHolograms?: QuestHologram[];

	// Quest-tree linkage (web)
	dependsOn?: string[];
	dependencies?: string[];

	// Holosphere-injected metadata + freeform extras.
	_meta?: {
		source?: 'design_streams' | 'quest_tree' | string;
		questTreeId?: string;
		generation?: number;
		parentNodeId?: string | null;
		initiatedBy?: 'council' | 'user' | string;
		holonicData?: Record<string, unknown>;
		activeHolograms?: Array<{
			targetHolon?: string | number;
			platforms?: Record<string, { messageId?: string | number }>;
			[key: string]: unknown;
		}>;
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

/**
 * QuestTree node and tree shapes (subset). Real definition lives in
 * `apps/web/src/types/questTree.ts` — kept here as a structural minimum
 * so `createTasksFromQuestTree` is callable from a UI-agnostic context.
 */
export interface QuestTreeNode {
	id: string;
	title: string;
	parentId?: string | null;
	generation: number;
	generationIndex?: number;
	description?: string;
	dependencies?: string[];
	participants?: QuestActor[];
	skillsRequired?: string[];
	resourcesRequired?: string[];
	impactCategory?: string;
	estimatedDuration?: string;
	assumptions?: string[];
	questions?: string[];
	actions?: string[];
	successMetrics?: string[];
	futureState?: string;
	facilitatingAdvisor?: string;
	[key: string]: unknown;
}

export interface QuestTree {
	id: string;
	nodes: Record<string, QuestTreeNode>;
	[key: string]: unknown;
}

const COUNCIL_INITIATOR = {
	username: 'Council',
	firstName: 'AI',
	lastName: 'Council',
} as const;

const DEFAULT_TASK_CATEGORY = 'council-created';

/**
 * Convert a QuestTree into an array of holonic tasks (quests).
 * Each node becomes a task; parent→child relationships are encoded via
 * `dependsOn` (parents depend on children).
 *
 * Mirrors the implementation in `apps/web/src/utils/holonCreator.ts` so
 * Unit 2 can swap in the real shared version without breaking callers.
 */
export function createTasksFromQuestTree(questTree: QuestTree, holonID: string): Quest[] {
	const tasks: Quest[] = [];
	const makeTaskId = (nodeId: string): string => `qt-${questTree.id}-${nodeId}`;

	for (const node of Object.values(questTree.nodes)) {
		const taskId = makeTaskId(node.id);

		// Parent always depends on its children (recursive holonic logic).
		const childTaskIds = Object.values(questTree.nodes)
			.filter((n) => n.parentId === node.id)
			.map((n) => makeTaskId(n.id));
		const dependsOn: string[] = [...childTaskIds];

		if (node.dependencies && node.dependencies.length > 0) {
			for (const depNodeId of node.dependencies) {
				dependsOn.push(makeTaskId(depNodeId));
			}
		}

		// Build a richer description from optional holonic metadata.
		let richDescription = node.description ?? `(Generation ${node.generation})`;
		const sections: string[] = [];
		if (node.estimatedDuration) sections.push(`Duration: ${node.estimatedDuration}`);
		if (node.skillsRequired?.length) sections.push(`Skills: ${node.skillsRequired.join(', ')}`);
		if (node.resourcesRequired?.length) sections.push(`Resources: ${node.resourcesRequired.join(', ')}`);
		if (node.actions?.length) sections.push(`Actions: ${node.actions.join(' • ')}`);
		if (node.futureState) sections.push(`Success: ${node.futureState}`);
		if (node.assumptions?.length) sections.push(`Assumptions: ${node.assumptions.join(' • ')}`);
		if (node.questions?.length) sections.push(`Questions: ${node.questions.join(' • ')}`);
		if (node.successMetrics?.length) sections.push(`Metrics: ${node.successMetrics.join(' • ')}`);
		if (node.impactCategory) sections.push(`Impact: ${node.impactCategory}`);
		if (sections.length > 0) richDescription += '\n\n' + sections.join('\n\n');

		tasks.push({
			id: taskId,
			title: node.title,
			description: richDescription,
			status: 'pending',
			type: 'task',
			category: DEFAULT_TASK_CATEGORY,
			participants: node.participants ?? [],
			appreciation: [],
			created: new Date().toISOString(),
			orderIndex: node.generation * 100 + (node.generationIndex ?? 0),
			initiator: { id: holonID, ...COUNCIL_INITIATOR },
			dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
			_meta: {
				source: 'quest_tree',
				questTreeId: questTree.id,
				generation: node.generation,
				parentNodeId: node.parentId ?? null,
				initiatedBy: 'council',
				holonicData: {
					skillsRequired: node.skillsRequired,
					resourcesRequired: node.resourcesRequired,
					impactCategory: node.impactCategory,
					estimatedDuration: node.estimatedDuration,
					assumptions: node.assumptions,
					questions: node.questions,
					actions: node.actions,
					successMetrics: node.successMetrics,
					futureState: node.futureState,
					facilitatingAdvisor: node.facilitatingAdvisor,
				},
			},
		});
	}

	return tasks;
}

/**
 * Persist a batch of tasks to a holon's `quests` lens. Returns the count of
 * successful saves; failures are logged and skipped (matches the harvest
 * implementation's best-effort semantics).
 *
 * Accepts any object with a `put(holonID, lens, value)` signature so both
 * the real `holosphere` instance and per-holon scoped instances work.
 */
export async function saveTasksToHolon(
	holosphere: TasksHoloSphere,
	holonID: string,
	tasks: Quest[]
): Promise<number> {
	let successful = 0;
	for (const task of tasks) {
		try {
			await holosphere.put(holonID, 'quests', task);
			successful += 1;
		} catch (err) {
			// Best-effort persistence; surface failure via globalThis.console when
			// available without forcing a `dom`/`node` lib dependency on consumers.
			const c: { error?: (...args: unknown[]) => void } | undefined = (globalThis as { console?: { error?: (...args: unknown[]) => void } }).console;
			c?.error?.(`[core/tasks] Failed to save task "${task.title}":`, err);
		}
	}
	return successful;
}
