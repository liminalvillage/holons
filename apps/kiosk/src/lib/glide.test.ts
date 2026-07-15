// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { glide } from "./glide";

const rect = (left: number, top: number) => ({ left, top }) as DOMRect;
const node = null as unknown as Element;

describe("glide", () => {
  it("translates from the old position to rest, never scaling", () => {
    const g = glide(node, { from: rect(100, 40), to: rect(20, 200) });
    expect(g.css(0, 1)).toBe("transform: translate(80px, -160px);");
    expect(g.css(1, 0)).toBe("transform: translate(0px, 0px);");
    expect(g.css(0.5, 0.5)).not.toContain("scale");
  });

  it("defaults to 220ms and accepts overrides", () => {
    expect(glide(node, { from: rect(0, 0), to: rect(0, 0) }).duration).toBe(
      220,
    );
    expect(
      glide(node, { from: rect(0, 0), to: rect(0, 0) }, { duration: 90 })
        .duration,
    ).toBe(90);
  });
});
