// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  PAGE_SEGMENTS,
  hrefForPage,
  opensChoose,
  pageForPath,
  pathForChoose,
  pathForPage,
  pathForTab,
  tabForPath,
} from "./tabroute";
import { TABS } from "./stores";

describe("tabForPath", () => {
  it("reads a bare tab path", () => {
    expect(tabForPath("/tasks")).toBe("tasks");
    expect(tabForPath("/calendar/")).toBe("calendar");
  });

  it("reads the tab after a holon segment", () => {
    expect(tabForPath("/liminal/shifts")).toBe("shifts");
    expect(tabForPath("/-1001234567890/library")).toBe("library");
  });

  it("is case-insensitive, like the rest of the URL grammar", () => {
    expect(tabForPath("/Tasks")).toBe("tasks");
  });

  it("names no tab on the root, a holon-only path, or junk", () => {
    expect(tabForPath("/")).toBeNull();
    expect(tabForPath("")).toBeNull();
    expect(tabForPath("/liminal")).toBeNull();
    expect(tabForPath("/liminal/nope")).toBeNull();
    expect(tabForPath("/about")).toBeNull();
  });
});

describe("pathForTab", () => {
  it("appends the tab to a tab-less path", () => {
    expect(pathForTab("/", "tasks")).toBe("/tasks");
    expect(pathForTab("/liminal", "calendar")).toBe("/liminal/calendar");
  });

  it("replaces an existing tab segment instead of stacking", () => {
    expect(pathForTab("/tasks", "flows")).toBe("/flows");
    expect(pathForTab("/liminal/tasks", "roles")).toBe("/liminal/roles");
  });

  it("round-trips: the built path parses back to the same tab", () => {
    const p = pathForTab("/-1001234567890", "status");
    expect(tabForPath(p)).toBe("status");
    expect(p).toBe("/-1001234567890/status");
  });
});

describe("the onboarding page", () => {
  it("is the onboarding segment, which is no tab", () => {
    expect(pageForPath("/liminal/onboarding")).toBe("onboarding");
    expect(pageForPath("/Onboarding/")).toBe("onboarding");
    expect(tabForPath("/liminal/onboarding")).toBeNull();
    expect(pageForPath("/liminal/tasks")).toBeNull();
  });

  it("gives way to a tab once the board opens", () => {
    expect(pathForTab("/liminal/onboarding", "calendar")).toBe(
      "/liminal/calendar",
    );
  });
});

describe("page segments", () => {
  it("are dna, apply and onboarding, and never a tab", () => {
    expect([...PAGE_SEGMENTS]).toEqual(["dna", "apply", "onboarding"]);
    for (const p of PAGE_SEGMENTS)
      expect(
        TABS.some((t) => (t.id as string) === p),
        p,
      ).toBe(false);
  });

  it("are read off the last segment, with or without a holon", () => {
    expect(pageForPath("/dna")).toBe("dna");
    expect(pageForPath("/liminal/apply")).toBe("apply");
    expect(pageForPath("/-1003864542239/DNA/")).toBe("dna");
    expect(pageForPath("/liminal/onboarding")).toBe("onboarding");
    expect(pageForPath("/liminal")).toBeNull();
    expect(pageForPath("/liminal/tasks")).toBeNull();
    expect(tabForPath("/liminal/dna")).toBeNull();
  });

  it("swap with tabs and with each other, keeping the holon as written", () => {
    expect(pathForPage("/liminal/tasks", "dna")).toBe("/liminal/dna");
    expect(pathForPage("/liminal/dna", "apply")).toBe("/liminal/apply");
    expect(pathForPage("/liminal/apply", null)).toBe("/liminal");
    expect(pathForPage("/", "dna")).toBe("/dna");
    expect(pathForPage("/-1003864542239", "apply")).toBe(
      "/-1003864542239/apply",
    );
    expect(pathForTab("/liminal/dna", "calendar")).toBe("/liminal/calendar");
  });

  it("links keep the query but drop one page's own parameters", () => {
    const url = {
      pathname: "/liminal/dna",
      search: "?app=HolonsDebug&edit&dna=abc",
    };
    expect(hrefForPage(url, "apply")).toBe("/liminal/apply?app=HolonsDebug");
    expect(hrefForPage(url, "apply", { dna: "f".repeat(8) })).toBe(
      "/liminal/apply?app=HolonsDebug&dna=ffffffff",
    );
    expect(hrefForPage({ pathname: "/liminal", search: "" }, "dna")).toBe(
      "/liminal/dna",
    );
  });
});

describe("the Choose deck link", () => {
  it("opens the Tasks tab with the deck over it", () => {
    expect(tabForPath("/liminal/choose")).toBe("tasks");
    expect(tabForPath("/choose")).toBe("tasks");
    expect(opensChoose("/liminal/choose")).toBe(true);
    expect(opensChoose("/Choose/")).toBe(true);
    expect(opensChoose("/liminal/tasks")).toBe(false);
  });

  it("swaps with the tab segment both ways, keeping the holon", () => {
    expect(pathForChoose("/liminal/tasks")).toBe("/liminal/choose");
    expect(pathForChoose("/liminal")).toBe("/liminal/choose");
    expect(pathForChoose("/liminal/choose")).toBe("/liminal/choose");
    expect(pathForTab("/liminal/choose", "tasks")).toBe("/liminal/tasks");
  });
});
