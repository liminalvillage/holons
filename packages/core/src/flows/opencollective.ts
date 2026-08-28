// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * OpenCollective, read-only — the query and the parser, never the fetch.
 *
 * Core does no outbound HTTP (it depends on `holosphere` and `ical.js` and
 * nothing else), so this module owns the GraphQL document and the shape
 * validation while the apps own the network call, behind their own
 * `/api/opencollective` route. That is the same split the AI breakdown uses:
 * core builds and validates the payload, the app talks to the world.
 *
 * `parseOpenCollectiveResponse` is deliberately forgiving. It is the only place
 * that knows OpenCollective's schema, so when that schema drifts the damage is
 * contained here: every field is coerced, every optional defaults, and a
 * missing branch yields zeroes rather than an exception that would take the
 * whole Flows view down over a third party's API change.
 */

export const OPENCOLLECTIVE_API_URL = 'https://api.opencollective.com/graphql/v2';

/**
 * Balance and recent movement for one collective.
 *
 * NOTE: verified against the live API on first use — see the plan. If
 * OpenCollective renames a field, the parser below is what needs updating.
 */
export const COLLECTIVE_OVERVIEW_QUERY = `
query HolonCollective($slug: String!, $limit: Int!) {
  account(slug: $slug) {
    slug
    name
    currency
    stats {
      balance {
        value
        currency
      }
    }
  }
  transactions(
    account: { slug: $slug }
    limit: $limit
    orderBy: { field: CREATED_AT, direction: DESC }
  ) {
    nodes {
      id
      type
      kind
      createdAt
      description
      amount {
        value
        currency
      }
      fromAccount {
        slug
        name
      }
      toAccount {
        slug
        name
      }
    }
  }
}
`.trim();

export interface OpenCollectiveTransaction {
  id: string;
  /** CREDIT is money in, DEBIT is money out, from the collective's view. */
  type: 'CREDIT' | 'DEBIT';
  kind?: string;
  /** Absolute amount; direction lives in `type`. */
  amount: number;
  currency: string;
  /** Normalized to ms epoch. */
  createdAt: number;
  description: string;
  fromAccount?: string;
  toAccount?: string;
}

export interface OpenCollectiveSnapshot {
  slug: string;
  name: string;
  currency: string;
  balance: number;
  totalReceived: number;
  totalSpent: number;
  transactions: OpenCollectiveTransaction[];
  fetchedAt: number;
}

/** Reduce a pasted collective URL to its slug; leave a bare slug alone. */
export function normalizeCollectiveSlug(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  // Accept a full URL, with or without protocol, and take the first path
  // segment after the host — that is where the slug sits.
  const withoutProtocol = raw.replace(/^https?:\/\//i, '');
  const segments = withoutProtocol.split('/').filter(Boolean);
  const candidate = segments.length > 1 ? segments[1] : segments[0] ?? '';
  return candidate.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Whether a slug is safe to interpolate into an API call. */
export function isValidCollectiveSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const str = (value: unknown): string =>
  typeof value === 'string' ? value : value == null ? '' : String(value);

/**
 * Read an OpenCollective money field.
 *
 * The API exposes both `value` (major units) and `valueInCents`; different
 * fields have historically favoured different ones, so accept either rather
 * than reporting a balance a hundred times too large.
 */
function money(raw: unknown): { amount: number; currency: string } {
  const doc = (raw ?? {}) as Record<string, unknown>;
  const currency = str(doc.currency).toUpperCase();
  if (doc.value != null) return { amount: num(doc.value), currency };
  if (doc.valueInCents != null) return { amount: num(doc.valueInCents) / 100, currency };
  return { amount: 0, currency };
}

function timestamp(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(str(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalize a raw GraphQL response into a snapshot.
 *
 * `now` is injectable so tests can assert `fetchedAt` without freezing clocks.
 */
export function parseOpenCollectiveResponse(
  raw: unknown,
  slug: string,
  now: number = Date.now(),
): OpenCollectiveSnapshot {
  const root = (raw ?? {}) as Record<string, unknown>;
  // Tolerate being handed either the envelope or its `data` payload.
  const data = ((root.data ?? root) ?? {}) as Record<string, unknown>;
  const account = (data.account ?? {}) as Record<string, unknown>;
  const stats = (account.stats ?? {}) as Record<string, unknown>;

  const balance = money(stats.balance);
  const currency = balance.currency || str(account.currency).toUpperCase();

  const rawNodes = (data.transactions as Record<string, unknown> | undefined)?.nodes;
  const nodes = Array.isArray(rawNodes) ? rawNodes : [];

  const transactions: OpenCollectiveTransaction[] = [];
  let totalReceived = 0;
  let totalSpent = 0;

  for (const entry of nodes) {
    const node = (entry ?? {}) as Record<string, unknown>;
    const amount = money(node.amount);
    // Direction is authoritative in `type`; the sign on `amount` is not
    // consistent across transaction kinds, so normalize to a magnitude.
    const type = str(node.type).toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT';
    const magnitude = Math.abs(amount.amount);
    if (magnitude <= 0) continue;

    if (type === 'CREDIT') totalReceived += magnitude;
    else totalSpent += magnitude;

    const from = (node.fromAccount ?? {}) as Record<string, unknown>;
    const to = (node.toAccount ?? {}) as Record<string, unknown>;

    transactions.push({
      id: str(node.id) || `${type}-${transactions.length}`,
      type,
      kind: str(node.kind) || undefined,
      amount: magnitude,
      currency: amount.currency || currency,
      createdAt: timestamp(node.createdAt),
      description: str(node.description),
      fromAccount: str(from.name) || str(from.slug) || undefined,
      toAccount: str(to.name) || str(to.slug) || undefined,
    });
  }

  return {
    slug: str(account.slug) || slug,
    name: str(account.name) || str(account.slug) || slug,
    currency,
    balance: balance.amount,
    totalReceived,
    totalSpent,
    transactions,
    fetchedAt: now,
  };
}
