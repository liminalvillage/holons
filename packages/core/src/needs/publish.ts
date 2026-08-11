// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Publish orchestration for geolocated needs.
 *
 * Two legs, both consent-driven by the caller's options:
 *
 *   - Partners — `publishToFederation({kind:'all'})` on the `quests` lens as
 *     standalone copies (holograms stay opt-in across the federation). Status
 *     changes are pushed by re-publishing: same id → overwrite.
 *   - Public map — a hologram at the holon's `settings.hex` cell under the
 *     `needs` lens, upcast up the parent chain so the "Local Needs" map layer
 *     lights at any zoom. A hologram (not a copy) because nobody owns a hex
 *     cell: a copy would stay lit as a ghost need after fulfillment, while a
 *     hologram resolves live from the canonical quests record.
 */

import type { HoloSphere } from 'holosphere';
import { publishToFederation, type PublishOutcome } from '../federation/publish.js';
import { readSettingsHex } from '../federation/settings-hex.js';
import { getFederationSnapshot } from '../federation/snapshot.js';
import { createAnnouncement, ANNOUNCEMENTS_LENS } from '../announcements/index.js';
import { NEED_RECORD_LENS, NEEDS_LENS, type PublishedNeed } from './types.js';

export interface PublishNeedOptions {
  /** Publish copies to federation partners. Default true. */
  toPartners?: boolean;
  /** Publish a hologram to the holon's settings.hex cell. Default false. */
  toHex?: boolean;
  /** Federation source identity (e.g. nostr pubkey). Defaults to holonId. */
  federationSourceId?: string;
  /**
   * Climb the hex parent chain so the need surfaces at coarser map zooms.
   * Default true. `upcastLevels` bounds the climb (default: full climb) —
   * this is the "how far should it travel" ring dial: 0 keeps the need at
   * the exact cell, small values keep it neighbourhood-local.
   */
  upcast?: boolean;
  upcastLevels?: number;
  /**
   * Emergency mode (docs §8): stamp `urgency:'urgent'` on the need and
   * cross-post an announcement to this holon, its hex cell, and its
   * federation partners — the same channel, rendered with priority.
   * Default false.
   */
  urgent?: boolean;
  onWriteDenied?: (info: { target: string; lens: string; message: string }) => void;
  /** Override the timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

export interface PublishNeedOutcome {
  /** The need as persisted, stamped with `published` (and `hex` when mapped). */
  need: PublishedNeed;
  partners?: PublishOutcome;
  hexCell?: PublishOutcome;
  errors: string[];
}

/**
 * The soul of the canonical need record on its owner holon. Handed to the
 * hex leg as a pre-resolved hologram so the `{id, soul}` written at the cell
 * points across lenses at `<app>/<holon>/quests/<id>` — where the record
 * actually lives — instead of at an empty `needs` lens.
 */
function canonicalSoul(holosphere: HoloSphere, holonId: string, needId: string): string {
  const appname = (holosphere as { appname?: string }).appname ?? '';
  return `${appname}/${holonId}/${NEED_RECORD_LENS}/${needId}`;
}

/**
 * Persist the canonical need record and publish it per the consent options.
 * The hex leg is skipped (with an error message, not a throw) when the holon
 * has no valid `settings.hex` — the UI should disable the option up front via
 * `readSettingsHex`.
 */
