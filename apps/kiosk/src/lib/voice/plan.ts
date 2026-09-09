// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The voice agent's pending plan: every write the agent asks for is STAGED
// here as a previewed change, and nothing reaches Holosphere until the user
// reviews the drawer and taps Apply. Resolution ("it", "Marco", "at two") and
// the preview itself come from @holons/core/actions; this module supplies the
// kiosk's context — the live tasks, the roster, the open card, who is logged
// in — and, on Apply, the kiosk's own write paths (identity-aware writer with
// owner-holon targeting, hologram reflection for the speaker's joins, the
// full completion flow with its accounting).

import { get, writable } from "svelte/store";
import type { ToolCall, ToolResult } from "@holons/ai-ui";
import {
  applyChangeset,
  describeChange,
  emptyChangeset,
  isTaskAction,
  mergeChange,
  projectQuests,
  removeChange,
  resolveAction,
  stageAction,
  type ApplyOutcome,
  type ApplyPorts,
  type Changeset,
  type StagedChange,
} from "@holons/core/actions";
import type { Quest, QuestParticipant } from "@holons/core/tasks";
import { holonId, rawQuests, rotationHold, selection } from "$lib/stores";
import { currentUser } from "$lib/auth";
import { getHolosphere, getWriter } from "$lib/holosphere";
import { loadMembers } from "$lib/members";
import { person, reflectMembership, type TgUser } from "$lib/membership";
import { recordCompletion } from "$lib/complete";

export interface PendingPlan {
  changeset: Changeset;
  /** Ticked change ids — the ones Apply writes. */
  selected: Set<string>;
  /** What the user said to get here, oldest first. */
  utterances: string[];
  applying: boolean;
  /** Per change, once Apply ran. */
  outcomes: Record<string, ApplyOutcome>;
}

export const pendingPlan = writable<PendingPlan | null>(null);
export const drawerOpen = writable(false);
/** The task the last staged change targeted — what "it" most likely means. */
export const lastStagedTaskId = writable<string | null>(null);

// The drawer holds the kiosk's auto-rotation like an open card does.
drawerOpen.subscribe((open) => rotationHold.set(open));

const LOGIN_REQUIRED =
  "No one is logged in on this kiosk. Ask the user to log in with Telegram (the account button in the header) first.";

const changeCount = (): number =>
  get(pendingPlan)?.changeset.changes.length ?? 0;

/** The tasks as the user will see them once the pending plan is applied. */
export function projectedQuests(): Quest[] {
  const plan = get(pendingPlan);
  const quests = get(rawQuests);
  return plan ? projectQuests(quests, plan.changeset) : quests;
}

function openTaskId(): string | null {
  const sel = get(selection);
  if (!sel || sel.kind === "thing") return null;
  return String(sel.quest.id ?? "");
}

/**
 * Stage one write tool call. The result text goes back to the model: what
 * was staged (so it can summarise), or why it could not be (so it can ask).
 */
export async function stageCall(
  call: ToolCall,
  utterance: string,
): Promise<ToolResult> {
  const fail = (content: string): ToolResult => ({
    id: call.id,
    content,
    isError: true,
  });
  const hid = get(holonId);
  if (!hid) return fail("No holon is configured on this kiosk.");
  if (!isTaskAction(call.name)) return fail(`Unknown tool "${call.name}".`);
  const user = get(currentUser);
  if (!user) return fail(LOGIN_REQUIRED);

  const users = await loadMembers(hid);
  const outcome = resolveAction(
    { name: call.name, input: call.input ?? {} },
    {
      holonId: hid,
      utterance,
      quests: projectedQuests(),
      users,
      actor: person(user as TgUser),
      focus: {
        lastStagedTaskId: get(lastStagedTaskId),
        openTaskId: openTaskId(),
      },
    },
  );
  if (outcome.kind !== "ok") return fail(outcome.message);
  const staged = stageAction(outcome.resolved, outcome.warnings);
  if ("error" in staged) {
    // "Add Marco" again while Marco's add is still pending: the projection
    // already has him, so staging refuses — but the request IS fulfilled, by
    // the pending row. Say so, as a staged outcome, not a failure.
    const resolved = outcome.resolved;
    const target =
      resolved.name === "task_create" ? "" : String(resolved.quest.id ?? "");
    const kind =
      call.name === "task_update"
        ? "update"
        : call.name === "task_complete"
          ? "complete"
          : "participants";
    const pending = get(pendingPlan)?.changeset.changes.find(
      (c) => c.localId === target && (c.kind === kind || c.kind === "create"),
    );
    if (pending) {
      return {
        id: call.id,
        content:
          `Already proposed (pending the user's approval): ${describeChange(pending)}. ` +
          "Nothing new to stage; the user must tap Apply.",
        isError: false,
      };
    }
    return fail(staged.error);
  }

  const change = staged.change;
  pendingPlan.update((plan) => {
    const base = plan ?? {
      changeset: emptyChangeset(),
      selected: new Set<string>(),
      utterances: [],
      applying: false,
      outcomes: {},
    };
    const changeset = mergeChange(base.changeset, change);
    // Every change in the merged set is ticked unless the user unticked it.
    const selected = new Set(
      changeset.changes
        .filter(
          (c) =>
            base.selected.has(c.id) ||
            !base.changeset.changes.some((p) => p.id === c.id),
        )
        .map((c) => c.id),
    );
    const utterances =
      base.utterances[base.utterances.length - 1] === utterance
        ? base.utterances
        : [...base.utterances, utterance];
    return { ...base, changeset, selected, utterances, outcomes: {} };
  });
  lastStagedTaskId.set(change.localId);
  drawerOpen.set(true);

  const set = get(pendingPlan)!.changeset;
  // The row the call ended up in: its own kind, or the creation it folded into.
  const kept =
    set.changes.find(
      (c) =>
        c.kind === change.kind &&
        c.holon === change.holon &&
        c.key === change.key,
    ) ??
    set.changes.find(
      (c) =>
        c.kind === "create" && c.holon === change.holon && c.key === change.key,
    );
  const line = kept
    ? describeChange(kept)
    : "(cancelled out an earlier change)";
  const note = change.warnings.length
    ? ` Note: ${change.warnings.join(" ")}`
    : "";
  return {
    id: call.id,
    content:
      `STAGED, not applied: ${line}. ${set.changes.length} change(s) now wait in the review ` +
      `panel; the user must tap Apply. Say it is ready to review — never that it was done.${note}`,
    isError: false,
  };
}

