// Pure planner for task/event completion side-effects.
// Returns the data needed to record REA events + expense docs.
// Consumers (bot, web, MCP) call executeCompletionPlan to persist.

import type { Quest, QuestParticipant } from './types.js';
import type { ScoreEquation } from '../scoring/index.js';
import { getActionScore } from '../scoring/index.js';

export interface PlannedAction {
  user: QuestParticipant;
  type: 'questInitiated' | 'questCompleted' | 'appreciationExchange' | 'timeLogged';
  taskTitle: string;
  taskId: string | number;
  amount: number;
  hours?: number;
  receiver?: QuestParticipant;
}

export interface PlannedExpense {
  id: string;
  amount: number;
  currency: 'hour';
  description: string;
  paidBy: string | number;
  splitWith: (string | number)[];
  date: number;
  fromTimeTracking: true;
  questId: string | number;
}

export interface CompletionPlan {
  task: Quest;
  actions: PlannedAction[];
  expenses: PlannedExpense[];
  releasedHolograms: unknown[];
}

function isSelfPair(a: QuestParticipant, b: QuestParticipant): boolean {
  return String(a?.id ?? '') === String(b?.id ?? '');
}

export function planTaskCompletion(
  task: Quest,
  equation: ScoreEquation,
  options: { now?: number; holonId?: string | number } = {},
): CompletionPlan {
  const actions: PlannedAction[] = [];
  const expenses: PlannedExpense[] = [];
  const now = options.now ?? Date.now();

  const initiatedAmount = getActionScore('initiated', 1, equation).points;
  const completedAmount = getActionScore('completed', 1, equation).points;
  const sentAmount = getActionScore('sent', 1, equation).points;

  if (task.initiator) {
    actions.push({
      user: task.initiator as QuestParticipant,
      type: 'questInitiated',
      taskTitle: task.title,
      taskId: task.id ?? '',
      amount: initiatedAmount,
    });
  }

  for (const participant of task.participants ?? []) {
    actions.push({
      user: participant,
      type: 'questCompleted',
      taskTitle: task.title,
      taskId: task.id ?? '',
      amount: completedAmount,
    });
  }

  for (const sender of task.appreciation ?? []) {
    for (const recipient of task.participants ?? []) {
      if (isSelfPair(sender, recipient)) continue;
      actions.push({
        user: sender,
        type: 'appreciationExchange',
        taskTitle: task.title,
        taskId: task.id ?? '',
        amount: sentAmount,
        receiver: recipient,
      });
    }
  }

  const timeTracking = (task as any).timeTracking ?? {};
  for (const [userId, rawHours] of Object.entries(timeTracking)) {
    const hours = Number(rawHours);
    if (!hours || hours <= 0) continue;
    const hoursAmount = getActionScore('hours', hours, equation).points;
    actions.push({
      user: { id: userId } as QuestParticipant,
      type: 'timeLogged',
      taskTitle: task.title,
      taskId: task.id ?? '',
      amount: hoursAmount,
      hours,
    });
    if (options.holonId != null) {
      expenses.push({
        // Stable id keyed on (task, user) so re-completion upserts the
        // existing hour expense rather than stacking a new one per attempt.
        id: `${task.id ?? 'task'}_time_${userId}`,
        amount: hours,
        currency: 'hour',
        description: task.title,
        paidBy: userId,
        splitWith: [options.holonId],
        date: now,
        fromTimeTracking: true,
        questId: task.id ?? '',
      });
    }
  }

  const releasedHolograms = ((task as any).activeHolograms ?? []) as unknown[];

  return { task, actions, expenses, releasedHolograms };
}

/**
 * The quest id one occurrence of a series is credited under. The REA event
 * ids are keyed on the quest id, so this is what keeps each occurrence's
 * credits apart — the Telegram scheduler spawns every occurrence as a fresh
 * quest for the same reason; this is the read-side twin of that.
 */
export function occurrenceQuestId(taskId: string | number, when: string): string {
  return `${taskId}::${when}`;
}

/**
 * Plan the credits for completing ONE occurrence of a recurring quest: the
 * very same actions a one-off quest earns (initiated, completed per
 * participant, appreciation exchanges, hours) priced by the same equation,
 * keyed under {@link occurrenceQuestId} so this week's credits never collide
 * with last week's. The plan's `task` is the series as `applyOccurrenceCompletion`
 * returned it — that is what gets saved, not a quest per occurrence.
 *
 * `credited` is the confirmed participant set (who actually showed up this
 * time); it only shapes the credits, the series' own roster is untouched.
 */
export function planOccurrenceCompletion(
  task: Quest,
  when: string,
  equation: ScoreEquation,
  options: { now?: number; holonId?: string | number; credited?: QuestParticipant[] } = {},
): CompletionPlan {
  const { credited, ...rest } = options;
  const occurrence: Quest = {
    ...task,
    id: occurrenceQuestId(task.id ?? '', when),
    participants: credited ?? task.participants ?? [],
    activeHolograms: [],
  };
  const plan = planTaskCompletion(occurrence, equation, rest);
  return { ...plan, task, releasedHolograms: [] };
}
