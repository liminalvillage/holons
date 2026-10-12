// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The people of the dock: who is in the hubs on it, and who is in more than
// one. Federation is the tie two hubs chose; a shared person is a tie they
// have whether they chose it or not, and the sky draws both. The rule for
// who counts, and for when two ids are one person, is core's
// (`@holons/core/holons` peopleAcross) — this module only keeps the answer
// for the dock, and works out where a person stands among their hubs.
//
// Nothing is read until the layer is switched on: a roster per docked hub is
// a read per hub, and a sky nobody asked about people in should not pay it.

import { get, writable } from "svelte/store";
import {
  loadPeopleAcross,
  type PeopleAcross,
  type PersonAcross,
} from "@holons/core/holons";
import type { Vec } from "./dock";
import { getHolosphere } from "./holosphere";
import { primeNames } from "./names";

const ON_KEY = "kiosk_dock_people";

function loadOn(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the dock shows people among its hubs. Per device. */
export const dockPeopleOn = writable<boolean>(loadOn());

export function setDockPeople(on: boolean): void {
  dockPeopleOn.set(on);
  try {
    localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the choice just won't survive a reload */
  }
}

const NOBODY: PeopleAcross = { people: [], connectors: [], bridges: [] };

/** The people across the docked hubs; empty until `loadDockPeople` answers. */
export const dockPeople = writable<PeopleAcross>(NOBODY);
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
    });
    if (asking !== key) return;
    // The rosters named these people; the resolver need not ask again.
    primeNames(found.people.flatMap((p) => p.ids.map((id) => [id, p.name])));
    loadedKey = key;
    loadedAt = Date.now();
    dockPeople.set(found);
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

export function currentDockPeople(): PeopleAcross {
  return get(dockPeople);
}

// ── Where a person stands ────────────────────────────────────────────────--

/** A person among their hubs, or the "+N" that stands for the rest of a group. */
export type PersonSpot = {
  key: string;
  x: number;
  y: number;
  /** The hubs on screen this spot ties to. */
  hubs: string[];
  person?: PersonAcross;
  /** How many more people share exactly these hubs than are drawn. */
  more?: number;
};

export type SpotOptions = {
  /** Only these hubs count (the search has narrowed the sky). */
  visible?: ReadonlySet<string> | null;
  /** People drawn per group of hubs before the rest fold into "+N". */
  cap?: number;
  /** Air between neighbours. */
  gap?: number;
};

/**
 * Where each connector stands: at the middle of the hubs they are in, so the
 * ties out to those hubs say at a glance what they hold together.
 *
 * People sharing exactly the same hubs would land on one point, so a group
 * stands in a row instead. Between two hubs the row runs along the axis
 * joining them, on its upper side — a hub's name hangs below it — and just
 * off the axis when it fits in the gap between the two rims; when it does
 * not (the hubs are close, or federated and overlapping) it lifts clear of
 * both orbs. Among three or more it is a row through the middle.
 *
 * `r` is an orb's radius and `pr` a person's, both in the field's px.
 */
export function personSpots(
  connectors: readonly PersonAcross[],
  positions: ReadonlyMap<string, Vec>,
  r: number,
  pr: number,
  opts: SpotOptions = {},
): PersonSpot[] {
  const cap = opts.cap ?? 4;
  const gap = opts.gap ?? 6;
  const step = 2 * pr + gap;
  const groups = new Map<string, { hubs: string[]; people: PersonAcross[] }>();
  for (const p of connectors) {
    const hubs = p.holons.filter(
      (h) => positions.has(h) && (!opts.visible || opts.visible.has(h)),
    );
    if (hubs.length < 2) continue;
    const key = [...hubs].sort().join("\n");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { hubs, people: [] }));
    g.people.push(p);
  }

  const spots: PersonSpot[] = [];
  for (const [key, g] of groups) {
    const pts = g.hubs.map((h) => positions.get(h)!);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const drawn = g.people.slice(0, cap);
    const more = g.people.length - drawn.length;
    const n = drawn.length + (more > 0 ? 1 : 0);
    const along = (k: number) => (k - (n - 1) / 2) * step;
    const at = (k: number): Vec => {
      if (pts.length === 2) {
        const dx = pts[1].x - pts[0].x;
        const dy = pts[1].y - pts[0].y;
        const d = Math.hypot(dx, dy);
        // Left to right whichever hub was named first, so a row reads the
        // same way however the rosters were ordered.
        const flip = dx < 0 || (dx === 0 && dy < 0) ? -1 : 1;
        const ux = d ? (flip * dx) / d : 1;
        const uy = d ? (flip * dy) / d : 0;
        // The side of the axis that points up the screen (or left, when the
        // two hubs sit one above the other).
        let nx = -uy;
        let ny = ux;
        if (ny > 0 || (ny === 0 && nx > 0)) {
          nx = -nx;
          ny = -ny;
        }
        const room = d / 2 - r - pr - gap;
        const out = (room >= ((n - 1) * step) / 2 ? 0 : r) + pr + gap;
        return {
          x: cx + ux * along(k) + nx * out,
          y: cy + uy * along(k) + ny * out,
        };
      }
      return { x: cx + along(k), y: cy };
    };
    drawn.forEach((person, k) => {
      spots.push({ key: person.id, ...at(k), hubs: g.hubs, person });
    });
    if (more > 0)
      spots.push({
        key: `more:${key}`,
        ...at(drawn.length),
        hubs: g.hubs,
        more,
      });
  }
  // Rows of different groups can cross (two pairs of hubs whose axes meet):
  // ease any two spots apart until neither sits on the other, so each stays
  // a target a finger can pick. A few passes settle a crowded middle.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const a = spots[i];
        const b = spots[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= step) continue;
        // Two on the very same point part along the vertical.
        const ux = d ? dx / d : 0;
        const uy = d ? dy / d : 1;
        const push = (step - d) / 2;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return spots;
}

/** The point on a hub's rim nearest `from` — where a tie lands. */
export function rimPoint(hub: Vec, from: Vec, r: number): Vec {
  const dx = from.x - hub.x;
  const dy = from.y - hub.y;
  const d = Math.hypot(dx, dy);
  if (d <= r || d === 0) return hub;
  return { x: hub.x + (dx / d) * r, y: hub.y + (dy / d) * r };
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
