// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The browser UI for the Meridian Works simulation. Plain DOM + inline SVG.
// It renders what the engine returns and never computes meaning itself: scores,
// shares, the cascade and what is claimable all come from engine.ts (which in
// turn calls @holons/core). The only things derived here are layout and wording.

import {
  balances,
  cascadeFrom,
  circleScores,
  claim,
  collect,
  commitRightsRoot,
  createSim,
  deposit,
  flowGraph,
  fmt,
  holonById,
  nameOf,
  personById,
  step,
  tasksIn,
  unitsSeen,
  type FlowGraph,
  type SimEvent,
  type SimState,
} from './engine.js';
import { HOLONS, LUNATION_DAYS, PEOPLE, RAIL_LABEL, RAIL_UNIT, type Rail } from './scenario.js';

// ── Small helpers ────────────────────────────────────────────────────────

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const NS = 'http://www.w3.org/2000/svg';
const esc = (v: unknown): string =>
  String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const num = (v: number, unit: string): string => fmt(v, unit).replace(` ${unit}`, '');
const pct = (v: number): string => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}%`;
const POT_UNIT = RAIL_UNIT.pot;

function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

// ── State ────────────────────────────────────────────────────────────────

const SEED = 7;
const WARMUP_DAYS = 6;

let s: SimState = fresh();
let feed: SimEvent[] = [...s.events].reverse();
let selected = 'meridian';
let unit = '';
let highlight: string | null = null; // person id whose incoming paths are lit
let playing = false;
let timer = 0;

function fresh(): SimState {
  const sim = createSim(SEED);
  for (let i = 0; i < WARMUP_DAYS; i++) step(sim);
  return sim;
}

// ── Org map layout (viewBox 1000 × 680) ─────────────────────────────────

interface Shape { x: number; y: number; r: number; lx: number; ly: number }
const SHAPES: Record<string, Shape> = {
  meridian: { x: 380, y: 340, r: 320, lx: 380, ly: 52 },
  eng: { x: 250, y: 300, r: 130, lx: 250, ly: 190 },
  platform: { x: 235, y: 350, r: 62, lx: 235, ly: 308 },
  content: { x: 540, y: 215, r: 90, lx: 540, ly: 150 },
  mkt: { x: 560, y: 400, r: 85, lx: 560, ly: 342 },
  ops: { x: 330, y: 520, r: 80, lx: 330, ly: 462 },
  oss: { x: 870, y: 215, r: 78, lx: 870, ly: 212 },
};
const DOTS: Record<string, Record<string, [number, number]>> = {
  ana: { meridian: [315, 112] },
  sam: { meridian: [435, 118] },
  kai: { eng: [190, 238], platform: [212, 352] },
  mira: { eng: [312, 250] },
  theo: { platform: [262, 372] },
  lena: { content: [498, 224] },
  omar: { content: [545, 262] },
  sasha: { content: [584, 202] },
  priya: { mkt: [528, 408] },
  jonas: { mkt: [596, 430] },
  rosa: { ops: [298, 528] },
  ben: { ops: [364, 550] },
};
const colorOf = (id: string): string => holonById(id)?.color ?? '#8a8f98';
const personColor = (id: string): string => colorOf(personById(id)?.circles.at(-1) ?? '');

const mapSvg = $<SVGSVGElement>('#map');
let fx: SVGGElement;
const circleEls: Record<string, SVGGElement> = {};
const dotEls: Record<string, SVGCircleElement> = {};

function buildMap(): void {
  mapSvg.innerHTML = '';
  const defs = svgEl('defs', {}, mapSvg);
  const glow = svgEl('filter', { id: 'glow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  svgEl('feGaussianBlur', { stdDeviation: 3, result: 'b' }, glow);
  const merge = svgEl('feMerge', {}, glow);
  svgEl('feMergeNode', { in: 'b' }, merge);
  svgEl('feMergeNode', { in: 'SourceGraphic' }, merge);

  const order = ['meridian', 'eng', 'platform', 'content', 'mkt', 'ops', 'oss'];
  for (const id of order) {
    const h = holonById(id)!;
    const sh = SHAPES[id];
    const g = svgEl('g', { class: 'circ', tabindex: 0, role: 'button', 'aria-label': `${h.name}: ${h.purpose}`, 'data-id': id }, mapSvg);
    const c = svgEl('circle', { class: 'shape', cx: sh.x, cy: sh.y, r: sh.r, fill: h.color, 'fill-opacity': id === 'meridian' ? 0.06 : 0.1, stroke: h.color, 'stroke-width': id === 'meridian' ? 3.5 : 2.5 }, g);
    if (id === 'oss') c.setAttribute('stroke-dasharray', '8 6');
    if (id === 'oss') {
      const t = svgEl('text', { class: 'mtext mlabel', x: sh.lx, y: sh.ly, 'text-anchor': 'middle' }, g);
      t.innerHTML = '<tspan x="870" dy="0">Open-source</tspan><tspan x="870" dy="21">commons</tspan>';
    } else {
      svgEl('text', { class: 'mtext mlabel', x: sh.lx, y: sh.ly, 'text-anchor': 'middle' }, g).textContent = h.name;
    }
    g.addEventListener('click', () => select(id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); }
    });
    circleEls[id] = g;
  }
  svgEl('text', { class: 'msmall', x: 870, y: 120, 'text-anchor': 'middle' }, mapSvg).textContent = 'outside the company';
  svgEl('text', { class: 'msmall', x: 380, y: 72, 'text-anchor': 'middle' }, mapSvg).textContent = 'general circle';

  for (const p of PEOPLE) {
    for (const [circle, [x, y]] of Object.entries(DOTS[p.id])) {
      const key = `${p.id}@${circle}`;
      svgEl('title', {}, svgEl('circle', { class: 'dot', cx: x, cy: y, r: 8, fill: colorOf(circle) }, mapSvg)).textContent = `${p.name} — ${p.role}`;
      dotEls[key] = mapSvg.lastElementChild as SVGCircleElement;
      dotEls[key].dataset.person = p.id;
      svgEl('text', { class: 'mtext mdot', x, y: y + 22, 'text-anchor': 'middle' }, mapSvg).textContent = p.name;
    }
  }
  fx = svgEl('g', { 'pointer-events': 'none' }, mapSvg);
  markSelected();
}

function markSelected(): void {
  for (const [id, g] of Object.entries(circleEls)) {
    g.classList.toggle('sel', id === selected);
    g.setAttribute('aria-pressed', String(id === selected));
  }
}

/** Where a party sits on the map: its dot (preferring the circle) or the circle's centre. */
function posOf(id: string, circle?: string): [number, number] {
  const d = DOTS[id];
  if (d) return (circle && d[circle]) || Object.values(d)[0];
  const sh = SHAPES[id];
  return sh ? [sh.x, sh.y] : [SHAPES.meridian.x, SHAPES.meridian.y];
}

// ── Animation ────────────────────────────────────────────────────────────

function tween(ms: number, fn: (t: number) => void, done?: () => void): void {
  if (reduced) { done?.(); return; }
  const t0 = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    fn(t);
    if (t < 1) requestAnimationFrame(tick);
    else done?.();
  };
  requestAnimationFrame(tick);
}
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function pulse(at: [number, number], r0: number, color: string, ms = 800): void {
  const ring = svgEl('circle', { cx: at[0], cy: at[1], r: r0, fill: 'none', stroke: color, 'stroke-width': 4 }, fx);
  tween(ms, (t) => { ring.setAttribute('r', String(r0 + t * 26)); ring.setAttribute('opacity', String(1 - t)); }, () => ring.remove());
}
function pulseCircle(id: string, color: string): void {
  const sh = SHAPES[id];
  if (!sh) return;
  const ring = svgEl('circle', { cx: sh.x, cy: sh.y, r: sh.r, fill: color, 'fill-opacity': 0.25, stroke: color, 'stroke-width': 5 }, fx);
  tween(900, (t) => { ring.setAttribute('opacity', String(1 - ease(t))); ring.setAttribute('r', String(sh.r + t * 8)); }, () => ring.remove());
}
function flashDot(person: string, circle: string | undefined, color: string): void {
  const [x, y] = posOf(person, circle);
  pulse([x, y], 9, color, 700);
}
function floatText(at: [number, number], text: string, color: string): void {
  const t = svgEl('text', { class: 'mtext', x: at[0], y: at[1], 'text-anchor': 'middle', fill: color, 'font-size': 14, 'font-weight': 700 }, fx);
  t.style.fill = color;
  t.style.paintOrder = 'stroke';
  t.style.stroke = 'var(--card)';
  t.style.strokeWidth = '4px';
  t.textContent = text;
  tween(1400, (k) => { t.setAttribute('y', String(at[1] - 40 * k)); t.setAttribute('opacity', String(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4)); }, () => t.remove());
}

function animate(ev: SimEvent): void {
  if (reduced) return;
  const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
  switch (ev.kind) {
    case 'hologram': {
      if (!ev.to) return;
      const a = posOf(ev.holon), b = posOf(ev.to);
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(90, len * 0.3);
      const cx = mx - (dy / len) * bend, cy = my + (dx / len) * bend;
      const col = colorOf(ev.holon);
      const trail = svgEl('path', { d: `M${a[0]},${a[1]} Q${cx},${cy} ${b[0]},${b[1]}`, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-dasharray': '3 6', opacity: 0.6 }, fx);
      const card = svgEl('g', { filter: 'url(#glow)' }, fx);
      svgEl('rect', { x: -10, y: -7, width: 20, height: 14, rx: 3, fill: col, stroke: '#fff', 'stroke-width': 1.5 }, card);
      svgEl('path', { d: 'M-6,-2.5 H6 M-6,1 H3', stroke: '#fff', 'stroke-width': 1.4, 'stroke-linecap': 'round' }, card);
      tween(1300, (t) => {
        const k = ease(t), u = 1 - k;
        card.setAttribute('transform', `translate(${u * u * a[0] + 2 * u * k * cx + k * k * b[0]},${u * u * a[1] + 2 * u * k * cy + k * k * b[1]})`);
      }, () => { card.remove(); trail.remove(); pulseCircle(ev.to!, colorOf(ev.to!)); });
      break;
    }
    case 'deposit': {
      const sh = SHAPES[ev.holon];
      if (!sh) return;
      const dx = sh.x - SHAPES.meridian.x, dy = sh.y - SHAPES.meridian.y;
      const len = Math.hypot(dx, dy) || 1;
      let sx = sh.x + (dx / len) * 500, sy = sh.y + (dy / len) * 500;
      sx = Math.max(40, Math.min(960, sx)); sy = Math.max(20, Math.min(660, sy));
      const coin = svgEl('g', { filter: 'url(#glow)' }, fx);
      svgEl('circle', { r: 11, fill: '#e8b13a', stroke: '#8a5a00', 'stroke-width': 2 }, coin);
      svgEl('text', { y: 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 800, fill: '#5b3a00' }, coin).textContent = '$';
      const lab = svgEl('text', { class: 'mtext', 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': 600 }, fx);
      lab.style.fill = cssVar('--gold');
      lab.style.paintOrder = 'stroke'; lab.style.stroke = 'var(--card)'; lab.style.strokeWidth = '4px';
      lab.textContent = ev.rail ? RAIL_LABEL[ev.rail] : 'deposit';
      tween(1200, (t) => {
        const k = ease(t);
        const x = sx + (sh.x - sx) * k, y = sy + (sh.y - sh.r * 0.55 - sy) * k;
        coin.setAttribute('transform', `translate(${x},${y})`);
        lab.setAttribute('x', String(x)); lab.setAttribute('y', String(y - 18));
      }, () => {
        coin.remove(); lab.remove();
        pulseCircle(ev.holon, '#e8b13a');
        floatText([sh.x, sh.y - sh.r * 0.2], `+${fmt(ev.amount ?? 0, ev.unit ?? '')}`, cssVar('--gold'));
      });
      break;
    }
    case 'complete':
      if (ev.actor) flashDot(ev.actor, ev.holon, cssVar('--k-complete'));
      break;
    case 'claim':
    case 'collect': {
      const p = ev.actor ?? ev.holon;
      const [x, y] = posOf(p);
      const col = cssVar('--k-claim');
      const coin = svgEl('circle', { cx: x, cy: y, r: 7, fill: '#e8b13a', stroke: '#8a5a00', 'stroke-width': 2, filter: 'url(#glow)' }, fx);
      tween(1100, (t) => { coin.setAttribute('cy', String(y - 50 * ease(t))); coin.setAttribute('opacity', String(1 - t * t)); }, () => coin.remove());
      floatText([x, y - 14], `${ev.kind === 'claim' ? '−' : '↓'}${fmt(ev.amount ?? 0, ev.unit ?? '')}`, col);
      break;
    }
    case 'commit':
      pulseCircle('meridian', cssVar('--k-commit'));
      break;
    case 'task':
      if (ev.actor) flashDot(ev.actor, ev.holon, cssVar('--k-task'));
      break;
    default:
  }
}

// ── Feed ─────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  task: 'task', hologram: 'hologram', complete: 'done', article: 'article', views: 'views', appreciation: 'thanks',
  deposit: 'money in', claim: 'claim', commit: 'new moon', collect: 'collect',
};

function renderFeed(): void {
  feed = feed.slice(0, 80);
  $('#feed').innerHTML = feed
    .map((e) => `<li class="ev k-${e.kind}"><span class="d">d${e.day}</span><span><span class="k">${KIND_LABEL[e.kind] ?? e.kind}</span>${esc(e.text)}</span></li>`)
    .join('');
}

// ── Header ───────────────────────────────────────────────────────────────

function renderClock(): void {
  const inLunation = s.day % LUNATION_DAYS;
  $('#clock').innerHTML = `<b>Day ${s.day}</b> · Lunation ${s.lunation} <span class="muted small">· new moon in ${LUNATION_DAYS - inLunation} d</span>`;
  const p = inLunation / LUNATION_DAYS;
  const r = 12, k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r;
  let lit = '';
  if (p > 0.001 && p < 0.999) {
    lit = p < 0.5
      ? `M0,${-r} A${r},${r} 0 0 1 0,${r} A${rx},${r} 0 0 ${k < 0 ? 1 : 0} 0,${-r}Z`
      : `M0,${-r} A${r},${r} 0 0 0 0,${r} A${rx},${r} 0 0 ${k < 0 ? 0 : 1} 0,${-r}Z`;
  }
  $('#moon').innerHTML = `<circle r="${r}" fill="var(--moon-dark)"/><path d="${lit}" fill="var(--moon-lit)"/><circle r="${r}" fill="none" stroke="var(--muted, #888)" stroke-opacity=".5"/>`;
}

// ── Circle panel ─────────────────────────────────────────────────────────

function select(id: string): void {
  selected = id;
  markSelected();
  renderPanel();
}

function equationWords(id: string): string {
  const h = holonById(id)!;
  return h.valuedFor;
}

function renderPanel(): void {
  const h = holonById(selected)!;
  const el = $('#panel');
  const scroll = (el.querySelector('.tasks') as HTMLElement | null)?.scrollTop ?? 0;
  let html = `<h2 id="h-panel" style="display:flex;gap:8px;align-items:center"><span class="swatch" style="--k:${h.color};width:14px;height:14px"></span>${esc(h.name)}</h2>`;
  html += `<p class="sub">${esc(h.purpose)}</p>`;
  if (h.kind === 'outside') {
    html += `<p>This holon sits outside the company. It has no members of its own here; it receives what others choose to give it — for example part of Kai's personal split.</p>`;
    const rights = balances(s).find((b) => b.id === h.id);
    if (rights) {
      html += `<h3>Received so far</h3><div class="chips">${Object.entries(rights.units)
        .map(([u, v]) => `<span class="chip" style="--c:${h.color}">${esc(fmt(v.right + v.pending + v.collectable + v.collected, u))}</span>`)
        .join('')}</div>`;
    }
    el.innerHTML = html;
    return;
  }

  html += `<p><b>Valued for:</b> ${esc(equationWords(selected))}</p>`;
  const cfg = h.config;
  const interior = cfg.interiorPercent;
  const rings = h.partners.length ? `rings 1–${cfg.nzones}` : '';
  const interiorWhy = cfg.interiorMode === 'equation' || !cfg.interiorMode ? 'by the equation' : 'by a custom split';
  let split = interior >= 100
    ? `Everything that arrives is shared among its own members ${interiorWhy}.`
    : `${interior}% to its own members ${interiorWhy} · ${100 - interior}% to circles on ${rings}`;
  html += `<p><b>Split:</b> ${esc(split)}</p>`;

  const cas = cascadeFrom(s, selected).rootResult;
  const own = cas.interior;
  html += `<h3>Immediate recipients of 100%</h3>`;
  if (own.length) {
    html += `<p class="small muted" style="margin:0 0 4px">Own members (${own.length})</p><div class="chips">${own
      .filter((x) => x.percentage > 0.005)
      .sort((a, b) => b.percentage - a.percentage)
      .map((x) => `<span class="chip" style="--c:${personColor(x.id)}">${esc(x.label)} ${pct(x.percentage)}</span>`)
      .join('')}</div>`;
  }
  for (const z of cas.exterior) {
    const parts = z.members?.length ? z.members : [z];
    html += `<p class="small muted" style="margin:8px 0 4px">Ring ${z.zone ?? '?'} — ${pct(z.percentage)} in total</p><div class="chips">${parts
      .map((x) => `<span class="chip" style="--c:${colorOf(x.id)}">${esc(x.label)} ${pct(x.percentage)}</span>`)
      .join('')}</div>`;
  }

  const sc = circleScores(s, selected);
  html += `<h3>Leaderboard</h3>`;
  const sorted = [...sc.members].sort((a, b) => b.percentage - a.percentage);
  const maxPct = Math.max(1, ...sorted.map((m) => m.percentage));
  html += sorted
    .map((m) => {
      const t = m.tally;
      const tallies = [`done ${t.completed}`, `started ${t.initiated}`, `thanks ${t.received}`, ...Object.entries(t.metrics).map(([k, v]) => `${k} ${Math.round(v).toLocaleString('en')}`)];
      return `<div class="lbrow"><div class="who">${esc(m.name)}<small>${esc(m.role)}</small></div>
        <div><div class="bar" role="img" aria-label="${esc(m.name)} ${pct(m.percentage)}"><i style="width:${(m.percentage / maxPct) * 100}%;background:${h.color}"></i></div>
        <div class="lbmeta"><span><b>${pct(m.percentage)}</b> · score ${Math.round(m.score * 100) / 100}</span><span>${esc(tallies.join(' · '))}</span></div></div></div>`;
    })
    .join('');

  const tasks = tasksIn(s, selected).sort((a, b) => b.createdDay - a.createdDay);
  html += `<h3>Tasks (${tasks.length})</h3>`;
  html += tasks.length
    ? `<ul class="tasks">${tasks
        .slice(0, 14)
        .map((t) => {
          const badge = t.hologramOf
            ? `<span class="pill hl">↯ hologram of ${esc(nameOf(t.hologramOf))}</span>`
            : t.holograms.length
              ? `<span class="pill">→ also visible in ${esc(t.holograms.map(nameOf).join(', '))}</span>`
              : '';
          const who = t.assignee ? ` <span class="muted small">${esc(nameOf(t.assignee))}</span>` : '';
          return `<li><span class="pill ${t.status}">${t.status}</span><span>${esc(t.title)}</span>${who}${badge}</li>`;
        })
        .join('')}</ul>`
    : `<p class="muted small">No tasks yet — play a few days.</p>`;
  el.innerHTML = html;
  const list = el.querySelector('.tasks') as HTMLElement | null;
  if (list) list.scrollTop = scroll;
}

