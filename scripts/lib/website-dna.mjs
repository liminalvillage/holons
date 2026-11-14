// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Parser + builder behind scripts/import-website-dna.mjs. PURE: no network,
// no relays, no @holons/core import (the caller injects what it needs), so a
// spec can run it on a fixture.
//
//   parseDnaHtml(html)   -> the website's /dna page as plain data
//   buildGenes(opts)     -> Gene[] (the @holons/core/dna shape), plus what
//                           could not be mapped or did not fit the model

export const SITE_ORIGIN = 'https://liminalvillage.com';

/** Font Awesome class -> semantic ALLELE_ICONS key. `approx` marks a nearest-meaning pick. */
export const FA_TO_ICON = Object.freeze({
  'fa-house': 'home',
  'fa-circle-nodes': 'network',
  'fa-seedling': 'seedling',
  'fa-people-group': 'people',
  'fa-pen-to-square': 'pencil',
  'fa-map': 'map',
  'fa-flag': 'flag',
  'fa-coins': 'coins',
  'fa-star': 'star',
  'fa-leaf': 'leaf',
  'fa-heart': 'heart',
  'fa-hands-holding-circle': 'hand',
  'fa-gift': 'gift',
  'fa-dna': 'dna',
  'fa-compass': 'compass',
  'fa-broom': 'broom',
  'fa-bolt': 'bolt',
  'fa-yin-yang': 'balance',
  'fa-utensils': 'food',
  'fa-user': 'person',
  'fa-telegram': 'send',
  'fa-paper-plane': 'send',
  'fa-spa': 'spa',
  'fa-solar-panel': 'solar',
  'fa-people-roof': 'community',
  'fa-microchip': 'chip',
  'fa-industry': 'industry',
  'fa-handshake': 'handshake',
  'fa-handshake-simple': 'handshake',
  'fa-handshake-angle': 'hand',
  'fa-hand-holding-heart': 'care',
  'fa-hand-holding-dollar': 'coins',
  'fa-hand': 'hand',
  'fa-flask': 'lab',
  'fa-atom': 'lab',
  'fa-diagram-project': 'network',
  'fa-comments': 'chat',
  'fa-comment-dots': 'chat',
  'fa-circle-notch': 'cycle',
  'fa-rotate-left': 'cycle',
  'fa-chalkboard-user': 'teach',
  'fa-bed': 'bed',
  'fa-water': 'water',
  'fa-droplet': 'water',
  'fa-video': 'video',
  'fa-users': 'people',
  'fa-user-gear': 'person',
  'fa-user-check': 'person-check',
  'fa-trophy': 'trophy',
  'fa-award': 'trophy',
  'fa-triangle-exclamation': 'warning',
  'fa-tree': 'tree',
  'fa-sun': 'sun',
  'fa-moon': 'moon',
  'fa-street-view': 'community',
  'fa-shoe-prints': 'walk',
  'fa-shield-halved': 'shield',
  'fa-scroll': 'scroll',
  'fa-screwdriver-wrench': 'tools',
  'fa-scale-balanced': 'balance',
  'fa-robot': 'robot',
  'fa-person-walking-luggage': 'travel',
  'fa-lock': 'lock',
  'fa-lightbulb': 'idea',
  'fa-laptop-code': 'code',
  'fa-code-branch': 'code',
  'fa-key': 'key',
  'fa-fire': 'fire',
  'fa-eye': 'eye',
  'fa-envelope-open-text': 'mail',
  'fa-earth-americas': 'earth',
  'fa-clock': 'clock',
  'fa-circle-question': 'info',
  'fa-calendar-check': 'calendar',
  'fa-calendar-day': 'calendar',
  'fa-book-open': 'book',
  'fa-book': 'book',
  'fa-door-open': 'travel',
  'fa-circle-check': 'check',
});

/** Mappings that are the nearest meaning rather than the same thing. */
export const APPROX_ICONS = Object.freeze(
  new Set([
    'fa-hands-holding-circle',
    'fa-yin-yang',
    'fa-handshake-angle',
    'fa-hand-holding-dollar',
    'fa-atom',
    'fa-diagram-project',
    'fa-user-gear',
    'fa-award',
    'fa-street-view',
    'fa-circle-question',
    'fa-code-branch',
    'fa-people-group',
    'fa-circle-nodes',
    'fa-pen-to-square',
    'fa-circle-notch',
    'fa-rotate-left',
    'fa-envelope-open-text',
    'fa-shoe-prints',
    'fa-door-open',
  ]),
);

