// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bot's purpose is the DNA's purpose gene (@holons/core/dna): Settings
// shows it from the gene, never from the old settings field, and editing it
// is a link to the kiosk DNA editor — the same one /dna links to.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bytesToHex } from 'nostr-tools/utils';
import { generateSecretKey } from 'nostr-tools/pure';
import { createHoloSphere } from '@holons/core/holosphere';
import { putGene } from '@holons/core/dna';
import Settings, { dnaEditUrl } from '../src/Settings.ts';

const T = '-1001112223334';

function hs() {
  const h = createHoloSphere({
    appName: 'settings-purpose-test',
    privateKey: bytesToHex(generateSecretKey()),
    store: { adapter: 'memory' },
  });
  h.publishNostrEvents = () => {};
  h.subscribeNostr = () => () => {};
  return h;
}

const self = db => ({
  db,
  getPurpose: Settings.prototype.getPurpose,
  getLanguage: async () => 'en',
});

describe('the purpose in the bot', () => {
  it('is the purpose gene, whatever the old settings field says', async () => {
    const db = hs();
    await db.put(T, 'settings', {
      id: T,
      name: 'Orto',
      purpose: 'stale words',
    });
    const s = self(db);
    expect(await Settings.prototype.getPurpose.call(s, T)).toBe('');
    await putGene(db, T, {
      kind: 'purpose',
      title: 'Purpose',
      blurb: 'Tend the grove.',
    });
    expect(await Settings.prototype.getPurpose.call(s, T)).toBe(
      'Tend the grove.'
    );
  });

  it('/setpurpose shows the gene and links to the DNA editor, writing nothing', async () => {
    const db = hs();
    await putGene(db, T, {
      kind: 'purpose',
      title: 'Purpose',
      blurb: 'Tend the grove.',
    });
    const put = vi.spyOn(db, 'put');
    const ctx = {
      message: { chat: { id: T }, text: '/setpurpose something new' },
      reply: vi.fn(async () => ({})),
    };
    await Settings.prototype.setPurpose.call(self(db), ctx);
    expect(put).not.toHaveBeenCalled();
    const [text, extra] = ctx.reply.mock.calls[0];
    expect(text).toContain('Tend the grove.');
    expect(extra.reply_markup.inline_keyboard[0][0].url).toBe(
      `https://hubs.network/${encodeURIComponent(T)}/dna?edit`
    );
    expect(dnaEditUrl(T)).toBe(extra.reply_markup.inline_keyboard[0][0].url);
  });

  it('no longer reads or writes settings.purpose anywhere in Settings', () => {
    const src = readFileSync(
      new URL('../src/Settings.ts', import.meta.url),
      'utf8'
    );
    expect(src).not.toMatch(/settings\.purpose\b/);
    expect(src).not.toMatch(/purpose:\s*''/);
  });
});
