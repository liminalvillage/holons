// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Copy the Telegram file_id pictures already in the graph to Blossom and
// rewrite each record's `picture` to the hosted URL, so old pictures show
// everywhere like new ones (see deploy/blossom/README.md).
//
// A file_id opens only with the token of the bot that received it, so every
// bot's token goes in BOT_TOKENS (comma-separated; BOT_TOKEN is tried too).
// A picture no token opens is reported and left as it is.
//
// DRY-RUN by default: resolves every picture and prints what it WOULD
// rewrite. Pass --apply to upload and write.
//
// HOW TO RUN (core dist must be built: pnpm --filter @holons/core build)
//   cd packages/telegram-ui
//   HOLONS_APP=Holons BOT_TOKENS=<t1>,<t2> \
//     node ../../scripts/rehost-pictures.mjs -1004438000774 -1004318065568
//   …same with --apply to do it. --lenses quests,expenses picks the lenses.

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const lensArg = args.find((a) => a.startsWith('--lenses='))?.split('=')[1];
const LENSES = (lensArg || 'quests,expenses,events,tags').split(',').filter(Boolean);
const HOLONS = args.filter((a) => !a.startsWith('--'));
if (!HOLONS.length) {
  console.error(
    'usage: node rehost-pictures.mjs <holonId>… [--lenses=quests,expenses] [--apply]\n' +
      '  env: HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC (signs uploads + writes), BOT_TOKENS, MEDIA_SERVERS',
  );
  process.exit(64);
}
const APP = process.env.HOLONS_APP || 'Holons';
const KEY = process.env.HOLOSPHERE_NSEC;
if (!KEY) {
  console.error('HOLOSPHERE_NSEC is required: it signs the uploads and the rewritten records.');
  process.exit(64);
}

const { createRequire } = await import('module');
const { pathToFileURL } = await import('url');
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const mod = await import(pathToFileURL(requireFromCwd.resolve('holosphere')).href);
const HoloSphere = mod.HoloSphere || mod.default;
const core = (sub) => import(new URL(`../packages/core/dist/${sub}/index.js`, import.meta.url).href);
const { resolveRelays, signerFromSecretKey } = await core('holosphere');
const { pictureSource, resolveMediaServers, uploadBlob } = await core('media');
const { nsecToHex } = await core('nostr');

const RELAYS = resolveRelays(process.env.HOLOSPHERE_RELAYS);
const SERVERS = resolveMediaServers(process.env.MEDIA_SERVERS);
const signer = signerFromSecretKey(nsecToHex(KEY));
const TOKENS = [
  ...new Set(
    [process.env.BOT_TOKEN, ...(process.env.BOT_TOKENS ?? '').split(',')]
      .map((t) => (t ?? '').replace(/[^A-Za-z0-9:_-]/g, ''))
      .filter(Boolean),
  ),
];

const hs = new HoloSphere({ appName: APP, privateKey: KEY, relays: RELAYS, store: { adapter: 'memory' } });
await hs.ready();

console.log(`\n=== rehost pictures: ${APP}  (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
console.log(`relays=${RELAYS.join(', ')}  media=${SERVERS.join(', ')}  bots=${TOKENS.length}\n`);

/** Download a file_id with whichever bot owns it. Never logs a token. */
async function download(fileId) {
  for (const token of TOKENS) {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)
      .then((r) => r.json())
      .catch(() => null);
    const path = meta?.ok ? meta.result?.file_path : null;
    if (!path) continue;
    const resp = await fetch(`https://api.telegram.org/file/bot${token}/${path}`).catch(() => null);
    if (resp?.ok) return { bytes: new Uint8Array(await resp.arrayBuffer()), path };
  }
  return null;
}

function sniff(bytes, path) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'image/webp';
  if (/\.png$/i.test(path)) return 'image/png';
  return 'image/jpeg';
}

/** Every `picture` in a record that is still a Telegram file_id, with a setter. */
function telegramPictures(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'picture' && pictureSource(value)?.kind === 'telegram') {
      out.push({ fileId: value, set: (url) => (node[key] = url) });
    } else if (value && typeof value === 'object') {
      telegramPictures(value, out);
    }
  }
  return out;
}

const hosted = new Map(); // fileId → url | null (unresolvable)
let found = 0;
let rewritten = 0;
let unresolved = 0;

for (const holon of HOLONS) {
  for (const lens of LENSES) {
    let items = [];
    try {
      items = (await hs.getAll(holon, lens)) || [];
    } catch (err) {
      console.log(`  ${holon}/${lens}: read failed — ${err?.message || err}`);
      continue;
    }
    for (const item of items) {
      const record = structuredClone(item);
      const pictures = telegramPictures(record);
      if (!pictures.length) continue;
      let changed = false;
      for (const p of pictures) {
        found++;
        if (!hosted.has(p.fileId)) {
          const file = await download(p.fileId);
          if (!file) hosted.set(p.fileId, null);
          else if (!APPLY) hosted.set(p.fileId, `(would upload ${file.bytes.length} bytes)`);
          else {
            try {
              const blob = await uploadBlob({ bytes: file.bytes, type: sniff(file.bytes, file.path), signer, servers: SERVERS });
              hosted.set(p.fileId, blob.url);
            } catch (err) {
              console.log(`  ✗ upload failed for ${holon}/${lens}/${item.id}: ${err?.message || err}`);
              hosted.set(p.fileId, null);
            }
          }
        }
        const url = hosted.get(p.fileId);
        if (!url) {
          unresolved++;
          console.log(`  ? ${holon}/${lens}/${item.id}: no configured bot opens this file_id`);
          continue;
        }
        console.log(`  → ${holon}/${lens}/${item.id}  "${String(item.title ?? item.description ?? '').slice(0, 50)}"  ${url}`);
        p.set(url);
        changed = true;
      }
      if (changed && APPLY) {
        try {
          await hs.put(holon, lens, record);
          rewritten++;
        } catch (err) {
          console.log(`  ✗ write failed for ${holon}/${lens}/${item.id}: ${err?.message || err}`);
        }
      }
    }
  }
}

console.log(`\n${found} Telegram picture(s); ${unresolved} not opened by any configured bot; ${APPLY ? `${rewritten} record(s) rewritten` : 'dry-run — pass --apply to upload and write'}.`);
await new Promise((r) => setTimeout(r, 1500)); // let the relay publishes drain
await hs.close();
process.exit(0);
