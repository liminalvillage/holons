// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { createAutosave } from "./autosave";

describe("createAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(value: { v: string | null } = { v: "a" }) {
    const puts: string[] = [];
    const put = vi.fn(async (v: string) => {
      puts.push(v);
      return true;
    });
    const saver = createAutosave(() => value.v, put, {
      delay: 100,
      savedFor: 50,
    });
    return { saver, puts, put, value };
  }

  it("opening a form saves nothing", async () => {
    const { saver, put } = setup();
    saver.watch("k1");
    await vi.advanceTimersByTimeAsync(500);
    expect(put).not.toHaveBeenCalled();
    expect(get(saver)).toBe("idle");
  });

  it("a burst of edits becomes one write after the quiet spell", async () => {
    const { saver, puts, value } = setup();
    saver.watch("k1");
    saver.watch("k2");
    await vi.advanceTimersByTimeAsync(60);
    value.v = "b";
    saver.watch("k3");
    await vi.advanceTimersByTimeAsync(60);
    expect(puts).toEqual([]);
    await vi.advanceTimersByTimeAsync(60);
    expect(puts).toEqual(["b"]);
    expect(get(saver)).toBe("saved");
    await vi.advanceTimersByTimeAsync(60);
    expect(get(saver)).toBe("idle");
  });

  it("an unchanged key does not write", async () => {
    const { saver, put } = setup();
    saver.watch("k1");
    saver.watch("k1");
    await vi.advanceTimersByTimeAsync(500);
    expect(put).not.toHaveBeenCalled();
  });

  it("flush builds the payload at once, so a torn-down form still lands", async () => {
    const { saver, puts, value } = setup();
    saver.watch("k1");
    saver.watch("k2");
    const done = saver.flush();
    value.v = "gone"; // the form resets right after the close
    expect(await done).toBe(true);
    expect(puts).toEqual(["a"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(puts).toEqual(["a"]); // nothing left waiting
  });

  it("an invalid form (null payload) is not written", async () => {
    const { saver, put } = setup({ v: null });
    saver.watch("k1");
    saver.watch("k2");
    await saver.flush();
    expect(put).not.toHaveBeenCalled();
  });

  it("writes go out in order, one at a time", async () => {
    const order: string[] = [];
    let release!: () => void;
    const value = { v: "first" };
    const saver = createAutosave(
      () => value.v,
      async (v) => {
        order.push(`start ${v}`);
        if (v === "first") await new Promise<void>((r) => (release = r));
        order.push(`end ${v}`);
        return true;
      },
      { delay: 10 },
    );
    saver.touch();
    await vi.advanceTimersByTimeAsync(10);
    value.v = "second";
    saver.touch();
    const flushed = saver.flush();
    expect(get(saver)).toBe("saving");
    release();
    await flushed;
    expect(order).toEqual([
      "start first",
      "end first",
      "start second",
      "end second",
    ]);
    expect(get(saver)).toBe("saved");
  });

  it("a failed write shows as an error", async () => {
    const saver = createAutosave(
      () => "x",
      async () => false,
      { delay: 10 },
    );
    saver.touch();
    expect(await saver.flush()).toBe(false);
    expect(get(saver)).toBe("error");
  });

  it("retry sends the failed write again", async () => {
    let fail = true;
    const puts: string[] = [];
    const saver = createAutosave(
      () => "x",
      async (v) => {
        puts.push(v);
        return !fail;
      },
      { delay: 10 },
    );
    saver.touch();
    await saver.flush();
    expect(get(saver)).toBe("error");
    fail = false;
    expect(await saver.retry()).toBe(true);
    expect(puts).toEqual(["x", "x"]);
    expect(get(saver)).toBe("saved");
  });

  it("cancel drops the waiting write", async () => {
    const { saver, put } = setup();
    saver.touch();
    saver.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(put).not.toHaveBeenCalled();
  });
});
