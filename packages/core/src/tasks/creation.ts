// Creation helpers for tasks/quests. Pure (no I/O), so both the web UI and
// the Telegram bot can call them and produce identical records.

import type {
  Quest,
  QuestTree,
  QuestTreeNode,
  RitualSession,
} from './types.js';

// Initiator label stamped on council-generated tasks. Kept identical to the
// historical web copy so existing records remain comparable.
export const COUNCIL_INITIATOR = {
  username: 'Council',
  firstName: 'AI',
  lastName: 'Council',
} as const;

export const DEFAULT_TASK_CATEGORY = 'council-created';

// Shared scaffold for council-created tasks (design streams + default).
function councilTask(
  holonID: string,
  fields: { id: string; title: string; description: string; orderIndex: number },
): Quest {
  return {
    ...fields,
    status: 'pending',
    type: 'task',
    category: DEFAULT_TASK_CATEGORY,
    participants: [],
    appreciation: [],
    created: new Date().toISOString(),
    initiator: { id: holonID, ...COUNCIL_INITIATOR },
  };
}

/**
 * Build a single task record from one design-stream step.
 * Matches the historical shape produced by apps/web/src/utils/holonCreator.ts
 * (status `pending`, type `task`, council initiator, deterministic
 * orderIndex = streamIndex * 100 + stepIndex).
 */
export function createTaskFromStep(
  step: string,
  stream: RitualSession['design_streams'][number],
  streamIndex: number,
  stepIndex: number,
  holonID: string,
): Quest {
  return councilTask(holonID, {
    id: `${streamIndex}-${stepIndex}-${Date.now()}`,
    title: step,
    description: `From ${stream.name}: ${stream.description}`,
    orderIndex: streamIndex * 100 + stepIndex,
  });
}

/** Default task generated when a ritual produced no design streams. */
export function createDefaultTask(
  wishStatement: string,
  holonID: string,
): Quest {
  return councilTask(holonID, {
    id: `default-${Date.now()}`,
    title: 'Begin the journey',
    description: `Start working towards: "${wishStatement}"`,
    orderIndex: 0,
  });
}

/** Convert a ritual session's design streams into a flat list of tasks. */
export function createTasksFromDesignStreams(
  designStreams: RitualSession['design_streams'],
  wishStatement: string,
  holonID: string,
): Quest[] {
  const tasks: Quest[] = designStreams.flatMap((stream, streamIndex) =>
    stream.steps.map((step, stepIndex) =>
      createTaskFromStep(step, stream, streamIndex, stepIndex, holonID),
    ),
  );

  if (tasks.length === 0) {
    tasks.push(createDefaultTask(wishStatement, holonID));
  }

  return tasks;
}

// Description-prefix table: emoji + label + how to read the value off a
// QuestTreeNode + how to render it. Order is preserved in the rendered output.
type MetaSpec = {
  prefix: string;
  pick: (n: QuestTreeNode) => string | string[] | undefined;
  joiner?: string; // for arrays
};
const QUEST_TREE_META: ReadonlyArray<MetaSpec> = [
  { prefix: '⏱️ Duration', pick: (n) => n.estimatedDuration },
  { prefix: '🔧 Skills', pick: (n) => n.skillsRequired, joiner: ', ' },
  { prefix: '📦 Resources', pick: (n) => n.resourcesRequired, joiner: ', ' },
  { prefix: '⚡ Actions', pick: (n) => n.actions, joiner: ' • ' },
  { prefix: '🎯 Success', pick: (n) => n.futureState },
  { prefix: '💭 Assumptions', pick: (n) => n.assumptions, joiner: ' • ' },
  { prefix: '❓ Questions', pick: (n) => n.questions, joiner: ' • ' },
  { prefix: '📊 Metrics', pick: (n) => n.successMetrics, joiner: ' • ' },
  { prefix: '🌱 Impact', pick: (n) => n.impactCategory },
];

