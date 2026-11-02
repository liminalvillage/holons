// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The people of the dock: who is in the hubs on it, and who is in more than
// one. Federation is the tie two hubs chose; a shared person is a tie they
// have whether they chose it or not, and the dock's People view draws that
// one: each hub a territory its members stand in, the people in several
// hubs where those overlap. No lines: where someone stands says it. The rule for who counts, and for when two ids are one person, is
// core's (`@holons/core/holons` peopleAcross) — this module only keeps the
// answer for the dock, and works out where everyone stands.
//
// Nothing is read until the view is opened: a roster per docked hub is a
// read per hub, and a dock nobody asked about people in should not pay it.

import { writable } from "svelte/store";
import {
  loadPeopleAcross,
  type PeopleAcross,
  type PersonAcross,
} from "@holons/core/holons";
import { matchesDock, matchesText, type Vec } from "./dock";
import { readCache, writeCache } from "./dockcache";
import { getHolosphere } from "./holosphere";
import { primeNames } from "./names";

const NOBODY: PeopleAcross = { people: [], connectors: [], bridges: [] };

/** The last fold this device saw (lib/dockcache), so a reload paints at once. */
function keptPeople(): PeopleAcross {
  const kept = readCache<PeopleAcross>("people", NOBODY);
  if (!Array.isArray(kept?.people)) return NOBODY;
  primeNamesOf(kept);
  return {
    people: kept.people,
    connectors: Array.isArray(kept.connectors) ? kept.connectors : [],
    bridges: Array.isArray(kept.bridges) ? kept.bridges : [],
  };
}
function primeNamesOf(found: PeopleAcross): void {
  // The rosters named these people; the resolver need not ask again.
  primeNames(found.people.flatMap((p) => p.ids.map((id) => [id, p.name])));
}

/**
 * The people across the docked hubs: what was last seen on this device at
 * once, then each fresh read from `loadDockPeople`.
 */
export const dockPeople = writable<PeopleAcross>(
  typeof window === "undefined" ? NOBODY : keptPeople(),
);
/** A read is out — the list says so instead of "nobody". */
export const dockPeopleLoading = writable(false);

const FRESH_MS = 60_000;
let loadedKey = "";
let loadedAt = 0;
let asking = "";

/**
 * Read the rosters of `ids` and publish who is in them. One read per cast:
 * the same hubs asked again within a minute answer from what is held, and a
 * slower earlier read never overwrites a later one.
 */
export async function loadDockPeople(
  ids: readonly string[],
  force = false,
): Promise<void> {
  const key = [...ids].sort().join("\n");
  if (!key) {
    loadedKey = asking = "";
    dockPeople.set(NOBODY);
    return;
  }
  if (asking === key) return;
  if (!force && key === loadedKey && Date.now() - loadedAt < FRESH_MS) return;
  asking = key;
  dockPeopleLoading.set(true);
  try {
    const hs = await getHolosphere();
    const found = await loadPeopleAcross(hs, ids, {
      format: { lastName: "initial" },
      // Every roster at once: each waits on a relay catch-up, and the
      // transport keeps its own query budget — a lane of four here only
      // queued them behind one another.
      concurrency: ids.length,
    });
    if (asking !== key) return;
    primeNamesOf(found);
    loadedKey = key;
    loadedAt = Date.now();
    dockPeople.set(found);
    writeCache("people", found);
  } catch {
    /* offline — whoever was known stays on screen */
  } finally {
    if (asking === key) {
      asking = "";
      dockPeopleLoading.set(false);
    }
  }
}

/** Test hook: forget what was read. */
export function resetDockPeople(): void {
  loadedKey = asking = "";
  loadedAt = 0;
  dockPeople.set(NOBODY);
  dockPeopleLoading.set(false);
}

// ── The picture ──────────────────────────────────────────────────────────--

/** A running people graph — positions and momentum. */
export type PeopleSim = {
  ids: string[];
  px: Float64Array;
  py: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
};

/**
 * Who stands with whom, as the physics reads it: each hub's members by
 * their place in the sim, and for every two people how many hubs they share.
 */