// ── Send funds ───────────────────────────────────────────────────────────

const DEFAULT_AMOUNT: Record<Rail, number> = { opencollective: 1000, pot: 1000, eth: 1, nostr: 100000 };
const sTarget = $<HTMLSelectElement>('#s-target');
const sRail = $<HTMLSelectElement>('#s-rail');

function initSend(): void {
  sTarget.innerHTML = HOLONS.filter((h) => Object.keys(h.rails).length)
    .map((h) => `<option value="${h.id}">${esc(h.name)}</option>`)
    .join('');
  sTarget.addEventListener('change', fillRails);
  sRail.addEventListener('change', fillRail);
  $<HTMLFormElement>('#sendform').addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = parseFloat($<HTMLInputElement>('#s-amount').value);
    const msg = $('#s-msg');
    if (!(amount > 0)) { msg.textContent = 'Enter an amount above zero.'; return; }
    const rail = sRail.value as Rail;
    const target = sTarget.value;
    const from = $<HTMLInputElement>('#s-from').value.trim() || 'A supporter';
    act(() => { deposit(s, { target, rail, amount, from }); });
    unit = RAIL_UNIT[rail];
    renderAll();
    msg.textContent = `Sent ${fmt(amount, RAIL_UNIT[rail])} to ${nameOf(target)}.`;
  });
  fillRails();
}
function fillRails(): void {
  const h = holonById(sTarget.value)!;
  sRail.innerHTML = (Object.keys(h.rails) as Rail[]).map((r) => `<option value="${r}">${esc(RAIL_LABEL[r])}</option>`).join('');
  fillRail();
}
function fillRail(): void {
  const h = holonById(sTarget.value)!;
  const r = sRail.value as Rail;
  $('#s-addr').textContent = h.rails[r] ?? '';
  $('#s-unit').textContent = RAIL_UNIT[r];
  $<HTMLInputElement>('#s-amount').value = String(DEFAULT_AMOUNT[r]);
  $('#s-note').hidden = r !== 'pot';
}