export async function publishNeedNearby(
  holosphere: HoloSphere,
  holonId: string,
  need: PublishedNeed,
  opts: PublishNeedOptions = {}
): Promise<PublishNeedOutcome> {
  if (!need?.id || typeof need.id !== 'string') {
    throw new Error('publishNeedNearby: need.id is required');
  }
  const toPartners = opts.toPartners !== false;
  const toHex = opts.toHex === true;
  const now = opts.now ?? Date.now();
  const errors: string[] = [];

  const hexCell = toHex ? await readSettingsHex(holosphere, holonId) : null;
  if (toHex && !hexCell) {
    errors.push('No hex address configured (Settings → Hex Address) — skipped map publish');
  }

  const stamped = {
    ...need,
    ...(hexCell ? { hex: hexCell } : {}),
    ...(opts.urgent ? { urgency: 'urgent' as const } : {}),
    published: { at: now, toPartners, ...(hexCell ? { toHex: hexCell } : {}) },
  } as PublishedNeed & { id: string };

  // Canonical record first, so holograms and partner copies resolve to it.
  await (holosphere as any).put(holonId, NEED_RECORD_LENS, stamped);

  let partners: PublishOutcome | undefined;
  if (toPartners) {
    partners = await publishToFederation(
      { holosphere, holonId, lens: NEED_RECORD_LENS, item: stamped },
      { kind: 'all' },
      {
        includeSettingsHex: false,
        federationSourceId: opts.federationSourceId,
        onWriteDenied: opts.onWriteDenied,
      }
    );
    errors.push(...partners.errors);
  }

  let hexOutcome: PublishOutcome | undefined;
  if (hexCell) {
    const crossLens = {
      ...stamped,
      _hologram: { isHologram: true, soul: canonicalSoul(holosphere, holonId, need.id) },
    };
    hexOutcome = await publishToFederation(
      { holosphere, holonId, lens: NEEDS_LENS, item: crossLens },
      { kind: 'hex', cell: hexCell },
      {
        useHolograms: true,
        upcast: opts.upcast !== false && opts.upcastLevels !== 0,
        upcastLevels: opts.upcastLevels,
        onWriteDenied: opts.onWriteDenied,
      }
    );
    errors.push(...hexOutcome.errors);
  }

  // Emergency cross-post (docs §8): the urgent need also lands as an
  // announcement — on this holon, its hex cell, and its partners — so the
  // channel people already read for news carries the alarm. Best-effort:
  // the need itself is already published either way.
  if (opts.urgent) {
    const announcement = {
      ...createAnnouncement({
        id: `urgent-${need.id}`,
        content: `🚨 URGENT need: ${String(stamped.title ?? '')}`,
        chat: holonId,
        user: stamped.initiator,
      }),
      urgency: 'urgent' as const,
      source: { kind: 'need' as const, needId: String(need.id), holonId },
    };
    const targets = new Set<string>([holonId]);
    if (hexCell) targets.add(hexCell);
    if (toPartners) {
      try {
        for (const p of (await getFederationSnapshot(holosphere, holonId)).federated) {
          targets.add(p);
        }
      } catch (err) {
        errors.push(`urgent announce targets: ${(err as Error).message ?? String(err)}`);
      }
    }
    for (const target of targets) {
      try {
        await (holosphere as any).put(target, ANNOUNCEMENTS_LENS, announcement);
      } catch (err) {
        errors.push(`urgent announce ${target}: ${(err as Error).message ?? String(err)}`);
      }
    }
  }

  return { need: stamped, partners, hexCell: hexOutcome, errors };
}

/**
 * Persist a changed need (response added, status change) and push the update
 * to the targets it was previously published to. The hex hologram needs no
 * re-put — it resolves live from the canonical record — so only partner
 * copies are re-sent.
 */
export async function refreshPublishedNeed(
  holosphere: HoloSphere,
  holonId: string,
  need: PublishedNeed,
  opts: Pick<PublishNeedOptions, 'federationSourceId' | 'onWriteDenied'> = {}
): Promise<PublishNeedOutcome> {
  if (!need?.id || typeof need.id !== 'string') {
    throw new Error('refreshPublishedNeed: need.id is required');
  }
  const errors: string[] = [];
  const record = need as PublishedNeed & { id: string };
  await (holosphere as any).put(holonId, NEED_RECORD_LENS, record);

  let partners: PublishOutcome | undefined;
  if (record.published?.toPartners) {
    partners = await publishToFederation(
      { holosphere, holonId, lens: NEED_RECORD_LENS, item: record },
      { kind: 'all' },
      {
        includeSettingsHex: false,
        federationSourceId: opts.federationSourceId,
        onWriteDenied: opts.onWriteDenied,
      }
    );
    errors.push(...partners.errors);
  }

  return { need, partners, errors };
}
