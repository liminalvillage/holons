// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { afterEach, describe, expect, it, vi } from "vitest";
import { geoMessage, requestPosition } from "./geolocate";

type Answer =
  | { fix: { lat: number; lng: number } }
  | { code: number; message?: string }
  | "silent";

/** A geolocation stub that answers each call from a scripted list. */
function fakeGeo(answers: Answer[]) {
  const calls: PositionOptions[] = [];
  const geo = {
    getCurrentPosition(
      ok: PositionCallback,
      fail: PositionErrorCallback,
      opts?: PositionOptions,
    ) {
      calls.push(opts ?? {});
      const answer = answers[calls.length - 1] ?? "silent";
      if (answer === "silent") return;
      if ("fix" in answer)
        ok({
          coords: { latitude: answer.fix.lat, longitude: answer.fix.lng },
        } as GeolocationPosition);
      else
        fail({
          code: answer.code,
          message: answer.message ?? "",
        } as GeolocationPositionError);
    },
  } as unknown as Geolocation;
  return { geo, calls };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("requestPosition", () => {
  it("returns the precise fix without a second ask", async () => {
    const { geo, calls } = fakeGeo([{ fix: { lat: 42.85, lng: 13.57 } }]);
    const res = await requestPosition({ geo, secure: true, fetcher: null });
    expect(res).toEqual({ ok: true, fix: { lat: 42.85, lng: 13.57 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].enableHighAccuracy).toBe(true);
  });

  it("falls back to a coarse ask when the precise one has no fix", async () => {
    // The desktop case: Core Location answers POSITION_UNAVAILABLE while the
    // network fix is right there.
    const { geo, calls } = fakeGeo([{ code: 2 }, { fix: { lat: 1, lng: 2 } }]);
    const res = await requestPosition({ geo, secure: true, fetcher: null });
    expect(res).toEqual({ ok: true, fix: { lat: 1, lng: 2 } });
    expect(calls).toHaveLength(2);
    expect(calls[1].enableHighAccuracy).toBe(false);
    expect(calls[1].timeout).toBeGreaterThan(calls[0].timeout ?? 0);
  });

  it("retries a timeout too", async () => {
    const { geo, calls } = fakeGeo([{ code: 3 }, { fix: { lat: 1, lng: 2 } }]);
    const res = await requestPosition({ geo, secure: true, fetcher: null });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a refusal", async () => {
    const { geo, calls } = fakeGeo([{ code: 1, message: "User denied" }]);
    const res = await requestPosition({ geo, secure: true, fetcher: null });
    expect(res).toEqual({ ok: false, reason: "denied", detail: "User denied" });
    expect(calls).toHaveLength(1);
  });

  it("keeps the named cause when the retry only times out", async () => {
    const { geo } = fakeGeo([{ code: 2 }, { code: 3 }]);
    const res = await requestPosition({ geo, secure: true, fetcher: null });
    expect(res).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("settles when the browser never calls back", async () => {
    vi.useFakeTimers();
    const { geo } = fakeGeo(["silent", "silent"]);
    const pending = requestPosition({ geo, secure: true, fetcher: null });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      reason: "timeout",
    });
  });

  it("names an insecure origin rather than blaming a permission", async () => {
    const { geo, calls } = fakeGeo([{ fix: { lat: 1, lng: 2 } }]);
    const res = await requestPosition({ geo, secure: false, fetcher: null });
    expect(res).toEqual({ ok: false, reason: "insecure" });
    expect(calls).toHaveLength(0);
  });

  it("names a browser with no geolocation at all", async () => {
    const res = await requestPosition({
      geo: null,
      secure: true,
      fetcher: null,
    });
    expect(res).toEqual({ ok: false, reason: "unsupported" });
  });
});

describe("geoMessage", () => {
  it("gives every reason its own message", () => {
    const keys = (
      ["unsupported", "insecure", "denied", "unavailable", "timeout"] as const
    ).map(geoMessage);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the IP last resort", () => {
  /** A fetch stub answering each URL from a table. */
  const fetcher = (table: Record<string, unknown | "fail">) =>
    (async (url: string | URL | Request) => {
      const key = String(url);
      const body = table[key];
      if (body === undefined || body === "fail")
        return { ok: false, status: 503, json: async () => ({}) } as Response;
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;

  it("answers approximately when the device cannot locate itself", async () => {
    // The hotspot case: CoreLocation never learns a phone's BSSID, so both
    // browser asks come back unavailable, forever.
    const { geo } = fakeGeo([{ code: 2 }, { code: 2 }]);
    const res = await requestPosition({
      geo,
      secure: true,
      fetcher: fetcher({
        "https://ipwho.is/": {
          success: true,
          latitude: 42.85,
          longitude: 13.57,
        },
      }),
    });
    expect(res).toEqual({
      ok: true,
      fix: { lat: 42.85, lng: 13.57 },
      approximate: true,
    });
  });

  it("falls through to the second service", async () => {
    const { geo } = fakeGeo([{ code: 2 }, { code: 2 }]);
    const res = await requestPosition({
      geo,
      secure: true,
      fetcher: fetcher({
        "https://ipwho.is/": "fail",
        "https://ipapi.co/json/": { latitude: "1.5", longitude: "2.5" },
      }),
    });
    expect(res).toMatchObject({ ok: true, fix: { lat: 1.5, lng: 2.5 } });
  });

  it("never goes around a refusal", async () => {
    const { geo } = fakeGeo([{ code: 1 }]);
    const res = await requestPosition({
      geo,
      secure: true,
      fetcher: fetcher({
        "https://ipwho.is/": { latitude: 1, longitude: 2 },
      }),
    });
    expect(res).toMatchObject({ ok: false, reason: "denied" });
  });

  it("keeps the browser's own fix when it has one", async () => {
    const { geo } = fakeGeo([{ fix: { lat: 9, lng: 9 } }]);
    const res = await requestPosition({
      geo,
      secure: true,
      fetcher: fetcher({ "https://ipwho.is/": { latitude: 1, longitude: 2 } }),
    });
    expect(res).toEqual({ ok: true, fix: { lat: 9, lng: 9 } });
  });

  it("reports the browser failure when the lookup answers nothing usable", async () => {
    const { geo } = fakeGeo([{ code: 2 }, { code: 2 }]);
    const res = await requestPosition({
      geo,
      secure: true,
      fetcher: fetcher({
        "https://ipwho.is/": { success: false },
        "https://ipapi.co/json/": { latitude: 0, longitude: 0 },
      }),
    });
    expect(res).toMatchObject({ ok: false, reason: "unavailable" });
  });

  it("still helps a screen served over plain http", async () => {
    const { geo } = fakeGeo([]);
    const res = await requestPosition({
      geo,
      secure: false,
      fetcher: fetcher({ "https://ipwho.is/": { latitude: 3, longitude: 4 } }),
    });
    expect(res).toMatchObject({ fix: { lat: 3, lng: 4 }, approximate: true });
  });
});
