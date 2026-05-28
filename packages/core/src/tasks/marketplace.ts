// Marketplace items (offers / requests / needs). These are Quests with a
// marketplace `type`, sharing the `quests` lens with tasks and events. Core
// owns the classification rule and the record shape so the web dashboard and
// the Telegram bot produce identical items.

import { createTask } from './creation.js';
import type { Quest } from './types.js';

/** The three marketplace `type` discriminators. */
export type MarketItemKind = 'offer' | 'request' | 'need';

/**
 * Classify a quest as a marketplace item, or null if it's a plain
 * task/event/recurring quest. This is the single source of truth UIs filter on
 * (replaces the per-UI `classifyTask` copies).
 */
export function classifyMarketItem(item: unknown): MarketItemKind | null {
  if (!item || typeof item !== 'object') return null;
  const type = (item as { type?: unknown }).type;
  if (type === 'offer' || type === 'request' || type === 'need') return type;
  return null;
}

export interface CreateMarketItemInput {
  holonId: string | number;
  initiator: Quest['initiator'];
  kind: MarketItemKind;
  title: string;
  description?: string;
  /** Murmurations item type. */
  itemType?: 'good' | 'service';
  /** Murmurations transaction types, e.g. 'borrow-lend', 'buy-sell'. */
  transactionTypes?: string[];
  tags?: string[];
  /** Expiry as ms since epoch. */
  expiresAt?: number;
  category?: string;
  messageThreadId?: number | null;
  picture?: string | null;
  /** Override the creation timestamp (ms since epoch). Mostly for tests. */
  now?: number;
}

/**
 * Build a fresh marketplace item record. Reuses {@link createTask} for the
 * shared default-field set, then attaches the marketplace fields. The id is
 * left empty per the createTask contract — the caller assigns it (web: a uuid,
 * bot: the Telegram message id).
 */
export function createMarketItem(input: CreateMarketItemInput): Quest {
  const item = createTask({
    holonId: input.holonId,
    initiator: input.initiator,
    title: input.title,
    type: input.kind,
    category: input.category,
    picture: input.picture,
    messageThreadId: input.messageThreadId,
    now: input.now,
  });

  // 'offer' is offered; 'request'/'need' are wanted — mirrors the Murmurations
  // exchange_type used for federation.
  item.exchange_type = input.kind === 'offer' ? 'offer' : 'want';
  if (input.description) item.description = input.description;
  if (input.itemType) item.item_type = input.itemType;
  if (input.transactionTypes && input.transactionTypes.length > 0) {
    item.transaction_type = [...input.transactionTypes];
  }
  if (input.tags && input.tags.length > 0) item.tags = [...input.tags];
  if (typeof input.expiresAt === 'number' && !Number.isNaN(input.expiresAt)) {
    item.expires_at = input.expiresAt;
  }

  return item;
}
