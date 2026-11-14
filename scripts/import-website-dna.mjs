// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Import the website's /dna page (dna.html + src/dna/content.js: GENES,
// FRAMEWORKS) into Liminal Village's `genes` lens, as @holons/core/dna genes.
//
//   - 7 genes in page order; Thresholds is a `custom` gene. kind/ack per the
//     blueprint defaults; colours are the helix colours of the page.
//   - Allele icons: Font Awesome class -> ALLELE_ICONS semantic key. Anything
//     with no key is left without an icon and reported.
//   - Gene `links` kept (relative links made absolute on liminalvillage.com).
//   - FRAMEWORKS shared between genes: the first gene that lists one OWNS it
//     (allele.detail); every other gene lists a one-level `ref` allele.
//   - The terms gene is left out unless --with-terms.
//
// DRY RUN BY DEFAULT: parses, validates, prints a summary, writes JSON (with
// the dnaHash) and the review markdown. Nothing touches a relay.
//
//   node scripts/import-website-dna.mjs                       # dry run
//   node scripts/import-website-dna.mjs --with-terms          # dry run, + terms gene
//   node scripts/import-website-dna.mjs --apply [--with-terms]
//
// --apply signs every gene with the key in HOLOSPHERE_NSEC (the admin key the
// bot/holon uses: the `genes` guard counts only an admin's signature) and
// publishes to the relays of HOLOSPHERE_RELAYS, in the HOLONS_APP namespace
// (LIVE prod when it is `Holons`). Run it only after the dry-run JSON and the
// review were read. Needs: pnpm --filter @holons/core build.
//
// Env/options:
//   ENV_FILE=/path/.env   reads ONLY HOLONS_APP, HOLOSPHERE_RELAYS, HOLOSPHERE_NSEC from it
//   WEBSITE=/path/website (default ~/Projects/website)
//   HOLON=-1003864542239  target holon (default Liminal Village)
//   OUT=<dir>             where dry-run files go (default: cwd)
//   TERMS=<path>          the reviewed terms gene JSON (with --with-terms)

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { absolutize, buildGenes, parseDnaHtml, renderReview } from './lib/website-dna.mjs';

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const WITH_TERMS = args.has('--with-terms');
const HOLON = process.env.HOLON || '-1003864542239';
const WEBSITE = process.env.WEBSITE || join(homedir(), 'Projects/website');
const OUT = process.env.OUT || process.cwd();
const TERMS = process.env.TERMS || '';

/** Pull only the named keys out of a dotenv file (never printed). */
function readEnvKeys(file, keys) {
  const out = {};
  if (!file) return out;
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && keys.includes(m[1])) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const dna = await import(new URL('../packages/core/dist/dna/index.js', import.meta.url).href);
const { ALLELE_ICONS, validateGene, validateGenes, geneBytes, geneHash, dnaHash, shortHash, normalizeGene, sortGenes } = dna;

const html = readFileSync(join(WEBSITE, 'dna.html'), 'utf8');
const content = await import(pathToFileURL(join(WEBSITE, 'src/dna/content.js')).href);
const icons = new Set(ALLELE_ICONS);
const updated = new Date().toISOString();

const parsed = parseDnaHtml(html);
const built = buildGenes({ parsed, content, isIcon: (k) => icons.has(k), updated });
let genes = built.genes.map((g) => normalizeGene(g));

if (WITH_TERMS) {
  if (!TERMS) throw new Error('--with-terms needs TERMS=<path to liminal-terms-gene.json>');
  const raw = JSON.parse(readFileSync(TERMS, 'utf8'));
  const terms = normalizeGene({
    ...raw,
    updated,
    links: (raw.links ?? []).map((l) => ({ ...l, href: absolutize(l.href) })),
    alleles: (raw.alleles ?? []).map((a) => ({ ...a, ...(a.link ? { link: { ...a.link, href: absolutize(a.link.href) } } : {}) })),
  });
  genes.push(terms);
}
genes = sortGenes(genes);

// ── Checks: every gene valid, whole DNA valid, every gene within 48 KB ──────
const issues = validateGenes(genes);
for (const g of genes) for (const i of validateGene(g, genes.filter((o) => o !== g))) if (!issues.some((x) => x.code === i.code && x.gene === i.gene && x.allele === i.allele && x.field === i.field)) issues.push(i);