// ── Text helpers ────────────────────────────────────────────────────────────

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m]);

/** HTML fragment -> plain text, whitespace collapsed. */
export const txt = (html) =>
  decode((html ?? '').replace(/<\/?(?:li|p|div|h\d|br|ul|ol|header|section|article)\b[^>]*>/g, ' ').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/** The page's own relative links point at the website; a kiosk or a bot has no such origin. */
export const absolutize = (href, origin = SITE_ORIGIN) => (typeof href === 'string' && /^\/(?!\/)/.test(href) ? `${origin}${href}` : href);

const slug = (s) =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64)
    .replace(/[-_]+$/, '');

// ── Parsing dna.html ────────────────────────────────────────────────────────

const lastFaIcon = (html) => {
  const found = [...html.matchAll(/class="ico[^"]*"[^>]*>\s*<i class="fa-(?:solid|brands|regular) (fa-[\w-]+)"/g)].map((m) => m[1]);
  return { icon: found.at(-1) ?? null, all: found };
};

function parseAllele(open, inner) {
  const attrs = open;
  const href = /href="([^"]*)"/.exec(attrs)?.[1] ?? null;
  const fw = /data-fw="([^"]*)"/.exec(attrs)?.[1] ?? null;
  const { icon, all } = lastFaIcon(inner);
  const kicker = txt(/<div class="kicker">([\s\S]*?)<\/div>/.exec(inner)?.[1] ?? '');
  const h3 = /<h3>([\s\S]*?)<\/h3>/.exec(inner)?.[1] ?? '';
  const statHtml = /<span class="stat">([\s\S]*?)<\/span>/.exec(h3)?.[1] ?? null;
  const stat = statHtml == null ? null : txt(statHtml);
  const statIcon = statHtml != null && !stat ? (/fa-(?:solid|brands) (fa-[\w-]+)/.exec(statHtml)?.[1] ?? 'icon') : null;
  const title = txt(h3.replace(/<span class="stat">[\s\S]*?<\/span>/, ''));
  const go = txt(/<div class="go">([\s\S]*?)<\/div>/.exec(inner)?.[1] ?? '').replace(/\s*→$/, '');

  const listAt = (re) => {
    const m = re.exec(inner);
    return m ? { index: m.index, items: [...m[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => x[1]) } : null;
  };
  const steps = listAt(/<ol class="steps">[\s\S]*?<\/ol>/)?.items.map((li) => ({
    name: txt(/<b>([\s\S]*?)<\/b>/.exec(li)?.[1] ?? ''),
    desc: txt(/<span>([\s\S]*?)<\/span>/.exec(li)?.[1] ?? ''),
  }));
  const miniBlock = listAt(/<ul class="mini">[\s\S]*?<\/ul>/);
  const chipBlock = /<ul class="chips( no)?">[\s\S]*?<\/ul>/.exec(inner);
  const chips = chipBlock
    ? {
        index: chipBlock.index,
        no: !!chipBlock[1],
        items: [...chipBlock[0].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((x) => ({
          text: txt(x[1]),
          fw: /data-fw="([^"]*)"/.exec(x[1])?.[1] ?? null,
          icon: /fa-(?:solid|brands) (fa-[\w-]+)/.exec(x[1])?.[1] ?? null,
        })),
      }
    : null;
  const mini = miniBlock
    ? {
        index: miniBlock.index,
        items: miniBlock.items.map((li) => ({
          text: txt(li),
          icon: /fa-(?:solid|brands) (fa-[\w-]+)/.exec(li)?.[1] ?? null,
          links: [...li.matchAll(/<a class="link" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], label: txt(m[2]) })),
        })),
      }
    : null;

  // The one free paragraph (not inside a list).
  const stripped = inner.replace(/<(ul|ol)[\s\S]*?<\/\1>/g, (m) => ' '.repeat(m.length));
  const pm = /<p>([\s\S]*?)<\/p>/.exec(stripped);
  const pHtml = pm ? inner.slice(pm.index, pm.index + pm[0].length).replace(/^<p>|<\/p>$/g, '') : null;
  const p = pHtml == null ? null : { index: pm.index, text: txt(pHtml), links: [...pHtml.matchAll(/<a class="link" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], label: txt(m[2]) })) };

  return { href, fw, icon, pairIcons: all, kicker, title, stat, statIcon, go: go || null, steps: steps ?? null, mini, chips, p };
}

