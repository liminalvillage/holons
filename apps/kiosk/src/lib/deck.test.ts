// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  badgeOpacity,
  cardTransform,
  dealOrder,
  deckKey,
  decksFor,
  deckTasks,
  swipeDecision,
} from "./deck";
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
    frequency: null,
    unmetDeps,
    dependencies: [],
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

describe("a deck is personal", () => {
  it("keys one deck per hub and per person", () => {
    expect(deckKey("hubA", 1)).not.toBe(deckKey("hubA", 2));
    expect(deckKey("hubA", 1)).not.toBe(deckKey("hubB", 1));
    // Telegram ids arrive as numbers or strings — same person, same deck.
    expect(deckKey("hubA", 1)).toBe(deckKey("hubA", "1"));
    // Nobody logged in is its own deck, not anybody's.
    expect(deckKey("hubA", null)).not.toBe(deckKey("hubA", 1));
  });

  it("keeps only the new person's decks when the login changes", () => {
    const all = new Map([
      [deckKey("hubA", 1), "ann@A"],
      [deckKey("hubB", 1), "ann@B"],
      [deckKey("hubA", 2), "bob@A"],
      [deckKey("hubA", null), "anon@A"],
    ]);
    expect([...decksFor(all, 1).values()]).toEqual(["ann@A", "ann@B"]);
    expect([...decksFor(all, null).values()]).toEqual(["anon@A"]);
    expect(decksFor(all, 3).size).toBe(0);
  });
});

describe("dealing order is frozen", () => {
  it("appends cards not dealt yet and leaves the rest alone", () => {
    expect(dealOrder([], [task("a"), task("b")])).toEqual(["a", "b"]);
    expect(dealOrder(["a", "b"], [task("c"), task("a"), task("b")])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns the same array when nothing is new", () => {
    const prev = ["a", "b"];
    expect(dealOrder(prev, [task("b"), task("a")])).toBe(prev);
  });

  it("keeps the place of a card that is momentarily absent", () => {
    const order = dealOrder(["a", "b", "c"], [task("a"), task("c")]);
    expect(order).toEqual(["a", "b", "c"]);
    const back = deckTasks([task("c"), task("b"), task("a")], new Set(), order);
    expect(back.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("does not reshuffle when someone else's like re-ranks the backlog", () => {
    const order = ["a", "b", "c", "d"];
    // "d" got a heart elsewhere and now leads the wall's most-loved sort.
    const reranked = [task("d"), task("a"), task("b"), task("c")];
    const out = deckTasks(reranked, new Set(["a"]), order);
    expect(out.map((t) => t.id)).toEqual(["b", "c", "d"]);
  });

  it("deals a brand-new card last, in backlog order", () => {
    const out = deckTasks(
      [task("y"), task("a"), task("x"), task("b")],
      new Set(),
      ["a", "b"],
    );
    expect(out.map((t) => t.id)).toEqual(["a", "b", "y", "x"]);
  });
});
