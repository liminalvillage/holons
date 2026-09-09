// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The staging pipeline end to end, with the kiosk's I/O mocked: a spoken
// request becomes previewed rows, nothing is written, a follow-up refines
// the rows, Apply writes only the ticked ones through the kiosk ports.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import type { Quest } from "@holons/core/tasks";
import { localFieldsToStored, toLocalTimeField } from "@holons/core/datetime";

const { db, put, reflect, complete } = vi.hoisted(() => {
  const db: Record<string, Quest> = {};
  return {
    db,
    put: vi.fn(async (_lens: string, rec: Quest) => {
      db[String(rec.id)] = rec;
      return true;
    }),
    reflect: vi.fn(async (..._args: unknown[]) => {}),
    complete: vi.fn(async () => ({ ok: true, actions: 1, expenses: 0 })),
  };
});

vi.mock("$lib/holosphere", () => ({
  getHolosphere: async () => ({
    get: async (_h: string, _l: string, key: string) => db[key] ?? null,
  }),
  getWriter: async () => ({ put }),
}));
vi.mock("$lib/members", () => ({
  loadMembers: async () => [
    { id: 1, first_name: "Marco", last_name: "Rossi" },
    { id: 3, first_name: "Roberto" },
  ],
}));
vi.mock("$lib/membership", () => ({
  person: (u: { id: string | number; first_name?: string }) => ({
    id: u.id,
    first_name: u.first_name,
  }),
  reflectMembership: reflect,
}));
vi.mock("$lib/complete", () => ({ recordCompletion: complete }));

import { holonId, rawQuests, selection } from "$lib/stores";
import { currentUser } from "$lib/auth";
import {
  applyPlan,
  discardPlan,
  drawerOpen,
  lastStagedTaskId,
  pendingLines,
  pendingPlan,
  projectedQuests,
  stageCall,
  toggleSelected,
} from "./plan";

const kitchen: Quest = {
  id: "k1",
  title: "Clean the kitchen",
  status: "ongoing",
  participants: [],
  when: localFieldsToStored("2026-09-10", "10:00")!,
  ends: localFieldsToStored("2026-09-10", "11:30")!,
};
const van: Quest = {
  id: "v1",
  title: "Wash the van",
  status: "ongoing",
  participants: [],
};

