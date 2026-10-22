// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Publish orchestration for offers — the same two legs a need takes
 * (`needs/publish.ts`), so the two sides of the market travel the same way:
 *
 *   - Partners — `publishToFederation({kind:'all'})` on the `quests` lens as
 *     standalone copies; a changed offer is re-sent under the same id.
 *   - Public map — a hologram at the holon's `settings.hex` cell under the
 *     `offers` lens, upcast up the parent chain, so the "Offers" map layer
 *     lights at any zoom and a cell's market can be read in one `getAll`.
 *     A hologram because nobody owns a cell: it resolves live from the
 *     canonical record, so a fulfilled offer does not linger as a ghost.
 *
 * Withdrawing retracts partner copies and deletes the cell hologram
 * best-effort; readers filter closed statuses either way.
 */

import type { HoloSphere } from 'holosphere';
import { publishToFederation, type PublishOutcome } from '../federation/publish.js';
import { retractFromFederation, type RetractOutcome } from '../federation/retract.js';
import { readSettingsHex } from '../federation/settings-hex.js';
import { withdrawOffer } from './lifecycle.js';
import { OFFER_RECORD_LENS, OFFERS_LENS, type OfferRecord } from './types.js';

export interface PublishOfferOptions {
  /** Publish copies to federation partners. Default true. */
  toPartners?: boolean;
  /** Publish a hologram to the holon's settings.hex cell. Default false. */
  toHex?: boolean;
  /** Federation source identity (e.g. nostr pubkey). Defaults to holonId. */
  federationSourceId?: string;
  /** Climb the hex parent chain (default true); `upcastLevels` bounds it. */
  upcast?: boolean;
  upcastLevels?: number;
  onWriteDenied?: (info: { target: string; lens: string; message: string }) => void;
  /** Override the timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

export interface PublishOfferOutcome {
  /** The offer as persisted, stamped with `published` (and `hex` when mapped). */
  offer: OfferRecord;
  partners?: PublishOutcome;
  hexCell?: PublishOutcome;
  errors: string[];
}

function canonicalSoul(holosphere: HoloSphere, holonId: string, offerId: string): string {
  const appname = (holosphere as { appname?: string }).appname ?? '';
  return `${appname}/${holonId}/${OFFER_RECORD_LENS}/${offerId}`;
}

/**
 * Persist the canonical offer and publish it per the options. The hex leg is
 * skipped with an error message (not a throw) when the holon has no valid
 * `settings.hex`.
 */
export async function publishOfferNearby(
  holosphere: HoloSphere,
  holonId: string,
  offer: OfferRecord,
  opts: PublishOfferOptions = {},
): Promise<PublishOfferOutcome> {
  if (!offer?.id || typeof offer.id !== 'string') throw new Error('publishOfferNearby: offer.id is required');
  const toPartners = opts.toPartners !== false;
  const toHex = opts.toHex === true;
  const now = opts.now ?? Date.now();
  const errors: string[] = [];

  const hexCell = toHex ? await readSettingsHex(holosphere, holonId) : null;
  if (toHex && !hexCell) errors.push('No hex address configured (Settings → Hex Address) — skipped map publish');

  const stamped = {
    ...offer,
    ...(hexCell ? { hex: hexCell } : {}),
    published: { at: now, toPartners, ...(hexCell ? { toHex: hexCell } : {}) },
  } as OfferRecord & { id: string };

  await (holosphere as any).put(holonId, OFFER_RECORD_LENS, stamped);

  let partners: PublishOutcome | undefined;
  if (toPartners) {
    partners = await publishToFederation(
      { holosphere, holonId, lens: OFFER_RECORD_LENS, item: stamped },
      { kind: 'all' },
      { includeSettingsHex: false, federationSourceId: opts.federationSourceId, onWriteDenied: opts.onWriteDenied },
    );
    errors.push(...partners.errors);
  }

  let hexOutcome: PublishOutcome | undefined;
  if (hexCell) {
    const crossLens = { ...stamped, _hologram: { isHologram: true, soul: canonicalSoul(holosphere, holonId, offer.id) } };
    hexOutcome = await publishToFederation(
      { holosphere, holonId, lens: OFFERS_LENS, item: crossLens },
      { kind: 'hex', cell: hexCell },
      {
        useHolograms: true,
        upcast: opts.upcast !== false && opts.upcastLevels !== 0,
        upcastLevels: opts.upcastLevels,
        onWriteDenied: opts.onWriteDenied,
      },
    );
    errors.push(...hexOutcome.errors);
  }

  return { offer: stamped, partners, hexCell: hexOutcome, errors };
}

/**
 * Persist a changed offer and re-send it where it was published. The hex
 * hologram resolves live, so only partner copies are pushed again.
 */
export async function refreshPublishedOffer(
  holosphere: HoloSphere,
  holonId: string,
  offer: OfferRecord,
  opts: Pick<PublishOfferOptions, 'federationSourceId' | 'onWriteDenied'> = {},
): Promise<PublishOfferOutcome> {
  if (!offer?.id || typeof offer.id !== 'string') throw new Error('refreshPublishedOffer: offer.id is required');
  const errors: string[] = [];
  const record = offer as OfferRecord & { id: string };
  await (holosphere as any).put(holonId, OFFER_RECORD_LENS, record);

  let partners: PublishOutcome | undefined;
  if (record.published?.toPartners) {
    partners = await publishToFederation(
      { holosphere, holonId, lens: OFFER_RECORD_LENS, item: record },
      { kind: 'all' },
      { includeSettingsHex: false, federationSourceId: opts.federationSourceId, onWriteDenied: opts.onWriteDenied },
    );
    errors.push(...partners.errors);
  }
  return { offer, partners, errors };
}

export interface WithdrawOfferOutcome extends PublishOfferOutcome {
  ok: boolean;
  reason?: 'already_closed' | 'has_live_reservations';
  retracted?: RetractOutcome;
}

/**
 * Take the offer off the market everywhere it was published. Refused (no
 * writes) while a reservation is live.
 */
export async function withdrawPublishedOffer(
  holosphere: HoloSphere,
  holonId: string,
  offer: OfferRecord,
  opts: Pick<PublishOfferOptions, 'federationSourceId' | 'onWriteDenied' | 'now'> = {},
): Promise<WithdrawOfferOutcome> {
  const withdrawn = withdrawOffer(offer, opts.now);
  if (!withdrawn.ok) return { ok: false, offer, reason: withdrawn.reason, errors: [] };
  const refreshed = await refreshPublishedOffer(holosphere, holonId, withdrawn.offer, opts);
  const errors = [...refreshed.errors];
  let retracted: RetractOutcome | undefined;
  if (withdrawn.offer.published?.toPartners) {
    retracted = await retractFromFederation(holosphere, holonId, OFFER_RECORD_LENS, withdrawn.offer.id as string);
    errors.push(...retracted.errors);
  }
  const cell = withdrawn.offer.published?.toHex ?? withdrawn.offer.hex;
  if (cell) {
    try {
      await (holosphere as any).delete(cell, OFFERS_LENS, withdrawn.offer.id);
    } catch (err) {
      errors.push(`unlight ${cell}: ${(err as Error).message ?? String(err)}`);
    }
  }
  return { ok: true, offer: refreshed.offer, partners: refreshed.partners, retracted, errors };
}
