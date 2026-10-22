// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A member's retuned editor becomes a proposal: only what they moved.

import { describe, it as spec, expect, vi } from "vitest";
import { DEFAULT_EQUATION, type ScoreEquation } from "@holons/core/scoring";

vi.mock("$lib/holosphere", () => ({
  getHolosphere: vi.fn(),
  getLensStore: vi.fn(),
}));
vi.mock("$lib/flowsClaims", () => ({ recordLogEntry: vi.fn() }));

import { draftPatch, equationProposal } from "./equationProposal";

const live: ScoreEquation = {
  ...DEFAULT_EQUATION,
  completed: 1,
  currencies: { hour: 1 },
};

describe("draftPatch", () => {
  spec("is null when the draft moves nothing", () => {
    expect(
      draftPatch(live, { ...live, currencies: { ...live.currencies } }),
    ).toBeNull();
  });

  spec("carries only the moved weights, rounded", () => {
    expect(
      draftPatch(live, {
        ...live,
        participation: 0.1 + 0.2,
        currencies: { hour: 1 },
      }),
    ).toEqual({ participation: 0.3 });
  });

  spec("proposes a new currency even at weight 0", () => {
    expect(
      draftPatch(live, { ...live, currencies: { hour: 2, euro: 0 } }),
    ).toEqual({ currencies: { hour: 2, euro: 0 } });
  });

  spec("can propose a weight back down to 0", () => {
    expect(draftPatch(live, { ...live, completed: 0 })).toEqual({
      completed: 0,
    });
  });
});

describe("equationProposal", () => {
  spec("is a proposal card with its author, and no patch to edit", () => {
    const p = equationProposal(
      "h",
      { id: 7, username: "ada", first_name: "Ada" },
      "Retune the value equation",
      1_760_000_000_000,
    );
    expect(p).toMatchObject({
      type: "proposal",
      holon: "h",
      title: "Retune the value equation",
      initiator: { id: 7, username: "ada", firstName: "Ada" },
      participants: [],
    });
    expect(String(p.id)).toMatch(/^prop-/);
    expect(p).not.toHaveProperty("newEquation");
  });
});
