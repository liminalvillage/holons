// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import {
  opensChoose,
  opensOnboarding,
  pathForChoose,
  pathForTab,
  tabForPath,
} from "./tabroute";

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

describe("opensOnboarding", () => {
  it("is the onboarding segment, which is no tab", () => {
    expect(opensOnboarding("/liminal/onboarding")).toBe(true);
    expect(opensOnboarding("/Onboarding/")).toBe(true);
    expect(tabForPath("/liminal/onboarding")).toBeNull();
    expect(opensOnboarding("/liminal/tasks")).toBe(false);
  });

  it("gives way to a tab once the board opens", () => {
    expect(pathForTab("/liminal/onboarding", "calendar")).toBe(
      "/liminal/calendar",
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

describe("tab aliases", () => {
  it("opens the tab an alias names", () => {
    expect(tabForPath("/lists")).toBe("checklists");
    expect(tabForPath("/liminal/quests")).toBe("tasks");
    expect(tabForPath("/liminal/need")).toBe("offers");
    expect(tabForPath("/liminal/Needs")).toBe("offers");
  });

  it("is replaced by the tab's own id when a tab is reflected", () => {
    expect(pathForTab("/liminal/lists", "checklists")).toBe(
      "/liminal/checklists",
    );
    expect(pathForTab("/quests", "calendar")).toBe("/calendar");
  });
});
