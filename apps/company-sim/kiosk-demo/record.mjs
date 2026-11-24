// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Records the narrated kiosk walkthrough (see README.md). Needs playwright-core
// (not a repo dependency) and a cached Chromium; OUT=<dir> node record.mjs
// Record the Meridian Works kiosk demo. Loading time is cut out afterwards:
// every stretch worth watching is marked [start,end] on the video's clock.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
const DEMO = new URL('.', import.meta.url).pathname; // this folder: seeded.json + dist/attest.cjs
const attest = (circle, lead) => new Promise((res) => execFile('node', ['dist/attest.cjs', circle, lead], { cwd: DEMO }, (e, out) => res(out || String(e))));

const SEED = JSON.parse(readFileSync(`${DEMO}seeded.json`, 'utf8'));
const OUT = process.env.OUT;
mkdirSync(`${OUT}/raw`, { recursive: true });
const BASE = 'http://localhost:5291';
const H = SEED.holons;
const exe = process.env.CHROMIUM || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium`;
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  for (const [k, v] of Object.entries({ kiosk_flows: '1', kiosk_status: '1', kiosk_federated: '1', kiosk_add_tip: '1', kiosk_theme: 'dark' })) localStorage.setItem(k, v);
});
let page = await ctx.newPage();
const t0 = Date.now();
const clock = () => (Date.now() - t0) / 1000;
const segments = [];
let open = null;
// Frames come from Chromium's screencast; only frames while a scene is SHOWN
// are kept, on a clock that skips the hidden (loading) stretches.
const frames = [];
let shownBefore = 0; // seconds shown in earlier segments
let n = 0;
// Screenshots on a loop while a scene is shown — exactly what the page paints.
let capturing = true;
const loop = (async () => {
  while (capturing) {
    if (open == null) { await new Promise((r) => setTimeout(r, 60)); continue; }
    const at = shownBefore + (clock() - open);
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 85, animations: 'allow', caret: 'initial', timeout: 5000 });
      const file = `${OUT}/raw/f${String(n++).padStart(6, '0')}.jpg`;
      writeFileSync(file, buf);
      frames.push({ file, t: at });
    } catch { await new Promise((r) => setTimeout(r, 60)); }
  }
})();
const show = () => { if (open == null) open = clock(); };
const hide = () => { if (open != null) { segments.push([open, clock()]); shownBefore += clock() - open; open = null; } };
const wait = (ms) => page.waitForTimeout(ms);
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// ── Overlay: caption + cursor ─────────────────────────────────────────────
async function overlay() {
  await page.evaluate(() => {
    if (document.getElementById('demo-cap')) return;
    const st = document.createElement('style');
    st.textContent = `#demo-cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1100px;z-index:2147483647;
      background:rgba(12,16,22,.92);color:#f3f5f8;border:1px solid rgba(120,220,200,.45);border-radius:14px;padding:14px 22px;
      font:500 21px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.45);pointer-events:none;transition:opacity .35s}
      #demo-cap b{color:#7fe0c8;font-weight:650}
      #demo-cap .k{display:block;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#9fb3c8;margin-bottom:4px}
      #demo-cur{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;z-index:2147483647;pointer-events:none;
      background:rgba(255,214,90,.35);border:2px solid #ffd65a;box-shadow:0 0 0 6px rgba(255,214,90,.15);transition:left .55s cubic-bezier(.3,.7,.2,1),top .55s cubic-bezier(.3,.7,.2,1),transform .15s}
      #demo-cur.down{transform:scale(.7)}`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = 'demo-cap'; c.style.opacity = '0'; document.body.appendChild(c);
    const k = document.createElement('div'); k.id = 'demo-cur'; k.style.left = '720px'; k.style.top = '450px'; document.body.appendChild(k);
  });
}
let curPos = { x: 720, y: 450 };
async function caption(kicker, html) {
  await overlay();
  await page.evaluate(([k, h, pos]) => {
    const c = document.getElementById('demo-cap');
    c.innerHTML = (k ? `<span class="k">${k}</span>` : '') + h;
    c.style.opacity = h ? '1' : '0';
    const cur = document.getElementById('demo-cur'); cur.style.left = pos.x + 'px'; cur.style.top = pos.y + 'px';
  }, [kicker, html, curPos]);
}
async function moveTo(loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const b = await loc.boundingBox();
  if (!b) return null;
  curPos = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await page.evaluate((p) => { const c = document.getElementById('demo-cur'); if (c) { c.style.left = p.x + 'px'; c.style.top = p.y + 'px'; } }, curPos);
  await page.mouse.move(curPos.x, curPos.y, { steps: 8 });
  await wait(650);
  return b;
}
async function click(loc, after = 900) {
  await loc.waitFor({ state: 'visible', timeout: 30000 });
  await overlay();
  await moveTo(loc);
  await page.evaluate(() => document.getElementById('demo-cur')?.classList.add('down'));
  await loc.click();
  await page.evaluate(() => document.getElementById('demo-cur')?.classList.remove('down'));
  await wait(after);
}
const btn = (text) => page.locator('button:visible', { hasText: text }).first();
async function typeInto(loc, text, delay = 28) {
  await click(loc, 200);
  await loc.pressSequentially(text, { delay });
}

