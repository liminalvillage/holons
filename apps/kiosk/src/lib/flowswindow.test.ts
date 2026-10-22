// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { describeWindow, describeWindowSpan } from "./flowswindow";
import type { Translator } from "./i18n";

// A translator that shows what it was asked, so the assertions read the
// key and its parameters rather than one language's words.
const tr = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key) as unknown as Translator;

const NOW = new Date(2026, 8, 16, 15, 30).getTime();

describe("describeWindow", () => {
  it("names a preset", () => {
    expect(describeWindow({ preset: "month" }, tr, "en", NOW)).toBe(
      "flows.windowMonth",
    );
    expect(describeWindow({ preset: "all" }, tr, "en", NOW)).toBe(
      "flows.windowAll",
    );
  });

  it("spells custom bounds as dates, either end optional", () => {
    expect(
      describeWindow(
        { preset: "custom", from: "2026-06-01", to: "2026-06-30" },
        tr,
        "en",
        NOW,
      ),
    ).toBe("Jun 1, 2026 – Jun 30, 2026");
    expect(
      describeWindow({ preset: "custom", from: "2026-06-01" }, tr, "en", NOW),
    ).toBe('flows.windowSince({"date":"Jun 1, 2026"})');
    expect(
      describeWindow({ preset: "custom", to: "2026-06-30" }, tr, "en", NOW),
    ).toBe('flows.windowUntil({"date":"Jun 30, 2026"})');
    expect(describeWindow({ preset: "custom" }, tr, "en", NOW)).toBe(
      "flows.windowAll",
    );
  });
});

describe("describeWindowSpan", () => {
  it("counts the days of a bounded period and says nothing for an open one", () => {
    expect(describeWindowSpan({ preset: "30" }, tr, NOW)).toBe(
      'flows.windowDays({"n":"30"})',
    );
    expect(
      describeWindowSpan(
        { preset: "custom", from: "2026-06-01", to: "2026-06-30" },
        tr,
        NOW,
      ),
    ).toBe('flows.windowDays({"n":"30"})');
    expect(describeWindowSpan({ preset: "all" }, tr, NOW)).toBe("");
  });
});