/** The website's /dna page as data: header text, genes (in page order) with their allele cards. */
export function parseDnaHtml(html) {
  const hero = {
    eyebrow: txt(/<div class="eyebrow">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''),
    lede: txt(/<section class="hero">[\s\S]*?<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ''),
  };
  const outro = {
    title: txt(/<section class="outro">[\s\S]*?<h2>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? ''),
    text: txt(/<section class="outro">[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? ''),
    buttons: [...(/<section class="outro">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '').matchAll(/<a class="btn[^"]*" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], label: txt(m[2]) })),
  };
  const footer = txt(/<div class="lic">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '');

  const genes = [];
  const sectionRe = /<section class="gene" id="([\w-]+)"[^>]*style="--g:(#[0-9a-fA-F]{6})"[^>]*>([\s\S]*?)<\/section>/g;
  for (const m of html.matchAll(sectionRe)) {
    const [, id, color, body] = m;
    const header = /<header class="tag">([\s\S]*?)<\/header>/.exec(body)?.[1] ?? '';
    const after = body.slice(body.indexOf('</header>') + 9);
    const quote = /<p class="quote">([\s\S]*?)<\/p>/.exec(header)?.[1];
    const lede = /<blockquote>([\s\S]*?)<\/blockquote>/.exec(header)?.[1] ?? /<p>([\s\S]*?)<\/p>/.exec(header)?.[1] ?? '';
    const num = /<div class="num"><b>([\s\S]*?)<\/b>([\s\S]*?)<small/.exec(header);
    const alleles = [];
    for (const a of after.matchAll(/<(article|a) class="allele"([^>]*)>([\s\S]*?)<\/\1>/g)) alleles.push(parseAllele(a[2], a[3]));
    genes.push({ id, color: color.toLowerCase(), title: txt(/<h2>([\s\S]*?)<\/h2>/.exec(header)?.[1] ?? ''), tagline: num ? txt(num[2]) : '', lede: txt(lede), quote: quote ? txt(quote) : null, alleles });
  }
  return { hero, outro, footer, genes };
}

// ── Building genes ──────────────────────────────────────────────────────────

/** kind and ack per the blueprint (section 1 defaults). Thresholds is a `custom` gene. */
export const GENE_KIND_BY_SECTION = Object.freeze({
  purpose: 'purpose',
  thresholds: 'custom',
  values: 'values',
  agreements: 'agreements',
  practices: 'practices',
  roles: 'roles',
  tools: 'tools',
});
const ACK_BY_KIND = { purpose: 'read', values: 'agree', agreements: 'agree', practices: 'agree', roles: 'none', tools: 'none', terms: 'agree', custom: 'read' };

/**
 * @param {object} o
 * @param {ReturnType<typeof parseDnaHtml>} o.parsed
 * @param {{ GENES: Record<string, any>, FRAMEWORKS: Record<string, any> }} o.content
 * @param {(v: unknown) => boolean} o.isIcon  true for a key in ALLELE_ICONS
 * @param {string} [o.updated]  ISO stamp for `updated`
 * @param {string} [o.origin]   site origin for relative links
 */
export function buildGenes({ parsed, content, isIcon, updated = '', origin = SITE_ORIGIN }) {
  const { GENES, FRAMEWORKS } = content;
  const unmapped = []; // { gene, allele, fa, where }
  const approx = []; // { gene, allele, fa, icon }
  const lost = []; // { gene, allele?, what, text? }
  const fwOwner = {}; // framework id -> gene id (the first gene whose content lists it)
  for (const g of parsed.genes) for (const f of GENES[g.id]?.frameworks ?? []) fwOwner[f] ??= g.id;

  const mapIcon = (fa, gene, allele, where) => {
    if (!fa) return undefined;
    const key = FA_TO_ICON[fa];
    if (!key || !isIcon(key)) {
      unmapped.push({ gene, allele, fa, where });
      return undefined;
    }
    if (APPROX_ICONS.has(fa)) approx.push({ gene, allele, fa, icon: key });
    return key;
  };
  const link = (l, gene, allele, where) => {
    const icon = mapIcon(l.icon, gene, allele, where);
    return { label: l.label.replace(/\s*→$/, ''), href: absolutize(l.href, origin), ...(icon ? { icon } : {}) };
  };

  const alleleOf = (geneId, raw, used, refList) => {
    const id = (() => {
      const base = slug(raw.title) || `allele-${used.size + 1}`;
      let out = base;
      for (let n = 2; used.has(out); n++) out = `${base}-${n}`;
      used.add(out);
      return out;
    })();
    const a = { id, title: raw.title };
    if (raw.kicker) a.kicker = raw.kicker;
    const icon = mapIcon(raw.icon, geneId, id, 'allele');
    if (icon) a.icon = icon;
    if (raw.pairIcons.length > 1) lost.push({ gene: geneId, allele: id, what: 'second icon of a pair', text: raw.pairIcons.filter((x) => x !== raw.icon).join(', ') });
    if (raw.statIcon) lost.push({ gene: geneId, allele: id, what: 'icon next to the title', text: raw.statIcon });

    // Body: the paragraph, a list (mini or chips), in page order.
    let pText = raw.p?.text ?? '';
    const links = [...(raw.p?.links ?? [])];
    if (links.length) {
      const last = links.at(-1).label;
      if (pText.endsWith(last)) pText = pText.slice(0, -last.length).replace(/[\s.]+$/, '').trim();
    }
    const parts = [];
    const lines = [];
    if (raw.mini) {
      for (const it of raw.mini.items) {
        lines.push(`- ${it.text}`);
        links.push(...it.links);
        if (it.icon) lost.push({ gene: geneId, allele: id, what: 'list-item icon', text: `${it.icon} (${it.text})` });
      }
    }
    if (raw.chips) {
      const dropped = new Set(refList);
      for (const it of raw.chips.items) {
        if (it.fw && dropped.has(it.fw)) continue; // shown as a ref allele instead
        lines.push(`- ${it.text}`);
        if (it.icon) lost.push({ gene: geneId, allele: id, what: 'chip icon', text: `${it.icon} (${it.text})` });
      }
    }
    const listFirst = (raw.mini ?? raw.chips)?.index < (raw.p?.index ?? Infinity);
    const stat = raw.stat ? raw.stat : '';
    const para = [stat, pText].filter(Boolean).join(' · ');
    if (listFirst) parts.push(lines.join('\n'), para);
    else parts.push(para, lines.join('\n'));
    const body = parts.filter(Boolean).join('\n\n');
    if (body) a.body = body;

    const all = [];
    if (raw.href && raw.go) all.push({ href: raw.href, label: raw.go });
    all.push(...links);
    if (all.length) a.link = link(all[0], geneId, id, 'allele link');
    const detail = {};
    if (all.length > 1) detail.links = all.slice(1).map((l) => link(l, geneId, id, 'detail link'));
    if (raw.steps?.length) detail.steps = raw.steps.map((s) => (s.desc ? `${s.name}: ${s.desc}` : s.name));
    if (Object.keys(detail).length) a.detail = { body: '', ...detail };
    return a;
  };

  const frameworkAllele = (fid, geneId) => {
    const fw = FRAMEWORKS[fid];
    const links = [...(fw.page ? [{ label: 'On our Frameworks page', href: fw.page }] : []), ...(fw.links ?? [])].map((l) => link(l, geneId, fid, 'framework link'));
    return {
      id: fid,
      title: fw.title,
      kicker: fw.origin,
      body: fw.tagline,
      detail: {
        body: fw.body,
        ...(fw.steps?.length ? { steps: [...fw.steps] } : {}),
        ...(links.length ? { links } : {}),
        ...(fw.image ? { image: { src: absolutize(fw.image.src, origin), alt: fw.image.alt } } : {}),
      },
    };
  };

  const genes = parsed.genes.map((pg, index) => {
    const info = GENES[pg.id] ?? {};
    const kind = GENE_KIND_BY_SECTION[pg.id] ?? 'custom';
    const used = new Set();
    const refList = info.frameworks ?? [];
    const alleles = [];

    if (pg.quote) {
      const m = /^[“"]?([\s\S]*?)[”"]?\s*[—-]\s*([^—-]+)$/.exec(pg.quote);
      const a = { id: 'rohr', title: `${m ? m[2].trim() : 'A quote'} on thresholds`, kicker: 'Quote', body: m ? m[1].trim() : pg.quote };
      used.add('rohr');
      alleles.push(a);
    }
    for (const raw of pg.alleles) alleles.push(alleleOf(pg.id, raw, used, refList));

    // Frameworks this gene owns: merge into a card of the same name, else add one.
    for (const fid of refList.filter((f) => fwOwner[f] === pg.id)) {
      const fa = frameworkAllele(fid, pg.id);
      const same = alleles.find((a) => !a.ref && a.title.toLowerCase().replace(/[^a-z]/g, '') === fa.title.toLowerCase().replace(/[^a-z]/g, ''));
      if (same) {
        same.id = fid;
        used.add(fid);
        same.kicker = fa.kicker;
        same.body = fa.body;
        same.detail = { ...fa.detail, steps: same.detail?.steps ?? fa.detail.steps };
      } else {
        let id = fid;
        for (let n = 2; used.has(id); n++) id = `${fid}-${n}`;
        used.add(id);
        alleles.push({ ...fa, id });
      }
    }
    // Frameworks owned elsewhere: a one-level ref.
    for (const fid of refList.filter((f) => fwOwner[f] !== pg.id)) {
      let id = `${fwOwner[fid]}-${fid}`.slice(0, 64);
      for (let n = 2; used.has(id); n++) id = `${fid}-${n}`;
      used.add(id);
      alleles.push({ id, title: FRAMEWORKS[fid].title, ref: `${fwOwner[fid]}/${fid}` });
    }
    if (pg.tagline) lost.push({ gene: pg.id, what: 'page tagline (the "Why we exist" line over the title)', text: pg.tagline });
    if (pg.lede && pg.lede !== info.blurb) lost.push({ gene: pg.id, what: 'page intro text (the gene shows the Explore-drawer blurb instead)', text: pg.lede });
    const links = (info.links ?? []).map((l) => link(l, pg.id, undefined, 'gene link'));
    return {
      id: pg.id,
      kind,
      title: pg.title,
      blurb: info.blurb ?? pg.lede,
      color: pg.color,
      order: index + 1,
      ack: ACK_BY_KIND[kind],
      ...(links.length ? { links } : {}),
      alleles,
      lang: 'en',
      updated,
    };
  });

  return { genes, unmapped, approx, lost };
}

// ── Review markdown ─────────────────────────────────────────────────────────

const quoteBody = (s) => String(s).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n');

/** A readable review of the built genes, for a human to read before --apply. */
export function renderReview({ genes, built, parsed, hash, short, holon, withTerms }) {
  const out = [];
  const w = (s = '') => out.push(s);
  w(`# Liminal Village genes: review before --apply`);
  w();
  w(`Holon ${holon} · ${genes.length} genes · ${genes.reduce((n, g) => n + g.alleles.length, 0)} alleles · dnaHash \`${short}\` (${hash})`);
  w(`${withTerms ? 'Includes' : 'Excludes'} the terms gene (${withTerms ? 'as reviewed' : 'see liminal-terms-review.md; import with --with-terms'}).`);
  w();
  w('## Decisions this import made (change any of them before --apply)');
  w();
  w('- **Gene blurb = the Explore-drawer text of the website (`content.js` GENES.blurb).** The one-line intro printed on the page under each title is not stored (listed under "Not carried over"). The purpose blurb becomes the NIP-29 `about`.');
  w('- **Relative website links are made absolute** (`/frameworks` becomes `https://liminalvillage.com/frameworks`), because a kiosk or a bot has no such origin. The same for framework image paths.');
  w('- **Framework ownership:** the first gene that lists a framework in `content.js` owns it (`allele.detail`). That is `agreements` for all nine. `roles` and `tools` list it as a one-level `ref` allele.');
  w('- **Four Agreements, Holacracy** get their own framework allele in `agreements` next to the page cards that mention them. **Non-Violent Communication** is one card (the page card and the framework are the same thing).');
  w('- **Each pair icon** (shifts, thresholds) is reduced to one icon: the destination or second side. The other is listed under "Not carried over".');
  w('- **Rich cards are flattened to text:** step lists (Observation / Feeling / Need / Request, the tension steps) become `detail.steps`; check-lists and chip lists become bullet lines in `body`.');
  w('- **Added from the page header:** the Richard Rohr quote on thresholds, as its own allele.');
  w('- **Kinds and acknowledgements:** purpose = read; thresholds = custom, read; values, agreements, practices = agree; roles, tools = none. A person is asked to acknowledge 5 genes. Colours are the page helix colours.');
  w();
  w('## Genes');
  const icon = (a) => (a.icon ? `[${a.icon}] ` : '');
  for (const g of genes) {
    w();
    w(`### ${g.order}. ${g.title} (\`${g.id}\`)`);
    w();
    w(`kind \`${g.kind}\` · ack \`${g.ack}\` · color ${g.color ?? 'none'} · ${g.alleles.length} alleles`);
    w();
    w(`> ${g.blurb}`);
    if (g.links?.length) {
      w();
      w('Gene links: ' + g.links.map((l) => `${l.icon ? `[${l.icon}] ` : ''}${l.label} <${l.href}>`).join(' · '));
    }
    w();
    for (const a of g.alleles) {
      if (a.ref) {
        w(`- **${a.title}** → shows \`${a.ref}\``);
        continue;
      }
      const head = `- ${icon(a)}**${a.title}**${a.kicker ? ` (${a.kicker})` : ''}`;
      w(head);
      if (a.body) w(quoteBody(a.body.split('\n').map((l) => l).join('\n')).replace(/^ {2}/gm, '  > '));
      if (a.link) w(`  link: ${a.link.label} <${a.link.href}>`);
      if (a.detail) {
        w(`  detail: ${a.detail.body ? a.detail.body : '(steps and links only)'}`);
        if (a.detail.steps?.length) w(`  steps: ${a.detail.steps.join(' / ')}`);
        if (a.detail.links?.length) w(`  more links: ${a.detail.links.map((l) => `${l.label} <${l.href}>`).join(' · ')}`);
        if (a.detail.image) w(`  image: ${a.detail.image.src}`);
      }
    }
  }

  w();
  w('## Unmapped icons (left without an icon)');
  w();
  if (!built.unmapped.length) w('None.');
  for (const u of built.unmapped) w(`- \`${u.fa}\` on ${u.gene}${u.allele ? `/${u.allele}` : ''} (${u.where}). No semantic key means the same thing; the card shows no icon. Add a key to \`ALLELE_ICONS\` or pick another.`);
  w();
  w('## Approximate icon picks (a nearest-meaning key, not the same icon)');
  w();
  const seen = new Set();
  for (const a of built.approx) {
    const k = `${a.fa}>${a.icon}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const where = built.approx.filter((x) => x.fa === a.fa && x.icon === a.icon).map((x) => `${x.gene}/${x.allele ?? 'gene link'}`);
    w(`- \`${a.fa}\` → \`${a.icon}\`: ${where.slice(0, 4).join(', ')}${where.length > 4 ? ` (+${where.length - 4})` : ''}`);
  }

  w();
  w('## Not carried over from the website page');
  w();
  const byKind = new Map();
  for (const l of built.lost) {
    const key = l.what;
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push(l);
  }
  for (const [what, items] of byKind) {
    w(`- **${what}** (${items.length})`);
    const show = what.includes('icon') && items.length > 6 ? items.slice(0, 6) : items;
    for (const i of show) w(`  - ${i.gene}${i.allele ? `/${i.allele}` : ''}: ${i.text ?? ''}`);
    if (show.length < items.length) w(`  - … and ${items.length - show.length} more`);
  }
  w(`- **Page chrome:** hero ("${parsed.hero.eyebrow}" / "${parsed.hero.lede}"), the closing "${parsed.outro.title}" block (${parsed.outro.buttons.map((b) => b.label).join(' / ')}) and the footer line "${parsed.footer}". The front page spec renders its own hero and footer.`);
  w('- **Everything visual:** the 3D helix, wires, moon-phase layout, the per-card "go" arrows, and the page-only numbering (Gene 01 to 07).');
  w('- **Chip and list icons** inside cards (listed above) and the step icons of the step lists.');
  w('- **The framework chips** in "Tools for the inside" are now `ref` alleles; the same frameworks listed in the "Frameworks we think with" card of agreements stay as text.');
  w();
  w('## Things to check');
  w();
  w('- The gene links "Apply to visit" (`/apply`) on values, practices and roles point at the website questionnaire that open question 1 proposes to delete. Keep, retarget or drop before --apply.');
  w('- A few alleles are near-duplicates by design of the page: "Tensions are opportunities" (agreements card with steps) next to the Holacracy framework allele.');
  w('- `ack` is read for purpose and thresholds, agree for values, agreements and practices. The roles gene ("Ways to take part", "How money works") carries `none`; if the money rule should be agreed to, it belongs in the terms gene.');
  w('- Every gene is far under the 48 KB cap (largest: agreements). Run with `--apply` only after the prod admin key is exported as HOLOSPHERE_NSEC; the `genes` guard counts only an admin signature.');
  return out.join('\n') + '\n';
}
