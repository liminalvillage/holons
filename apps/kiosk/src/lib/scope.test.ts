// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, test } from "vitest";
import { fromPartner, scopeLocal } from "./scope";
import { scopeFromLegacy } from "./config";

const local = { id: "a", title: "Local task" };
const partner = {
  id: "b",
  title: "Partner task",
  _federation: { origin: "-100999", originName: "Partners" },
};
const hologram = {
  id: "c",
  title: "Mirrored task",
  _hologram: { isHologram: true, sourceHolon: "-100888" },
};

describe("fromPartner", () => {
  test("matches records carrying a federation origin", () => {
    expect(fromPartner(partner)).toBe(true);
  });

  test("does NOT match holograms — local pointers, visible in every scope", () => {
    expect(fromPartner(hologram)).toBe(false);
  });

  test("plain local records and null-ish values are safe", () => {
    expect(fromPartner(local)).toBe(false);
    expect(fromPartner(null)).toBe(false);
    expect(fromPartner(undefined)).toBe(false);
    expect(fromPartner({ _federation: {} })).toBe(false);
  });
});

describe("scopeLocal", () => {
  const all = [local, partner, hologram];

  test("networked passes everything through untouched", () => {
    expect(scopeLocal(all, "networked")).toBe(all);
  });

  test("all drops only partner copies, keeps holograms", () => {
    expect(scopeLocal(all, "all")).toEqual([local, hologram]);
  });
});

describe("scopeFromLegacy", () => {
  const none = { scope: null, federated: null };

  test("explicit kiosk_scope wins over the legacy toggle", () => {
    expect(scopeFromLegacy({ scope: "all", federated: "1" })).toBe("all");
    expect(scopeFromLegacy({ ...none, scope: "networked" })).toBe("networked");
  });

  test("the retired personal scope reads as all, whatever the toggle said", () => {
    expect(scopeFromLegacy({ scope: "personal", federated: "1" })).toBe("all");
    expect(scopeFromLegacy({ ...none, scope: "personal" })).toBe("all");
  });

  test("legacy federated=1 alone migrates to networked", () => {
    expect(scopeFromLegacy({ ...none, federated: "1" })).toBe("networked");
    expect(scopeFromLegacy({ ...none, federated: "0" })).toBe("all");
  });

  test("nothing persisted → all; garbage scope falls through to legacy rules", () => {
    expect(scopeFromLegacy(none)).toBe("all");
    expect(scopeFromLegacy({ ...none, scope: "bogus", federated: "1" })).toBe(
      "networked",
    );
  });
});
