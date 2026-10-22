// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import { resolveFeedAppName, resolveFeedRelays } from "./feedEnv";
import { DEFAULT_RELAYS } from "@holons/core/holosphere";

describe("resolveFeedAppName", () => {
  it("lands on the production namespace when nothing is set", () => {
    // The regression: an unset HOLONS_APP used to fall to "HolonsDebug",
    // an empty namespace on the relays, so the feed had no events.
    expect(resolveFeedAppName({})).toBe("Holons");
    expect(resolveFeedAppName({ HOLONS_APP: "  " })).toBe("Holons");
  });

  it("honours HOLONS_APP first, then the kiosk client's own variables", () => {
    expect(
      resolveFeedAppName({ HOLONS_APP: "HolonsDebug", VITE_KIOSK_APP: "X" }),
    ).toBe("HolonsDebug");
    expect(
      resolveFeedAppName({ VITE_KIOSK_APP: "Kiosk", VITE_HOLONS_APP: "Web" }),
    ).toBe("Kiosk");
    expect(resolveFeedAppName({ VITE_HOLONS_APP: "Web" })).toBe("Web");
  });
});

describe("resolveFeedRelays", () => {
  it("falls back to the production relay set", () => {
    expect(resolveFeedRelays({})).toEqual([...DEFAULT_RELAYS]);
  });

  it("prefers HOLOSPHERE_RELAYS, then the kiosk client's variable", () => {
    expect(
      resolveFeedRelays({
        HOLOSPHERE_RELAYS: "wss://a",
        VITE_KIOSK_RELAYS: "wss://b",
      }),
    ).toEqual(["wss://a"]);
    expect(
      resolveFeedRelays({ VITE_KIOSK_RELAYS: "wss://b, wss://c" }),
    ).toEqual(["wss://b", "wss://c"]);
  });
});
