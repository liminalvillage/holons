// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { isPageZoom, lockPageZoom } from "./nozoom";

describe("isPageZoom", () => {
  it("cancels Safari's pinch gestures", () => {
    expect(isPageZoom({ type: "gesturestart" })).toBe(true);
    expect(isPageZoom({ type: "gesturechange" })).toBe(true);
    expect(isPageZoom({ type: "gestureend" })).toBe(true);
  });
  it("cancels a two-finger move but keeps a one-finger scroll", () => {
    expect(isPageZoom({ type: "touchmove", touches: { length: 2 } })).toBe(
      true,
    );
    expect(isPageZoom({ type: "touchmove", touches: { length: 1 } })).toBe(
      false,
    );
  });
  it("cancels a trackpad pinch (ctrl+wheel) but keeps plain scrolling", () => {
    expect(isPageZoom({ type: "wheel", ctrlKey: true })).toBe(true);
    expect(isPageZoom({ type: "wheel", ctrlKey: false })).toBe(false);
  });
  it("leaves other events alone", () => {
    expect(isPageZoom({ type: "pointermove" })).toBe(false);
  });
});

describe("lockPageZoom", () => {
  it("prevents a pinch on the target and stops once torn down", () => {
    const target = new EventTarget();
    const pinch = () => {
      const e = new Event("gesturechange", { cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const unlock = lockPageZoom(target);
    expect(pinch()).toBe(true);
    unlock();
    expect(pinch()).toBe(false);
  });
});
