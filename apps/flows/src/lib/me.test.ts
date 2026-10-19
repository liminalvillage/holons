// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";

vi.mock("./holosphere", () => ({ getHolosphere: async () => null }));

import { indexFlowGraph, type FlowGraph } from "@holons/core/flows";
import { myParties } from "./me";

const WALLET = "0xabc0000000000000000000000000000000000001";
const graph: FlowGraph = {
  v: 1,
  root: "holon_pot",
  at: 1,
  complete: true,
  problems: [],
  nodes: [
    { id: "holon_pot", label: "Pot", kind: "pot", share: 100, rest: 0 },
    {
      id: "111",
      label: "Ada",
      kind: "person",
      share: 60,
      rest: 60,
      payout: WALLET,
    },
    {
      id: "holon_j",
      label: "J",
      kind: "project",
      share: 40,
      rest: 40,
      payout: WALLET,
    },
    { id: "222", label: "Bo", kind: "person", share: 0, rest: 0 },
  ],
  links: [],
  aliases: [],
  cycles: [],
};
const index = indexFlowGraph(graph);

describe("myParties", () => {
  it("is the party I am, then the ones paid at my wallet, each once", () => {
    expect(
      myParties(index, "111", [WALLET.toUpperCase().replace("0X", "0x")]),
    ).toEqual([
      { id: "111", via: "self" },
      { id: "holon_j", via: "address" },
    ]);
  });

  it("is only what my wallet is paid for when my key is seated nowhere", () => {
    expect(myParties(index, "f".repeat(64), [WALLET, WALLET])).toEqual([
      { id: "111", via: "address" },
      { id: "holon_j", via: "address" },
    ]);
  });

  it("is nobody without a map, an id or an address the map knows", () => {
    expect(myParties(null, "111", [WALLET])).toEqual([]);
    expect(myParties(index, null, [null, undefined, ""])).toEqual([]);
    expect(myParties(index, "999", ["0x" + "0".repeat(40)])).toEqual([]);
  });
});
