// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { createMoment } from "./calendarcreate";

const NOW = new Date(2026, 9, 21, 15, 30); // Wed 21 Oct 2026, 15:30
const day = (d: number, m = 9) => new Date(2026, m, d);

describe("createMoment", () => {
  it("is now while today is on screen", () => {
    expect(createMoment({ start: day(21), end: day(22) }, NOW)).toBe(NOW);
    expect(createMoment({ start: day(18), end: day(25) }, NOW)).toBe(NOW);
    expect(createMoment({ start: day(1), end: day(1, 10) }, NOW)).toBe(NOW);
  });
  it("lands on the window's first day, at the present time, when today is not", () => {
    const next = createMoment({ start: day(27), end: day(28) }, NOW);
    expect(next.getTime()).toBe(new Date(2026, 9, 27, 15, 30).getTime());
    const past = createMoment({ start: day(4), end: day(11) }, NOW);
    expect(past.getTime()).toBe(new Date(2026, 9, 4, 15, 30).getTime());
  });
  it("treats the window end as exclusive", () => {
    const edge = new Date(2026, 9, 22, 0, 0);
    expect(createMoment({ start: day(21), end: day(22) }, edge).getTime()).toBe(
      new Date(2026, 9, 21, 0, 0).getTime(),
    );
  });
});
