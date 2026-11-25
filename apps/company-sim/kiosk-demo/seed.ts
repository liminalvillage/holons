// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Seed Meridian Works into a PRIVATE relay so the real kiosk can show it.
 *
 * Every write goes through the same core calls the kiosk, bot and MCP make,
 * each signed by the person who would make it in real life:
 *
 *   founding + seats      @holons/core/holons    createHolon, approveJoin, ensureProfile
 *   circles federated     @holons/core/federation setFederationPartner
 *   split + equation      @holons/core/flows / scoring  saveAllocationConfig, saveEquation
 *   work                  @holons/core/tasks     createTask → planTaskCompletion → executeCompletionPlan
 *   holograms             @holons/core/federation publishToFederation (useHolograms)
 *   articles × views …    @holons/core/expenses  contributions INTO the circle (splitWith [circle])
 *   money in              @holons/core/flows     buildMint on `flow_mints` (one per rail)
 *   claims                @holons/core/flows     buildClaim on `flow_claims`, attested by an admin
 *
 * The story is one lunation of the simulation (`../src/engine.ts`), replayed.
 *
 *   node dist/seed.cjs [ws://127.0.0.1:7787] [appName]
 */

import { createHash } from 'node:crypto';
import { getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { createHoloSphere, signerFromSecretKey } from '@holons/core/holosphere';
import { approveJoin, createHolon, ensureProfile, rememberHolon } from '@holons/core/holons';
import { setFederationPartner, publishToFederation } from '@holons/core/federation';
import { saveAllocationConfig, buildMint, buildClaim, buildClaimVerdict, FLOW_MINTS_LENS, FLOW_CLAIMS_LENS } from '@holons/core/flows';
import { saveEquation } from '@holons/core/scoring';
import { createTask, planTaskCompletion, executeCompletionPlan, applyTaskCompletion } from '@holons/core/tasks';
import { createExpense } from '@holons/core/expenses';
import { REAEventStore } from '@holons/core/rea';
import { createSim, step } from '../src/engine.js';
import { HOLONS, PEOPLE, LUNATION_DAYS } from '../src/scenario.js';

const RELAY = process.argv[2] || 'ws://127.0.0.1:7787';
const APP = process.argv[3] || 'MeridianSim';

// ── People: one deterministic key each, one HoloSphere each ──────────────
const skOf = (id: string) => createHash('sha256').update(`meridian-sim:${id}`).digest();
const pk: Record<string, string> = {};
const nsec: Record<string, string> = {};
const hsOf: Record<string, any> = {};
for (const p of PEOPLE) {
  const sk = skOf(p.id);
  pk[p.id] = getPublicKey(sk);
  nsec[p.id] = bytesToHex(sk);
}
async function hs(person: string) {
  if (!hsOf[person]) {
    hsOf[person] = await createHoloSphere({
      appName: APP,
      privateKey: nsec[person],
      relays: [RELAY],
      store: { adapter: 'memory' },
      enforce: true,
      awaitReady: true,
    } as any);
  }
  return hsOf[person];
}
const signer = (person: string) => signerFromSecretKey(nsec[person]);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(...a);

// Who founds (and administers) each circle — the lead link.
const LEAD: Record<string, string> = {
  meridian: 'ana',
  eng: 'mira',
  platform: 'theo',
  content: 'lena',
  mkt: 'priya',
  ops: 'rosa',
};
const CIRCLES = Object.keys(LEAD);
const hid: Record<string, string> = {}; // sim id → real holon id

async function main() {
  // 1. Found every circle, seat its members, let each member write their profile.
  for (const c of CIRCLES) {
    const spec = HOLONS.find((h) => h.id === c)!;
    const lead = LEAD[c];
    const h = await hs(lead);
    const { holon } = await createHolon(h, signer(lead), {
      appName: APP,
      name: spec.name,
      profile: { first_name: PEOPLE.find((p) => p.id === lead)!.name },
    });
    hid[c] = holon;
    await h.put(holon, 'settings', { id: holon, name: spec.name, description: spec.purpose });
    for (const p of PEOPLE.filter((p) => p.circles.includes(c) && p.id !== lead)) {
      await approveJoin(h, holon, pk[p.id], signer(lead), { appName: APP });
    }
    log(`founded ${spec.name} = ${holon} (lead ${lead})`);
  }
  await pause(1200);
  for (const c of CIRCLES) {
    for (const p of PEOPLE.filter((p) => p.circles.includes(c) && p.id !== LEAD[c])) {
      const ok = await ensureProfile(await hs(p.id), hid[c], { first_name: p.name });
      if (!ok) log(`  ! profile not written for ${p.name} in ${c}`);
    }
  }
  // Everyone keeps the company and their own circles in their personal holon
  // (`holons` lens) — the upstreams their personal Flows board reads rights from.
  for (const p of PEOPLE) {
    const h = await hs(p.id);
    await h.put(pk[p.id], 'settings', { id: pk[p.id], name: p.name });
    await h.put(pk[p.id], 'users', { id: pk[p.id], first_name: p.name });
    for (const c of new Set(['meridian', ...p.circles])) {
      await rememberHolon(h, pk[p.id], { id: hid[c], name: HOLONS.find((x) => x.id === c)!.name });
    }
  }

  // 2. Federate: the company with each circle, Engineering with Platform.
  //    Each half is written by that side's lead.
  const links: Array<[string, string]> = [
    ['meridian', 'eng'], ['meridian', 'content'], ['meridian', 'mkt'], ['meridian', 'ops'], ['eng', 'platform'],
    ['mkt', 'eng'], ['eng', 'content'], ['eng', 'mkt'],
  ];
  const lenses = ['quests', 'announcements'];
  for (const [a, b] of links) {
    for (const [x, y] of [[a, b], [b, a]]) {
      const out = await setFederationPartner(await hs(LEAD[x]), hid[x], hid[y], {
        inbound: lenses,
        outbound: lenses,
        partnerName: HOLONS.find((h) => h.id === y)!.name,
        holonName: HOLONS.find((h) => h.id === x)!.name,
        askPartner: true,
      } as any);
      if (out.self !== 'linked' && out.self !== 'requested') log(`  federation ${x}→${y}:`, out);
    }
  }
  log('federated');

  // 3. Splits and value equations, saved by each lead.
  for (const c of CIRCLES) {
    const spec = HOLONS.find((h) => h.id === c)!;
    const h = await hs(LEAD[c]);
    const zones: Record<string, number> = {};
    for (const p of spec.partners) if (hid[p.id]) zones[hid[p.id]] = p.zone;
    await saveAllocationConfig(h, hid[c], spec.config, zones);
    await saveEquation(h, hid[c], spec.equation);
  }
  // Lena's own split: she keeps 90% and places Omar on her ring.
  {
    const h = await hs('lena');
    await h.put(pk.lena, 'settings', { id: pk.lena, name: 'Lena' });
    await saveAllocationConfig(h, pk.lena, { interiorPercent: 90, steepness: 50, nzones: 1, interiorMode: 'custom' }, {}, { [pk.omar]: 1 }, { [pk.lena]: 1 });
  }
  log('splits + equations saved');

  // 4. One lunation of work, replayed from the simulation.
  const s = createSim(7);
  for (let d = 0; d < LUNATION_DAYS - 1; d++) step(s);
  const realTask: Record<string, string> = {};
  const holonOfTask = (t: { holon: string }) => hid[t.holon];
  for (const t of Object.values(s.tasks)) {
    if (t.kind === 'article') continue; // articles are valued by views (step 5)
    const owner = t.initiator;
    const h = await hs(owner);
    const q: any = createTask({
      holonId: holonOfTask(t),
      initiator: { id: pk[owner], username: PEOPLE.find((p) => p.id === owner)!.name },
      title: t.title,
    } as any);
    q.id = `${t.id}-${t.kind}`;
    q.created = new Date(Date.now() - (LUNATION_DAYS - t.createdDay) * 86400_000).toISOString();
    if (t.assignee) q.participants = [{ id: pk[t.assignee], username: PEOPLE.find((p) => p.id === t.assignee)!.name }];
    await h.put(holonOfTask(t), 'quests', q);
    realTask[t.id] = q.id;
    for (const to of t.holograms) {
      if (!hid[to]) continue;
      await publishToFederation(
        { holosphere: h, holonId: holonOfTask(t), lens: 'quests', item: q },
        { kind: 'partner', holonId: hid[to] } as any,
        { useHolograms: true } as any,
      ).catch((e: Error) => log(`  hologram ${t.id}→${to}: ${e.message}`));
    }
    if (t.status === 'done' && t.assignee) {
      // Completed by whoever did it, in the holon that owns the task.
      const doer = t.assignee;
      const hd = await hs(doer);
      const fresh = (await hd.get(holonOfTask(t), 'quests', q.id)) ?? q;
      const done = applyTaskCompletion(fresh, pk[doer], { isAmbassador: true } as any);
      if (!done.ok) { log(`  complete ${t.id}: ${done.reason}`); continue; }
      const eq = HOLONS.find((x) => x.id === t.holon)!.equation;
      const plan = planTaskCompletion(done.task, eq, { holonId: holonOfTask(t) });
      await executeCompletionPlan(hd, new REAEventStore(hd), holonOfTask(t), plan);
    }
  }
  log(`tasks: ${Object.keys(realTask).length}`);

  // 5. What each circle's equation counts besides tasks: views per article,
  //    edits, features shipped, leads — contributions INTO the circle.
  let n = 0;
  for (const t of Object.values(s.tasks)) {
    if (t.kind !== 'article' || !t.assignee || !t.views) continue;
    const e = createExpense({ id: `views-${t.id}`, amount: t.views, currency: 'view', description: `“${t.title}” — ${t.views.toLocaleString('en')} views`, paidBy: pk[t.assignee], splitWith: [hid.content] } as any);
    if (e) { await (await hs(t.assignee)).put(hid.content, 'expenses', e); n++; }
  }
  for (const [circle, byPerson] of Object.entries(s.tallies)) {
    if (!hid[circle]) continue;
    for (const [person, tally] of Object.entries(byPerson)) {
      for (const [metric, amount] of Object.entries(tally.metrics)) {
        if (metric === 'view' || !(amount > 0)) continue;
        const what = { feature: 'feature requests satisfied', edit: 'articles edited', lead: 'leads brought in' }[metric] ?? metric;
        const e = createExpense({ id: `${metric}-${circle}-${person}`, amount, currency: metric, description: `${amount} ${what}`, paidBy: pk[person], splitWith: [hid[circle]] } as any);
        if (e) { await (await hs(person)).put(hid[circle], 'expenses', e); n++; }
      }
    }
  }
  log(`contributions: ${n}`);

  // 6. Money arrives — one mint per rail, by the circle's lead (an admin).
  const mints: Array<[string, number, string, string]> = [
    ['meridian', 18000, 'EUR', 'Open Collective · opencollective.com/meridian-works — customer subscriptions'],
    ['content', 420000, 'SAT', 'Nostr zaps to npub1meridian…content — readers'],
    ['eng', 1.5, 'ETH', 'Protocol grant to 0xEng1…neer'],
    ['meridian', 8000, 'USDC', 'Pot 0x7a3e…c41D — client invoice'],
  ];
  for (const [c, amount, unit, memo] of mints) {
    const a = buildMint({ amount, unit, memo });
    await (await hs(LEAD[c])).append(hid[c], FLOW_MINTS_LENS, a.item, { refs: a.refs });
  }
  log('mints recorded');

  // Let the relays settle before anything is claimed.
  await pause(1500);
  const out = { app: APP, relay: RELAY, holons: hid, people: Object.fromEntries(PEOPLE.map((p) => [p.id, { name: p.name, pubkey: pk[p.id], sk: nsec[p.id] }])) };
  const { writeFile } = await import('node:fs/promises');
  await writeFile(new URL('./seeded.json', `file://${process.cwd()}/`), JSON.stringify(out, null, 2));
  log('wrote seeded.json');
  return out;
}

export { main, hs, pk, nsec, hid, LEAD, buildClaim, buildClaimVerdict, FLOW_CLAIMS_LENS };

main().then(
  () => setTimeout(() => process.exit(0), 500),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