function buildRichDescription(node: QuestTreeNode): string {
  const base = node.description || `(Generation ${node.generation})`;
  const sections = QUEST_TREE_META.flatMap((spec) => {
    const value = spec.pick(node);
    if (Array.isArray(value)) {
      return value.length > 0 ? [`${spec.prefix}: ${value.join(spec.joiner ?? ', ')}`] : [];
    }
    return value ? [`${spec.prefix}: ${value}`] : [];
  });
  return sections.length > 0 ? `${base}\n\n${sections.join('\n\n')}` : base;
}

/**
 * Convert a QuestTree (recursive backcasting) into a list of holonic tasks.
 * - One task per node.
 * - Parent tasks `dependsOn` their children (recursive logic preserved
 *   verbatim from apps/web).
 * - Rich description carries holonic metadata (skills, resources, actions,
 *   metrics, etc.) for UIs that don't yet render `_meta.holonicData`.
 */
export function createTasksFromQuestTree(
  questTree: QuestTree,
  holonID: string,
): Quest[] {
  const makeTaskId = (nodeId: string) => `qt-${questTree.id}-${nodeId}`;

  // Index children up-front so the per-node assembly is O(1) instead of O(N²).
  const childIdsByParent = new Map<string, string[]>();
  for (const node of Object.values(questTree.nodes)) {
    if (node.parentId == null) continue;
    const list = childIdsByParent.get(node.parentId) ?? [];
    list.push(makeTaskId(node.id));
    childIdsByParent.set(node.parentId, list);
  }

  return Object.values(questTree.nodes).map((node) => {
    // RECURSIVE DEPENDENCY LOGIC: parent depends on children, plus any
    // explicit `node.dependencies`.
    const dependsOn = [
      ...(childIdsByParent.get(node.id) ?? []),
      ...(node.dependencies ?? []).map(makeTaskId),
    ];

    const task: Quest = {
      id: makeTaskId(node.id),
      title: node.title,
      description: buildRichDescription(node),
      status: 'pending',
      type: 'task',
      category: DEFAULT_TASK_CATEGORY,
      participants: node.participants || [],
      appreciation: [],
      created: new Date().toISOString(),
      orderIndex: node.generation * 100 + (node.generationIndex ?? 0),
      initiator: {
        id: holonID,
        ...COUNCIL_INITIATOR,
      },
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      _meta: {
        source: 'quest_tree',
        questTreeId: questTree.id,
        generation: node.generation,
        parentNodeId: node.parentId,
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
    };

    return task;
  });
}

// ---------------------------------------------------------------------------
// User-initiated task record (used by the Telegram bot's /task, /quest, ...
// commands). Returns a record with all the bot's expected default fields so
// the bot side becomes a thin wrapper that just attaches its own ids and
// transient UI state on top.
// ---------------------------------------------------------------------------

export interface NewTaskRecordInput {
  holonId: string | number;
  initiator: Quest['initiator'];
  title: string;
  type?: Quest['type'];
  category?: string;
  picture?: string | null;
  messageThreadId?: number | null;
  // Bot keeps `date` in ms (Date.now()), not ISO. Allow caller to override.
  now?: number;
}

/**
 * Build a fresh user-initiated task record with the Telegram bot's full
 * default-field set. The id is left empty — the caller assigns the platform
 * message id (Telegram message_id / Discord id) once the message is sent.
 */
export function createTaskRecord(input: NewTaskRecordInput): Quest {
  const now = input.now ?? Date.now();
  return {
    id: '',
    version: '0.1',
    holon: input.holonId,
    message_thread_id: input.messageThreadId ?? null,
    initiator: input.initiator,
    title: input.title,
    picture: input.picture ?? null,
    type: input.type ?? 'task',
    status: 'ongoing',
    date: now,
    participants: [],
    appreciation: [],
    stoppers: [],
    dependencies: [],
    frequency: null,
    recurringTaskId: null,
    timeTracking: {},
    checklistId: null,
    reminderId: null,
    activeHolograms: [],
    category: input.category ?? '',
    document: '',
    where: { latitude: '', longitude: '' },
    when: '',
    until: '',
    completed: '',
  };
}
