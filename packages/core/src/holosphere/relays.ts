// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The relay set every Holons surface talks to. The relays are the wire: a
// HoloSphere instance publishes every write to them as a signed Nostr event
// and rebuilds its local store from them. Each UI resolves its own env (the
// factory deliberately never reads `process.env`), then hands the raw value
// here so the parsing and the production default live in one place.

/** Production relays — the default when an app configures none. */
export const DEFAULT_RELAYS: readonly string[] = Object.freeze([
  'wss://relay.holons.io',
  'wss://relay.commonshub.dev',
]);

/** Split a comma-separated relay env value into a clean list. */
export function parseRelayList(raw: string | undefined | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * The relays an app should use: the configured list, or the production
 * default when the value is unset or empty.
 */
export function resolveRelays(raw: string | undefined | null | string[]): string[] {
  const list = Array.isArray(raw) ? raw.map((r) => String(r).trim()).filter(Boolean) : parseRelayList(raw);
  return list.length ? list : [...DEFAULT_RELAYS];
}

/**
 * Whether reads are enforced (`HOLOSPHERE_ENFORCE` / `VITE_HOLOSPHERE_ENFORCE`):
 * on unless the value says `off`, `false`, `0` or `no`. The kill switch for
 * a deployment that must read the open graph while a holon's authority is
 * still being founded.
 */
export function resolveEnforce(raw: string | boolean | undefined | null): boolean {
  if (typeof raw === 'boolean') return raw;
  return !['off', 'false', '0', 'no'].includes(String(raw ?? '').trim().toLowerCase());
}
