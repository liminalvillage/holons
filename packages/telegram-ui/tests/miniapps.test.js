// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { miniApps, miniAppUrl, miniAppButton } from '../src/MiniApps.ts';

describe('miniApps', () => {
  it('lists the registered services from MINI_APPS', () => {
    expect([...miniApps({ MINI_APPS: ' Tasks, calendar ,' })]).toEqual([
      'tasks',
      'calendar',
    ]);
    expect(miniApps({}).size).toBe(0);
  });
});

describe('miniAppUrl', () => {
  const env = { MINI_APPS: 'tasks' };

  it('opens a registered service on the holon', () => {
    expect(miniAppUrl('HolonsBot', 'tasks', -1001234567890, env)).toBe(
      'https://t.me/HolonsBot/tasks?startapp=-1001234567890'
    );
    expect(
      miniAppUrl('HolonsBot', 'tasks', 'holon_fig33pftaepw96i4', env)
    ).toBe('https://t.me/HolonsBot/tasks?startapp=holon_fig33pftaepw96i4');
  });

  it('is null for an unregistered service, no bot, or an unsendable holon', () => {
    expect(miniAppUrl('HolonsBot', 'calendar', -100123, env)).toBeNull();
    expect(miniAppUrl(undefined, 'tasks', -100123, env)).toBeNull();
    expect(miniAppUrl('HolonsBot', 'tasks', '<id>/settings', env)).toBeNull();
  });
});

describe('miniAppButton', () => {
  const ctx = { botInfo: { username: 'HolonsBot' } };

  it('opens the service when registered, else is null', () => {
    process.env.MINI_APPS = 'library';
    try {
      const btn = miniAppButton(ctx, 'library', -100123, 'en');
      expect(btn.url).toBe('https://t.me/HolonsBot/library?startapp=-100123');
      expect(btn.text.startsWith('✅ ')).toBe(true);
      expect(miniAppButton(ctx, 'roles', -100123, 'en')).toBeNull();
    } finally {
      delete process.env.MINI_APPS;
    }
  });
});