// ── Sankey ───────────────────────────────────────────────────────────────

interface LNode { id: string; label: string; type: string; color: string; col: number; value: number; y: number; h: number; x: number; inOff: number; outOff: number }
interface LLink { source: LNode; target: LNode; value: number; via: string; w: number; y0: number; y1: number }
let skNodes: LNode[] = [];
let skLinks: LLink[] = [];
let skTotal = 0;

const VIA_WORDS = (l: { source: LNode; via: string }): string => {
  switch (l.via) {
    case 'deposit': return 'arrived via the rail';
    case 'interior': return `by ${l.source.label}'s value equation`;
    case 'exterior': return `to a circle or partner on ${l.source.label}'s rings`;
    case 'kept': return 'kept from the person\'s own personal split';
    case 'retained': return `retained by ${l.source.label} (nobody named for this part)`;
    case 'cycle': return 'came back round a loop and stays here';
    default: return l.via;
  }
};

function layoutSankey(g: FlowGraph, W: number): { H: number } {
  const nodes: LNode[] = g.nodes.map((n) => ({ ...n, col: 0, value: 0, y: 0, h: 0, x: 0, inOff: 0, outOff: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: LLink[] = g.links
    .filter((l) => byId.has(l.source) && byId.has(l.target))
    .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, value: l.value, via: l.via, w: 0, y0: 0, y1: 0 }));

  for (let i = 0; i < nodes.length + 2; i++) {
    let changed = false;
    for (const l of links) if (l.target.col < l.source.col + 1) { l.target.col = l.source.col + 1; changed = true; }
    if (!changed) break;
  }
  const maxCol = Math.max(1, ...nodes.map((n) => n.col));
  for (const n of nodes) if (n.type === 'party') n.col = maxCol;
  for (const n of nodes) {
    const inV = links.filter((l) => l.target === n).reduce((a, l) => a + l.value, 0);
    const outV = links.filter((l) => l.source === n).reduce((a, l) => a + l.value, 0);
    n.value = Math.max(inV, outV);
  }

  const cols: LNode[][] = Array.from({ length: maxCol + 1 }, () => []);
  nodes.forEach((n) => cols[n.col].push(n));
  const maxN = Math.max(...cols.map((c) => c.length));
  const H = Math.max(460, maxN * 38 + 60);
  const padL = 190, padR = 150, padY = 20, nw = 14, gap = 6, slotMin = 30;
  const colX = (c: number) => padL + (c * (W - padL - padR - nw)) / maxCol;
  const ky = Math.min(
    ...cols.map((c) => (H - 2 * padY - c.length * (slotMin + gap)) / (c.reduce((a, n) => a + n.value, 0) || 1)),
  );

  const place = () => {
    for (const c of cols) {
      const slot = (n: LNode) => Math.max(slotMin, n.value * ky);
      const total = c.reduce((a, n) => a + slot(n), 0) + gap * Math.max(0, c.length - 1);
      let y = padY + (H - 2 * padY - total) / 2;
      for (const n of c) { n.h = Math.max(3, n.value * ky); n.y = y + (slot(n) - n.h) / 2; y += slot(n) + gap; n.x = colX(n.col); }
    }
  };
  place();
  const centre = (n: LNode) => n.y + n.h / 2;
  for (let pass = 0; pass < 4; pass++) {
    for (let c = 1; c <= maxCol; c++) {
      const bc = (n: LNode) => {
        const ls = links.filter((l) => l.target === n);
        const tot = ls.reduce((a, l) => a + l.value, 0);
        return tot ? ls.reduce((a, l) => a + centre(l.source) * l.value, 0) / tot : centre(n);
      };
      const keys = new Map(cols[c].map((n) => [n, bc(n)]));
      cols[c].sort((a, b) => keys.get(a)! - keys.get(b)!);
      place();
    }
    for (let c = maxCol - 1; c >= 0; c--) {
      const bc = (n: LNode) => {
        const ls = links.filter((l) => l.source === n);
        const tot = ls.reduce((a, l) => a + l.value, 0);
        return tot ? ls.reduce((a, l) => a + centre(l.target) * l.value, 0) / tot : centre(n);
      };
      const keys = new Map(cols[c].map((n) => [n, bc(n)]));
      cols[c].sort((a, b) => keys.get(a)! - keys.get(b)!);
      place();
    }
  }
  for (const n of nodes) {
    const outs = links.filter((l) => l.source === n).sort((a, b) => centre(a.target) - centre(b.target));
    let o = 0;
    for (const l of outs) { l.w = Math.max(1, l.value * ky); l.y0 = n.y + o + l.w / 2; o += l.w; }
    const ins = links.filter((l) => l.target === n).sort((a, b) => centre(a.source) - centre(b.source));
    o = 0;
    for (const l of ins) { l.w = Math.max(1, l.value * ky); l.y1 = n.y + o + l.w / 2; o += l.w; }
  }
  skNodes = nodes;
  skLinks = links;
  skTotal = g.total;
  return { H };
}

