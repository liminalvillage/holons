// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  linkedCardFromSearch,
  searchWithCard,
  selectionCard,
  selectionCardUrl,
  withoutSelectionCard,
} from "./cardlink";
import type { Selection } from "./stores";

describe("linkedCardFromSearch", () => {
  it("reads each card kind with its tab", () => {
    expect(linkedCardFromSearch("?task=t1")).toEqual({
      param: "task",
      id: "t1",
      tab: "tasks",
      kind: "task",
    });
    expect(linkedCardFromSearch("?event=e1")).toMatchObject({
      id: "e1",
      tab: "calendar",
      kind: "event",
    });
    expect(linkedCardFromSearch("?thing=book")).toMatchObject({
      id: "book",
      tab: "library",
      kind: "thing",
    });
    expect(linkedCardFromSearch("?item=flour")).toMatchObject({
      id: "flour",
      tab: "stock",
      kind: "item",
    });
    expect(linkedCardFromSearch("?offer=o1")).toMatchObject({
      id: "o1",
      tab: "offers",
      kind: "offer",
    });
  });
  it("ignores unrelated params and blanks", () => {
    expect(linkedCardFromSearch("?holon=liminal&app=x")).toBeNull();
    expect(linkedCardFromSearch("?task=%20")).toBeNull();
    expect(linkedCardFromSearch("")).toBeNull();
  });
  it("prefers the first known param when several are present", () => {
    expect(linkedCardFromSearch("?offer=o1&task=t1")).toMatchObject({
      kind: "task",
      id: "t1",
    });
  });
});

describe("withoutSelectionCard", () => {
  it("drops task/event/thing but leaves the stock and offer pointers", () => {
    expect(withoutSelectionCard("?task=t1&event=e1&thing=x&item=flour")).toBe(
      "?item=flour",
    );
    expect(withoutSelectionCard("?offer=o1&thing=x")).toBe("?offer=o1");
  });
  it("is the empty string when nothing is left", () => {
    expect(withoutSelectionCard("?task=t1")).toBe("");
    expect(withoutSelectionCard("")).toBe("");
  });
});

describe("searchWithCard", () => {
  it("names the card and keeps the rest of the query", () => {
    expect(searchWithCard("?app=x", "task", "t1")).toBe("?app=x&task=t1");
  });
  it("replaces another open card — one card shows at a time", () => {
    expect(searchWithCard("?event=e1", "task", "t1")).toBe("?task=t1");
    expect(searchWithCard("?task=old&item=flour", "task", "new")).toBe(
      "?task=new&item=flour",
    );
  });
});

describe("selectionCard / selectionCardUrl", () => {
  const origin = "https://liminal.hubs.network";
  it("links a task and an event by the id openQuest looks up", () => {
    const task = {
      kind: "task",
      quest: { id: "t1", title: "Fix" },
    } as Selection;
    expect(selectionCard(task)).toEqual({ param: "task", id: "t1" });
    expect(selectionCardUrl(origin, "liminal", task)).toBe(
      "https://liminal.hubs.network/liminal/tasks?task=t1",
    );
    const ev = { kind: "event", quest: { title: "Dinner" } } as Selection;
    expect(selectionCardUrl(origin, "liminal", ev)).toBe(
      "https://liminal.hubs.network/liminal/calendar?event=Dinner",
    );
  });
  it("links a thing on the library tab", () => {
    const thing = { kind: "thing", item: { id: "book 1" } } as Selection;
    expect(selectionCardUrl(origin, "-100123", thing)).toBe(
      "https://liminal.hubs.network/-100123/library?thing=book%201",
    );
  });
  it("has nothing to link for a draft, an id-less thing, or no selection", () => {
    const draft = {
      kind: "task",
      isNew: true,
      quest: { id: "x", title: "Draft" },
    } as Selection;
    expect(selectionCardUrl(origin, "liminal", draft)).toBeNull();
    expect(selectionCard({ kind: "thing", item: {} } as Selection)).toBeNull();
    expect(selectionCard(null)).toBeNull();
  });
});
