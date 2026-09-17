// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { isIos, resolveInstallMode, type InstallEnv } from "./install";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1";
// iPadOS asks for desktop sites: it claims to be a Mac.
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX =
  "Mozilla/5.0 (Android 15; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0";

const env = (over: Partial<InstallEnv>): InstallEnv => ({
  standalone: false,
  inTelegram: false,
  hasPrompt: false,
  userAgent: ANDROID_CHROME,
  maxTouchPoints: 5,
  ...over,
});

describe("isIos", () => {
  it("knows an iPhone in any browser", () => {
    expect(isIos(IPHONE, 5)).toBe(true);
    expect(isIos(IPHONE_CHROME, 5)).toBe(true);
  });
  it("tells an iPad from the Mac it claims to be by its touch screen", () => {
    expect(isIos(MAC_SAFARI, 5)).toBe(true);
    expect(isIos(MAC_SAFARI, 0)).toBe(false);
  });
  it("is not fooled by Android", () => {
    expect(isIos(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe("resolveInstallMode", () => {
  it("offers nothing once running from the home screen", () => {
    expect(resolveInstallMode(env({ standalone: true, hasPrompt: true }))).toBe(
      "hidden",
    );
    expect(
      resolveInstallMode(env({ standalone: true, userAgent: IPHONE })),
    ).toBe("hidden");
  });

  it("offers nothing inside Telegram, which cannot install", () => {
    expect(
      resolveInstallMode(env({ inTelegram: true, userAgent: IPHONE })),
    ).toBe("hidden");
  });

  it("uses the browser's own dialog when it handed us one", () => {
    expect(resolveInstallMode(env({ hasPrompt: true }))).toBe("prompt");
  });

  it("walks iOS through Share → Add to Home Screen", () => {
    expect(resolveInstallMode(env({ userAgent: IPHONE }))).toBe("ios");
    expect(resolveInstallMode(env({ userAgent: IPHONE_CHROME }))).toBe("ios");
    expect(resolveInstallMode(env({ userAgent: MAC_SAFARI }))).toBe("ios");
  });

  it("points everyone else at their browser's menu", () => {
    expect(resolveInstallMode(env({ userAgent: ANDROID_FIREFOX }))).toBe(
      "manual",
    );
    expect(
      resolveInstallMode(env({ userAgent: MAC_SAFARI, maxTouchPoints: 0 })),
    ).toBe("manual");
    // Chromium before (or without) its event: the menu still has "Install".
    expect(resolveInstallMode(env({}))).toBe("manual");
  });
});
