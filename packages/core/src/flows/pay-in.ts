// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where real money can be paid into a pot, besides its OpenCollective
 * (`settings.ts`): a Safe on an EVM chain, and a Lightning address.
 *
 * Nothing here moves or records money. These are doors a pot's admins
 * point at accounts they already hold; a payment through one is a real
 * transaction on that rail, and what reaches the pot is read from the rail,
 * never typed in. (A number someone types is not money that arrived.)
 *
 * Both are read forgivingly from what people paste: a Safe as `gno:0x…`
 * (how Safe{Wallet} copies it), as a Safe{Wallet} link, or as a bare
 * address with a chosen chain; a Lightning address as `name@domain`, a
 * `lightning:` link, or an LNURL.
 */

import { KNOWN_CHAINS, describeChain, safeAppUrl } from './chain.js';

/** Settings field holding the pay-in doors. */
export const PAY_IN_KEY = 'payIn';

/** The chain a bare address is taken to be on when none is said. */
export const DEFAULT_SAFE_CHAIN = 100;

export interface PayInSafe {
  chainId: number;
  /** Lower-case 0x address. */
  address: string;
}

export interface PayIn {
  safe: PayInSafe | null;
  /** `name@domain` or an `lnurl1…`, lower-case. */
  lightning: string | null;
}

export const NO_PAY_IN: PayIn = { safe: null, lightning: null };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Chain id by Safe's short prefix (`gno`, `eth`, `base`…). */
const BY_PREFIX: Record<string, number> = Object.fromEntries(
  Object.entries(KNOWN_CHAINS)
    .filter(([, c]) => c.safe)
    .map(([id, c]) => [c.safe as string, Number(id)]),
);

/**
 * A Safe from what was pasted, or null when it names none. `chainId` is the
 * chain for a bare address; a prefixed one (`gno:0x…`) says its own.
 */
export function parseSafe(input: unknown, chainId: number = DEFAULT_SAFE_CHAIN): PayInSafe | null {
  let raw = String(input ?? '').trim();
  if (!raw) return null;
  // A Safe{Wallet} link: the `safe=` parameter carries `prefix:address`.
  const param = /[?&]safe=([^&#\s]+)/.exec(raw);
  if (param) {
    try {
      raw = decodeURIComponent(param[1]);
    } catch {
      raw = param[1];
    }
  }
  const prefixed = /^([a-z0-9]+):(0x[0-9a-fA-F]{40})$/i.exec(raw);
  if (prefixed) {
    const id = BY_PREFIX[prefixed[1].toLowerCase()];
    return id ? { chainId: id, address: prefixed[2].toLowerCase() } : null;
  }
  if (!ADDRESS.test(raw)) return null;
  const id = Number(chainId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { chainId: id, address: raw.toLowerCase() };
}

const LIGHTNING_ADDRESS = /^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const LNURL = /^lnurl1[02-9ac-hj-np-z]{20,}$/;

/** A Lightning address or LNURL from what was pasted, or null. */
export function parseLightning(input: unknown): string | null {
  const raw = String(input ?? '')
    .trim()
    .replace(/^lightning:/i, '')
    .toLowerCase();
  if (!raw || raw.length > 400) return null;
  return LIGHTNING_ADDRESS.test(raw) || LNURL.test(raw) ? raw : null;
}

/** A pot's pay-in doors, as stored. Anything malformed reads as unset. */
export function readPayIn(settings: unknown): PayIn {
  const doc = (settings ?? {}) as Record<string, unknown>;
  const entry = (doc[PAY_IN_KEY] ?? {}) as Record<string, unknown>;
  const safe = entry.safe as Record<string, unknown> | undefined;
  return {
    safe: safe ? parseSafe(safe.address, Number(safe.chainId)) : null,
    lightning: parseLightning(entry.lightning),
  };
}

/**
 * Point a pot's doors at a Safe and/or a Lightning address. Only the fields
 * given change; `null` removes one. Merged into the settings document like
 * every other settings write, so nothing else on it is lost.
 */
export async function savePayIn(
  holosphere: any,
  holonId: string,
  patch: { safe?: PayInSafe | null; lightning?: string | null },
): Promise<PayIn> {
  const holon = String(holonId ?? '');
  if (!holon) throw new Error('A holon is required');
  if (patch.safe && !parseSafe(patch.safe.address, patch.safe.chainId)) throw new Error('That is not a Safe address');
  if (patch.lightning && !parseLightning(patch.lightning)) throw new Error('That is not a Lightning address');

  let existing: any = null;
  try {
    existing = await holosphere.get(holon, 'settings', holon);
  } catch {
    // A failed read must not cost the admin their edit.
  }
  const before = readPayIn(existing);
  const next: PayIn = {
    safe: patch.safe === undefined ? before.safe : patch.safe ? parseSafe(patch.safe.address, patch.safe.chainId) : null,
    lightning: patch.lightning === undefined ? before.lightning : patch.lightning ? parseLightning(patch.lightning) : null,
  };
  await holosphere.put(holon, 'settings', {
    ...(existing ?? {}),
    id: holon,
    [PAY_IN_KEY]: {
      ...(next.safe ? { safe: next.safe } : {}),
      ...(next.lightning ? { lightning: next.lightning } : {}),
    },
  });
  return next;
}

/** How a wallet is asked to pay a Lightning address or LNURL. */
export function lightningUri(lightning: string): string {
  return `lightning:${lightning}`;
}

/** Where a Safe is opened, and the name of its chain. */
export function describeSafe(safe: PayInSafe): { chain: string; app: string | null } {
  return {
    chain: describeChain(safe.chainId)?.name ?? `Chain ${safe.chainId}`,
    app: safeAppUrl(safe.chainId, safe.address),
  };
}

/** Chains a Safe can be named on, for a picker: mainnets first. */
export function safeChains(): Array<{ chainId: number; name: string }> {
  return Object.entries(KNOWN_CHAINS)
    .filter(([, c]) => c.safe)
    .sort(([, a], [, b]) => Number(a.testnet) - Number(b.testnet))
    .map(([id, c]) => ({ chainId: Number(id), name: c.name }));
}
