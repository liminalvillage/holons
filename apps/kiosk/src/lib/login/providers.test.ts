// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
import { describe, expect, it } from "vitest";
import {
  ALL_LOGIN_PROVIDERS,
  keyLoginOffered,
  parseLoginProviders,
} from "./providers";

describe("VITE_KIOSK_LOGIN", () => {
  it("unset, empty or nonsense offers every provider", () => {
    for (const raw of [undefined, "", "  ", "carrier-pigeon", "all"])
      expect(parseLoginProviders(raw)).toEqual([...ALL_LOGIN_PROVIDERS]);
  });
  it("telegram alone is the Telegram-only switch", () => {
    expect(parseLoginProviders("telegram")).toEqual(["telegram"]);
    expect(keyLoginOffered(parseLoginProviders("telegram"))).toBe(false);
  });
  it("lists are comma or space separated, case-free, deduped, unknowns dropped", () => {
    expect(parseLoginProviders("Telegram, nostr nostr,foo")).toEqual([
      "nostr",
      "telegram",
    ]);
    expect(keyLoginOffered(parseLoginProviders("ethereum"))).toBe(true);
  });
});
