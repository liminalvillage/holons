// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// AI task breakdown: decompose a task into constituent steps that become
// linked dependencies. Pure and UI-agnostic — this module owns the tool
// schema the LLM is forced to call, the prompt that gives it the whole
// canvas as context (so it reuses existing tasks instead of recreating
// them), proposal validation, and the materializer that turns a proposal
// into concrete Quest records wired into the dependency DAG. The actual
// LLM HTTP call lives at the edge (apps/web server route).
//
// Dependency semantics (see dependencies.ts): a task's `dependencies` array
// lists its predecessors. The broken-down task becomes the goal node — it
// gains the terminal (sink) steps as dependencies — so on the canvas the
// steps fan out to its left and arrows flow steps → goal.

import type { Quest } from './types.js';
import { createTask } from './creation.js';
import { findDependencyCycle } from './dependencies.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compact task representation sent to the LLM as canvas context. */
export interface BreakdownContextTask {
  id: string;
  title: string;
  description?: string;
  status: string;
  dependencies: string[];
}

/** One proposed step, as returned by the LLM through `propose_steps`. */
export interface BreakdownStep {
  title: string;
  description: string;
  /** '' for a new task; an existing quest id to reuse that task as this step. */
  existingTaskId: string;
  /** 0-based indices of other steps in the batch that must come first. */
  dependsOnSteps: number[];
  /** Ids of existing tasks that must come first. */
  dependsOnExisting: string[];
}

export interface BreakdownProposal {
  /** True when the task is already a single actionable unit (steps empty). */
  atomic: boolean;
  reasoning: string;
  steps: BreakdownStep[];
}

export class BreakdownValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BreakdownValidationError';
  }
}

// ---------------------------------------------------------------------------
// LLM tool definition (plain JSON — the server route casts to Anthropic.Tool)
// ---------------------------------------------------------------------------

export const PROPOSE_STEPS_TOOL_NAME = 'propose_steps';

