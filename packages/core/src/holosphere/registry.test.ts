// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
import { describe, it, expect, vi } from 'vitest';
import {
  HOLONS_REGISTRY_TABLE,
  buildRegistryEntry,
  registerHolon,
} from './registry.js';

describe('buildRegistryEntry', () => {
  it('returns null when the id is missing or blank', () => {
    expect(buildRegistryEntry({ id: '' })).toBeNull();
    expect(buildRegistryEntry({ id: '   ' })).toBeNull();
    expect(buildRegistryEntry({ id: null as unknown as string })).toBeNull();
  });

  it('coerces numeric ids to trimmed strings', () => {
    const entry = buildRegistryEntry({ id: -1001234567890, name: 'Group' });
    expect(entry?.id).toBe('-1001234567890');
  });

  it('falls back to a derived name when none is given', () => {
    expect(buildRegistryEntry({ id: '42' })?.name).toBe('Holon 42');
    expect(buildRegistryEntry({ id: '42', name: '  ' })?.name).toBe('Holon 42');
  });

  it('defaults purpose to empty string and type to community', () => {
    const entry = buildRegistryEntry({ id: '42', name: 'A' });
    expect(entry?.purpose).toBe('');
    expect(entry?.type).toBe('community');
  });

  it('promotes a legacy ms-epoch created to canonical ISO', () => {
    const ms = Date.UTC(2024, 0, 1, 0, 0, 0);
    expect(buildRegistryEntry({ id: '1', created: ms })?.created).toBe(
      '2024-01-01T00:00:00.000Z',
    );
  });

  it('passes an existing ISO created through unchanged', () => {
    const iso = '2025-06-08T12:00:00.000Z';
    expect(buildRegistryEntry({ id: '1', created: iso })?.created).toBe(iso);
  });
});

describe('registerHolon', () => {
  it('writes the normalised entry to the registry table and returns true', async () => {
    const writeGlobal = vi.fn().mockResolvedValue(undefined);
    const ok = await registerHolon({ writeGlobal }, {
      id: 99,
      name: 'My Holon',
      type: 'personal',
    });

    expect(ok).toBe(true);
    expect(writeGlobal).toHaveBeenCalledTimes(1);
    const [table, entry] = writeGlobal.mock.calls[0];
    expect(table).toBe(HOLONS_REGISTRY_TABLE);
    expect(entry).toMatchObject({ id: '99', name: 'My Holon', type: 'personal' });
  });

  it('returns false without writing when the id is unusable', async () => {
    const writeGlobal = vi.fn().mockResolvedValue(undefined);
    const ok = await registerHolon({ writeGlobal }, { id: '' });
    expect(ok).toBe(false);
    expect(writeGlobal).not.toHaveBeenCalled();
  });

  it('swallows write errors and returns false (never throws)', async () => {
    const writeGlobal = vi.fn().mockRejectedValue(new Error('relay down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(registerHolon({ writeGlobal }, { id: '7' })).resolves.toBe(false);
    warn.mockRestore();
  });
});
