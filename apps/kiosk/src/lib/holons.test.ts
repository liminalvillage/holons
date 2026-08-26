// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The landing page's "already have a holon?" field is the return leg of the
// site → bot → site loop, so it has to accept whatever shape someone happens
// to have copied. These specs pin exactly which shapes that is.

import { describe, it as spec, expect } from "vitest";
import {
  holonForHost,
  holonForPath,
  parseHolonRef,
  subdomainOf,
} from "./holons";

describe("subdomainOf", () => {
  spec("takes the label attached to the base domain", () => {
    expect(subdomainOf("liminal.hubs.network")).toBe("liminal");
    expect(subdomainOf("staging.liminal.hubs.network")).toBe("liminal");
    expect(subdomainOf("liminal.hubs.network:5273")).toBe("liminal");
  });
  spec("is null off the base domain", () => {
    expect(subdomainOf("localhost")).toBeNull();
    expect(subdomainOf("deploy-preview-3--kiosk.netlify.app")).toBeNull();
  });
});

describe("holonForPath", () => {
  spec("resolves a registered label and a raw id", () => {
    expect(holonForPath("/liminal")).toBe("-1003864542239");
    expect(holonForPath("/-1001234567890")).toBe("-1001234567890");
  });
  spec("never treats the API namespace as a holon", () => {
    expect(holonForPath("/api/auth/session")).toBeNull();
    expect(holonForPath("/")).toBeNull();
  });
});

describe("parseHolonRef", () => {
  spec("takes a holon id straight from the bot", () => {
    expect(parseHolonRef("-1001234567890")).toBe("-1001234567890");
    expect(parseHolonRef("  -1001234567890 ")).toBe("-1001234567890");
    // Personal holons are the user's own (positive) Telegram id.
    expect(parseHolonRef("235114395")).toBe("235114395");
  });

  spec("takes a registered label, case-insensitively", () => {
    expect(parseHolonRef("liminal")).toBe("-1003864542239");
    expect(parseHolonRef("Liminal")).toBe("-1003864542239");
  });

  spec("restores the -100 prefix Telegram drops from group links", () => {
    expect(parseHolonRef("https://t.me/c/1234567890/42")).toBe(
      "-1001234567890",
    );
    expect(parseHolonRef("https://t.me/c/1234567890")).toBe("-1001234567890");
  });

  spec("refuses a t.me link that only carries a username", () => {
    expect(parseHolonRef("https://t.me/HolonicDAO")).toBeNull();
    expect(parseHolonRef("t.me/HolonsBot?start=hub")).toBeNull();
  });

  spec("takes what /dashboard replies with", () => {
    expect(parseHolonRef("https://dashboard.holons.io/-1001234567890")).toBe(
      "-1001234567890",
    );
  });

  spec("takes a hub's own address, with or without a scheme", () => {
    expect(parseHolonRef("https://liminal.hubs.network")).toBe(
      "-1003864542239",
    );
    expect(parseHolonRef("liminal.hubs.network/")).toBe("-1003864542239");
    expect(parseHolonRef("https://hubs.network/-1001234567890")).toBe(
      "-1001234567890",
    );
  });

  spec("is null on anything that names no holon", () => {
    expect(parseHolonRef("")).toBeNull();
    expect(parseHolonRef("   ")).toBeNull();
    expect(parseHolonRef("our garden group")).toBeNull();
    expect(parseHolonRef("https://example.com/about")).toBeNull();
    expect(parseHolonRef("mailto:we@holons.io")).toBeNull();
  });
});

describe("holonForHost", () => {
  spec("a declared mapping wins", () => {
    expect(holonForHost("akasha.hubs.network")).toBe("-1003958094547");
    expect(holonForHost("liminal.hubs.network")).toBe("-1003864542239");
  });

  spec("an undeclared subdomain IS the holon id", () => {
    expect(holonForHost("somenewhub.hubs.network")).toBe("somenewhub");
    expect(holonForHost("SomeNewHub.hubs.network")).toBe("somenewhub");
  });

  spec("restores the '-' a hostname cannot carry on a group id", () => {
    expect(holonForHost("1003864542239.hubs.network")).toBe("-1003864542239");
    // A personal holon is a plain user id — no sign to restore.
    expect(holonForHost("235114395.hubs.network")).toBe("235114395");
  });

  spec("leaves infrastructure subdomains to the home page", () => {
    expect(holonForHost("www.hubs.network")).toBeNull();
    expect(holonForHost("api.hubs.network")).toBeNull();
    expect(holonForHost("staging.hubs.network")).toBeNull();
  });

  spec("the bare base domain names no holon", () => {
    expect(holonForHost("hubs.network")).toBeNull();
    expect(holonForHost("localhost")).toBeNull();
  });

  spec("deeper labels still resolve by the one next to the base domain", () => {
    expect(holonForHost("staging.liminal.hubs.network")).toBe("-1003864542239");
  });
});
