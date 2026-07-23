#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scan holons for circular hologram pointers and (with --fix) nuke them.
//
// A hologram whose soul chain loops back on itself (in the degenerate case, a
// `{id, soul}` husk pointing at its OWN path) makes every subscriber's
// resolution re-read the node Gun just emitted — an unbounded re-emission
// loop. holosphere's fire-storm guard then QUARANTINES the lens (detaching
// every listener), after which writes still land but no UI on that lens ever
// updates again until reload: the "board frozen until refresh" field failure.
// This is the script form of the web console's __repairCircular helper.
//
//   node scripts/repair-circular-holograms.mjs                # scan kiosk holons
//   node scripts/repair-circular-holograms.mjs --fix          # scan + nuke
//   node scripts/repair-circular-holograms.mjs --lens=library <holonId> [...]
//
// Run from a FRESH working directory (or delete ./holosphere between runs) —
// Gun's radisk caches reads in cwd and a warm cache can mask relay state.
// Writes go to the namespace in HOLONS_APP (default Holons — LIVE prod), so
// --fix only ever put(null)s pointers whose chain provably loops.

import { HoloSphere } from '../packages/holosphere/holosphere.js';

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const lensArg = args.find((a) => a.startsWith('--lens='));
const LENS = lensArg ? lensArg.split('=')[1] : 'quests';
const explicit = args.filter((a) => !a.startsWith('--'));

// Default sweep: the registered kiosk tenants (apps/kiosk/src/lib/holons.ts).
const KIOSK_HOLONS = {
  residence: '-1001652773351',
  liminal: '-1003864542239',
  akasha: '-1003958094547',
  casaselva: '-1002964866719',
  refactory: '-1003943146280',
  civic: '-5349529224',
  lunation80: '-1003711659317',
};
const targets = explicit.length
  ? Object.fromEntries(explicit.map((id) => [id, id]))
  : KIOSK_HOLONS;

const hs = new HoloSphere({
  appName: process.env.HOLONS_APP || 'Holons',
  logLevel: 'ERROR',
  gunOptions: { multicast: false },
});
await hs.ready?.();
const app = hs.appname;

const readRaw = (h, l, k) =>
  new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    hs.gun.get(app).get(h).get(l).get(k).once((d) => {
      if (d == null) return fin(null);
      try { fin(typeof d === 'string' ? JSON.parse(d) : d); } catch { fin(d); }
    });
    setTimeout(() => fin(null), 1500);
  });

const listKeys = (h, l) =>
  new Promise((resolve) => {
    const set = new Set();
    hs.gun.get(app).get(h).get(l).map().once((d, k) => {
      if (d != null && k !== '_') set.add(k);
    });
    setTimeout(() => resolve([...set]), 3000);
  });

let totalCircular = 0;
for (const [label, holon] of Object.entries(targets)) {
  const keys = await listKeys(holon, LENS);
  let holograms = 0;
  const circular = [];
  for (const key of keys) {
    const item = await readRaw(holon, LENS, key);
    if (!item || !hs.isHologram(item)) continue;
    holograms++;
    const visited = new Set([`${holon}/${LENS}/${key}`]);
    let cur = item, hops = 0, isCirc = false;
    while (cur && hs.isHologram(cur) && hops < 16) {
      const sp = hs.parseSoulPath(cur.soul);
      if (!sp || !sp.holon) break;
      const id = `${sp.holon}/${sp.lens}/${sp.key}`;
      if (visited.has(id)) { isCirc = true; break; }
      visited.add(id);
      cur = await readRaw(sp.holon, sp.lens, sp.key);
      hops++;
    }
    if (isCirc) circular.push({ key, soul: item.soul });
  }
  totalCircular += circular.length;
  console.log(`[${label}] ${LENS}: keys=${keys.length} holograms=${holograms} circular=${circular.length}`);
  for (const c of circular) {
    console.log(`   CIRCULAR ${holon}/${LENS}/${c.key} -> soul=${c.soul}`);
    if (FIX) {
      await new Promise((res) => {
        let d = false;
        const f = () => { if (!d) { d = true; res(); } };
        try { hs.gun.get(app).get(holon).get(LENS).get(c.key).put(null, f); } catch { f(); }
        setTimeout(f, 2000);
      });
      const after = await readRaw(holon, LENS, c.key);
      console.log(`   nuked ${c.key}; read-back: ${after == null ? 'null (gone)' : 'STILL PRESENT — retry'}`);
    }
  }
}
if (totalCircular && !FIX) console.log('\nRe-run with --fix to nuke the circular pointers above.');
setTimeout(() => process.exit(0), 3000);
