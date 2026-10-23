// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from "vitest";
import { holonForLaunch, launchFromUrl, type MiniAppLaunch } from "./miniapp";

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

describe("launchFromUrl", () => {
  const initData =
    "query_id=AAH&user=" +
    encodeURIComponent(JSON.stringify({ id: 235114395, first_name: "R" })) +
    "&start_param=-1001234567890&auth_date=1&hash=abc";
  const hash =
    "#tgWebAppData=" +
    encodeURIComponent(initData) +
    "&tgWebAppVersion=8.0&tgWebAppPlatform=ios";

  it("reads the signed launch Telegram put in the fragment", () => {
    expect(launchFromUrl(hash)).toEqual({
      initData,
      startParam: "-1001234567890",
      userId: "235114395",
    });
  });

  it("falls back to the SDK's saved copy when a reload dropped it", () => {
    const stored = JSON.stringify({ tgWebAppData: initData });
    expect(launchFromUrl("", stored)?.initData).toBe(initData);
  });

  it("is nothing on an ordinary visit", () => {
    expect(launchFromUrl("")).toBeNull();
    expect(launchFromUrl("#task=42")).toBeNull();
    expect(launchFromUrl("", "not json")).toBeNull();
  });
});