function litLinks(): Set<LLink> | null {
  if (!highlight) return null;
  const start = skNodes.find((n) => n.id === `p:${highlight}`);
  if (!start) return null;
  const lit = new Set<LLink>();
  const seen = new Set<LNode>([start]);
  const queue = [start];
  while (queue.length) {
    const n = queue.pop()!;
    for (const l of skLinks) if (l.target === n) { lit.add(l); if (!seen.has(l.source)) { seen.add(l.source); queue.push(l.source); } }
  }
  return lit;
}

function renderSankey(): void {
  const svg = $<SVGSVGElement>('#sankey');
  const units = unitsSeen(s);
  if (!unit || !units.includes(unit)) unit = units[0] ?? '';
  $('#units').innerHTML = units
    .map((u) => `<button type="button" data-unit="${u}" aria-pressed="${u === unit}">${esc(u)}</button>`)
    .join('');
  if (!unit) {
    svg.setAttribute('viewBox', '0 0 1000 120');
    svg.innerHTML = '<text x="500" y="60" text-anchor="middle" class="msmall">No money has arrived yet — send some, or play a few days.</text>';
    skNodes = []; skLinks = [];
    return;
  }
  const g = flowGraph(s, unit);
  const W = 1000;
  const { H } = layoutSankey(g, W);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const lit = litLinks();
  let out = '';
  skLinks.forEach((l, i) => {
    const x0 = l.source.x + 14, x1 = l.target.x, mx = (x0 + x1) / 2;
    const faint = l.via === 'kept' || l.via === 'retained';
    const col = l.target.type === 'party' && l.via !== 'kept' ? l.target.color : l.target.type === 'holon' ? l.target.color : l.source.color;
    const dim = lit ? !lit.has(l) : false;
    out += `<path class="sk-link" data-link="${i}" d="M${x0},${l.y0} C${mx},${l.y0} ${mx},${l.y1} ${x1},${l.y1}" fill="none" stroke="${col}" stroke-width="${l.w}" ${faint ? 'stroke-dasharray="7 5"' : ''} opacity="${dim ? 0.07 : faint ? 0.38 : 0.5}"/>`;
  });
  skNodes.forEach((n, i) => {
    const isLast = n.type === 'party';
    const tx = n.type === 'source' ? n.x + 22 : n.x + 22;
    const lab = n.type === 'source' ? n.label.split(' → ') : [n.label];
    const ty = n.y + n.h / 2 - ((lab.length) * 14) / 2 + 12;
    out += `<g class="sk-node" data-node="${i}"><rect x="${n.x}" y="${n.y}" width="14" height="${n.h}" rx="3" fill="${n.color}"/>
      <text class="sk-label" x="${tx}" y="${ty}">${lab.map((t, j) => `<tspan x="${tx}" dy="${j ? 14 : 0}">${esc(t)}</tspan>`).join('')}<tspan class="m" x="${tx}" dy="14">${esc(fmt(n.value, unit))}</tspan></text></g>`;
    void isLast;
  });
  svg.innerHTML = out;
}

