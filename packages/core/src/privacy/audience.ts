// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy verbs every surface calls. A scope — a lens, or one card of it
// — is locked or unlocked, and shared with holons or not. Who reads is an
// audience of HOLONS kept on the scope's vault (the owner holon always in
// it, so its members read without being a special case); this module turns
// that audience into the pubkeys the holosphere hands keys to, and keeps the
// two in step. No key crosses this API in either direction.

import type { HoloSphere } from 'holosphere';
import { holonReaders } from './readers.js';
import { assertPrivatizable, audienceTag, holonOfTag, holonsOf, isPubkeyHolonId, normScope } from './scope.js';
import type { Audience, AudienceEntry, AudienceTag, LockedScopes, Scope, SyncReport } from './types.js';

type PrivacyHost = HoloSphere & {
  isAppendLens?: (lens: string) => boolean;
  store?: { wire?: { isStandardPrimary?: (lens: string) => boolean } };
};

function privacyOf(hs: HoloSphere): HoloSphere['privacy'] {
  const p = (hs as PrivacyHost).privacy;
  if (!p) throw new Error('privacy: this holosphere instance has no privacy layer');
  return p;
}

function ctxOf(hs: HoloSphere) {
  const h = hs as PrivacyHost;
  return {
    isAppend: (lens: string) => !!h.isAppendLens?.(lens),
    isStandardPrimary: (lens: string) => !!h.store?.wire?.isStandardPrimary?.(lens),
  };
}

/** Load the holon's vault records (own and others') so the flags are current. */
async function loadVaults(hs: HoloSphere, holon: string): Promise<void> {
  try { await hs.getAll(holon, '_vault', null, { includeLocked: true }); } catch { /* offline: the store decides */ }
}

/** The private scopes of a holon, by lens — readable by anyone, keys or not. */
export async function privacyOfHolon(hs: HoloSphere, holonId: string): Promise<LockedScopes> {
  const holon = String(holonId ?? '').trim();
  if (!holon) return {};
  await loadVaults(hs, holon);
  return privacyOf(hs).lockedScopes(holon) as LockedScopes;
}

/** Is the scope private right now? Loads the vaults first. */
export async function isLocked(hs: HoloSphere, scope: Scope): Promise<boolean> {
  const s = normScope(scope);
  await loadVaults(hs, s.holon);
  return privacyOf(hs).isPrivate(s.holon, s.lens, s.item ?? null);
}

/**
 * Make a scope private. A card can be locked on its own only while its
 * lens is public; locking the lens covers every card. The owner holon is
 * the first entry of the audience, and its readers get the key at once.
 */
export async function lock(hs: HoloSphere, scope: Scope): Promise<Audience> {
  const s = normScope(scope);
  assertPrivatizable(s.lens, ctxOf(hs));
  const p = privacyOf(hs);
  await p.ensureKeys(s.holon, s.lens);
  if (s.item && p.isPrivate(s.holon, s.lens)) {
    throw new Error(`privacy: ${s.lens} of ${s.holon} is locked as a whole — the card follows the lens`);
  }
  await p.lock(s, { audience: [audienceTag(s.holon)] });
  await syncScope(hs, s);
  return audience(hs, s);
}

/** Make a scope public again: its items go out in the clear, its vault is tombstoned. */
export async function unlock(hs: HoloSphere, scope: Scope): Promise<Audience> {
  const s = normScope(scope);
  await privacyOf(hs).unlock(s);
  return audience(hs, s);
}

/** Let a holon read the scope: its readers get the key. */
export async function share(hs: HoloSphere, scope: Scope, withHolon: string): Promise<Audience> {
  const s = normScope(scope);
  const tag = audienceTag(withHolon);
  if (tag[1] === s.holon || tag[1] === s.holon.toLowerCase()) {
    throw new Error('privacy: a holon always reads its own private scopes');
  }
  const p = privacyOf(hs);
  const current = await p.audienceGet(s);
  if (!current) throw new Error(`privacy: ${s.lens}${s.item ? `/${s.item}` : ''} of ${s.holon} is not a private scope you own — lock it first`);
  if (!holonsOf(current).includes(tag[1])) await p.audienceSet(s, [...current, tag]);
  await syncScope(hs, s);
  return audience(hs, s);
}

