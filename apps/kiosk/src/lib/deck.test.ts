// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { badgeOpacity, cardTransform, deckTasks, swipeDecision } from "./deck";
import type { BacklogTask } from "./data";

const T = 100; // threshold used throughout

function task(id: string, unmetDeps = 0): BacklogTask {
  return {
    id,
    title: `Task ${id}`,
    participants: 0,
    people: [],
    appreciation: 0,
    appreciatedBy: [],
    created: 0,
    unmetDeps,
  };
}

describe("swipeDecision", () => {
  it("returns null under the threshold in every direction", () => {
    expect(swipeDecision(0, 0, T)).toBeNull();
    expect(swipeDecision(99, 0, T)).toBeNull();
    expect(swipeDecision(-99, 0, T)).toBeNull();
    expect(swipeDecision(0, -99, T)).toBeNull();
  });

  it("commits right/left past the threshold", () => {
    expect(swipeDecision(101, 0, T)).toBe("right");
    expect(swipeDecision(-101, 0, T)).toBe("left");
  });

  it("commits up past the threshold", () => {
    expect(swipeDecision(0, -101, T)).toBe("up");
  });

  it("never commits on a downward swipe", () => {
    expect(swipeDecision(0, 500, T)).toBeNull();
    expect(swipeDecision(50, 500, T)).toBeNull();
  });

  it("up wins a diagonal only when it dominates the horizontal pull", () => {
    // Mostly-up diagonal → up.
    expect(swipeDecision(80, -150, T)).toBe("up");
    // Mostly-right diagonal → right, even with some lift.
    expect(swipeDecision(150, -80, T)).toBe("right");
    expect(swipeDecision(-150, -80, T)).toBe("left");
  });

  it("treats the exact threshold as not-yet-committed", () => {
    expect(swipeDecision(T, 0, T)).toBeNull();
    expect(swipeDecision(0, -T, T)).toBeNull();
  });
});

describe("badgeOpacity", () => {
  it("is all-zero at rest", () => {
    expect(badgeOpacity(0, 0, T)).toEqual({ join: 0, skip: 0, like: 0 });
  });

  it("ramps each badge with its own direction", () => {
    expect(badgeOpacity(50, 0, T).join).toBeCloseTo(0.5);
    expect(badgeOpacity(-50, 0, T).skip).toBeCloseTo(0.5);
    expect(badgeOpacity(0, -50, T).like).toBeCloseTo(0.5);
  });

  it("clamps to 1 past the threshold and to 0 for opposing pulls", () => {
    const far = badgeOpacity(300, 0, T);
    expect(far.join).toBe(1);
    expect(far.skip).toBe(0);
    const down = badgeOpacity(0, 300, T);
    expect(down.like).toBe(0);
  });

  it("mirrors swipeDecision on diagonals: the dominant axis' badge leads", () => {
    const o = badgeOpacity(80, -150, T);
    expect(o.like).toBeGreaterThan(o.join);
  });
});

describe("cardTransform", () => {
  it("translates with the drag and rotates with the horizontal offset", () => {
    expect(cardTransform(100, -20)).toBe(
      "translate(100px, -20px) rotate(8deg)",
    );
    expect(cardTransform(-50, 10)).toBe("translate(-50px, 10px) rotate(-4deg)");
  });

  it("is identity at rest", () => {
    expect(cardTransform(0, 0)).toBe("translate(0px, 0px) rotate(0deg)");
  });
});

describe("deckTasks", () => {
  it("filters dismissed ids while preserving order", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const out = deckTasks(tasks, new Set(["b", "d"]));
    expect(out.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("returns everything when nothing was dismissed", () => {
    const tasks = [task("a"), task("b")];
    expect(deckTasks(tasks, new Set())).toEqual(tasks);
  });

  it("handles an emptied deck", () => {
    expect(deckTasks([task("a")], new Set(["a"]))).toEqual([]);
    expect(deckTasks([], new Set())).toEqual([]);
  });

  it("never deals a task still blocked by open dependencies", () => {
    const tasks = [task("a"), task("b", 2), task("c")];
    expect(deckTasks(tasks, new Set()).map((t) => t.id)).toEqual(["a", "c"]);
  });
});