const tip = $('#tip');
function showTip(e: MouseEvent, html: string): void {
  tip.innerHTML = html;
  tip.style.display = 'block';
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, e.clientX + 14)}px`;
  tip.style.top = `${e.clientY + 14}px`;
}
function initSankeyEvents(): void {
  const svg = $<SVGSVGElement>('#sankey');
  svg.addEventListener('mousemove', (e) => {
    const t = e.target as Element;
    const li = t.closest('[data-link]');
    const ni = t.closest('[data-node]');
    if (li) {
      const l = skLinks[+li.getAttribute('data-link')!];
      showTip(e, `<b>${esc(l.source.label)} → ${esc(l.target.label)}</b><br>${esc(fmt(l.value, unit))} · ${pct((l.value / (skTotal || 1)) * 100)} of everything sent in ${esc(unit)}<br>${esc(VIA_WORDS(l))}`);
    } else if (ni) {
      const n = skNodes[+ni.getAttribute('data-node')!];
      const role = n.type === 'source' ? 'where money arrives' : n.type === 'party' ? 'where value rests' : 'divides what it receives';
      showTip(e, `<b>${esc(n.label)}</b><br>${esc(fmt(n.value, unit))} · ${pct((n.value / (skTotal || 1)) * 100)} of the total<br>${role}`);
    } else tip.style.display = 'none';
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  $('#units').addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button[data-unit]') as HTMLElement | null;
    if (!b) return;
    unit = b.dataset.unit!;
    renderSankey();
    renderClaims();
    ($('#units').querySelector(`[data-unit="${unit}"]`) as HTMLElement | null)?.focus();
  });
}

// ── Claims table ─────────────────────────────────────────────────────────

function renderClaims(): void {
  const units = unitsSeen(s);
  const rows = balances(s);
  const wrap = $('#claims');
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
  if (!rows.length) {
    wrap.innerHTML = '<p class="muted">Nothing is claimable yet — money has not arrived.</p>';
    $('#checks').innerHTML = '';
    return;
  }
  const isPot = (u: string) => u === POT_UNIT;
  let h1 = '<tr><th class="l" rowspan="2">Who</th>';
  let h2 = '<tr>';
  for (const u of units) {
    h1 += `<th class="g" colspan="3">${esc(u)}${isPot(u) ? ' · Pot' : ''}</th>`;
    h2 += isPot(u) ? '<th>pending until new moon</th><th>collectable</th><th>collected</th>' : '<th>right</th><th>claimed</th><th>available</th>';
  }
  const head = `<thead>${h1}</tr>${h2}</tr></thead>`;
  const totals: Record<string, [number, number, number]> = {};
  let body = '<tbody>';
  let sawHolon = false;
  for (const r of rows) {
    const sep = r.kind === 'holon' && !sawHolon;
    if (sep) sawHolon = true;
    body += `<tr class="${highlight === r.id ? 'hi' : ''}${sep ? ' sep' : ''}"><td class="l"><button type="button" class="who-btn" data-key="who:${r.id}" data-who="${r.id}" aria-pressed="${highlight === r.id}" title="Highlight the paths that feed ${esc(r.name)}">${esc(r.name)}</button>${r.kind === 'holon' ? ' <span class="muted small">holon</span>' : ''}</td>`;
    for (const u of units) {
      const v = r.units[u];
      const t = (totals[u] ??= [0, 0, 0]);
      if (!v) { body += '<td class="muted">–</td><td class="muted">–</td><td class="muted">–</td>'; continue; }
      if (isPot(u)) {
        t[0] += v.pending; t[1] += v.collectable; t[2] += v.collected;
        body += `<td>${num(v.pending, u)}</td><td class="avail">${num(v.collectable, u)} ${v.collectable > 0 ? `<button class="btn small" type="button" data-key="collect:${r.id}:${u}" data-collect="${r.id}|${u}">Collect</button>` : ''}</td><td>${num(v.collected, u)}</td>`;
      } else {
        t[0] += v.right; t[1] += v.claimed; t[2] += v.available;
        body += `<td>${num(v.right, u)}</td><td>${num(v.claimed, u)}</td><td class="avail">${num(v.available, u)} ${v.available > 0 ? `<button class="btn small" type="button" data-key="claim:${r.id}:${u}" data-claim="${r.id}|${u}">Claim</button>` : ''}</td>`;
      }
    }
    body += '</tr>';
  }
  body += '</tbody>';
  let foot = '<tfoot><tr><td class="l">Total</td>';
  for (const u of units) foot += (totals[u] ?? [0, 0, 0]).map((v) => `<td>${num(v, u)}</td>`).join('');
  foot += '</tr></tfoot>';
  wrap.innerHTML = `<table>${head}${body}${foot}</table>`;

  let checks = '';
  for (const u of units) {
    const dep = flowGraph(s, u).total;
    const t = totals[u] ?? [0, 0, 0];
    const rights = isPot(u) ? t[0] + t[1] + t[2] : t[0];
    const ok = Math.abs(rights - dep) < 0.05 + dep * 1e-6;
    checks += `<span class="${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'MISMATCH'} — ${esc(u)}: Σ rights ${esc(fmt(rights, u))} ${ok ? '=' : '≠'} deposited ${esc(fmt(dep, u))}</span>`;
  }
  $('#checks').innerHTML = checks;
  if (focusKey) (wrap.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus();
}

