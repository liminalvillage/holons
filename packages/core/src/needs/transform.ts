// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Shopping item → published need. Pure transforms; storage is the caller's
 * responsibility (the publish orchestrator persists to the `quests` lens).
 */

import { createMarketItem } from '../tasks/marketplace.js';
import type { Quest, QuestInitiator } from '../tasks/types.js';
import type { ShoppingItem } from '../shopping/types.js';
import {
  NEED_STATUSES,
  type NeedResponse,
  type NeedStatus,
  type PublishedNeed,
} from './types.js';

export interface NeedFromShoppingOptions {
  holonId: string | number;
  initiator: QuestInitiator;
  /** Override the generated id. Mostly for tests and the Telegram bot. */
  id?: string;
  /** H3 cell the need will be published to (stamped for provenance). */
  hex?: string;
  description?: string;
  tags?: string[];
  /** Expiry as ms since epoch. */
  expiresAt?: number;
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * Build a fresh need from a shopping-list item. The item's text becomes the
 * title, its category carries over, and a `source` back-link records the
 * originating item so checking it off can close the need.
 */
export function needFromShoppingItem(
  item: ShoppingItem,
  opts: NeedFromShoppingOptions
): PublishedNeed {
  const now = opts.now ?? Date.now();
  const need = createMarketItem({
    holonId: opts.holonId,
    initiator: opts.initiator,
    kind: 'need',
    title: String(item.text ?? '').trim(),
    description: opts.description,
    itemType: 'good',
    tags: opts.tags,
    expiresAt: opts.expiresAt,
    category: typeof item.category === 'string' && item.category ? item.category : undefined,
    now,
  }) as PublishedNeed;

  need.id = opts.id ?? `need-${now}-${Math.random().toString(36).slice(2, 8)}`;
  need.status = 'requested';
  need.source = { kind: 'shopping', itemId: String(item.id) };
  need.responses = [];
  if (opts.hex) need.hex = opts.hex;
  return need;
}

/**
 * Coerce a raw record (possibly partial / from the wire) into a sane need, or null
 * when it isn't a need or was deleted. Unknown statuses fall back to
 * 'requested' rather than dropping the record.
 */
export function normalizeNeed(raw: unknown): PublishedNeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Quest & Record<string, unknown>;
  if (d._deleted || d.type !== 'need') return null;

  const status: NeedStatus = NEED_STATUSES.includes(d.status as NeedStatus)
    ? (d.status as NeedStatus)
    : 'requested';
  const responses = Array.isArray(d.responses)
    ? (d.responses as NeedResponse[]).filter((r) => r && r.id != null)
    : [];

  return { ...(d as Quest), type: 'need', status, responses } as PublishedNeed;
}