describe("voice plan", () => {
  beforeEach(() => {
    for (const k of Object.keys(db)) delete db[k];
    db.k1 = kitchen;
    db.v1 = van;
    put.mockClear();
    reflect.mockClear();
    complete.mockClear();
    holonId.set("h");
    rawQuests.set([kitchen, van]);
    selection.set({ kind: "task", quest: kitchen });
    currentUser.set({ id: 3, first_name: "Roberto" } as never);
    pendingPlan.set(null);
    drawerOpen.set(false);
    lastStagedTaskId.set(null);
  });

  it("stages 'add Marco and move it to 2pm' as two rows and writes nothing", async () => {
    const utterance = "add marco as participant and move it to 2pm";
    const a = await stageCall(
      {
        id: "1",
        name: "task_add_participant",
        input: { user: { name: "Marco" } },
      },
      utterance,
    );
    expect(a.isError).toBe(false);
    expect(a.content).toMatch(
      /^STAGED, not applied: Add Marco Rossi to "Clean the kitchen"/,
    );
    const b = await stageCall(
      { id: "2", name: "task_update", input: { time: "14:00" } },
      utterance,
    );
    expect(b.isError).toBe(false);
    expect(b.content).toMatch(
      /schedule 2026-09-10 10:00–11:30 → 2026-09-10 14:00–15:30/,
    );

    const plan = get(pendingPlan)!;
    expect(plan.changeset.changes.map((c) => c.kind)).toEqual([
      "participants",
      "update",
    ]);
    expect(plan.selected.size).toBe(2);
    expect(get(drawerOpen)).toBe(true);
    expect(put).not.toHaveBeenCalled();
    expect(get(lastStagedTaskId)).toBe("k1");
    // The projection is what the next turn sees.
    const [k] = projectedQuests();
    expect(k.participants).toHaveLength(1);
    expect(toLocalTimeField(k.when)).toBe("14:00");
    expect(pendingLines()).toMatch(/1\. Add Marco Rossi/);
  });

  it("replaces a schedule on the follow-up instead of duplicating it", async () => {
    await stageCall(
      { id: "1", name: "task_update", input: { taskId: "k1", time: "14:00" } },
      "move the kitchen to 2pm",
    );
    await stageCall(
      { id: "2", name: "task_update", input: { time: "15:00" } },
      "actually 3pm",
    );
    const changes = get(pendingPlan)!.changeset.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].diff[0].after).toBe("2026-09-10 15:00–16:30");
  });

  it("applies only the ticked rows through the kiosk ports, in order", async () => {
    await stageCall(
      {
        id: "1",
        name: "task_add_participant",
        input: { taskRef: "van", user: { name: "Marco" } },
      },
      "add marco to the van",
    );
    await stageCall(
      { id: "2", name: "task_toggle_participant", input: { taskRef: "van" } },
      "and me too",
    );
    await stageCall(
      {
        id: "3",
        name: "task_update",
        input: { taskRef: "van", title: "Wash the bus" },
      },
      "rename the van to bus",
    );
    const plan = get(pendingPlan)!;
    expect(plan.changeset.changes.map((c) => c.kind)).toEqual([
      "participants",
      "update",
    ]);
    const [people, rename] = plan.changeset.changes;
    toggleSelected(rename.id);

    const outcomes = await applyPlan();
    expect(outcomes.map((o) => o.ok)).toEqual([true]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(db.v1.participants.map((p) => p.id)).toEqual(["1", 3]);
    expect(db.v1.title).toBe("Wash the van");
    // The speaker's own join is mirrored (hologram reflection); Marco's is not.
    expect(reflect).toHaveBeenCalledTimes(1);
    expect(reflect.mock.calls[0][2]).toMatchObject({ id: 3 });
    // The unticked rename stays in the drawer.
    expect(get(pendingPlan)!.changeset.changes.map((c) => c.id)).toEqual([
      rename.id,
    ]);
    expect(people.id).not.toBe(rename.id);
  });

  it("completes through the kiosk's accounting flow and clears the plan", async () => {
    await stageCall(
      { id: "1", name: "task_complete", input: { taskRef: "van" } },
      "the van is done",
    );
    const outcomes = await applyPlan();
    expect(outcomes[0].ok).toBe(true);
    expect(complete).toHaveBeenCalledWith(
      "h",
      expect.objectContaining({
        id: "v1",
        participants: [{ id: 3, first_name: "Roberto" }],
      }),
      3,
    );
    expect(put).not.toHaveBeenCalled();
    expect(get(pendingPlan)).toBeNull();
    expect(get(drawerOpen)).toBe(false);
  });

  it("refuses without a login and reports ambiguity for the model to ask", async () => {
    currentUser.set(null);
    const r = await stageCall(
      { id: "1", name: "task_update", input: { time: "14:00" } },
      "move it",
    );
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/logged in/);
    currentUser.set({ id: 3, first_name: "Roberto" } as never);
    rawQuests.set([
      kitchen,
      van,
      {
        id: "k2",
        title: "Clean the bathroom",
        status: "ongoing",
        participants: [],
      },
    ]);
    const amb = await stageCall(
      {
        id: "2",
        name: "task_update",
        input: { taskRef: "clean", time: "14:00" },
      },
      "move clean to two",
    );
    expect(amb.isError).toBe(true);
    expect(amb.content).toMatch(/Several tasks match/);
    expect(get(pendingPlan)).toBeNull();
  });

  it("reports a repeat of a pending request as already proposed, not an error", async () => {
    await stageCall(
      {
        id: "1",
        name: "task_add_participant",
        input: { taskId: "v1", user: { name: "Marco" } },
      },
      "add marco to the van",
    );
    const again = await stageCall(
      {
        id: "2",
        name: "task_add_participant",
        input: { taskId: "v1", user: { name: "Marco" } },
      },
      "add marco to the van",
    );
    expect(again.isError).toBe(false);
    expect(again.content).toMatch(
      /^Already proposed .*Add Marco Rossi to "Wash the van"/,
    );
    expect(get(pendingPlan)!.changeset.changes).toHaveLength(1);
  });

  it("discards one change or all", async () => {
    await stageCall(
      { id: "1", name: "task_update", input: { taskId: "k1", time: "14:00" } },
      "move the kitchen",
    );
    await stageCall(
      { id: "2", name: "task_update", input: { taskId: "v1", title: "Bus" } },
      "rename the van",
    );
    const [first] = get(pendingPlan)!.changeset.changes;
    expect(discardPlan(first.id)).toBe(1);
    expect(get(pendingPlan)!.changeset.changes).toHaveLength(1);
    expect(discardPlan()).toBe(1);
    expect(get(pendingPlan)).toBeNull();
  });
});
