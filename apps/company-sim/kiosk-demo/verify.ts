// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Read the seeded demo back through core from a fresh, unrelated key.
import { readFileSync } from 'node:fs';
import { createHoloSphere } from '@holons/core/holosphere';
import { loadAllocationInputs, loadCascadeChildren, resolveCascade, scoreAllocationMembers, loadMints, loadInboundRights } from '@holons/core/flows';
import { getFederationSnapshot } from '@holons/core/federation';
const seeded = JSON.parse(readFileSync('seeded.json', 'utf8'));
const main = async () => {
  const hs: any = await createHoloSphere({ appName: seeded.app, privateKey: 'ab'.repeat(32), relays: [seeded.relay], store: { adapter: 'memory' }, enforce: true, awaitReady: true } as any);
  const scoreOf = (id: string) => scoreAllocationMembers(hs, id);
  const name = (id: string) => Object.values<any>(seeded.people).find((p) => p.pubkey === id)?.name ?? Object.entries<string>(seeded.holons).find(([, v]) => v === id)?.[0] ?? id.slice(0, 8);
  for (const [c, id] of Object.entries<string>(seeded.holons)) {
    const scored = await scoreOf(id);
    const fed = await getFederationSnapshot(hs, id).catch(() => null);
    const m = await loadMints(hs, id);
    console.log(c, 'scores', scored.map((s) => `${name(s.id)} ${s.percentage.toFixed(1)}%`).join(', '), '| partners', fed?.federated.map(name).join(','), '| mints', JSON.stringify(m.folded.byUnit), m.folded.mints.map((x: any) => x.status).join(','));
  }
  const root = seeded.holons.meridian;
  const { config, members, zoned } = await loadAllocationInputs(hs, root, { scoreOf });
  const loaded = await loadCascadeChildren(hs, [...members.map((m: any) => m.id), ...zoned.filter((p: any) => p.zone >= 1).map((p: any) => p.id)], { rootId: root, scoreOf });
  const cascade = resolveCascade({ holonId: root, total: 18000, unit: 'EUR', root: { config, members, zoned }, resolveChild: (id: string) => loaded.children[id] ?? null, maxDepth: 4 });
  console.log('zoned', zoned.map((z: any) => `${name(z.id)}@${z.zone}`).join(' '));
  for (const [id, l] of Object.entries<any>(cascade.leaves)) console.log('  leaf', name(id), l.percentage.toFixed(2) + '%');
  const lena = seeded.people.lena.pubkey;
  const inbound = await loadInboundRights(hs, lena, { scoreOf });
  console.log('lena inbound', JSON.stringify(inbound.inbound.map((r: any) => ({ from: name(r.from), ...r, from_: undefined })), null, 0).slice(0, 1500), 'upstreams', inbound.upstreams.map(name));
  process.exit(0);
};
main().catch((e) => { console.error(e); process.exit(1); });