/** Drop one change, or the whole plan. */
export function discardPlan(changeId?: string): number {
  const plan = get(pendingPlan);
  if (!plan) return 0;
  if (!changeId) {
    pendingPlan.set(null);
    drawerOpen.set(false);
    return plan.changeset.changes.length;
  }
  const changeset = removeChange(plan.changeset, changeId);
  if (changeset.changes.length === 0) {
    pendingPlan.set(null);
    drawerOpen.set(false);
  } else {
    plan.selected.delete(changeId);
    pendingPlan.set({ ...plan, changeset, selected: new Set(plan.selected) });
  }
  return 1;
}

/** Find the staged change the model refers to, by id or by title words. */
export function findChange(ref: string): StagedChange | undefined {
  const plan = get(pendingPlan);
  if (!plan) return undefined;
  const r = ref.trim().toLowerCase();
  return (
    plan.changeset.changes.find((c) => c.id === r) ??
    plan.changeset.changes.find((c) => c.title.toLowerCase().includes(r))
  );
}

export function toggleSelected(id: string): void {
  pendingPlan.update((plan) => {
    if (!plan) return plan;
    const selected = new Set(plan.selected);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { ...plan, selected };
  });
}

function kioskPorts(actor: TgUser): ApplyPorts {
  return {
    get: async (holon, lens, key) => {
      const hs = await getHolosphere();
      return ((await hs.get(holon, lens, key)) as Quest | null) ?? null;
    },
    put: async (holon, lens, record) => {
      const writer = await getWriter(holon);
      return writer.put(lens, record);
    },
    complete: async (holon, task, completer: QuestParticipant) =>
      (await recordCompletion(holon, task, completer.id ?? actor.id)).ok,
    afterParticipants: async (holon, updated, user, joined) => {
      // The speaker's own join/leave mirrors into their personal holon and
      // refreshes the linked DM, exactly as a tapped toggle does.
      if (String(user.id) === String(actor.id)) {
        await reflectMembership(holon, updated, actor, joined);
      }
    },
  };
}

/** Write the ticked changes, in staged order. Applied rows leave the plan. */
export async function applyPlan(): Promise<ApplyOutcome[]> {
  const plan = get(pendingPlan);
  const user = get(currentUser);
  if (!plan || plan.applying || !user) return [];
  pendingPlan.set({ ...plan, applying: true });
  const outcomes = await applyChangeset(
    plan.changeset,
    plan.selected,
    kioskPorts(user as TgUser),
  );
  const done = new Set(outcomes.filter((o) => o.ok).map((o) => o.id));
  const remaining = {
    changes: plan.changeset.changes.filter((c) => !done.has(c.id)),
  };
  const byId = Object.fromEntries(outcomes.map((o) => [o.id, o]));
  // Applied rows leave; failed and unticked ones stay, with their outcome.
  pendingPlan.set(
    remaining.changes.length === 0
      ? null
      : { ...plan, changeset: remaining, applying: false, outcomes: byId },
  );
  if (remaining.changes.length === 0) drawerOpen.set(false);
  return outcomes;
}

/** Human summary for the prompt: what is pending, so follow-ups refine it. */
export function pendingLines(): string {
  const plan = get(pendingPlan);
  if (!plan || plan.changeset.changes.length === 0) return "";
  return plan.changeset.changes
    .map(
      (c, i) =>
        `${i + 1}. ${describeChange(c)} [target "${c.title}" id ${c.localId}]`,
    )
    .join("\n");
}

export { changeCount };
