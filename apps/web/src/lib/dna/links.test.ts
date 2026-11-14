// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import {
  applyHref,
  dnaHref,
  editDnaHref,
  holonHref,
  isExternal,
  safeHref,
} from "./links";

describe("dna links", () => {
  it("points the dashboard pages at the holon", () => {
    expect(dnaHref("-1003864542239")).toBe("/-1003864542239/dna");
    expect(applyHref("-1003864542239")).toBe("/-1003864542239/apply");
    expect(holonHref("a b")).toBe("/a%20b");
  });

  it('sends "Edit DNA" to the one editor, the kiosk', () => {
    expect(editDnaHref("-1003864542239")).toMatch(
      /^https?:\/\/[^/]+\/-1003864542239\/dna\?edit$/,
    );
  });

  it("follows only links a gene may carry", () => {
    for (const ok of [
      "https://liminalvillage.com/",
      "http://a.b",
      "mailto:hi@x.org",
      "tg://resolve?domain=x",
      "/dna",
      "#top",
    ])
      expect(safeHref(ok), ok).toBe(ok);
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "//evil.example",
      "ftp://x",
      "",
      "  ",
      "https://a b",
    ])
      expect(safeHref(bad), bad).toBeNull();
    expect(safeHref(undefined)).toBeNull();
    expect(isExternal("https://x.org")).toBe(true);
    expect(isExternal("/dna")).toBe(false);
  });
});
