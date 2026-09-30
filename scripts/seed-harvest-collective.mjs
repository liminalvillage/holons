#!/usr/bin/env node
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Seed a harvest collective on Flows — docs/flows-harvest-collective.md.
//
//   node --env-file=.env scripts/seed-harvest-collective.mjs \
//     --mother <chat id> --collectors <chat id> \
//     [--location <id>=<weight>]... [--collectors-weight 50] \
//     [--hour 10] [--euro 1] [--interior 80] [--dry-run]
//
// Writes, through the same core the MCP and the bot use (HOLONS_APP,
// HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC from .env):
//   mother      federation links to every location and to the collectors;
//               a custom contributors split with the given weights
//   collectors  the value equation (hours, euros) and an equation-mode split
// Nothing is minted: the harvest is recorded when the oil is back.
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

const mother = opt("mother");
const collectors = opt("collectors");
if (!mother || !collectors) {
  console.error(
    "usage: --mother <id> --collectors <id> [--location <id>=<weight>]...",
  );
  process.exit(2);
}
// Defaults: Liminal and Casa Selva, a quarter each; the collectors take half.
const locations = many("location").length
  ? Object.fromEntries(
      many("location")
        .map((s) => s.split("="))
        .map(([id, w]) => [id, Number(w ?? 25)]),
    )
  : { "-1003864542239": 25, "-1002964866719": 25 };
const collectorsWeight = Number(opt("collectors-weight", 50));
const hour = Number(opt("hour", 10));
const euro = Number(opt("euro", 1));
const interior = Number(opt("interior", 80));

const shares = { ...locations, [collectors]: collectorsWeight };
console.log("mother", mother, "shares", shares);
console.log(
  "collectors",
  collectors,
  `equation hour=${hour} euro=${euro}`,
  `interior ${interior}%`,
);
if (dry) process.exit(0);

const hs = await getHoloSphere();
try {
  const names = { [collectors]: "Collectors" };
  for (const id of Object.keys(locations)) {
    const doc = await hs.get(id, "settings", id).catch(() => null);
    names[id] = doc?.name || id;
  }
  // Links first: a seat only pays a partner the federation record lists.
  const before = await getFederationSnapshot(hs, mother).catch(() => ({
    federated: [],
  }));
  for (const [id, name] of Object.entries(names)) {
    if (before.federated.includes(id)) continue;
    await setFederationPartner(hs, mother, id, {
      partnerName: name,
      inbound: [],
      outbound: [],
    });
    console.log("linked", mother, "↔", id, `(${name})`);
  }
  await saveAllocationConfig(
    hs,
    mother,
    { interiorPercent: 100, interiorMode: "custom", nzones: 3, steepness: 50 },
    undefined,
    undefined,
    shares,
  );
  console.log("mother split saved");

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
    "\nNext, in the mother group: /fundpolicy pin <id> for each of",
    Object.keys(names).join(", "),
  );
  console.log(
    "Then place the cook and the tool lenders on the collectors' rings (kiosk Flows → gear → Zones).",
  );
} finally {
  setTimeout(() => process.exit(process.exitCode ?? 0), 1500);
}
