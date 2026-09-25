// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pure helpers over the public privacy hint on a settings record. The hint is
// what a surface without a key shows (a lock on the lens); the owner's vault
// decides what actually gets sealed.

import { NEVER_PRIVATE_LENSES, type PrivacyLensMode, type PrivacySettings } from './types.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/** The privacy hint of a settings record (empty when none). */
export function readPrivacy(settings: unknown): PrivacySettings {
  const raw = (settings as { privacy?: { lenses?: unknown } } | null | undefined)?.privacy?.lenses;
  const lenses: Record<string, PrivacyLensMode> = {};
  if (raw && typeof raw === 'object') {
    for (const [lens, mode] of Object.entries(raw as Record<string, unknown>)) {
      if (mode === 'private' || mode === 'public') lenses[lens] = mode;
    }
  }
  return { lenses };
}

/** The hinted mode of one lens ('public' when unhinted). */
export function lensPrivacy(settings: unknown, lens: string): PrivacyLensMode {
  return readPrivacy(settings).lenses[lens] ?? 'public';
}

/** A settings record with one lens's hint changed (new object; 'public' removes the entry). */
export function withLensPrivacy<T extends Record<string, unknown>>(settings: T, lens: string, mode: PrivacyLensMode): T & { privacy: PrivacySettings } {
  const { lenses } = readPrivacy(settings);
  const next = { ...lenses };
  if (mode === 'private') next[lens] = 'private';
  else delete next[lens];
  return { ...settings, privacy: { lenses: next } };
}

export interface PrivatizableContext {
  isAppend?: (lens: string) => boolean;
  isStandardPrimary?: (lens: string) => boolean;
}

/** Throws with the reason when a lens can never be private. */
export function assertPrivatizable(lens: string, ctx: PrivatizableContext = {}): void {
  const name = String(lens ?? '').trim();
  if (!name) throw new Error('privacy: a lens name is required');
  if (NEVER_PRIVATE_LENSES.includes(name)) throw new Error(`privacy: lens '${name}' cannot be private`);
  if (ctx.isAppend?.(name)) throw new Error(`privacy: lens '${name}' is an append-only log and cannot be private`);
  if (ctx.isStandardPrimary?.(name)) throw new Error(`privacy: lens '${name}' is carried on a standard Nostr kind and cannot be private`);
}

/** Is this a 64-hex Nostr pubkey (a personal holon id)? */
export function isPubkeyHolonId(id: unknown): id is string {
  return typeof id === 'string' && HEX64.test(id);
}
