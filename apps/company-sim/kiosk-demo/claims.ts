// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Print each claim in a circle's log with its judged status.
import { readFileSync } from 'node:fs';
import { createHoloSphere } from '@holons/core/holosphere';
import { judged } from './judge.js';
const seeded = JSON.parse(readFileSync('seeded.json', 'utf8'));
(async () => {
  const hs: any = await createHoloSphere({ appName: seeded.app, privateKey: 'ef'.repeat(32), relays: [seeded.relay], store: { adapter: 'memory' }, enforce: true, awaitReady: true } as any);
  const holon = seeded.holons[process.argv[2] || 'content'];
  const { ctx, policy } = await judged(hs, holon);
  console.log('policy', JSON.stringify(policy));
  for (const c of (ctx as any).folded.claims ?? []) console.log(JSON.stringify({ party: String(c.party).slice(0, 8), amount: c.amount, unit: c.unit, status: c.status, reason: c.reason, attests: c.attests }));
  process.exit(0);
})();
