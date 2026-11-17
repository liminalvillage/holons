// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  CIRCLE,
  dealOrder,
  decide,
  deckKey,
  decksFor,
  deckTasks,
  dragPose,
  hydrate,
  intentOf,
  isTap,
  nextCircle,
  poseCss,
  progress,
  stackPose,
  throwMs,
  throwPath,
} from "./deck";
import type { BacklogTask } from "./data";

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

describe("intentOf", () => {
  it("points nowhere at rest or within the tap slop", () => {
    expect(intentOf(0, 0)).toBeNull();
    expect(intentOf(5, 0)).toBeNull();
    expect(intentOf(0, -5)).toBeNull();
  });

  it("reads left/right from the horizontal pull", () => {
    expect(intentOf(40, 5)).toBe("right");
    expect(intentOf(-40, 5)).toBe("left");
  });

  it("reads up only while the lift dominates", () => {
    expect(intentOf(10, -60)).toBe("up");
    // A flick to the upper corner still reads as left/right.
    expect(intentOf(60, -60)).toBe("right");
  });

  it("never answers a downward drag", () => {
    expect(intentOf(0, 80)).toBeNull();
    expect(intentOf(10, 80)).toBeNull();
  });
});

describe("decide", () => {
  const W = 300; // threshold = 90px
  const still = { vx: 0, vy: 0, width: W };

  it("springs back under the threshold", () => {
    expect(decide({ dx: 80, dy: 0, ...still })).toBeNull();
    expect(decide({ dx: 0, dy: -80, ...still })).toBeNull();
  });

  it("commits past the threshold", () => {
    expect(decide({ dx: 95, dy: 0, ...still })).toBe("right");
    expect(decide({ dx: -95, dy: 0, ...still })).toBe("left");
    expect(decide({ dx: 0, dy: -95, ...still })).toBe("up");
  });

  it("commits a short, fast flick in its own direction", () => {
    expect(decide({ dx: 30, dy: 0, vx: 1, vy: 0, width: W })).toBe("right");
    expect(decide({ dx: -30, dy: 0, vx: -1, vy: 0, width: W })).toBe("left");
    expect(decide({ dx: 0, dy: -30, vx: 0, vy: -1, width: W })).toBe("up");
  });

  it("ignores a flick against the drag or too short", () => {
    expect(decide({ dx: 30, dy: 0, vx: -1, vy: 0, width: W })).toBeNull();
    expect(decide({ dx: 12, dy: 0, vx: 2, vy: 0, width: W })).toBeNull();
  });
});

describe("progress", () => {
  it("is 0 at rest and 1 at the threshold", () => {
    expect(progress({ dx: 0, dy: 0, width: 300 })).toBe(0);
    expect(progress({ dx: 45, dy: 0, width: 300 })).toBeCloseTo(0.5);
    expect(progress({ dx: 400, dy: 0, width: 300 })).toBe(1);
  });
});

describe("isTap", () => {
  it("counts a press that barely moved", () => {
    expect(isTap(3, 4)).toBe(true);
    expect(isTap(8, 0)).toBe(false);
  });
});

describe("poses", () => {
  it("prints the top card at rest as the identity pose", () => {
    expect(poseCss(stackPose(0))).toBe(
      "translate3d(0px, 0px, 0px) rotateX(0deg) rotateY(0deg) rotateZ(0deg) scale(1)",
    );
  });

  it("fans the cards behind back into depth, and lifts them as the top leaves", () => {
    const behind = stackPose(1);
    expect(behind.z).toBeLessThan(0);
    expect(behind.s).toBeLessThan(1);
    // Fully dragged, the second card has risen into the top's place.
    expect(stackPose(1, 1)).toEqual(stackPose(0));
  });

  it("leans the dragged card toward the pull, within bounds", () => {
    const p = dragPose(2000, 0, 300);
    expect(p.ry).toBe(16);
    expect(p.rz).toBe(14);
    expect(dragPose(-60, 0, 300).ry).toBeLessThan(0);
  });
});

describe("throws", () => {
  const o = { dx: 0, dy: 0, vx: 0, vy: 0, width: 300, height: 450 };

  it("start where the finger let go and end invisible", () => {
    for (const dir of ["left", "right", "up"] as const) {
      const kf = throwPath(dir, { ...o, dx: 40 });
      expect(kf[0].x).toBe(40);
      expect(kf[0].offset).toBe(0);
      expect(kf[kf.length - 1].offset).toBe(1);
      expect(kf[kf.length - 1].o).toBe(0);
    }
  });

  it("send a join into its star", () => {
    const kf = throwPath("right", { ...o, target: { x: 12, y: -300 } });
    expect(kf[kf.length - 1]).toMatchObject({ x: 12, y: -300 });
  });

  it("send a skip out to the left and a like up", () => {
    expect(throwPath("left", o).at(-1)!.x).toBeLessThan(0);
    expect(throwPath("up", o).at(-1)!.y).toBeLessThan(0);
  });

  it("are quicker when flung harder", () => {
    expect(throwMs("right", 2, 0)).toBeLessThan(throwMs("right"));
  });
});

describe("circles", () => {
  it("deals up to CIRCLE cards not seen this session", () => {
    const deck = Array.from({ length: 10 }, (_, i) => task(String(i)));
    expect(nextCircle(deck, new Set()).length).toBe(CIRCLE);
    const seen = new Set(deck.slice(0, CIRCLE).map((t) => t.id));
    expect(nextCircle(deck, seen).map((t) => t.id)).toEqual(["7", "8", "9"]);
  });

  it("hydrates a frozen circle with live data, keeping its order", () => {
    const frozen = [task("a"), task("b")];
    const live = [{ ...task("b"), appreciation: 3 }, task("a")];
    const out = hydrate(frozen, live);
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out[1].appreciation).toBe(3);
    // A card gone from the backlog keeps its last known face.
    expect(hydrate(frozen, [])).toEqual(frozen);
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
