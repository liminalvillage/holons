// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The home hex as a federation partner.
 *
 * A holon's `settings.hex` is the H3 cell it calls home. On its own that is
 * just a string: it has no direction config, no lens selection, and publishing
 * to it means pressing a button on every single card.
 *
 * Linking it turns the cell into an ordinary federation partner — which is the
 * whole point, because a partner already has everything the map needs: per-lens
 * `inbound`/`outbound` directions, a place on the Federation page, and a
 * publish path that honours them. The one thing a cell has that a peer does not
 * is a *scalespace*: it sits inside a nest of coarser hexagons all the way up to
 * res 0. So the partner config carries a `hops` reach, and HoloSphere plants a
 * pointer at each of those levels on every ordinary write.
 *
 * Directions read as they do for any partner, from the holon's perspective:
 *   - `outbound` — lenses whose items appear on the map at this cell.
 *   - `inbound`  — lenses the holon reads back from the cell, i.e. what other
 *                  holons have placed on the same ground. Exact cell only; the
 *                  ancestors are not read, or a village would inherit a
 *                  continent's noise.
 *
 * The writes here are config only. Placement and retraction happen inside
 * HoloSphere on ordinary put/delete — see `maybeMirrorToHexPartners` and
 * `retractFromHexPartners` in `packages/holosphere/federation.js`.
 */

import type { HoloSphere } from 'holosphere';
import { isValidCell } from 'h3-js';
import { readSettingsHex } from './settings-hex.js';
import { getFederationSnapshot } from './snapshot.js';
import { setFederationPartner, removeFederationPartner } from './partners.js';
import { publishToFederation, type PublishOutcome } from './publish.js';

/**
 * Default reach for a newly linked home hex: five levels above the cell.
 *
 * At the res-9 cells the pickers default to, that spans roughly a block up to
 * a small region — far enough that an item is findable at the zoom someone
 * actually browses at, near enough that it does not clutter a continent.
 */
export const HOME_HEX_DEFAULT_HOPS = 5;

/** Cells sit at res 0–15, so 15 climbs is the most any of them can make. */
export const HOME_HEX_MAX_HOPS = 15;

export interface HomeHexLink {
  /** The H3 cell from `settings.hex`. */
  cell: string;
  /** Lenses read back from the cell (exact cell only). */
  inbound: string[];
  /** Lenses whose items are placed on the map at this cell. */
  outbound: string[];
  /** How many parent levels above the cell an item climbs. */
  hops: number;
}

export interface SetHomeHexLinkOptions {
  inbound: string[];
  outbound: string[];
  /** Defaults to {@link HOME_HEX_DEFAULT_HOPS}; clamped to 0–15. */
  hops?: number;
}

/** Clamp a reach into 0–15. Anything unparseable reads as "no reach". */
export function normalizeHops(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(HOME_HEX_MAX_HOPS, Math.max(0, Math.floor(n)));
}

/**
 * The holon's home-hex link, or `null` when there is nothing to report.
 *
 * `null` covers both "no hex address set" and "hex set but never linked" —
 * callers treat them the same (offer to link), and the difference is already
 * available from `readSettingsHex` when a UI wants to word the prompt.
 */
export async function readHomeHexLink(
  holosphere: HoloSphere,
  holonId: string
): Promise<HomeHexLink | null> {
  const cell = await readSettingsHex(holosphere, holonId);
  if (!cell) return null;

  let snapshot;
  try {
    snapshot = await getFederationSnapshot(holosphere, holonId);
  } catch {
    return null;
  }
  if (!snapshot.federated.includes(cell)) return null;

  const cfg = snapshot.lensConfig[cell] ?? { inbound: [], outbound: [] };
  return {
    cell,
    inbound: cfg.inbound ?? [],
    outbound: cfg.outbound ?? [],
    hops: normalizeHops(cfg.hops),
  };
}

/**
 * Link (or reconfigure) the holon's home hex.
 *
 * Like `setFederationPartner`, this FULLY REPLACES the lens config — pass the
 * complete arrays, not a delta. Throws when the holon has no valid
 * `settings.hex`: there is no sensible default cell to invent, and silently
 * picking one would put a community on the map somewhere it never chose.
 */
export async function setHomeHexLink(
  holosphere: HoloSphere,
  holonId: string,
  options: SetHomeHexLinkOptions
): Promise<HomeHexLink> {
  const cell = await readSettingsHex(holosphere, holonId);
  if (!cell || !isValidCell(cell)) {
    throw new Error(
      'setHomeHexLink: no hex address set for this holon — pick one in Settings first'
    );
  }

  const hops = options.hops === undefined
    ? HOME_HEX_DEFAULT_HOPS
    : normalizeHops(options.hops);

  await setFederationPartner(holosphere, holonId, cell, {
    inbound: options.inbound,
    outbound: options.outbound,
    hops,
    partnerName: 'Home hex',
  });

  return { cell, inbound: options.inbound, outbound: options.outbound, hops };
}

/**
 * Unlink the home hex. Config only: items already placed on the map stay
 * there, and are retracted by deleting them (or by re-linking with the lens
 * turned off and sweeping). Returns false when there was nothing linked.
 */
export async function unlinkHomeHex(
  holosphere: HoloSphere,
  holonId: string
): Promise<boolean> {
  const cell = await readSettingsHex(holosphere, holonId);
  if (!cell) return false;
  return removeFederationPartner(holosphere, holonId, cell);
}

/**
 * Place one existing item on the map now, without waiting for its next write.
 *
 * Ordinary writes mirror themselves, so this is for the backfill a caretaker
 * expects when they switch a lens on: the board is already full, and an empty
 * map would read as the feature not working. Awaited, unlike the automatic
 * path, so a UI can report progress.
 */
export async function mirrorItemToHomeHex(
  holosphere: HoloSphere,
  holonId: string,
  lens: string,
  item: { id: string;[k: string]: any },
  link?: HomeHexLink | null
): Promise<PublishOutcome | null> {
  const resolved = link ?? (await readHomeHexLink(holosphere, holonId));
  if (!resolved || resolved.hops <= 0) return null;
  if (!resolved.outbound.includes(lens)) return null;

  return publishToFederation(
    { holosphere, holonId, lens, item },
    { kind: 'hex', cell: resolved.cell },
    { useHolograms: true, upcast: true, upcastLevels: resolved.hops }
  );
}

/**
 * Retract one item from the map — the counterpart to
 * {@link mirrorItemToHomeHex} for items whose source record is staying put
 * (unpublishing, rather than deleting). A delete needs no call: HoloSphere
 * retracts the placement as part of the delete cascade.
 */
export async function retractItemFromHomeHex(
  holosphere: HoloSphere,
  holonId: string,
  lens: string,
  itemId: string
): Promise<string[]> {
  return (holosphere as any).retractFromHexPartners(holonId, lens, itemId);
}
