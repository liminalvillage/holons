// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure helpers over scopes and audience entries.

import type { AudienceTag, Scope } from './types.js';
import { NEVER_PRIVATE_LENSES } from './types.js';

const HEX64 = /^[0-9a-f]{64}$/i;

/** Is this a 64-hex Nostr pubkey (a personal holon id)? */
export function isPubkeyHolonId(id: unknown): id is string {
  return typeof id === 'string' && HEX64.test(id);
}

/** A scope with trimmed strings; throws when it has no holon or lens. */
export function normScope(scope: Partial<Scope> | null | undefined): Scope {
  const holon = String(scope?.holon ?? '').trim();
  const lens = String(scope?.lens ?? '').trim();
  if (!holon || !lens) throw new Error('privacy: a scope needs a holon and a lens');
  const item = scope?.item != null && String(scope.item).trim() !== '' ? String(scope.item).trim() : undefined;
  return item ? { holon, lens, item } : { holon, lens };
}

/** The audience entry naming a holon: `p` for a personal holon, `group` otherwise. */
export function audienceTag(holonId: string): AudienceTag {
  const id = String(holonId ?? '').trim();
  if (!id) throw new Error('privacy: a holon id is required');
  return isPubkeyHolonId(id) ? ['p', id.toLowerCase()] : ['group', id];
}

/** The holon an audience entry names, or null for an entry this version does not read. */
export function holonOfTag(tag: unknown): string | null {
  if (!Array.isArray(tag) || tag.length < 2) return null;
  const [kind, value] = tag as [unknown, unknown];
  if (typeof value !== 'string' || !value) return null;
  if (kind === 'p') return isPubkeyHolonId(value) ? value.toLowerCase() : null;
  if (kind === 'group') return value;
  return null;
}

/** The holons an audience lists, in order, deduplicated. */
export function holonsOf(audience: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const tag of audience ?? []) {
    const h = holonOfTag(tag);
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
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