function initClaimEvents(): void {
  $('#claims').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const c = t.closest('[data-claim]') as HTMLElement | null;
    const k = t.closest('[data-collect]') as HTMLElement | null;
    const w = t.closest('[data-who]') as HTMLElement | null;
    if (c) {
      const [party, u] = c.dataset.claim!.split('|');
      act(() => { claim(s, party, u); });
      renderAll();
    } else if (k) {
      const [party, u] = k.dataset.collect!.split('|');
      act(() => { collect(s, party, u); });
      renderAll();
    } else if (w) {
      highlight = highlight === w.dataset.who ? null : w.dataset.who!;
      const person = highlight && rowsHaveUnit(highlight);
      if (highlight && person && !flowGraph(s, unit).nodes.some((n) => n.id === `p:${highlight}`)) unit = person;
      renderSankey();
      renderClaims();
    }
  });
}
/** A unit in which this party has anything, so highlighting always has something to show. */
function rowsHaveUnit(id: string): string | null {
  const r = balances(s).find((b) => b.id === id);
  return r ? Object.keys(r.units)[0] ?? null : null;
}

// ── Acting + stepping ────────────────────────────────────────────────────

/** Run a state change, then feed + animate whatever events it emitted. */
function act(fn: () => void, animateIt = true): SimEvent[] {
  const from = s.events.length;
  fn();
  const evs = s.events.slice(from);
  ingest(evs, animateIt);
  return evs;
}
function ingest(evs: SimEvent[], animateIt: boolean): void {
  for (const e of evs) feed.unshift(e);
  if (animateIt) evs.slice(0, 14).forEach((e, i) => setTimeout(() => animate(e), i * 160));
}

