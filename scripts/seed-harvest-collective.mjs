#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Seed a harvest collective on Flows — docs/flows-harvest-collective.md.
//
//   node --env-file=.env scripts/seed-harvest-collective.mjs \
//     --grove <grove id>=<location id> [--grove <grove id>=<location id>]... \
//     --collectors <chat id> \
//     [--location-weight 50] [--collectors-weight 50] \
//     [--hour 10] [--euro 1] [--interior 80] [--dry-run]
//
// A GROVE is the holon that owns a location's trees and mints its oil; it is
// what the location and the pickers share. Writes, through the same core the
// MCP and the bot use (HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC):
//   each grove   federation links to its location and to the collectors;
//                a custom contributors split: location / collectors
//   collectors   the value equation (hours, euros) and an equation-mode split
// Nothing is minted: a lot is recorded in its grove when the oil is back.
// Everything is idempotent — run it again to change the weights.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const { getHoloSphere } = await import(
  `${root}/packages/mcp-ui/dist/holosphere.js`
);
// Core is imported from its built output, as the MCP loader above is: this
// folder has no node_modules to resolve the package name through.
const { saveAllocationConfig } = await import(
  `${root}/packages/core/dist/flows/index.js`
);
const { setFederationPartner, getFederationSnapshot } = await import(
  `${root}/packages/core/dist/federation/index.js`
);
const { loadEquation, saveEquation } = await import(
  `${root}/packages/core/dist/scoring/index.js`
);

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const many = (name) =>
  args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const dry = args.includes("--dry-run");

const collectors = opt("collectors");
const groves = many("grove")
  .map((s) => s.split("="))
  .filter(([grove, location]) => grove && location);
if (!collectors || !groves.length) {
  console.error(
    "usage: --grove <grove id>=<location id> [--grove ...] --collectors <id>",
  );
  process.exit(2);
}
const locationWeight = Number(opt("location-weight", 50));
const collectorsWeight = Number(opt("collectors-weight", 50));
const hour = Number(opt("hour", 10));
const euro = Number(opt("euro", 1));
const interior = Number(opt("interior", 80));

for (const [grove, location] of groves) {
  console.log("grove", grove, "shares", {
    [location]: locationWeight,
    [collectors]: collectorsWeight,
  });
}
console.log(
  "collectors",
  collectors,
  `equation hour=${hour} euro=${euro}`,
  `interior ${interior}%`,
);
if (dry) process.exit(0);

const nameOf = async (hs, id, fallback) => {
  const doc = await hs.get(id, "settings", id).catch(() => null);
  return doc?.name || fallback || id;
};

// Links first: a seat only pays a partner the federation record lists.
const link = async (hs, holon, partner, partnerName) => {
  const before = await getFederationSnapshot(hs, holon).catch(() => ({
    federated: [],
  }));
  if (before.federated.includes(partner)) return;
  await setFederationPartner(hs, holon, partner, {
    partnerName,
    inbound: [],
    outbound: [],
  });
  console.log("linked", holon, "↔", partner, `(${partnerName})`);
};

const hs = await getHoloSphere();
try {
  const collectorsName = await nameOf(hs, collectors, "Collectors");
  for (const [grove, location] of groves) {
    const locationName = await nameOf(hs, location);
    await link(hs, grove, location, locationName);
    await link(hs, grove, collectors, collectorsName);
    await saveAllocationConfig(
      hs,
      grove,
      { interiorPercent: 100, interiorMode: "custom", nzones: 3, steepness: 50 },
      undefined,
      undefined,
      { [location]: locationWeight, [collectors]: collectorsWeight },
    );
    console.log("grove split saved", grove, `→ ${locationName} / ${collectorsName}`);
  }

  const eq = await loadEquation(hs, collectors);
  await saveEquation(hs, collectors, {
    ...eq,
    currencies: { ...(eq.currencies ?? {}), hour, euro },
  });
  await saveAllocationConfig(hs, collectors, {
    interiorPercent: interior,
    interiorMode: "equation",
    nzones: 3,
    steepness: 50,
  });
  console.log("collectors equation and split saved");
  console.log(
    "\nNext, in each grove group: /fundpolicy pin <location id> and /fundpolicy pin",
    collectors,
  );
  console.log(
    "Then place the cook and the tool lenders on the collectors' rings (kiosk Flows → gear → Zones).",
  );
} finally {
  setTimeout(() => process.exit(process.exitCode ?? 0), 1500);
}
