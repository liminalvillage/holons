// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// GET /api/front/<holon>: an in-memory instance, publishing stubbed — nothing
// here reaches a relay.

import { createRequire } from "node:module";
import { describe, it, expect, vi, afterEach } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import { schnorr } from "@noble/curves/secp256k1";
import { buildEvent } from "holosphere/nostr-events.js";
import type { HoloSphere } from "holosphere";
import { createHoloSphere } from "@holons/core/holosphere";
import { GENES_LENS, putGene, type Gene } from "@holons/core/dna";
import { addHolonMember, foundHolon } from "@holons/core/protocol";
import frontSchema from "../../../../../packages/core/schemas/holon-front.schema.json";
import {
  createFrontService,
  deployedHolosphere,
  FRONT_CACHE,
  FRONT_CACHE_EMPTY,
  HOLON_ID,
} from "./front";

// The real Ajv holosphere already depends on, as core's own front spec does.
const fromHolosphere = createRequire(
  createRequire(import.meta.url).resolve("holosphere"),
);
const Ajv = fromHolosphere("ajv") as new (opts?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & {
    errors?: unknown[] | null;
  };
};
const validate = new Ajv({ allErrors: true, strict: true }).compile(
  frontSchema,
);

function testKey() {
  const sk = schnorr.utils.randomPrivateKey();
  return { sk, pk: bytesToHex(schnorr.getPublicKey(sk)) };
}
const founder = testKey();
const member = testKey();
const H = "holon_frontendpoint1";

function memoryInstance(opts: { enforce?: boolean } = {}): HoloSphere {
  const hs = createHoloSphere({
    appName: "front-endpoint-test",
    privateKey: bytesToHex(founder.sk),
    store: { adapter: "memory" },
    ...opts,
  });
  const h = hs as unknown as {
    publishNostrEvents(e: unknown): void;
    subscribeNostr(): () => void;
  };
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return hs;
}

const gene = (fields: Partial<Gene> & Pick<Gene, "id">) => ({
  kind: "custom" as const,
  title: fields.id,
  blurb: "",
  order: 0,
  ack: "read" as const,
  alleles: [],
  lang: "en",
  updated: "",
  ...fields,
});

async function foundedHolon(): Promise<HoloSphere> {
  const hs = memoryInstance();
  await foundHolon(hs, H, { name: "Front Endpoint" });
  await addHolonMember(hs, H, member.pk, "member");
  await putGene(
    hs,
    H,
    gene({
      id: "purpose",
      kind: "purpose",
      title: "Purpose",
      blurb: "A village that learns to live well together.",
      color: "#2a9d8f",
    }),
    { now: () => new Date("2026-11-11T00:00:00Z") },
  );
  await putGene(
    hs,
    H,
    gene({
      id: "values",
      kind: "values",
      title: "Values",
      blurb: "What we hold on to.",
      order: 1,
      ack: "agree",
      alleles: [
        { id: "care", title: "Care", body: "We look after each other." },
      ],
    }),
    { now: () => new Date("2026-11-10T00:00:00Z") },
  );
  return hs;
}

const open: HoloSphere[] = [];
afterEach(async () => {
  vi.useRealTimers();
  while (open.length) await open.pop()!.close();
});
const track = (hs: HoloSphere) => (open.push(hs), hs);