function renderAll(): void {
  renderClock();
  renderFeed();
  renderPanel();
  renderSankey();
  renderClaims();
}

function tick(): void {
  act(() => { step(s); });
  renderAll();
}
function setPlaying(on: boolean): void {
  playing = on;
  window.clearTimeout(timer);
  const b = $<HTMLButtonElement>('#play');
  b.textContent = on ? 'Pause' : 'Play';
  b.setAttribute('aria-pressed', String(on));
  if (on) loop();
}
function loop(): void {
  const speed = parseFloat($<HTMLSelectElement>('#speed').value) || 1;
  timer = window.setTimeout(() => { tick(); if (playing) loop(); }, 700 / speed);
}

function init(): void {
  buildMap();
  initSend();
  initSankeyEvents();
  initClaimEvents();
  $('#play').addEventListener('click', () => setPlaying(!playing));
  $('#next').addEventListener('click', () => { setPlaying(false); tick(); });
  $('#moonrun').addEventListener('click', () => {
    setPlaying(false);
    const all: SimEvent[] = [];
    let guard = 0;
    do { all.push(...act(() => { step(s); }, false)); } while (s.day % LUNATION_DAYS !== 0 && ++guard < LUNATION_DAYS + 1);
    renderAll();
    all.filter((e) => e.kind === 'commit' || e.kind === 'deposit').slice(-4).forEach((e, i) => setTimeout(() => animate(e), i * 300));
  });
  $('#speed').addEventListener('change', () => { if (playing) { window.clearTimeout(timer); loop(); } });
  $('#reset').addEventListener('click', () => {
    setPlaying(false);
    s = fresh();
    feed = [...s.events].reverse();
    highlight = null;
    unit = '';
    selected = 'meridian';
    fx.innerHTML = '';
    markSelected();
    $('#s-msg').textContent = '';
    renderAll();
  });
  renderAll();
}

void commitRightsRoot; // exported by the engine; the new-moon commit happens inside step()
init();
