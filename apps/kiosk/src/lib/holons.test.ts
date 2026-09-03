// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The landing page's "already have a holon?" field is the return leg of the
// site → bot → site loop, so it has to accept whatever shape someone happens
// to have copied. These specs pin exactly which shapes that is.

import { describe, it as spec, expect } from "vitest";
import {
  holonForHost,
  holonForPath,
  parseHolonAdd,
  parseHolonPaste,
  parseHolonRef,
  subdomainOf,
} from "./holons";

// A holon can be keyed by any of a person's identities, not only a chat id.
const ETH = "0x52908400098527886E0F7030069857D2E4169EE7";
const NPUB = "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";

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

  spec("takes an identity — Ethereum address or npub — as the id", () => {
    // Normalised to lowercase so checksum-cased and plain copies of the same
    // address land in the same holon namespace.
    expect(parseHolonRef(ETH)).toBe(ETH.toLowerCase());
    expect(parseHolonRef(ETH.toLowerCase())).toBe(ETH.toLowerCase());
    expect(parseHolonRef(NPUB)).toBe(NPUB);
  });

  spec("refuses identity look-alikes", () => {
    expect(parseHolonRef("0x1234")).toBeNull(); // too short for an address
    expect(parseHolonRef(ETH + "ff")).toBeNull(); // too long
    expect(parseHolonRef("npub1tooshort")).toBeNull();
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
    // "valley" and "commons" are two names for the same holon.
    expect(holonForHost("valley.hubs.network")).toBe(
      holonForHost("commons.hubs.network"),
    );
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

describe("parseHolonPaste", () => {
  spec("reads the id out of the whole /id reply", () => {
    expect(parseHolonPaste("This holon ID is -1001234567890")).toBe(
      "-1001234567890",
    );
    expect(parseHolonPaste("🔑 Holon ID: -1001234567890")).toBe(
      "-1001234567890",
    );
  });

  spec("takes a personal holon id out of prose too", () => {
    expect(parseHolonPaste("This holon ID is 235114395")).toBe("235114395");
  });

  spec("finds a link buried in a pasted line", () => {
    expect(
      parseHolonPaste("Open your board: https://t.me/c/1234567890/42 — enjoy"),
    ).toBe("-1001234567890");
  });

  spec("still accepts everything the strict parse does", () => {
    expect(parseHolonPaste("-1001234567890")).toBe("-1001234567890");
    expect(parseHolonPaste("liminal")).toBe("-1003864542239");
    expect(parseHolonPaste("  ")).toBeNull();
  });

  spec("does not mistake a short number in prose for an id", () => {
    expect(parseHolonPaste("there are 42 quests open")).toBeNull();
  });

  spec(
    "a label only counts as the whole input, never scraped from prose",
    () => {
      // Otherwise any sentence mentioning a hub's name would silently redirect.
      expect(parseHolonPaste("we met the liminal crew last week")).toBeNull();
    },
  );

  spec("finds an identity in prose without shredding it into digits", () => {
    // ID_IN_TEXT would otherwise pluck a digit run out of the hex/bech32.
    expect(parseHolonPaste(`my address is ${ETH}, add me`)).toBe(
      ETH.toLowerCase(),
    );
    expect(parseHolonPaste(`on nostr I'm ${NPUB}.`)).toBe(NPUB);
  });
});

describe("parseHolonAdd", () => {
  spec("accepts everything the paste parse does", () => {
    expect(parseHolonAdd("-1001234567890")).toBe("-1001234567890");
    expect(parseHolonAdd("This holon ID is -1001234567890")).toBe(
      "-1001234567890",
    );
    expect(parseHolonAdd(ETH)).toBe(ETH.toLowerCase());
    expect(parseHolonAdd(NPUB)).toBe(NPUB);
  });

  spec("a registered name resolves to its holon id, not itself", () => {
    expect(parseHolonAdd("liminal")).toBe("-1003864542239");
    expect(parseHolonAdd("Liminal")).toBe("-1003864542239");
  });

  spec("any bare alphanumeric token is taken verbatim as an id", () => {
    expect(parseHolonAdd("myfarm")).toBe("myfarm");
    expect(parseHolonAdd("  my-farm_2 ")).toBe("my-farm_2");
  });

  spec("still refuses what cannot be an id", () => {
    expect(parseHolonAdd("")).toBeNull();
    expect(parseHolonAdd("our garden group")).toBeNull(); // spaces → a sentence
    expect(parseHolonAdd("-notanid")).toBeNull(); // leading '-' is ids only
  });
});