export type PeopleField = {
  /** The hubs, in the order they were first met. */
  hubIds: string[];
  /** Per hub, the places of its members. */
  hubs: number[][];
  /** `kin[i * n + j]`: the hubs `i` and `j` share. */
  kin: Uint8Array;
  /**
   * `share[h * hubs + k]`: how much of the smaller of hubs `h` and `k` is
   * also in the other — 0 when they share nobody, 1 when one is wholly
   * inside the other.
   */
  share: Float32Array;
  /** Per person, how many hubs they are in. */
  count: Uint8Array;
};

/** Read the field off the people of a sim. */
export function peopleField(
  sim: Pick<PeopleSim, "ids">,
  people: readonly Pick<PersonAcross, "id" | "holons">[],
): PeopleField {
  const n = sim.ids.length;
  const idx = new Map(sim.ids.map((id, i) => [id, i]));
  const byHub = new Map<string, number[]>();
  const count = new Uint8Array(n);
  for (const p of people) {
    const i = idx.get(p.id);
    if (i == null) continue;
    for (const h of new Set(p.holons)) {
      const list = byHub.get(h);
      if (list) list.push(i);
      else byHub.set(h, [i]);
      count[i] = Math.min(255, count[i] + 1);
    }
  }
  const kin = new Uint8Array(n * n);
  for (const members of byHub.values())
    for (const i of members)
      for (const j of members)
        if (i !== j) kin[i * n + j] = Math.min(255, kin[i * n + j] + 1);
  const hubs = [...byHub.values()];
  const share = new Float32Array(hubs.length * hubs.length);
  for (let h = 0; h < hubs.length; h++) {
    const mine = new Set(hubs[h]);
    for (let k = h + 1; k < hubs.length; k++) {
      const both = hubs[k].filter((i) => mine.has(i)).length;
      share[h * hubs.length + k] = share[k * hubs.length + h] =
        both / Math.min(hubs[h].length, hubs[k].length);
    }
  }
  return { hubIds: [...byHub.keys()], hubs, kin, count, share };
}

const GOLDEN_ANGLE = 2.399963229728653; // spreads any count evenly

/**
 * (Re)seat the sim for `ids`, around the origin. Whoever was already there
 * keeps their place and momentum — a tie filter changing, a roster arriving,
 * must not throw the picture in the air — and newcomers come in on a
 * golden-angle spiral, the same every time.
 */
export function syncPeopleSim(
  prev: PeopleSim | null,
  ids: readonly string[],
  r: number,
): PeopleSim {
  const n = ids.length;
  const sim: PeopleSim = {
    ids: [...ids],
    px: new Float64Array(n),
    py: new Float64Array(n),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
  };
  const was = new Map(prev?.ids.map((id, i) => [id, i]));
  for (let i = 0; i < n; i++) {
    const k = was.get(ids[i]);
    if (prev && k != null) {
      sim.px[i] = prev.px[k];
      sim.py[i] = prev.py[k];
      sim.vx[i] = prev.vx[k];
      sim.vy[i] = prev.vy[k];
      continue;
    }
    const rad = 3 * r * Math.sqrt(i + 0.5);
    sim.px[i] = Math.cos(i * GOLDEN_ANGLE) * rad;
    sim.py[i] = Math.sin(i * GOLDEN_ANGLE) * rad;
  }
  return sim;
}

// How the field moves. It should read as calm: things drift to where they
// belong and stay, nothing snaps or shivers. So a frame's forces are eased
// in — only a fifth reaches the momentum — and the momentum itself is kept
// long (a tenth lost a frame), which turns every push into a slow glide and
// smooths over the forces that switch on and off at a boundary (two orbs
// touching, a stranger crossing a hub's ground). Speed is capped low for the
// same reason. There is no wander: a field at rest is still, so the view
// can stop drawing it altogether.
const GAIN = 0.2;
const DAMPING = 0.9;
const MAX_GLIDE = 0.16; // radii a frame
/** How hard a connector tows each of their cells toward them. */
const TIE = 0.01;

/** What a frame may be told beyond the people. */
export type StepOptions = {
  /** The person under a finger: moved by the hand, not the forces. */
  held?: number;
  /** The hubs as territories (see `peopleField`). */
  field?: PeopleField;
  /** The person in focus: everyone they share a hub with gathers round. */
  focus?: number;
  /**
   * How much of this frame's forces reach the momentum, 0–1 (default 1).
   * The live view cools it after every nudge (see `COOL`), which is what
   * guarantees the field comes to rest: a field of hubs that push and
   * people that tie need not have a still point of its own, and without
   * cooling crept round for ever.
   */
  heat?: number;
};

