// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A circle's lead link attests the claims waiting in its log — the admin's
// half of a member's claim (policy: attesters = admins, quorum 1).
//   node dist/attest.cjs <circle> <lead>      e.g. eng mira
import { readFileSync } from 'node:fs';
import { createHoloSphere } from '@holons/core/holosphere';
import { FLOW_CLAIMS_LENS, buildClaimVerdict } from '@holons/core/flows';
import { judged } from './judge.js';
const seeded = JSON.parse(readFileSync(new URL('./seeded.json', `file://${process.cwd()}/`), 'utf8'));
(async () => {
  const [circle, lead] = process.argv.slice(2);
  const holon = seeded.holons[circle];
  const hs: any = await createHoloSphere({ appName: seeded.app, privateKey: seeded.people[lead].sk, relays: [seeded.relay], store: { adapter: 'memory' }, enforce: true, awaitReady: true } as any);
  const { ctx } = await judged(hs, holon);
  const waiting = ((ctx as any).folded.claims ?? []).filter((c: any) => c.status === 'pending');
  for (const c of waiting) {
    const v = buildClaimVerdict(c.id, 'attest', 'Checked against the sprint board');
    await hs.append(holon, FLOW_CLAIMS_LENS, v.item, { refs: v.refs });
    console.log(`attested ${c.amount} ${c.unit} for ${String(c.party).slice(0, 8)}`);
  }
  if (!waiting.length) console.log('nothing waiting');
  setTimeout(() => process.exit(0), 1500);
})();