export const PROPOSE_STEPS_TOOL: {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
} = {
  name: PROPOSE_STEPS_TOOL_NAME,
  description:
    'Propose the constituent steps of a task. Steps become new tasks linked ' +
    'as dependencies, so each must be a concrete, completable unit of work.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['atomic', 'reasoning', 'steps'],
    properties: {
      atomic: {
        type: 'boolean',
        description:
          'True if the task is already a single actionable unit and should ' +
          'NOT be broken down. steps must then be empty.',
      },
      reasoning: {
        type: 'string',
        description:
          'One short paragraph: why this decomposition and this number of steps.',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'description',
            'existingTaskId',
            'dependsOnSteps',
            'dependsOnExisting',
          ],
          properties: {
            title: {
              type: 'string',
              description:
                'Short achieved-state title the group can verify, e.g. ' +
                "'We have agreed on a design' or 'Materials are collected'.",
            },
            description: {
              type: 'string',
              description: '1-3 sentences: a concrete definition of done.',
            },
            existingTaskId: {
              type: 'string',
              description:
                'Empty string for a new task. If an EXISTING task from the ' +
                'provided list already covers this step, put its id here so ' +
                'no duplicate is created.',
            },
            dependsOnSteps: {
              type: 'array',
              items: { type: 'integer' },
              description:
                '0-based indices of other steps in this array that must be ' +
                'completed first. Usually EMPTY — steps default to running ' +
                'in parallel as direct prerequisites of the goal. Only set ' +
                "when this step literally consumes another step's output.",
            },
            dependsOnExisting: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Ids of EXISTING tasks (from the provided list) that must be ' +
                'completed before this step.',
            },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Context compaction
// ---------------------------------------------------------------------------

/** Prompt-size guards, applied on both client and server. */
export const BREAKDOWN_MAX_CONTEXT_TASKS = 200;
export const BREAKDOWN_MAX_DESCRIPTION_CHARS = 280;
/**
 * Description budget for the GOAL task (the one being broken down). Context
 * tasks are aggressively truncated because there can be hundreds of them; the
 * goal's description is the single richest input to the decomposition, so it
 * keeps far more of its text.
 */
export const BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS = 2000;
/** Soft cap on proposal size — beyond this a warning is recorded, not an error. */
export const BREAKDOWN_SOFT_MAX_STEPS = 9;

/**
 * Compact quests into the context shape sent to the LLM. Skips deleted
 * records, prefers active tasks when the cap bites, and truncates long
 * descriptions so hundreds of tasks can't blow the prompt budget. Pass a
 * higher `maxDescriptionChars` when compacting the goal task alone (see
 * BREAKDOWN_MAX_GOAL_DESCRIPTION_CHARS).
 */
export function toBreakdownContext(
  quests: Quest[],
  opts?: { maxDescriptionChars?: number },
): BreakdownContextTask[] {
  const maxDescriptionChars =
    opts?.maxDescriptionChars ?? BREAKDOWN_MAX_DESCRIPTION_CHARS;
  const active: Quest[] = [];
  const settled: Quest[] = [];
  for (const q of quests) {
    if (!q || q._deleted || q.id === undefined || q.id === '') continue;
    if (q.status === 'completed' || q.status === 'cancelled') settled.push(q);
    else active.push(q);
  }
  return [...active, ...settled]
    .slice(0, BREAKDOWN_MAX_CONTEXT_TASKS)
    .map((q) => {
      const desc = typeof q.description === 'string' ? q.description : '';
      return {
        id: String(q.id),
        title: q.title ?? '',
        ...(desc ? { description: desc.slice(0, maxDescriptionChars) } : {}),
        status: q.status ?? 'ongoing',
        dependencies: ((q.dependencies as string[] | undefined) ?? []).map(String),
      };
    });
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface BreakdownPromptInput {
  task: BreakdownContextTask;
  allTasks: BreakdownContextTask[];
  /** Optional holon name / purpose, to ground the decomposition. */
  holonContext?: string;
}

export function buildBreakdownPrompt(input: BreakdownPromptInput): {
  system: string;
  user: string;
} {
  const system = [
    'You decompose a task into its constituent steps for a shared task canvas',
    'where tasks are linked by dependencies (a task lists its predecessors).',
    'Rules:',
    '1. Choose the number of steps by the real complexity of the task —',
    `   typically 2-${BREAKDOWN_SOFT_MAX_STEPS}. If the task is already a single actionable unit, set`,
    '   atomic: true and return no steps.',
    '2. NEVER recreate work that already exists on the canvas. The full task',
    '   list is provided; if an existing task covers a step, reference it via',
    '   existingTaskId (to reuse it as the step) or dependsOnExisting (as a',
    '   prerequisite) instead of duplicating it.',
    '3. Default to INDEPENDENT, PARALLEL steps: the broken-down task is the',
    '   goal, and each step should be a prerequisite feeding directly into it.',
    '   Use dependsOnSteps ONLY when a step literally cannot start before',
    "   another finishes (its output is the other's input). Never chain steps",
    '   just because you listed them in order — a pure chain is rarely correct.',
    '4. Every step must be a concrete, achievable outcome with a clear',
    '   definition of done. No vague steps like "plan" or "finalize".',
    '5. Phrase each title as an achieved state the group can verify — e.g.',
    '   "We have agreed on a design", "Materials are collected" — never as a',
    '   command. Do not repeat the parent task itself as a step.',
    'Call propose_steps exactly once.',
  ].join('\n');

  const lines: string[] = [];
  if (input.holonContext) {
    lines.push(`## Group context\n${input.holonContext}\n`);
  }
  lines.push('## Task to break down');
  lines.push(JSON.stringify(input.task));
  lines.push('');
  lines.push(
    '## All tasks currently on the canvas (one JSON object per line; ' +
      "status 'completed'/'cancelled' means already done)",
  );
  for (const t of input.allTasks) lines.push(JSON.stringify(t));
  lines.push('');
  lines.push('Break down the task above. Call propose_steps exactly once.');

  return { system, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Proposal validation
// ---------------------------------------------------------------------------

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Validate the raw `propose_steps` tool input from the LLM. Throws
 * `BreakdownValidationError` on shape violations (defense in depth — the
 * tool schema is enforced upstream, but never trust parsed model output).
 */
export function parseBreakdownProposal(input: unknown): BreakdownProposal {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BreakdownValidationError('proposal is not an object');
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.atomic !== 'boolean') {
    throw new BreakdownValidationError('proposal.atomic must be a boolean');
  }
  if (typeof obj.reasoning !== 'string') {
    throw new BreakdownValidationError('proposal.reasoning must be a string');
  }
  // Absent fields are defaulted rather than rejected: OpenAI's non-strict
  // tool calling treats `required` as advisory, and gpt-4o omits `steps`
  // (typically alongside atomic: true) or a step's empty lists. An absent
  // list is unambiguous — nothing in it — so only a present-but-wrong type
  // is a shape violation.
  const rawSteps = obj.steps ?? [];
  if (!Array.isArray(rawSteps)) {
    throw new BreakdownValidationError('proposal.steps must be an array');
  }
  const steps: BreakdownStep[] = rawSteps.map((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BreakdownValidationError(`steps[${i}] is not an object`);
    }
    const s = raw as Record<string, unknown>;
    if (typeof s.title !== 'string' || s.title.trim() === '') {
      throw new BreakdownValidationError(`steps[${i}].title must be a non-empty string`);
    }
    const description = s.description ?? '';
    if (typeof description !== 'string') {
      throw new BreakdownValidationError(`steps[${i}].description must be a string`);
    }
    const existingTaskId = s.existingTaskId ?? '';
    if (typeof existingTaskId !== 'string') {
      throw new BreakdownValidationError(`steps[${i}].existingTaskId must be a string`);
    }
    const dependsOnSteps = s.dependsOnSteps ?? [];
    if (
      !Array.isArray(dependsOnSteps) ||
      !dependsOnSteps.every((n) => Number.isInteger(n))
    ) {
      throw new BreakdownValidationError(
        `steps[${i}].dependsOnSteps must be an array of integers`,
      );
    }
    const dependsOnExisting = s.dependsOnExisting ?? [];
    if (!isStringArray(dependsOnExisting)) {
      throw new BreakdownValidationError(
        `steps[${i}].dependsOnExisting must be an array of strings`,
      );
    }
    return {
      title: s.title.trim(),
      description: description.trim(),
      existingTaskId: existingTaskId.trim(),
      dependsOnSteps: dependsOnSteps as number[],
      dependsOnExisting,
    };
  });
  if (obj.atomic && steps.length > 0) {
    throw new BreakdownValidationError('atomic proposal must have no steps');
  }
  return { atomic: obj.atomic, reasoning: obj.reasoning, steps };
}

// ---------------------------------------------------------------------------
// Materialization: proposal → concrete Quests + parent dependency update
// ---------------------------------------------------------------------------

export interface ApplyBreakdownInput {
  proposal: BreakdownProposal;
  /** The task being broken down (full quest — position/orderIndex are read). */
  parent: Quest;
  /** Current graph, used for reuse validation and the cycle gate. */
  allQuests: Quest[];
  initiator?: Quest['initiator'];
  /** Id generator for new steps; the default mixes the step index in. */
  generateId?: (index: number) => string;
  /** Canvas placement pitches; defaults match CanvasView's card grid. */
  layout?: { colPitch?: number; rowPitch?: number };
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

export interface ApplyBreakdownResult {
  /** Fully-formed new quests: ids assigned, dependencies and positions set. */
  newQuests: Quest[];
  /** The parent's updated predecessor list (existing deps ∪ terminal steps). */
  parentDependencies: string[];
  /** Existing task ids reused as steps (no new quest created for these). */
  reusedExistingIds: string[];
  warnings: string[];
}

const DEFAULT_COL_PITCH = 520; // CanvasView CARD_WIDTH 320 + column gap 200
const DEFAULT_ROW_PITCH = 380;

function defaultGenerateId(now: number): (index: number) => string {
  return (index) =>
    now.toString(36) + index.toString(36) + Math.random().toString(36).slice(2, 5);
}

/**
 * Turn a validated proposal into concrete new Quest records plus the parent's
 * updated dependency list. Pure: performs no I/O — the caller persists
 * `newQuests` first, then saves the parent with `parentDependencies`.
 *
 * Invalid references (bad step indices, unknown or parent-pointing existing
 * ids) are dropped with warnings rather than failing the whole proposal; any
 * dependency edge that would close a cycle is likewise dropped. Only a cycle
 * that cannot be repaired by removing edges introduced here throws.
 */
export function applyBreakdownProposal(input: ApplyBreakdownInput): ApplyBreakdownResult {
  const { proposal, parent, allQuests } = input;
  const now = input.now ?? Date.now();
  const generateId = input.generateId ?? defaultGenerateId(now);
  const colPitch = input.layout?.colPitch ?? DEFAULT_COL_PITCH;
  const rowPitch = input.layout?.rowPitch ?? DEFAULT_ROW_PITCH;
  const warnings: string[] = [];

  const parentId = String(parent.id);
  const parentDeps = ((parent.dependencies as string[] | undefined) ?? []).map(String);

  if (proposal.atomic || proposal.steps.length === 0) {
    return {
      newQuests: [],
      parentDependencies: parentDeps,
      reusedExistingIds: [],
      warnings,
    };
  }
  if (proposal.steps.length > BREAKDOWN_SOFT_MAX_STEPS) {
    warnings.push(
      `Proposal has ${proposal.steps.length} steps (more than the usual ` +
        `${BREAKDOWN_SOFT_MAX_STEPS}) — consider breaking the task down in stages.`,
    );
  }

  const existingIds = new Set(
    allQuests
      .filter((q) => q && !q._deleted && q.id !== undefined && q.id !== '')
      .map((q) => String(q.id)),
  );

  const steps = proposal.steps;
  const n = steps.length;

  // -- Sanitize per-step references ----------------------------------------
  const reuseId: (string | null)[] = steps.map((s, i) => {
    if (!s.existingTaskId) return null;
    if (s.existingTaskId === parentId) {
      warnings.push(`Step ${i + 1} ("${s.title}") pointed at the task being broken down — treated as a new task.`);
      return null;
    }
    if (!existingIds.has(s.existingTaskId)) {
      warnings.push(`Step ${i + 1} ("${s.title}") referenced unknown task ${s.existingTaskId} — treated as a new task.`);
      return null;
    }
    return s.existingTaskId;
  });

  // Step-index edges, kept acyclic incrementally (drop any back-edge).
  const stepPreds: number[][] = steps.map(() => []);
  const reaches = (from: number, target: number): boolean => {
    const stack = [from];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const p of stepPreds[cur]) stack.push(p);
    }
    return false;
  };
  steps.forEach((s, i) => {
    for (const j of s.dependsOnSteps) {
      if (j < 0 || j >= n || j === i) {
        warnings.push(`Step ${i + 1} ("${s.title}") had an invalid step reference — dropped.`);
        continue;
      }
      // Adding "i depends on j" closes a loop iff j already reaches i.
      if (reaches(j, i)) {
        warnings.push(`Step ${i + 1} ("${s.title}") ordering formed a loop with step ${j + 1} — dropped that edge.`);
        continue;
      }
      if (!stepPreds[i].includes(j)) stepPreds[i].push(j);
    }
  });

  const stepExistingDeps: string[][] = steps.map((s, i) =>
    s.dependsOnExisting.filter((d) => {
      if (d === parentId) {
        warnings.push(`Step ${i + 1} ("${s.title}") depended on the task being broken down — dropped (steps precede it).`);
        return false;
      }
      if (!existingIds.has(d)) {
        warnings.push(`Step ${i + 1} ("${s.title}") depended on unknown task ${d} — dropped.`);
        return false;
      }
      return true;
    }),
  );

  // -- Assign ids ------------------------------------------------------------
  const usedIds = new Set(existingIds);
  usedIds.add(parentId);
  const resolvedId: string[] = steps.map((_, i) => {
    const reused = reuseId[i];
    if (reused) return reused;
    let id = generateId(i);
    while (usedIds.has(id)) id += i.toString(36);
    usedIds.add(id);
    return id;
  });

  // -- Resolve dependency lists for new steps --------------------------------
  const newStepDeps: string[][] = steps.map((_, i) => {
    if (reuseId[i]) return []; // reused tasks are never mutated here
    const deps = [
      ...stepPreds[i].map((j) => resolvedId[j]),
      ...stepExistingDeps[i],
    ];
    return [...new Set(deps)].filter((d) => d !== resolvedId[i]);
  });
  steps.forEach((s, i) => {
    if (reuseId[i] && (stepPreds[i].length > 0 || stepExistingDeps[i].length > 0)) {
      warnings.push(
        `Step ${i + 1} reuses existing task "${s.title}" — its proposed ordering was not applied (existing tasks are left untouched).`,
      );
    }
  });

  // -- Parent wiring: terminal steps (sinks) become the parent's predecessors -
  const referenced = new Set<number>();
  for (const preds of stepPreds) for (const j of preds) referenced.add(j);
  const terminalIds = steps
    .map((_, i) => i)
    .filter((i) => !referenced.has(i))
    .map((i) => resolvedId[i]);
  let parentDependencies = [...new Set([...parentDeps, ...terminalIds])];

  // -- Canvas placement (only when the parent sits on the canvas) ------------
  // Depth = longest path to a sink + 1, so terminal steps sit just left of
  // the goal and earlier steps fan out further left (matches the canvas's
  // predecessors-left auto-arrange convention).
  const depths: number[] = steps.map(() => 1);
  {
    const succs: number[][] = steps.map(() => []);
    stepPreds.forEach((preds, i) => {
      for (const j of preds) succs[j].push(i);
    });
    const depthOf = (i: number, seen: Set<number>): number => {
      if (seen.has(i)) return 1;
      seen.add(i);
      let d = 1;
      for (const s of succs[i]) d = Math.max(d, depthOf(s, seen) + 1);
      seen.delete(i);
      return d;
    };
    steps.forEach((_, i) => {
      depths[i] = depthOf(i, new Set());
    });
  }
  const parentPos = parent.position as { x?: number; y?: number } | undefined;
  const hasPos =
    parentPos && typeof parentPos.x === 'number' && typeof parentPos.y === 'number';
  const positionOf = (i: number): { x: number; y: number } | undefined => {
    if (!hasPos) return undefined;
    const layer = steps
      .map((_, k) => k)
      .filter((k) => !reuseId[k] && depths[k] === depths[i]);
    const row = layer.indexOf(i);
    return {
      x: (parentPos!.x as number) - colPitch * depths[i],
      y: (parentPos!.y as number) + (row - (layer.length - 1) / 2) * rowPitch,
    };
  };

  // -- Build the new quests ---------------------------------------------------
  const maxOrder = Math.max(
    0,
    ...allQuests.map((q) => (typeof q.orderIndex === 'number' ? q.orderIndex : 0)),
    typeof parent.orderIndex === 'number' ? parent.orderIndex : 0,
  );
  const newQuests: Quest[] = [];
  steps.forEach((s, i) => {
    if (reuseId[i]) return;
    const quest = createTask({
      holonId: parent.holon ?? '',
      initiator: input.initiator ?? parent.initiator,
      title: s.title,
      category: parent.category,
      dependencies: newStepDeps[i],
      now,
    });
    quest.id = resolvedId[i];
    if (s.description) quest.description = s.description;
    quest.orderIndex = maxOrder + 1 + i;
    const pos = positionOf(i);
    if (pos) quest.position = pos;
    newQuests.push(quest);
  });

  // -- Cycle gate --------------------------------------------------------------
  // New→new edges are acyclic by construction; a cycle can only enter through
  // references to existing tasks (a step depending on an existing task that
  // transitively depends on the parent, or the parent gaining a reused task
  // that already depends on it). Repair by dropping the offending edge we
  // introduced; a cycle none of our edges participate in predates us.
  const newIds = new Set(newQuests.map((q) => String(q.id)));
  const preexistingCycle = findDependencyCycle(allQuests) !== null;
  const assemble = (): Quest[] => [
    ...allQuests.filter((q) => String(q.id) !== parentId),
    { ...parent, dependencies: parentDependencies },
    ...newQuests,
  ];
  for (let guard = 0; guard < n + parentDependencies.length + 1; guard++) {
    const cycle = findDependencyCycle(assemble());
    if (!cycle) break;
    // Edges in the cycle run path[i] → path[i+1] (and last → first).
    let repaired = false;
    for (let k = 0; k < cycle.length && !repaired; k++) {
      const from = cycle[k];
      const to = cycle[(k + 1) % cycle.length];
      if (newIds.has(from) && !newIds.has(to)) {
        const quest = newQuests.find((q) => String(q.id) === from)!;
        quest.dependencies = (quest.dependencies ?? []).filter((d: string) => d !== to);
        warnings.push(`Dropped dependency of new step "${quest.title}" on existing task ${to} — it would have created a cycle.`);
        repaired = true;
      } else if (from === parentId && !newIds.has(to) && !parentDeps.includes(to)) {
        parentDependencies = parentDependencies.filter((d) => d !== to);
        warnings.push(`Dropped reused task ${to} from the goal's dependencies — it would have created a cycle.`);
        repaired = true;
      }
    }
    if (!repaired) {
      if (preexistingCycle) {
        warnings.push('The existing task graph already contains a dependency cycle — left untouched.');
        break;
      }
      throw new BreakdownValidationError(
        `Breakdown would create an unrepairable dependency cycle: ${cycle.join(' → ')}`,
      );
    }
  }

  return {
    newQuests,
    parentDependencies,
    reusedExistingIds: [...new Set(reuseId.filter((r): r is string => r !== null))],
    warnings,
  };
}