/** Per frame, how much heat the field keeps: ~0.01 left after 650 frames. */
export const COOL = 0.993;
/** Below this the field is cold: once nobody moves, the loop may stop. */
export const COLD = 0.01;

/**
 * One frame of the people field. What shapes it, in order:
 *
 *  - every two people repel, and push hard once they would touch — harder
 *    still when they share no hub, which is what parts the territories;
 *  - each hub draws its members toward their common middle, so a hub is a
 *    patch of ground and someone in two hubs comes to rest between the two
 *    patches, where their territories overlap;
 *  - a hub pushes out whoever stands on its ground without belonging to it,
 *    so a territory holds its own people and nobody else;
 *  - every two cells (hubs) repel until they no more than touch — or
 *    overlap as far as they share people;
 *  - and the people in more than one hub tie their cells together: each
 *    cell, whole, is towed toward its connectors. So cells sit as close as
 *    the people they share hold them — the more shared, the closer — with
 *    the connectors standing on the seam between them. The picture finds
 *    its best layout between the push of the cells and the pull of the
 *    people;
 *  - with someone in focus, everyone who shares a hub with them is drawn to
 *    a distance set by how many — the most shared nearest;
 *  - a light pull home keeps the unattached from drifting off.
 *
 * Returns the fastest anyone moved, so a caller can tell a field at rest.
 */
