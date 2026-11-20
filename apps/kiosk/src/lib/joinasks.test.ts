// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, test, vi } from "vitest";
import { get } from "svelte/store";
import type { ReadiedRequest } from "./hubmembers";
import { bindJoinAsks, joinAsks, settleJoinAsk } from "./joinasks";

const HOLON = "holon_ygqkeu2bvnai5dpu";
const ask = (pubkey: string): ReadiedRequest => ({
  pubkey,
  at: 1,
  reason: "Kamala",
  eventId: `e-${pubkey}`,
  holon: HOLON,
  readiness: "none-required",
});

/** A stand-in for `watchRequests`: hands back what it was given to say. */
function fakeWatch() {
  const stop = vi.fn();
  const said: Array<(r: ReadiedRequest[]) => void> = [];
  const watch = vi.fn((_hub: string, on: (r: ReadiedRequest[]) => void) => {
    said.push(on);
    return stop;
  });
  return { watch, said, stop };
}

afterEach(() => bindJoinAsks(null, false));

describe("bindJoinAsks", () => {
  test("an admin of a keyed holon is shown who is asking", () => {
    const { watch, said } = fakeWatch();
    bindJoinAsks(HOLON, true, watch);
    expect(watch).toHaveBeenCalledWith(HOLON, expect.any(Function));
    said[0]([ask("aa")]);
    expect(get(joinAsks)).toEqual([ask("aa")]);
  });

  test("nobody else is: no watch without the right to answer", () => {
    const { watch } = fakeWatch();
    bindJoinAsks(HOLON, false, watch);
    expect(watch).not.toHaveBeenCalled();
    expect(get(joinAsks)).toEqual([]);
  });

  test("a holon that keeps no members log (a hex cell) is never asked", () => {
    const { watch } = fakeWatch();
    bindJoinAsks("881e8a0a01fffff", true, watch);
    expect(watch).not.toHaveBeenCalled();
  });

  test("another board drops the list and the old watch; a late word is ignored", () => {
    const a = fakeWatch();
    bindJoinAsks(HOLON, true, a.watch);
    a.said[0]([ask("aa")]);
    const b = fakeWatch();
    bindJoinAsks("-1001234567890", true, b.watch);
    expect(a.stop).toHaveBeenCalled();
    expect(get(joinAsks)).toEqual([]);
    a.said[0]([ask("bb")]);
    expect(get(joinAsks)).toEqual([]);
  });

  test("binding the same board again keeps the one watch", () => {
    const { watch } = fakeWatch();
    bindJoinAsks(HOLON, true, watch);
    bindJoinAsks(HOLON, true, watch);
    expect(watch).toHaveBeenCalledTimes(1);
  });

  test("an answered ask no longer waits", () => {
    const { watch, said } = fakeWatch();
    bindJoinAsks(HOLON, true, watch);
    said[0]([ask("aa"), ask("bb")]);
    settleJoinAsk("aa");
    expect(get(joinAsks).map((r) => r.pubkey)).toEqual(["bb"]);
  });
});