/** Stop a holon from reading the scope: the key rotates, the rest are re-handed it. */
export async function unshare(hs: HoloSphere, scope: Scope, withHolon: string): Promise<Audience> {
  const s = normScope(scope);
  const tag = audienceTag(withHolon);
  if (tag[1] === s.holon || tag[1] === s.holon.toLowerCase()) {
    throw new Error('privacy: a holon cannot be removed from its own audience');
  }
  const p = privacyOf(hs);
  const current = await p.audienceGet(s);
  if (!current) throw new Error(`privacy: ${s.lens}${s.item ? `/${s.item}` : ''} of ${s.holon} is not a private scope you own`);
  const next = current.filter((t) => holonOfTag(t) !== tag[1]);
  if (next.length !== current.length) await p.audienceSet(s, next);
  await syncScope(hs, s);
  return audience(hs, s);
}

/** Readers per holon of an audience, resolved once each. */
async function readersByHolon(hs: HoloSphere, holons: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const h of holons) out.set(h, (await holonReaders(hs, h)).keys);
  return out;
}

/**
 * Bring the keys a scope handed out in line with its audience: readers no
 * longer in any listed holon lose the key (one rotation), readers that do
 * not hold the current key get it. A scope this identity does not own is
 * left alone.
 */
export async function syncScope(hs: HoloSphere, scope: Scope): Promise<SyncReport> {
  const s = normScope(scope);
  const p = privacyOf(hs);
  const list = await p.audienceGet(s);
  if (!list) return { granted: [], revoked: [], pending: [] };
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  const readers = await readersByHolon(hs, holonsOf(list));
  const desired = new Set<string>();
  for (const keys of readers.values()) for (const k of keys) if (k !== me) desired.add(k);
  const sent = (await p.sentGet(s)) ?? {};
  const gone = Object.keys(sent).filter((k) => !desired.has(k));
  let kid: string | null = null;
  if (gone.length) kid = (await p.revoke(s, gone)).kid;
  const after = (await p.sentGet(s)) ?? {};
  const missing = [...desired].filter((k) => !after[k] || (kid && after[k] !== kid));
  const r = missing.length ? await p.grant(s, missing) : { sent: [], failed: [] };
  return { granted: r.sent, revoked: gone, pending: r.failed };
}

/** Every private scope of a holon this identity owns, synced. The membership hook. */
export async function sync(hs: HoloSphere, holonId: string): Promise<Record<string, SyncReport>> {
  const holon = String(holonId ?? '').trim();
  const out: Record<string, SyncReport> = {};
  if (!holon) return out;
  const p = privacyOf(hs);
  const locked = await privacyOfHolon(hs, holon);
  for (const lens of Object.keys(locked)) await p.ensureKeys(holon, lens);
  for (const s of p.ownedScopes(holon)) {
    try {
      out[s.item ? `${s.lens}/${s.item}` : s.lens] = await syncScope(hs, s);
    } catch (err) {
      console.warn('[privacy] sync failed for', holon, s.lens, s.item ?? '', (err as Error)?.message);
    }
  }
  return out;
}

/** The audience of a scope as a surface shows it: holons, reader counts, status. Never a key. */
export async function audience(hs: HoloSphere, scope: Scope): Promise<Audience> {
  const s = normScope(scope);
  const p = privacyOf(hs);
  await loadVaults(hs, s.holon);
  await p.ensureKeys(s.holon, s.lens);
  const locked = p.isPrivate(s.holon, s.lens, s.item ?? null);
  const list = await p.audienceGet(s);
  if (!list) return { scope: s, locked, owned: false, canManage: locked && p.canManage(s), holons: [] };
  const sent = (await p.sentGet(s)) ?? {};
  const me = String(hs.currentPubkey ?? '').toLowerCase();
  const readers = await readersByHolon(hs, holonsOf(list));
  const holons: AudienceEntry[] = [];
  for (const tag of list as AudienceTag[]) {
    const holon = holonOfTag(tag);
    if (!holon) continue;
    const keys = readers.get(holon) ?? [];
    const others = keys.filter((k) => k !== me);
    const status = keys.length === 0 ? 'no-readers' : others.some((k) => !sent[k]) ? 'pending' : 'synced';
    holons.push({ holon, kind: isPubkeyHolonId(holon) ? 'personal' : 'group', self: holon === s.holon || holon === s.holon.toLowerCase(), readers: keys.length, status });
  }
  return { scope: s, locked, owned: true, canManage: true, holons };
}

/**
 * An admin takes a scope another key locked: it goes public under the
 * admin's tombstone and private again under the admin's own vault, with the
 * owner holon as its audience (the previous shares are the old owner's to
 * know; share again). Needs the key — a member of the holon holds it.
 */
export async function takeOver(hs: HoloSphere, scope: Scope): Promise<Audience> {
  const s = normScope(scope);
  const p = privacyOf(hs);
  await loadVaults(hs, s.holon);
  await p.ensureKeys(s.holon, s.lens);
  if (!p.owned(s)) await p.unlock(s);
  return lock(hs, s);
}