export function stepPeopleSim(
  sim: PeopleSim,
  r: number,
  opts: StepOptions = {},
): number {
  const { px, py, vx, vy } = sim;
  const { field, focus = -1, held = -1, heat = 1 } = opts;
  const gain = GAIN * heat;
  const n = sim.ids.length;
  // Kept tight: the picture is shrunk to fit its pane, so every radius of
  // air between people is a radius their orbs are drawn smaller by.
  const repel = 5 * r * r;
  const core = r * r; // closer than this the push stops growing
  const touch = 2 * r + 6;
  const maxSpeed = r * MAX_GLIDE;
  // The forces of this frame, gathered apart from the momentum so they can
  // be eased in (see GAIN).
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    fx[i] -= px[i] * 0.008;
    fy[i] -= py[i] * 0.008;
    for (let j = i + 1; j < n; j++) {
      let dx = px[j] - px[i];
      let dy = py[j] - py[i];
      let d2 = dx * dx + dy * dy;
      if (d2 < 1e-6) {
        // Two on one point part along a direction of their own.
        dx = Math.cos(i + j);
        dy = Math.sin(i + j);
        d2 = 1;
      }
      const d = Math.sqrt(d2);
      const strangers = field ? field.kin[i * n + j] === 0 : false;
      let f = ((strangers ? 2 : 1) * repel) / Math.max(d2, core);
      if (d < touch) f += (touch - d) * 0.25;
      f /= d;
      fx[i] -= dx * f;
      fy[i] -= dy * f;
      fx[j] += dx * f;
      fy[j] += dy * f;
    }
  }
  if (field) {
    const H = field.hubs.length;
    const cx = new Float64Array(H);
    const cy = new Float64Array(H);
    const reach = new Float64Array(H);
    const member = new Uint8Array(n);
    for (let h = 0; h < H; h++) {
      const members = field.hubs[h];
      for (const i of members) {
        cx[h] += px[i];
        cy[h] += py[i];
      }
      cx[h] /= members.length;
      cy[h] /= members.length;
      member.fill(0);
      for (const i of members) {
        member[i] = 1;
        // Shared out among a person's hubs, so three hubs do not pull three
        // times as hard as one.
        const pull = 0.03 / Math.max(1, field.count[i]);
        fx[i] += (cx[h] - px[i]) * pull;
        fy[i] += (cy[h] - py[i]) * pull;
        reach[h] = Math.max(reach[h], Math.hypot(px[i] - cx[h], py[i] - cy[h]));
      }
      // No wider than its members need, packed: one member drawn far off by
      // another hub must not widen the whole ground — it would push everyone
      // else out, stretch their hubs in turn, and the field would fly apart.
      reach[h] = Math.min(reach[h], 1.5 * r * Math.sqrt(members.length));
      if (members.length < 2) continue;
      const ground = reach[h] + 1.6 * r;
      for (let j = 0; j < n; j++) {
        if (member[j]) continue;
        const dx = px[j] - cx[h];
        const dy = py[j] - cy[h];
        const d = Math.hypot(dx, dy) || 1;
        if (d >= ground) continue;
        const push = (ground - d) * 0.06;
        fx[j] += (dx / d) * push;
        fy[j] += (dy / d) * push;
      }
    }
    // The ties: a cell is towed, whole, toward each of its connectors — a
    // connector's pull shared out among their cells, so someone in a dozen
    // hubs does not drag a dozen cells onto one point.
    for (let h = 0; h < H; h++) {
      const members = field.hubs[h];
      if (members.length < 2) continue;
      let tx = 0;
      let ty = 0;
      for (const i of members) {
        if (field.count[i] < 2) continue;
        tx += ((px[i] - cx[h]) * TIE) / field.count[i];
        ty += ((py[i] - cy[h]) * TIE) / field.count[i];
      }
      if (!tx && !ty) continue;
      for (const j of members) {
        fx[j] += tx / members.length;
        fy[j] += ty / members.length;
      }
    }
    // The cells' push, on each cell's OWN people — the people two cells
    // share are what holds them together, and are left to it. It holds
    // until the two only touch, or overlap as far as they share: a cell
    // wholly inside another stays there. (A faint push beyond touching was
    // tried: it spread the picture and stretched every cell.)
    const mineH = new Uint8Array(n);
    for (let h = 0; h < H; h++) {
      mineH.fill(0);
      for (const i of field.hubs[h]) mineH[i] = 1;
      for (let k = h + 1; k < H; k++) {
        const share = field.share[h * H + k];
        const touchAt = (reach[h] + reach[k] + 2.4 * r) * (1 - share);
        let dx = cx[k] - cx[h];
        let dy = cy[k] - cy[h];
        let d = Math.hypot(dx, dy);
        if (d < 1e-3) {
          // Two cells on one point part along a direction of their own.
          dx = Math.cos(h * GOLDEN_ANGLE + k);
          dy = Math.sin(h * GOLDEN_ANGLE + k);
          d = 1;
        }
        if (d >= touchAt) continue;
        const push = Math.min((touchAt - d) * 0.03, r * 0.3);
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        const both = new Set(field.hubs[k].filter((i) => mineH[i]));
        for (const i of field.hubs[h]) {
          if (both.has(i)) continue;
          fx[i] -= ux;
          fy[i] -= uy;
        }
        for (const i of field.hubs[k]) {
          if (both.has(i)) continue;
          fx[i] += ux;
          fy[i] += uy;
        }
      }
    }
  }
  if (field && focus >= 0 && focus < n) {
    // Whoever shares nothing with them stands back, beyond the outermost
    // ring, so the gathering is only the people it is about.
    const beyond = (focusRest(1) + 2) * r;
    for (let j = 0; j < n; j++) {
      if (j === focus) continue;
      const shared = field.kin[focus * n + j];
      const dx = px[focus] - px[j];
      const dy = py[focus] - py[j];
      const d = Math.hypot(dx, dy) || 1;
      if (!shared && d >= beyond) continue;
      const pull = (d - (shared ? focusRest(shared) * r : beyond)) * 0.06;
      fx[j] += (dx / d) * pull;
      fy[j] += (dy / d) * pull;
    }
  }
  let fastest = 0;
  for (let i = 0; i < n; i++) {
    if (i === held) {
      vx[i] = vy[i] = 0;
      continue;
    }
    vx[i] = (vx[i] + fx[i] * gain) * DAMPING;
    vy[i] = (vy[i] + fy[i] * gain) * DAMPING;
    const speed = Math.hypot(vx[i], vy[i]);
    if (speed > maxSpeed) {
      vx[i] *= maxSpeed / speed;
      vy[i] *= maxSpeed / speed;
    }
    // In focus: the one everybody gathers round stays where they are.
    if (i !== focus) {
      px[i] += vx[i];
      py[i] += vy[i];
    }
    fastest = Math.max(fastest, Math.min(speed, maxSpeed));
  }
  return fastest;
}

/**
 * How far from the person in focus someone who shares `shared` hubs with
 * them comes to rest, in radii: rings, the most shared innermost.
 */
