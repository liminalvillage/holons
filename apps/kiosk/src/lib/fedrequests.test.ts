// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, test, vi } from "vitest";
import type { HoloSphere } from "holosphere";
import type { FederationRequest } from "@holons/core/federation";
import { watchFedRequests } from "./fedrequests";

const req = (from: string): FederationRequest => ({
  id: from,
  from,
  to: "-1",
  kind: "link",
  inbound: ["library"],
  outbound: [],
  status: "pending",
  proposedAt: 1,
  at: 1,
});

function fakeHs() {
  const subs: Array<{ holon: string; lens: string; cb: () => void }> = [];
  const unsubscribe = vi.fn();
  const hs = {
    subscribe: (holon: string, lens: string, cb: () => void) => {
      subs.push({ holon, lens, cb });
      return { unsubscribe };
    },
  } as unknown as HoloSphere;
  return { hs, subs, unsubscribe };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("watchFedRequests", () => {
  test("reads on bind, again after a lens change and a local edit — debounced", async () => {
    vi.useFakeTimers();
    const { hs, subs } = fakeHs();
    const target = new EventTarget();
    let answer = [req("-2")];
    const load = vi.fn(async () => answer);
    const seen: FederationRequest[][] = [];
    watchFedRequests(hs, "-1", (l) => seen.push(l), {
      load,
      target,
      debounceMs: 100,
    });
    await vi.runAllTimersAsync();
    expect(seen).toEqual([[req("-2")]]);
    expect(subs[0]).toMatchObject({ holon: "-1", lens: "fedrequests" });

    answer = [req("-2"), req("-3")];
    subs[0].cb();
    subs[0].cb();
    target.dispatchEvent(new Event("kiosk:federation-changed"));
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)).toEqual([req("-2"), req("-3")]);
  });

  test("stop drops the subscription, the listener and late answers", async () => {
    vi.useFakeTimers();
    const { hs, subs, unsubscribe } = fakeHs();
    const target = new EventTarget();
    const load = vi.fn(async () => [req("-2")]);
    const onChange = vi.fn();
    const stop = watchFedRequests(hs, "-1", onChange, {
      load,
      target,
      debounceMs: 50,
    });
    stop();
    await vi.runAllTimersAsync();
    expect(onChange).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
    subs[0].cb();
    target.dispatchEvent(new Event("kiosk:federation-changed"));
    await vi.runAllTimersAsync();
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("a failed read keeps what is shown", async () => {
    const { hs } = fakeHs();
    const onChange = vi.fn();
    watchFedRequests(hs, "-1", onChange, {
      load: async () => {
        throw new Error("offline");
      },
      target: null,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
  });
});
