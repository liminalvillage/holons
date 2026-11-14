// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { ALLELE_ICONS, GENE_LIMITS } from "@holons/core/dna";
import {
  ALLELE_ICON_NAME,
  alleleIconName,
  iconWords,
  kb,
  meterLevel,
  starterLang,
} from "./dna";
import { isIconName } from "./icons";
import { en } from "./i18n/en";
import {
  ISSUE_LABEL,
  KIND_LABEL,
  READINESS_LABEL,
  genesSignature,
  handoffHash,
  ANON_WALK_TTL_MS,
  forgetAnonWalks,
  loadWalk,
  readinessWarns,
  saveWalk,
  walkKey,
} from "./dna";

describe("DNA icons", () => {
  it("draws every semantic key core knows, and only those, from the catalog", () => {
    expect(Object.keys(ALLELE_ICON_NAME).sort()).toEqual(
      [...ALLELE_ICONS].sort(),
    );
    for (const key of ALLELE_ICONS)
      expect(isIconName(alleleIconName(key)), key).toBe(true);
  });

  it("reads a key as words", () => {
    expect(iconWords("person-check")).toBe("person check");
  });
});

describe("DNA words", () => {
  it("has a message for every kind and every issue code", () => {
    for (const key of [
      ...Object.values(KIND_LABEL),
      ...Object.values(ISSUE_LABEL),
    ])
      expect(en, key).toHaveProperty([key]);
  });

  it("falls back to English for a language without starter genes", () => {
    expect(starterLang("it")).toBe("it");
    expect(starterLang("es")).toBe("en");
  });
});

describe("size meter", () => {
  it("is red over the cap, a warning from 80%, fine below", () => {
    expect(meterLevel(1000)).toBe("ok");
    expect(meterLevel(GENE_LIMITS.bytes * 0.8)).toBe("warn");
    expect(meterLevel(GENE_LIMITS.bytes)).toBe("warn");
    expect(meterLevel(GENE_LIMITS.bytes + 1)).toBe("over");
    expect(kb(1536)).toBe("1.5");
    expect(kb(48 * 1024)).toBe("48");
  });
});

describe("the walk on this device", () => {
  const H = "-1003864542239";
  const A = "a".repeat(64);
  const B = "b".repeat(64);
  const memory = () => {
    const m = new Map<string, string>();
    return {
      m,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };

  it("is kept per holon and person", () => {
    const store = memory();
    saveWalk(H, "pk1", { acks: { values: A } }, store);
    expect(loadWalk(H, "pk1", store)).toEqual({ acks: { values: A } });
    expect(loadWalk(H, "pk2", store)).toEqual({ acks: {} });
    expect(loadWalk("-1", "pk1", store)).toEqual({ acks: {} });
    expect(walkKey(H, null)).toBe(`dna-walk:${H}:anon`);
  });

  it("folds a walk made just before the login into the person's", () => {
    const store = memory();
    const t = 1_000_000;
    saveWalk(H, null, { acks: { purpose: A, values: A } }, store, t);
    saveWalk(H, "pk1", { acks: { values: B } }, store);
    expect(loadWalk(H, "pk1", store, t + 60_000)).toEqual({
      acks: { purpose: A, values: B },
    });
    expect(store.m.has(walkKey(H, null))).toBe(false);
  });

  it("never hands one person's anonymous walk to the next on a shared wall", () => {
    const store = memory();
    const t = 1_000_000;
    // Someone ticked the walk (or followed a ?dna= handoff) and walked away.
    saveWalk(H, null, { acks: { purpose: A, values: A } }, store, t);
    const later = t + ANON_WALK_TTL_MS + 1;
    // The next visitor sees nothing ticked, and the stale walk is gone…
    expect(loadWalk(H, null, store, later)).toEqual({ acks: {} });
    expect(store.m.has(walkKey(H, null))).toBe(false);
    // …and nothing of it is folded into whoever logs in later.
    saveWalk(H, null, { acks: { purpose: A } }, store, t);
    expect(loadWalk(H, "pk2", store, later)).toEqual({ acks: {} });
    expect(store.m.has(walkKey(H, null))).toBe(false);
  });

  it("folds an anonymous walk into one login only", () => {
    const store = memory();
    const t = 1_000_000;
    saveWalk(H, null, { acks: { purpose: A } }, store, t);
    expect(loadWalk(H, "pk1", store, t + 1000)).toEqual({
      acks: { purpose: A },
    });
    expect(loadWalk(H, "pk2", store, t + 2000)).toEqual({ acks: {} });
  });

  it("drops an anonymous walk with no stamp or one from the future", () => {
    const store = memory();
    store.setItem(walkKey(H, null), JSON.stringify({ acks: { purpose: A } }));
    expect(loadWalk(H, "pk1", store, 5)).toEqual({ acks: {} });
    saveWalk(H, null, { acks: { purpose: A } }, store, 10_000);
    expect(loadWalk(H, null, store, 5)).toEqual({ acks: {} });
  });

  it("forgets every anonymous walk on logout, and no one's own", () => {
    const m = new Map<string, string>();
    const store = {
      get length() {
        return m.size;
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    saveWalk(H, null, { acks: { purpose: A } }, store);
    saveWalk("-2", null, { acks: { purpose: A } }, store);
    saveWalk(H, "pk1", { acks: { purpose: A } }, store);
    m.set("other", "x");
    forgetAnonWalks(store);
    expect([...m.keys()].sort()).toEqual([walkKey(H, "pk1"), "other"].sort());
    expect(() => forgetAnonWalks(null)).not.toThrow();
  });

  it("starts over on anything unreadable, and survives no storage", () => {
    const store = memory();
    store.setItem(walkKey(H, "pk1"), "{not json");
    expect(loadWalk(H, "pk1", store)).toEqual({ acks: {} });
    store.setItem(walkKey(H, "pk1"), JSON.stringify({ acks: { x: "nope" } }));
    expect(loadWalk(H, "pk1", store)).toEqual({ acks: {} });
    expect(loadWalk(H, "pk1", null)).toEqual({ acks: {} });
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => saveWalk(H, "pk1", { acks: {} }, throwing)).not.toThrow();
    expect(loadWalk(H, "pk1", throwing)).toEqual({ acks: {} });
  });

  it("reads a handoff hash only when it is one", () => {
    expect(handoffHash(`?dna=${A.toUpperCase()}`)).toBe(A);
    expect(handoffHash("?dna=e961512c")).toBeNull();
    expect(handoffHash("?edit")).toBeNull();
  });

  it("tells a change of genes from a replay", () => {
    const g = [
      { id: "values", updated: "2026-11-01T00:00:00Z" },
      { id: "purpose", updated: "2026-11-02T00:00:00Z" },
    ];
    expect(genesSignature(g)).toBe(genesSignature([...g].reverse()));
    expect(genesSignature(g)).not.toBe(
      genesSignature([{ ...g[0], updated: "2026-11-03T00:00:00Z" }, g[1]]),
    );
  });
});

describe("readiness badges", () => {
  it("name every readiness that says something, in the catalog", () => {
    for (const key of Object.values(READINESS_LABEL))
      if (key) expect(en, key).toHaveProperty([key]);
    expect(READINESS_LABEL["none-required"]).toBeNull();
    expect(readinessWarns("outdated")).toBe(true);
    expect(readinessWarns("missing")).toBe(true);
    expect(readinessWarns("acknowledged")).toBe(false);
  });
});