const summary = genes.map((g) => ({ id: g.id, kind: g.kind, ack: g.ack, color: g.color ?? null, alleles: g.alleles.length, refs: g.alleles.filter((a) => a.ref).length, details: g.alleles.filter((a) => a.detail).length, links: g.links?.length ?? 0, bytes: geneBytes(g), hash: shortHash(geneHash(g, genes)) }));
const hash = dnaHash(genes);

console.log(`Holon ${HOLON} · ${genes.length} genes · ${genes.reduce((n, g) => n + g.alleles.length, 0)} alleles · dnaHash ${hash} (${shortHash(hash)})`);
console.table(summary);
console.log(`unmapped icons: ${built.unmapped.length ? built.unmapped.map((u) => `${u.fa} @ ${u.gene}${u.allele ? '/' + u.allele : ''} (${u.where})`).join('; ') : 'none'}`);
console.log(`approximate icon picks: ${built.approx.length}`);
console.log(`validation issues: ${issues.length}${issues.length ? '\n' + issues.map((i) => `  ${i.gene}${i.allele ? '/' + i.allele : ''} ${i.code}: ${i.message}`).join('\n') : ''}`);
if (issues.length) {
  console.error('Refusing: fix the issues above first.');
  process.exit(1);
}

// ── Output ──────────────────────────────────────────────────────────────────
const tag = WITH_TERMS ? '+terms' : '';
const jsonPath = join(OUT, `liminal-genes${tag}.dry.json`);
const payload = { holon: HOLON, dnaHash: hash, short: shortHash(hash), generatedFor: 'dry-run', unmapped: built.unmapped, approx: built.approx, lost: built.lost, summary, genes };
writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
console.log(`wrote ${jsonPath}`);
const reviewPath = join(OUT, `liminal-genes${tag}-review.md`);
writeFileSync(reviewPath, renderReview({ genes, built, parsed, hash, short: shortHash(hash), holon: HOLON, withTerms: WITH_TERMS }));
console.log(`wrote ${reviewPath}`);

if (!APPLY) {
  console.log('Dry run: nothing was written to any relay. Re-run with --apply to publish.');
  process.exit(0);
}

// ── Apply (NOT run by the work package that wrote it) ───────────────────────
const fileEnv = readEnvKeys(process.env.ENV_FILE, ['HOLONS_APP', 'HOLOSPHERE_RELAYS', 'HOLOSPHERE_NSEC']);
const APP = process.env.HOLONS_APP || fileEnv.HOLONS_APP || 'Holons';
const KEY = process.env.HOLOSPHERE_NSEC || fileEnv.HOLOSPHERE_NSEC || '';
if (!KEY) {
  console.error('FATAL: HOLOSPHERE_NSEC (the admin key the bot uses) is not set; refusing to sign under a throwaway key.');
  process.exit(1);
}
const { createHoloSphere, resolveRelays } = await import(new URL('../packages/core/dist/holosphere/index.js', import.meta.url).href);
const relays = resolveRelays(process.env.HOLOSPHERE_RELAYS || fileEnv.HOLOSPHERE_RELAYS);
console.log(`APPLY: namespace ${APP}, relays ${relays.join(', ')}, holon ${HOLON}`);

// Raw writes: no ledger, roster mirror or registry side effects from an import.
const hs = await createHoloSphere({ appName: APP, privateKey: KEY, relays, store: { adapter: 'memory' }, awaitReady: true, ledger: false, rosterMirror: false, registry: false });
const { putGene, readGenes } = dna;
for (const g of genes) {
  const stored = await putGene(hs, HOLON, g);
  console.log(`put ${stored.id} (${geneBytes(stored)} bytes)`);
}
// Give the relays a moment, then read back through the enforced path.
await new Promise((r) => setTimeout(r, 8000));
const back = await readGenes(hs, HOLON);
const backHash = dnaHash(back);
console.log(`read back ${back.length}/${genes.length} genes, dnaHash ${backHash}${backHash === hash ? ' (matches)' : ' (DIFFERS: check the guard / signer)'}`);
process.exit(backHash === hash ? 0 : 2);
