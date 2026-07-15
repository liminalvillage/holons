// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { toBacklog } from "./data";
import type { Quest } from "@holons/core/tasks";

function quest(id: string, extra: Partial<Quest> = {}): Quest {
  return { id, title: id, status: "ongoing", participants: [], ...extra };
}

describe("toBacklog — dependency-aware ordering", () => {
  it("marks self-standing tasks and current leaves as unblocked", () => {
    const out = toBacklog([
      quest("solo"),
      quest("next", { dependencies: ["done"] }),
      quest("done", { status: "completed" }),
    ]);
    expect(out.map((t) => [t.id, t.unmetDeps])).toEqual([
      ["next", 0],
      ["solo", 0],
    ]);
  });

  it("sorts current leaves before tasks with open dependencies", () => {
    const out = toBacklog([
      quest("blocked", { dependencies: ["leaf"] }),
      quest("leaf"),
    ]);
    expect(out.map((t) => t.id)).toEqual(["leaf", "blocked"]);
    expect(out[1].unmetDeps).toBe(1);
  });

  it("keeps a blocked task behind leaves even with a lower orderIndex", () => {
    const out = toBacklog([
      quest("blocked", { dependencies: ["leaf"], orderIndex: 0 }),
      quest("leaf", { orderIndex: 5 }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["leaf", "blocked"]);
  });

  it("orders by orderIndex then title within each group", () => {
    const out = toBacklog([
      quest("z-leaf"),
      quest("a-leaf", { orderIndex: 1 }),
      quest("b-blocked", { dependencies: ["z-leaf"] }),
      quest("a-blocked", { dependencies: ["z-leaf"] }),
    ]);
    expect(out.map((t) => t.id)).toEqual([
      "a-leaf",
      "z-leaf",
      "a-blocked",
      "b-blocked",
    ]);
  });

  it("counts only still-open dependencies", () => {
    const out = toBacklog([
      quest("t", { dependencies: ["d1", "d2", "gone"] }),
      quest("d1", { status: "completed" }),
      quest("d2"),
    ]);
    const t = out.find((x) => x.id === "t")!;
    expect(t.unmetDeps).toBe(1);
  });
});
