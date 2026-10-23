// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { holonForLaunch, type MiniAppLaunch } from "./miniapp";

const launch = (over: Partial<MiniAppLaunch> = {}): MiniAppLaunch => ({
  initData: "signed",
  startParam: null,
  userId: "235114395",
  ...over,
});

describe("holonForLaunch", () => {
  it("opens the holon the button named", () => {
    expect(holonForLaunch(launch({ startParam: "-1001234567890" }))).toBe(
      "-1001234567890",
    );
    expect(
      holonForLaunch(launch({ startParam: "holon_fig33pftaepw96i4" })),
    ).toBe("holon_fig33pftaepw96i4");
  });

  it("falls back to the launching person's own holon", () => {
    expect(holonForLaunch(launch())).toBe("235114395");
    expect(holonForLaunch(launch({ startParam: "not a holon!" }))).toBe(
      "235114395",
    );
  });

  it("is nothing outside Telegram", () => {
    expect(holonForLaunch(null)).toBeNull();
  });
});
