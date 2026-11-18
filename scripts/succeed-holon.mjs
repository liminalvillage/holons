// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Carry a holon on under a new id (core `succeedHolon`, see
// packages/core/src/holons/succession.ts) — by hand, for a Telegram group
// that became a supergroup before its bot knew how to do this itself
// (in the group, `/adopt <old id>` is the same thing).
//
// The key in HOLOSPHERE_NSEC must be an admin of the old holon — for a
// Telegram chat that is its bot's key.
//
// DRY-RUN by default: prints what WOULD be seated, copied and left behind,
// and signs nothing. Pass --apply to do it. --replace lets the old records
// win where both holons hold different content under one id (right when the
// new one only holds start-up defaults).
//
// HOW TO RUN (core dist must be built: pnpm --filter @holons/core build)
//   cd packages/mcp-ui
//   node --env-file=../../.env ../../scripts/succeed-holon.mjs <old id> <new id> [--replace] [--apply]
//   --lenses=a,b names lenses to look in beyond those the relays list.

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPLACE = args.includes('--replace');
const LENSES = (args.find((a) => a.startsWith('--lenses='))?.split('=')[1] ?? '').split(',').filter(Boolean);
const [FROM, TO] = args.filter((a) => !a.startsWith('--'));
if (!FROM || !TO) {
  console.error(
    'usage: node succeed-holon.mjs <old holon id> <new holon id> [--replace] [--lenses=a,b] [--apply]\n' +
      '  env: HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC (an admin key of the old holon)',
  );
  process.exit(64);
}
const APP = process.env.HOLONS_APP || 'Holons';
const KEY = (process.env.HOLOSPHERE_NSEC || '').trim();
if (!KEY) {
  console.error('HOLOSPHERE_NSEC is required: it signs the roster, the copies and the succession records.');
  process.exit(64);
}

const core = (sub) => import(new URL(`../packages/core/dist/${sub}/index.js`, import.meta.url).href);
const { createHoloSphere, resolveRelays } = await core('holosphere');
const { nsecToHex, projectionOptionsFor } = await core('nostr');
const { succeedHolon, readSuccessor } = await core('holons');

const RELAYS = resolveRelays(process.env.HOLOSPHERE_RELAYS);
const privateKey = nsecToHex(KEY);
const hs = await createHoloSphere({
  appName: APP,
  privateKey,
  relays: RELAYS,
  store: { adapter: 'memory' },
  // The same standard-kind projections the bot writes with.
  nostr: projectionOptionsFor({ appName: APP, privateKey, lenses: process.env.HOLOSPHERE_PROJECTIONS }),
  awaitReady: true,
});

console.log(`\n=== succeed holon: ${APP}  ${FROM} → ${TO}  (${APPLY ? 'APPLY' : 'DRY-RUN'}${REPLACE ? ', old records win' : ''}) ===`);
console.log(`relays=${RELAYS.join(', ')}  signing as ${String(hs.currentPubkey).slice(0, 8)}…\n`);

const result = await succeedHolon(hs, { from: FROM, to: TO, overwrite: REPLACE, lenses: LENSES, dryRun: !APPLY });
if (!result.ok) {
  console.error(`refused: ${result.refused}`);
  await hs.close?.();
  process.exit(1);
}

const total = Object.values(result.copied).reduce((a, b) => a + b, 0);
console.log(`new holon ${result.founded ? (APPLY ? 'founded' : 'would be founded') : 'already founded'}; keys ${APPLY ? 'seated' : 'to seat'}: ${result.seated.length}`);
console.log(`${APPLY ? 'copied' : 'would copy'} ${total} records:`, result.copied);
console.log(`already there: ${result.kept}`);
if (result.conflicts.length) console.log(`differ on both sides (new holon's kept):`, result.conflicts);
if (result.skipped.length) console.log('lenses left behind:', result.skipped.map((s) => `${s.lens} (${s.reason})`).join(', '));
if (result.sealed.length) console.log('sealed items left behind:', result.sealed);
if (APPLY) console.log(`personal mirrors repointed: ${result.repointed}`);
if (result.failed.length) console.log('FAILED writes:', result.failed);

if (APPLY) {
  // Let the relays take the writes before the process ends.
  for (let i = 0; i < 30; i++) {
    const left = (await hs.getOutbox?.())?.length ?? 0;
    if (!left) break;
    await hs.flushOutbox?.();
    await new Promise((r) => setTimeout(r, 1000));
  }
  const left = (await hs.getOutbox?.())?.length ?? 0;
  console.log(left ? `\n${left} events still unacknowledged by a relay — run again to finish.` : '\nall events acknowledged by a relay.');
  console.log(`successor of ${FROM}: ${await readSuccessor(hs, FROM)}`);
} else {
  console.log('\nDRY-RUN: nothing was signed. Pass --apply to do it.');
}
await hs.close?.();
process.exit(0);
