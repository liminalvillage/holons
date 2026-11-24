// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { watchOpenCount } from "./myholon";

function fakeHost() {
  let cb: ((items: unknown[]) => void) | null = null;
  const unsubscribe = vi.fn();
  const subscribeFederated = vi.fn(
    (_h: string, _l: string, fn: (items: unknown[]) => void) => {
      cb = fn;
      return { unsubscribe };
    },
  );
  return {
    host: { subscribeFederated } as any,
    emit: (items: unknown[]) => cb?.(items),
    subscribeFederated,
    unsubscribe,
  };
}

describe("watchOpenCount", () => {
  it("counts the person's own quests by core's rule, only on change", () => {
    const f = fakeHost();
    const seen: number[] = [];
    const stop = watchOpenCount(f.host, "42", (n) => seen.push(n), {
      now: () => new Date(2026, 10, 24, 12),
    });
    expect(f.subscribeFederated).toHaveBeenCalledWith(
      "42",
      "quests",
      expect.any(Function),
      { includeFederated: false },
    );
    f.emit([
      { id: "a", title: "A", status: "ongoing" },
      { id: "b", title: "B", status: "completed" },
    ]);
    f.emit([
      { id: "a", title: "A", status: "ongoing" },
      { id: "b", title: "B", status: "completed" },
    ]);
    f.emit([]);
    expect(seen).toEqual([1, 0]);
    stop();
    expect(f.unsubscribe).toHaveBeenCalled();
  });
});