describe("GET /api/front/<holon>", () => {
  it("answers the holon's front as JSON that validates against the wire schema", async () => {
    const hs = track(await foundedHolon());
    const res = await createFrontService({ holosphere: () => hs }).get(H);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    const front = await res.json();
    const ok = validate(front);
    expect(ok, JSON.stringify(validate.errors)).toBe(true);
    expect(front).toMatchObject({
      schema: 1,
      holon: H,
      name: "Front Endpoint",
      about: "A village that learns to live well together.",
      members: 2,
      viewer: { cta: "apply", edit: false },
    });
    expect(front.genes.map((g: { id: string }) => g.id)).toEqual([
      "purpose",
      "values",
    ]);
    expect(front.dna.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is readable from any origin, without credentials, and cacheable by a CDN", async () => {
    const hs = track(await foundedHolon());
    const res = await createFrontService({ holosphere: () => hs }).get(H);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.has("access-control-allow-credentials")).toBe(false);
    expect(res.headers.get("cache-control")).toBe(FRONT_CACHE);
    expect(FRONT_CACHE).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    // Not a private cache entry: nothing about the caller shapes the answer.
    expect(res.headers.get("cache-control")).not.toMatch(/private|max-age=\d/);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers the CORS preflight", () => {
    const res = createFrontService({ holosphere: memoryInstance }).options();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toMatch(/GET/);
    expect(res.headers.has("access-control-allow-credentials")).toBe(false);
  });

  it("refuses a bad holon id with 400, still readable cross-origin, and never opens an instance", async () => {
    const make = vi.fn(memoryInstance);
    const service = createFrontService({ holosphere: make });
    for (const bad of [
      "",
      "  ",
      "a b",
      "../etc/passwd",
      "holon/../x",
      "x".repeat(65),
      "a;b",
      "<script>",
      "é",
      "a%00b",
    ]) {
      const res = await service.get(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(await res.json()).toMatchObject({ error: "bad-holon" });
    }
    expect(make).not.toHaveBeenCalled();
    for (const good of ["-1003864542239", "235114395", H, "8928308280fffff"])
      expect(HOLON_ID.test(good)).toBe(true);
  });

  it("never serves a gene a member signed", async () => {
    const hs = track(await foundedHolon());
    const store = (
      hs as unknown as { store: { apply(e: unknown, o: unknown): void } }
    ).store;
    const forged = gene({
      id: "terms",
      kind: "terms",
      title: "Terms",
      blurb: "Everyone is in.",
      order: 2,
      alleles: [{ id: "free", title: "Free", body: "Join without asking." }],
      updated: "2026-11-12T00:00:00.000Z",
    });
    store.apply(
      buildEvent({
        holon: H,
        lens: GENES_LENS,
        item: forged,
        sk: member.sk,
        created_at: Math.floor(Date.now() / 1000) + 5,
        extraTags: [["n", "front-endpoint-test"]],
      }),
      { origin: "remote" },
    );
    const body = await (
      await createFrontService({ holosphere: () => hs }).get(H)
    ).json();
    expect(body.genes.map((g: { id: string }) => g.id)).toEqual([
      "purpose",
      "values",
    ]);
    expect(JSON.stringify(body)).not.toContain("Join without asking");
  });

  it("never serves a gene a stranger signed on a holon nobody speaks for", async () => {
    const hs = track(memoryInstance());
    const nobody = "-1009999999999";
    const store = (
      hs as unknown as { store: { apply(e: unknown, o: unknown): void } }
    ).store;
    store.apply(
      buildEvent({
        holon: nobody,
        lens: GENES_LENS,
        item: gene({
          id: "purpose",
          kind: "purpose",
          title: "Purpose",
          blurb: "FORGED BY STRANGER",
          updated: "2026-11-12T00:00:00.000Z",
        }),
        sk: member.sk,
        created_at: Math.floor(Date.now() / 1000),
        extraTags: [["n", "front-endpoint-test"]],
      }),
      { origin: "remote" },
    );
    const res = await createFrontService({ holosphere: () => hs }).get(nobody);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(FRONT_CACHE_EMPTY);
    const body = await res.json();
    expect(body).toMatchObject({ empty: true, genes: [], about: "" });
    expect(JSON.stringify(body)).not.toContain("FORGED BY STRANGER");
  });

  it("answers the anonymous visitor's view whatever the caller sends", async () => {
    const hs = track(await foundedHolon());
    const service = createFrontService({ holosphere: () => hs });
    // The service takes a holon id and nothing else: a viewer key smuggled
    // into the id is a bad id, not a viewer.
    expect((await service.get(`${H}?viewer=${founder.pk}`)).status).toBe(400);
    const front = await (await service.get(H)).json();
    expect(front.viewer).toEqual({ cta: "apply", edit: false });
  });

  it("answers an unknown holon with an empty front rather than an error", async () => {
    const hs = track(memoryInstance());
    const res = await createFrontService({ holosphere: () => hs }).get(
      "holon_nobodyhome1",
    );
    expect(res.status).toBe(200);
    // A read the relays never answered looks the same: not kept for minutes.
    expect(res.headers.get("cache-control")).toBe(FRONT_CACHE_EMPTY);
    const front = await res.json();
    expect(validate(front), JSON.stringify(validate.errors)).toBe(true);
    expect(front).toMatchObject({
      empty: true,
      genes: [],
      members: 0,
      viewer: { cta: "none" },
    });
  });

  it("gives up after the catch-up bound with a 504 that says to retry, and does not cache it", async () => {
    const never = new Promise<never>(() => {});
    const stuck = {
      enforceActive: true,
      signingEnabled: true,
      getAll: () => never,
      get: () => never,
      getMembers: () => never,
      _relaySync: () => never,
    } as unknown as HoloSphere;
    const res = await createFrontService({
      holosphere: () => stuck,
      catchUpMs: 20,
    }).get(H);
    expect(res.status).toBe(504);
    expect(res.headers.get("retry-after")).toBe("5");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ error: "unreachable", holon: H });
  });

  it("refuses an instance that does not enforce reads: a 500, never an open-graph answer", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const hs = track(memoryInstance({ enforce: false }));
    const res = await createFrontService({ holosphere: () => hs }).get(H);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "failed" });
    quiet.mockRestore();
  });

  it("builds one instance and reuses it, replacing it after maxHolons distinct holons", async () => {
    vi.useFakeTimers();
    const built: HoloSphere[] = [];
    const make = vi.fn(() => {
      const hs = memoryInstance();
      built.push(hs);
      return hs;
    });
    const service = createFrontService({ holosphere: make, maxHolons: 2 });
    await service.get("holon_aaaaaaaa1");
    await service.get("holon_aaaaaaaa1");
    await service.get("holon_bbbbbbbb1");
    expect(make).toHaveBeenCalledTimes(1);
    // A third distinct holon rotates the instance; a repeat of a served one does not.
    await service.get("holon_cccccccc1");
    expect(make).toHaveBeenCalledTimes(2);
    await service.get("holon_cccccccc1");
    expect(make).toHaveBeenCalledTimes(2);
    const closing = vi.spyOn(built[0], "close");
    await vi.advanceTimersByTimeAsync(31_000);
    expect(closing).toHaveBeenCalled();
    open.push(...built.slice(1));
    await built[0].close().catch(() => {});
  });
});

describe("deployedHolosphere", () => {
  it("reads enforced, whatever the environment says, and holds no write hooks", () => {
    const hs = deployedHolosphere({
      HOLOSPHERE_ENFORCE: "off",
      HOLOSPHERE_RELAYS: "wss://relay.invalid",
    }) as unknown as {
      enforceActive?: boolean;
      close(): Promise<void>;
    };
    try {
      expect(hs.enforceActive).toBe(true);
    } finally {
      void hs.close().catch(() => {});
    }
  });
});
