import { describe, expect, it, vi } from "vitest";
import {
  parseHologramWarning,
  cleanupDanglingPointer,
} from "./hologramJanitor";
import type { HoloSphere } from "holosphere";

describe("parseHologramWarning", () => {
  it("extracts holon/lens/key/soul from the holosphere warning", () => {
    const msg =
      "Hologram at 235114395/quests/mpjq9eekt57 did not resolve (soul=Holons/123/quests/mpjq9eekt57); skipping.";
    expect(parseHologramWarning(msg)).toEqual({
      holon: "235114395",
      lens: "quests",
      key: "mpjq9eekt57",
      sourceSoul: "Holons/123/quests/mpjq9eekt57",
    });
  });

  it("returns null for unrelated warnings", () => {
    expect(parseHologramWarning("something else happened")).toBeNull();
    expect(parseHologramWarning("Hologram at malformed")).toBeNull();
  });
});

interface MockOpts {
  source: null | undefined | object | string;
  denyDelete?: boolean;
  readDelay?: number;
}

function mockHolosphere(opts: MockOpts) {
  const del = vi.fn(async () => {
    if (opts.denyDelete) {
      const e: any = new Error("Write access denied");
      e.name = "AuthorizationError";
      throw e;
    }
  });
  const getNodeRef = vi.fn((_soul: string) => ({
    once: (cb: (d: unknown) => void) => {
      if (opts.readDelay) setTimeout(() => cb(opts.source), opts.readDelay);
      else cb(opts.source);
    },
  }));
  return {
    holosphere: { delete: del, getNodeRef } as unknown as HoloSphere,
    del,
  };
}

const sample = {
  holon: "me",
  lens: "quests",
  key: "q1",
  sourceSoul: "Holons/123/quests/q1",
};

describe("cleanupDanglingPointer", () => {
  it("deletes the local pointer when source is explicitly null", async () => {
    const m = mockHolosphere({ source: null });
    await expect(cleanupDanglingPointer(m.holosphere, sample)).resolves.toBe(
      "deleted",
    );
    expect(m.del).toHaveBeenCalledWith("me", "quests", "q1");
  });

  it("keeps the pointer when source returns object data", async () => {
    const m = mockHolosphere({ source: { id: "q1", title: "live" } });
    await expect(cleanupDanglingPointer(m.holosphere, sample)).resolves.toBe(
      "source-alive",
    );
    expect(m.del).not.toHaveBeenCalled();
  });

  it("reports source-unknown when source is undefined (transient miss)", async () => {
    const m = mockHolosphere({ source: undefined });
    await expect(cleanupDanglingPointer(m.holosphere, sample)).resolves.toBe(
      "source-unknown",
    );
    expect(m.del).not.toHaveBeenCalled();
  });

  it("reports source-unknown if the source read times out", async () => {
    const m = mockHolosphere({ source: null, readDelay: 200 });
    await expect(
      cleanupDanglingPointer(m.holosphere, sample, { readTimeoutMs: 30 }),
    ).resolves.toBe("source-unknown");
    expect(m.del).not.toHaveBeenCalled();
  });

  it("returns delete-failed when delete throws but does not propagate the error", async () => {
    const m = mockHolosphere({ source: null, denyDelete: true });
    await expect(cleanupDanglingPointer(m.holosphere, sample)).resolves.toBe(
      "delete-failed",
    );
  });
});
