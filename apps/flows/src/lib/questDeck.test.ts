// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";
import {
  badgeOpacity,
  cardTransform,
  defaultQuestFunds,
  readQuestFunds,
  saveQuestFunds,
  forgetNoes,
  rate,
  ratingSets,
  readRatings,
  readSwipes,
  recordSwipe,
  swipeDecision,
  type KeyValue,
} from "./questDeck";

const memory = (): KeyValue => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
};

describe("swipe geometry", () => {
  it("commits past the threshold, springs back before it", () => {
    expect(swipeDecision(120, 100)).toBe("yes");
    expect(swipeDecision(-120, 100)).toBe("no");
    expect(swipeDecision(80, 100)).toBeNull();
    expect(swipeDecision(-100, 100)).toBeNull();
  });

  it("fades the badges in up to the threshold", () => {
    expect(badgeOpacity(50, 100)).toEqual({ yes: 0.5, no: 0 });
    expect(badgeOpacity(-300, 100)).toEqual({ yes: 0, no: 1 });
  });

  it("leans the card with the drag", () => {
    expect(cardTransform(100, 10)).toBe("translate(100px, 10px) rotate(8deg)");
  });
});

describe("what a viewer said", () => {
  it("keeps yes and no per board and viewer, the latest word winning", () => {
    const s = memory();
    recordSwipe("pot", "ana", "q1", "no", s);
    recordSwipe("pot", "ana", "q2", "yes", s);
    recordSwipe("pot", "ana", "q1", "yes", s);
    expect(readSwipes("pot", "ana", s)).toEqual({ yes: ["q1", "q2"], no: [] });
    expect(readSwipes("pot", "ben", s)).toEqual({ yes: [], no: [] });
    expect(readSwipes("event", "ana", s)).toEqual({ yes: [], no: [] });
  });

  it("lets a signed-out viewer swipe, and forgets noes on asking", () => {
    const s = memory();
    recordSwipe("pot", null, "q1", "no", s);
    expect(readSwipes("pot", null, s).no).toEqual(["q1"]);
    expect(forgetNoes("pot", null, s).no).toEqual([]);
  });

  it("reads nothing from a broken or missing store", () => {
    const broken: KeyValue = {
      getItem: () => "{nope",
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readSwipes("pot", "ana", broken)).toEqual({ yes: [], no: [] });
    expect(() => recordSwipe("pot", "ana", "q", "yes", broken)).not.toThrow();
    expect(readSwipes("pot", "ana", null)).toEqual({ yes: [], no: [] });
  });

  it("keeps ratings private per viewer and splits them for the feed", () => {
    const s = memory();
    rate("ana", "ben", "again", s);
    rate("ana", "cai", "not", s);
    rate("ana", "dan", "again", s);
    rate("ana", "dan", null, s);
    expect(readRatings("ana", s)).toEqual({ ben: "again", cai: "not" });
    expect(readRatings("ben", s)).toEqual({});
    const { liked, avoided } = ratingSets(readRatings("ana", s));
    expect([...liked]).toEqual(["ben"]);
    expect([...avoided]).toEqual(["cai"]);
  });
});

describe("the funds a viewer follows", () => {
  const node = (id: string, kind: string, share: number) => ({
    id,
    kind,
    share,
  });
  const index = {
    byId: new Map([
      ["pot", node("pot", "pot", 100)],
      ["big", node("big", "fund", 30)],
      ["mid", node("mid", "fund", 20)],
      ["small", node("small", "fund", 1)],
      ["mine", node("mine", "project", 2)],
    ]),
    into: new Map([["mine", [{ source: "small" }, { source: "pot" }]]]),
  };

  it("starts with the funds that pay me, then the largest", () => {
    expect(defaultQuestFunds(index, ["mine"], 2)).toEqual(["small", "big"]);
    expect(defaultQuestFunds(index, [], 6)).toEqual(["big", "mid", "small"]);
    expect(defaultQuestFunds(null, ["mine"])).toEqual([]);
  });

  it("remembers a choice per viewer, without duplicates", () => {
    const s = memory();
    expect(readQuestFunds("ana", s)).toBeNull();
    expect(saveQuestFunds("ana", ["big", "big", "mid"], s)).toEqual([
      "big",
      "mid",
    ]);
    expect(readQuestFunds("ana", s)).toEqual(["big", "mid"]);
    expect(readQuestFunds("ben", s)).toBeNull();
    saveQuestFunds("ana", [], s);
    expect(readQuestFunds("ana", s)).toEqual([]);
  });
});
