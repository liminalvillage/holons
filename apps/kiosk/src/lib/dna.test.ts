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

  it("folds a walk made before the login into the person's", () => {
    const store = memory();
    saveWalk(H, null, { acks: { purpose: A, values: A } }, store);
    saveWalk(H, "pk1", { acks: { values: B } }, store);
    expect(loadWalk(H, "pk1", store)).toEqual({
      acks: { purpose: A, values: B },
    });
    expect(store.m.has(walkKey(H, null))).toBe(false);
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
