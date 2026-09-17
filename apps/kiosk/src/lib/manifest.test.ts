// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildManifest, manifestHref, startPathFor } from "./manifest";
import { SUBDOMAIN_HOLONS, holonForPath } from "./holons";

const [label, labelled] = Object.entries(SUBDOMAIN_HOLONS).find(
  ([, id]) => id && id.trim(),
)!;

describe("startPathFor", () => {
  it("is the front door when no holon is shown", () => {
    expect(
      startPathFor(null, { hostname: "kiosk.holons.io", pathname: "/" }),
    ).toBe("/");
  });

  it("is `/` on a hub's own host — the host already names it", () => {
    expect(
      startPathFor(labelled, {
        hostname: `${label}.hubs.network`,
        pathname: "/tasks",
      }),
    ).toBe("/");
  });

  it("keeps the label the URL uses, and drops the tab", () => {
    expect(
      startPathFor(labelled, {
        hostname: "kiosk.holons.io",
        pathname: `/${label}/calendar`,
      }),
    ).toBe(`/${label}`);
  });

  it("names a remembered holon by id — an installed app remembers nothing", () => {
    const start = startPathFor("-1001234567890", {
      hostname: "kiosk.holons.io",
      pathname: "/tasks",
    });
    expect(start).toBe("/-1001234567890");
    expect(holonForPath(start)).toBe("-1001234567890");
  });

  it("falls back to ?holon= for an id the path grammar can't carry", () => {
    expect(
      startPathFor("some-unregistered-holon", {
        hostname: "kiosk.holons.io",
        pathname: "/",
      }),
    ).toBe("/?holon=some-unregistered-holon");
  });
});

describe("manifestHref", () => {
  it("is the static file at the front door", () => {
    expect(manifestHref("/", "")).toBe("/manifest.webmanifest");
  });
  it("carries the start path and the name", () => {
    const url = new URL(
      manifestHref("/liminal", " Liminal Village "),
      "http://x",
    );
    expect(url.pathname).toBe("/api/manifest");
    expect(url.searchParams.get("start")).toBe("/liminal");
    expect(url.searchParams.get("name")).toBe("Liminal Village");
  });
});

describe("buildManifest", () => {
  it("names the app for the hub and opens on it, as its own app", () => {
    const m = buildManifest("/liminal", "Liminal Village");
    expect(m.name).toBe("Liminal Village");
    expect(m.short_name).toBe("Liminal Village");
    expect(m.start_url).toBe("/liminal");
    expect(m.id).toBe("/liminal");
  });

  it("accepts every shape startPathFor produces", () => {
    for (const start of ["/", "/-1001234567890", "/?holon=some-holon"])
      expect(buildManifest(start, null).start_url).toBe(start);
  });

  it("never starts off-origin or outside the board grammar", () => {
    for (const bad of [
      "//evil.example",
      "https://evil.example/",
      "/a/b",
      "/\\evil",
      "/?holon=x&next=//evil",
      "javascript:alert(1)",
      "",
    ])
      expect(buildManifest(bad, null).start_url, bad).toBe("/");
  });

  it("defaults and bounds the name", () => {
    expect(buildManifest("/", "  ").name).toBe("Holons");
    expect(buildManifest("/", "x".repeat(500)).name).toHaveLength(60);
  });

  it("matches the static fallback manifest", () => {
    const file = JSON.parse(
      readFileSync(
        new URL("../../static/manifest.webmanifest", import.meta.url),
        "utf8",
      ),
    );
    expect(buildManifest(null, null)).toEqual(file);
  });

  it("ships an installable icon set (PNG 192 + 512, a maskable one)", () => {
    const { icons } = buildManifest(null, null);
    const png = icons.filter((i) => i.type === "image/png");
    expect(png.map((i) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    expect(icons.some((i) => "purpose" in i && i.purpose === "maskable")).toBe(
      true,
    );
  });
});
