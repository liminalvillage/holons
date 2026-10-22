// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { swallowsContextMenu } from "./holdmenu";

// A stand-in for the pressed element: only `closest` matters here.
function el(editable: boolean): EventTarget {
  const fake = { closest: () => (editable ? fake : null) };
  return fake as unknown as EventTarget;
}

describe("swallowsContextMenu", () => {
  it("swallows a touch long-press on a card or an empty cell", () => {
    expect(swallowsContextMenu("touch", el(false))).toBe(true);
    expect(swallowsContextMenu("pen", el(false))).toBe(true);
  });
  it("keeps a mouse right-click", () => {
    expect(swallowsContextMenu("mouse", el(false))).toBe(false);
    expect(swallowsContextMenu(null, el(false))).toBe(false);
  });
  it("keeps the menu inside a field, where it is how one pastes", () => {
    expect(swallowsContextMenu("touch", el(true))).toBe(false);
  });
  it("tolerates a target that is no element", () => {
    expect(swallowsContextMenu("touch", null)).toBe(true);
  });
});
