// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

import { describe, expect, it, vi } from 'vitest';
import {
  enableRelayBackup,
  parseRelayBackupMode,
  parseRelayList,
} from './relayBackup.js';

const RELAYS = ['wss://relay.holons.io'];

function fakeSphere(impl?: () => Promise<unknown>) {
  const enableSigning = vi.fn(impl ?? (async () => undefined));
  return { sphere: { enableSigning }, enableSigning };
}

describe('parseRelayBackupMode', () => {
  it('accepts the two publishing modes, case-insensitively', () => {
    expect(parseRelayBackupMode('shadow')).toBe('shadow');
    expect(parseRelayBackupMode(' ENFORCE ')).toBe('enforce');
  });

  it('falls back to off for anything unrecognised', () => {
    // An unreadable setting must never silently turn read-gating on.
    for (const raw of [undefined, null, '', 'on', 'true', 'nostr', 'Enforce!']) {
      expect(parseRelayBackupMode(raw)).toBe('off');
    }
  });
});

describe('parseRelayList', () => {
  it('splits, trims and drops empties', () => {
    expect(parseRelayList(' wss://a , ,wss://b ')).toEqual(['wss://a', 'wss://b']);
  });

  it('returns an empty list for an unset value', () => {
    expect(parseRelayList(undefined)).toEqual([]);
    expect(parseRelayList('')).toEqual([]);
  });
});

describe('enableRelayBackup', () => {
  it('enables shadow publishing to the configured relays', async () => {
    const { sphere, enableSigning } = fakeSphere();

    await expect(
      enableRelayBackup(sphere, { relays: RELAYS, mode: 'shadow' }),
    ).resolves.toBe(true);

    expect(enableSigning).toHaveBeenCalledWith({
      relays: RELAYS,
      shadow: true,
      enforce: false,
    });
  });

  it('passes enforce through as a read-gating signer', async () => {
    const { sphere, enableSigning } = fakeSphere();

    await enableRelayBackup(sphere, { relays: RELAYS, mode: 'enforce' });

    expect(enableSigning).toHaveBeenCalledWith({
      relays: RELAYS,
      shadow: false,
      enforce: true,
    });
  });

  it('is off by default — backup is always opt-in', async () => {
    const { sphere, enableSigning } = fakeSphere();

    await expect(enableRelayBackup(sphere, { relays: RELAYS })).resolves.toBe(false);
    expect(enableSigning).not.toHaveBeenCalled();
  });

  it('does nothing without relays to publish to', async () => {
    const { sphere, enableSigning } = fakeSphere();

    await expect(
      enableRelayBackup(sphere, { relays: [], mode: 'shadow' }),
    ).resolves.toBe(false);
    expect(enableSigning).not.toHaveBeenCalled();
  });

  it('skips the nostr backend, where the transport already publishes', async () => {
    const { sphere, enableSigning } = fakeSphere();

    // A second signer here would duplicate every event on the relay.
    await expect(
      enableRelayBackup(sphere, { relays: RELAYS, mode: 'shadow', backend: 'nostr' }),
    ).resolves.toBe(false);
    expect(enableSigning).not.toHaveBeenCalled();
  });

  it('signs with an explicit key when the instance has none', async () => {
    const { sphere, enableSigning } = fakeSphere();

    await enableRelayBackup(sphere, {
      relays: RELAYS,
      mode: 'shadow',
      privateKey: 'ab'.repeat(32),
    });

    expect(enableSigning).toHaveBeenCalledWith({
      privateKey: 'ab'.repeat(32),
      relays: RELAYS,
      shadow: true,
      enforce: false,
    });
  });

  it('reports false on a build without signing support', async () => {
    await expect(
      enableRelayBackup({}, { relays: RELAYS, mode: 'shadow' }),
    ).resolves.toBe(false);
    await expect(
      enableRelayBackup(null, { relays: RELAYS, mode: 'shadow' }),
    ).resolves.toBe(false);
  });

  it('never throws — a dead relay must not take the UI down', async () => {
    const { sphere } = fakeSphere(async () => {
      throw new Error('relay unreachable');
    });
    const onError = vi.fn();

    await expect(
      enableRelayBackup(sphere, { relays: RELAYS, mode: 'shadow', onError }),
    ).resolves.toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