export function focusRest(shared: number): number {
  return 2.6 + 3 / Math.max(1, shared);
}

/**
 * Run a field from hot to cold in one go (no drawing): `frames` steps with
 * the heat falling by `COOL` each. Returns the heat it ends on.
 */
export function coolPeople(
  sim: PeopleSim,
  r: number,
  field: PeopleField,
  frames = 900,
  heat = 1,
): number {
  for (let it = 0; it < frames; it++) {
    stepPeopleSim(sim, r, { field, heat });
    heat *= COOL;
  }
  return heat;
}

/**
 * The field settled in one go, hot to cold. Deterministic — the same
 * people always settle into the same picture. The reduced-motion path and
 * the tests use this; the live view steps the same physics frame by frame.
 */
export function settlePeople(
  people: readonly Pick<PersonAcross, "id" | "holons">[],
  r: number,
): PeopleSim {
  const sim = syncPeopleSim(
    null,
    people.map((p) => p.id),
    r,
  );
  const field = peopleField(sim, people);
  coolPeople(sim, r, field, 1200);
  // And to a standstill: what momentum is left, the damping spends.
  for (let it = 0; it < 60; it++) stepPeopleSim(sim, r, { field, heat: 0 });
  return sim;
}

/**
 * The shortest set of lines that joins every point to the rest (a minimum
 * spanning tree), as pairs of places in `pts`. A hub's ground is drawn as
 * its members' discs melted together; these are the necks that keep a hub
 * whose members stand apart one piece, without sweeping over whoever stands
 * between them the way a hull would.
 */
export function spanTree(pts: readonly Vec[]): Array<[number, number]> {
  const n = pts.length;
  const out: Array<[number, number]> = [];
  if (n < 2) return out;
  const near = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n);
  const done = new Uint8Array(n);
  let cur = 0;
  done[0] = 1;
  for (let added = 1; added < n; added++) {
    let best = -1;
    for (let j = 0; j < n; j++) {
      if (done[j]) continue;
      const d = Math.hypot(pts[j].x - pts[cur].x, pts[j].y - pts[cur].y);
      if (d < near[j]) {
        near[j] = d;
        from[j] = cur;
      }
      if (best < 0 || near[j] < near[best]) best = j;
    }
    done[best] = 1;
    out.push([from[best], best]);
    cur = best;
  }
  return out;
}

/** The box the people of a sim stand in, orbs included. */
export function simBounds(
  sim: PeopleSim,
  r: number,
): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < sim.ids.length; i++) {
    x0 = Math.min(x0, sim.px[i] - r);
    y0 = Math.min(y0, sim.py[i] - r);
    x1 = Math.max(x1, sim.px[i] + r);
    y1 = Math.max(y1, sim.py[i] + r);
  }
  if (x0 > x1) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/** Up to two letters to stand for a name; "" when the name is only an id. */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return "";
  const first = [...words[0]][0];
  const last = words.length > 1 ? [...words[words.length - 1]][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Narrow the people view to a search. A person answers by name; a hub by
 * its name (the dock's own rule, `matchesDock`). Who stays:
 *
 * - everyone who answers by name, with ALL their hubs — finding a person
 *   shows where they stand;
 * - every member of a hub that answers, but standing only on the hubs that
 *   answer — finding a hub shows its people, not every other ground each
 *   of them brings along.
 *
 * `hubs` are the hubs that end up drawn: the ones somebody still stands on.
 * A blank query keeps everyone, as they were, and every hub.
 */
export function filterPeople<P extends Pick<PersonAcross, "id" | "holons">>(
  people: readonly P[],
  hubs: readonly { id: string; name: string }[],
  query: string,
  nameOf: (id: string) => string,
): { people: P[]; hubs: Set<string> } {
  if (!query.trim())
    return { people: [...people], hubs: new Set(hubs.map((h) => h.id)) };
  const hit = new Set(
    hubs.filter((h) => matchesDock(h, query)).map((h) => h.id),
  );
  const kept: P[] = [];
  for (const p of people) {
    if (matchesText(nameOf(p.id), query)) kept.push(p);
    else {
      const holons = p.holons.filter((h) => hit.has(h));
      if (holons.length) kept.push({ ...p, holons });
    }
  }
  return { people: kept, hubs: new Set(kept.flatMap((p) => p.holons)) };
}
