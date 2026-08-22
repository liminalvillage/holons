// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Publishing writes to a Nostr relay as a BACKUP of the Gun graph.
//
// There are two ways a HoloSphere instance can reach a relay, and they are not
// interchangeable:
//
//   backend: 'nostr'  — the relay IS the wire. Gun runs peerless as a local
//                       cache, so the instance sees ONLY what is on the relay.
//                       Nothing living on gun.holons.io shows up. Full
//                       migration, not a backup.
//
//   backend: 'gun' + signing with relays  — Gun stays the wire (all existing
//                       data keeps working) and the signer doubles as a
//                       publisher, mirroring every write to the relay as a
//                       signed NIP-01 event. THIS is the backup arrangement,
//                       and it is what this module turns on.
//
// Each UI resolves its own env (the factory deliberately never reads
// `process.env`), then hands the resolved values here so the decision of
// "should this instance publish, and how" lives in one place.

/** How writes are mirrored: not at all, published, or published + read-gated. */
export type RelayBackupMode = 'off' | 'shadow' | 'enforce';

/** The signing surface this module needs. Not in holosphere.d.ts yet. */
interface SigningCapable {
  enableSigning?(opts: {
    privateKey?: Uint8Array | string;
    relays?: string[];
    shadow?: boolean;
    enforce?: boolean;
  }): Promise<unknown>;
}

export interface RelayBackupOptions {
  /** Relay URLs to mirror writes to. Empty disables the backup. */
  relays: string[];
  /** Defaults to `'off'` — relay backup is always opt-in. */
  mode?: RelayBackupMode;
  /**
   * Key to sign published events with. Defaults to the instance's own key —
   * pass it only for instances built without one (e.g. a v1-positional
   * constructor), where signing would otherwise have no identity.
   */
  privateKey?: Uint8Array | string | null;
  /**
   * The backend the instance was built with. `'nostr'` instances already
   * publish through the relay transport, so this is a no-op for them.
   */
  backend?: string;
  /** Notified when enabling fails. Defaults to `console.error`. */
  onError?: (err: unknown) => void;
}

/**
 * Read a backup mode from a raw env value. Anything unrecognised (including
 * `undefined`) is `'off'` — an unreadable setting must never silently turn
 * read-gating on.
 */
export function parseRelayBackupMode(raw: string | undefined | null): RelayBackupMode {
  const want = String(raw ?? '').trim().toLowerCase();
  return want === 'shadow' || want === 'enforce' ? want : 'off';
}

/** Split a comma-separated relay env value into a clean list. */
export function parseRelayList(raw: string | undefined | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

/**
 * Turn on relay backup for an instance, if it's wanted and possible.
 *
 * Returns whether publishing was actually enabled, so callers can log the
 * truth rather than an intention. Never throws: a bad key or an unreachable
 * relay must not take down the UI that asked for a backup.
 */
export async function enableRelayBackup(
  holosphere: unknown,
  { relays, mode = 'off', privateKey, backend, onError }: RelayBackupOptions,
): Promise<boolean> {
  if (mode === 'off') return false;
  if (!relays.length) return false;
  // The relay transport is already the single publisher on this backend;
  // enabling a signer here would bolt a duplicate publisher next to it.
  if (String(backend ?? '').toLowerCase() === 'nostr') return false;

  const hs = holosphere as SigningCapable | null;
  if (!hs || typeof hs.enableSigning !== 'function') return false;

  try {
    await hs.enableSigning({
      ...(privateKey ? { privateKey } : {}),
      relays,
      shadow: mode === 'shadow',
      enforce: mode === 'enforce',
    });
    return true;
  } catch (err) {
    (onError ?? ((e: unknown) => console.error('[relay-backup] could not enable', e)))(err);
    return false;
  }
}
