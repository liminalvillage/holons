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

  test("all/personal drop only partner copies, keep holograms", () => {
    expect(scopeLocal(all, "all")).toEqual([local, hologram]);
    expect(scopeLocal(all, "personal")).toEqual([local, hologram]);
  });
});

describe("scopeFromLegacy", () => {
  const none = {
    scope: null,
    federated: null,
    taskView: null,
    libraryView: null,
    rolesView: null,
  };

  test("explicit kiosk_scope wins over every legacy key", () => {
    expect(
      scopeFromLegacy({
        ...none,
        scope: "all",
        federated: "1",
        taskView: "personal",
      }),
    ).toBe("all");
    expect(scopeFromLegacy({ ...none, scope: "networked" })).toBe("networked");
    expect(scopeFromLegacy({ ...none, scope: "personal" })).toBe("personal");
  });

  test("any legacy per-view personal mode beats the federated toggle", () => {
    expect(
      scopeFromLegacy({ ...none, taskView: "personal", federated: "1" }),
    ).toBe("personal");
    expect(scopeFromLegacy({ ...none, libraryView: "personal" })).toBe(
      "personal",
    );
    expect(scopeFromLegacy({ ...none, rolesView: "personal" })).toBe(
      "personal",
    );
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
