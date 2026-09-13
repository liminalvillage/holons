// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it } from "vitest";
import { resolveFeedAppName } from "./feedEnv";

describe("resolveFeedAppName", () => {
  it("reads the production namespace when HOLONS_APP is unset", () => {
    expect(resolveFeedAppName({})).toBe("Holons");
    expect(resolveFeedAppName({ NODE_ENV: "production" })).toBe("Holons");
  });

  it("reads HolonsDebug only for a dev process, like the client", () => {
    expect(resolveFeedAppName({ NODE_ENV: "development" })).toBe("HolonsDebug");
  });

  it("honours an explicit HOLONS_APP", () => {
    expect(
      resolveFeedAppName({ HOLONS_APP: "HolonsDebug", NODE_ENV: "production" }),
    ).toBe("HolonsDebug");
    expect(
      resolveFeedAppName({ HOLONS_APP: " ", NODE_ENV: "development" }),
    ).toBe("HolonsDebug");
  });
});
