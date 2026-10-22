// SPDX-License-Identifier: AGPL-3.0-or-later
// The board's resting view: with nothing pinned and no deep link the kiosk
// opens on the Calendar, and an active tab that vanishes falls back to it
// while it is on the strip.
import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TAB,
  activeTab,
  calendarEnabled,
  flowsEnabled,
  selectTab,
  tasksEnabled,
  visibleTabs,
} from "./stores";

describe("default tab", () => {
  it("is the calendar", () => {
    expect(DEFAULT_TAB).toBe("calendar");
    expect(get(activeTab)).toBe("calendar");
  });

  it("falls back to the calendar when the active tab is hidden", () => {
    selectTab("tasks");
    expect(get(activeTab)).toBe("tasks");
    tasksEnabled.set(false);
    expect(get(visibleTabs).some((t) => t.id === "tasks")).toBe(false);
    expect(get(activeTab)).toBe("calendar");
    tasksEnabled.set(true);
  });

  it("falls back to the first tab on the strip when the calendar is hidden too", () => {
    // No holon content in a test, so only the opt-in Flows board can be on
    // the strip once the two default tabs are switched off.
    flowsEnabled.set(true);
    selectTab("tasks");
    calendarEnabled.set(false);
    tasksEnabled.set(false);
    expect(get(visibleTabs).map((t) => t.id)).toEqual(["flows"]);
    expect(get(activeTab)).toBe("flows");
    calendarEnabled.set(true);
    tasksEnabled.set(true);
    flowsEnabled.set(false);
  });
});