/** Load a holon's tab off-camera; returns once the board is drawn. */
async function load(holon, tab, ready) {
  hide();
  await page.goto(`${BASE}/${holon}/${tab}?app=MeridianSim`);
  if (ready) await page.getByText(ready, { exact: false }).first().waitFor({ timeout: 45000 }).catch(() => {});
  await wait(2500);
  await overlay();
}
async function signIn(person) {
  for (let i = 0; i < 6; i++) {
    await click(page.getByText('Log in', { exact: true }).first(), 900).catch(() => {});
    if (await page.locator('button:visible', { hasText: 'Open full dashboard' }).count()) break;
  }
  await click(page.locator('button:visible').filter({ hasText: /^\s*Sign in\s*$/ }).last());
  await click(btn('Sign in with your key'));
  const key = page.locator('input:visible').last();
  await click(key, 200);
  await key.fill(SEED.people[person].sk);
  await wait(500);
  await click(btn('Continue'), 2500);
}
async function signOut() {
  await click(page.locator('button:visible').filter({ hasText: SEED.people.lena.name }).first(), 700);
  await click(btn('Log out'), 1500);
}

// ── Scenes ─────────────────────────────────────────────────────────────────
try {
  // 1. Engineering's wall: holograms from Marketing.
  await load(H.eng, 'tasks', 'Request:');
  show();
  await caption('Meridian Works · a company of holons', 'Six circles, each its own holon: <b>Meridian Works</b> (the general circle), <b>Engineering</b> with its <b>Platform</b> sub-circle, <b>Content</b>, <b>Marketing</b> and <b>Operations</b>. Twelve people, each signing with their own key.');
  await wait(6000);
  await caption('Holograms travel across the federation', 'This is <b>Engineering</b>\'s wall. The glassy cards tagged <b>⇄ Marketing</b> are <b>holograms</b>: feature requests Priya filed in Marketing, showing live here. They are pointers to the original, not copies.');
  await moveTo(page.getByText('Request:', { exact: false }).first());
  await wait(6500);
  await caption('Work crosses circles', 'Engineering ships a feature, then asks Content for a <b>launch post</b>, another hologram travelling the other way. Completing a card writes once, at its source, and every circle sees it.');
  await moveTo(page.getByText('Launch post:', { exact: false }).first());
  await wait(6000);
  hide();

  // 2. Content's status: valued by articles × views.
  await load(H.content, 'status', 'Lena');
  show();
  await caption('Each circle has its own value equation', '<b>Content</b> values <b>articles × views</b> (0.01 per view) and <b>5 per edit</b>. So Lena, whose articles were read most, ranks first; Omar, the other writer, second; and Sasha, the editor, earns through edits.');
  await wait(8000);
  hide();

  // 3. The company's fund: EUR from Open Collective cascades down.
  await load(H.meridian, 'flows', 'Fund allocation rights');
  show();
  await caption('Money in: €18,000 via Open Collective', 'It lands on <b>Meridian Works</b>. <b>20%</b> goes to the general circle\'s own people by its equation; <b>80%</b> goes to the circles placed on its rings: Engineering and Content on ring 1, Marketing on ring 2, Operations on ring 3.');
  await wait(8500);
  await caption('…and keeps flowing down', 'Each circle splits its part again by <b>its own</b> equation. Engineering passes a share to <b>Platform</b>. Lena\'s personal split gives 10% of what reaches her to <b>Omar</b>. Every euro ends with a person.');
  await moveTo(page.getByText('Lena', { exact: true }).first());
  await wait(7500);
  await click(btn('USDC'), 1500);
  await caption('Every unit on its own track', '<b>8,000 USDC</b> came in through the company\'s <b>Pot</b>, the on-chain rail. It divides by the same split and becomes collectable when the rights root is committed at the new moon. Units never mix: no exchange rates.');
  await wait(7500);
  hide();

  // 4. Engineering's ETH grant.
  await load(H.eng, 'flows', 'Fund allocation rights');
  show();
  await caption('A 1.5 ETH grant sent to Engineering\'s address', 'Engineering values <b>feature requests satisfied</b> (10 each). Mira shipped the most, and <b>25%</b> passes to the <b>Platform</b> sub-circle, where Theo\'s infrastructure work counts.');
  const ethPill = btn('ETH');
  if (await ethPill.count()) await click(ethPill, 1200);
  await wait(8000);
  hide();

  // 5. Lena signs in on Content and claims sats.
  await load(H.content, 'flows', 'Fund allocation rights');
  show();
  await caption('Claiming: Lena signs in with her own key', 'Readers zapped <b>420,000 sats</b> to Content\'s Nostr address. Lena opens the Content board and signs in.');
  await wait(3500);
  await signIn('lena');
  await click(btn('My balance'), 2500);
  await caption('Lena\'s balance in Content', '<b>SAT</b> was issued here. <b>EUR</b> and <b>USDC</b> are marked <b>From Meridian Works</b>: they came down from the company. Her right is net of the 10% she passes on to Omar.');
  await wait(8000);
  const amount = page.locator('input[type=number]:visible').first();
  await typeInto(amount, '50000');
  await typeInto(page.locator('input[type=text]:visible').last(), 'November article series');
  await caption('She records a claim', 'A claim is a signed entry in Content\'s append-only claims log. The board checks it against her right before it counts.');
  await click(btn('Record a claim'), 3500);
  await caption('Approved', 'It counts at once: Lena is seated in Content and the claim is within her right. Her available sats drop by 50,000.');
  await moveTo(page.getByText('Approved', { exact: false }).first());
  await wait(6500);

  // 6. Her own holon: what reaches her from every hub.
  await click(page.locator('button:visible').filter({ hasText: 'Lena' }).first(), 900);
  await click(btn('Open my holon'), 3000);
  await page.getByText('Flows', { exact: true }).first().click().catch(() => {});
  await wait(2500);
  await click(btn('My balance'), 2500);
  await caption('Lena\'s own holon gathers every hub', '<b>Reaching you</b> lists every right that reaches her, hub by hub. <b>Claim there</b> takes her straight to that hub\'s board, on that unit.');
  await moveTo(page.getByText('Reaching you', { exact: false }).first());
  await wait(7000);
  const eurThere = page.locator('li.claim-row', { hasText: '€' }).locator('button.claim-there').first();
  await click(eurThere, 4000);
  await page.getByText('Your balance · EUR', { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => console.error('EUR card never showed'));
  await caption('Claim there → Content, in EUR', 'Back on Content, already on her <b>EUR</b> balance, which arrived from Meridian Works via Open Collective.');
  await wait(4000);
  await typeInto(page.locator('input[type=number]:visible').first(), '1200');
  await typeInto(page.locator('input[type=text]:visible').last(), 'Launch posts for three features');
  await click(btn('Record a claim'), 3500);
  await caption('Claimed from across holons', 'Money that entered at the company, passed through Content and was split by views is now Lena\'s approved claim of <b>€1,200</b>. Every step is a signed record anyone in the federation can check.');
  await wait(7500);
  hide();

  // 7. Kai, on his own device: a member's claim needs the lead link's word.
  hide();
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx2.addInitScript(() => {
    for (const [k, v] of Object.entries({ kiosk_flows: '1', kiosk_status: '1', kiosk_federated: '1', kiosk_add_tip: '1', kiosk_theme: 'dark' })) localStorage.setItem(k, v);
  });
  page = await ctx2.newPage();
  await load(H.eng, 'flows', 'Fund allocation rights');
  show();
  await caption('Kai, on his own phone', 'Kai is a developer in <b>Engineering</b> and also sits in its <b>Platform</b> sub-circle. He opens Engineering\'s board and signs in.');
  await wait(3500);
  await signIn('kai');
  await click(btn('My balance'), 2500);
  await caption('Kai\'s balance in Engineering', '<b>ETH</b> was issued here: the grant sent to Engineering\'s address. <b>EUR</b> and <b>USDC</b> came down from Meridian Works.');
  await wait(6500);
  await typeInto(page.locator('input[type=number]:visible').first(), '0.2');
  await typeInto(page.locator('input[type=text]:visible').last(), 'Webhooks + bulk edit');
  await click(btn('Record a claim'), 3000);
  await caption('Awaiting attestation', 'Kai is a member, not an admin, so Engineering\'s rule asks for <b>one admin\'s word</b> before his claim counts. It is recorded, signed by his key, and waiting.');
  await moveTo(page.getByText('Awaiting attestation', { exact: false }).first());
  await wait(5500);
  await caption('Mira attests from her own device', '<b>Mira</b>, Engineering\'s lead link, checks it against the sprint board and attests. That is a second signed entry in the same log.');
  await attest('eng', 'mira');
  await page.getByText('Approved', { exact: false }).first().waitFor({ timeout: 25000 }).catch(() => {});
  await wait(1500);
  await caption('Approved', 'Kai\'s board updates by itself: <b>0.2 ETH</b>, approved.');
  await moveTo(page.getByText('Approved', { exact: false }).first());
  await wait(5500);
  await click(page.locator('button:visible').filter({ hasText: 'Kai' }).first(), 900);
  await click(btn('Open my holon'), 3000);
  await page.getByText('Flows', { exact: true }).first().click().catch(() => {});
  await wait(2500);
  await click(btn('My balance'), 2500);
  await caption('Two hubs, one place', 'Kai\'s own holon shows what reaches him from <b>Engineering</b> and from <b>Platform</b>, the sub-circle he also works in. Each right is claimed in the hub where it lives.');
  await moveTo(page.getByText('From Platform', { exact: false }).first());
  await wait(8000);
  await caption('Meridian Works', 'Money sent to any holon, through Open Collective, its Pot, an Ethereum address or a Nostr zap, is divided by each circle\'s own equation, down to the people who did the work. They claim it wherever it reached them. <b>Everything you saw is the real Holons kiosk.</b>');
  await wait(9000);
  hide();
  await ctx2.close();
} catch (e) {
  console.error('SCENE FAILED:', e.message);
  await page.screenshot({ path: `${OUT}/fail.png` });
  hide();
}
capturing = false;
await loop;
// ffmpeg concat list: each frame held until the next one arrived.
const lines = [];
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].t - frames[i].t) : 1.5;
  lines.push(`file '${frames[i].file}'`, `duration ${d.toFixed(3)}`);
}
if (frames.length) lines.push(`file '${frames[frames.length - 1].file}'`);
writeFileSync(`${OUT}/frames.txt`, lines.join('\n'));
const videoPath = `${OUT}/frames.txt`;
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/segments.json`, JSON.stringify({ video: videoPath, segments, errors: errs.slice(0, 10) }, null, 2));
console.log(JSON.stringify({ video: videoPath, segments, errors: errs.slice(0, 5) }));
