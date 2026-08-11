// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Geolocated needs — shared types.
 *
 * A "published need" is a marketplace item (`type: 'need'`, see
 * `tasks/marketplace.ts`) whose canonical record lives on the owner holon's
 * `quests` lens, optionally projected onto an H3 cell's `needs` lens as a
 * hologram so it lights the public map. The lifecycle vocabulary is revived
 * from the dormant `schemas/offers.json` schema.
 */

import type { Quest } from '../tasks/types.js';

/** Lens holding the canonical need record (shared with tasks/marketplace). */
export const NEED_RECORD_LENS = 'quests' as const;

/** Lens the map's "Local Needs" layer reads from — hex-cell projections only. */
export const NEEDS_LENS = 'needs' as const;

/** Lifecycle from schemas/offers.json, plus 'cancelled' for retracted needs. */
export type NeedStatus = 'requested' | 'offered' | 'claimed' | 'fulfilled' | 'cancelled';

export const NEED_STATUSES: readonly NeedStatus[] = [
  'requested',
  'offered',
  'claimed',
  'fulfilled',
  'cancelled',
];

/** Statuses a provider may still respond to. */
export const OPEN_NEED_STATUSES: readonly NeedStatus[] = ['requested', 'offered'];

/** One provider response, embedded on the need (the `bookings[]` pattern). */
export interface NeedResponse {
  id: string;
  responder: {
    id: string | number;
    name?: string;
    /** The responder's own holon, so the requester can follow up. */
    holonId?: string;
  };
  message?: string;
  /** Offered price — the market price the requester committed to. */
  price?: number;
  currency?: string;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * A quest of `type: 'need'` with the needs-network fields attached. All extra
 * fields ride on Quest's open index signature, so existing quest readers are
 * unaffected.
 */
/**
 * Two-sided handoff state. The code is minted at claim time and shown on the
 * requester's screen; the provider types it in on theirs. Hours move only
 * once both confirmations are present.
 */
export interface HandoffState {
  code: string;
  requesterAt?: string;
  providerAt?: string;
}

export interface PublishedNeed extends Quest {
  type: 'need';
  status: NeedStatus;
  /** H3 cell this need was published to, when shared on the public map. */
  hex?: string;
  /** Back-link to the originating record (phase 1: a shopping-list item). */
  source?: { kind: 'shopping'; itemId: string };
  responses?: NeedResponse[];
  /** Publication stamp — which targets this need has been shared with. */
  published?: { at: number; toHex?: string; toPartners?: boolean };
  handoff?: HandoffState;
  /**
   * Emergency mode (docs §8): an urgent need is a need with this field,
   * cross-posted to the announcements lens and rendered with priority.
   */
  urgency?: 'urgent';
  /** Which response won, stamped by `claimNeed`. */
  claimedResponseId?: string;
  /** ISO timestamp of the claim. */
  claimedAt?: string;
  /** ISO timestamp of the close (`fulfilled` or `cancelled`). */
  closedAt?: string;
}

/** Type guard: is this record a need in the needs-network sense? */
export function isPublishedNeed(item: unknown): item is PublishedNeed {
  if (!item || typeof item !== 'object') return false;
  const d = item as Record<string, unknown>;
  return d.type === 'need' && typeof d.status === 'string';
}
