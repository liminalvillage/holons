// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { pathForTab, tabForPath } from "./tabroute";

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
    expect(tabForPath("/key")).toBeNull();
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
