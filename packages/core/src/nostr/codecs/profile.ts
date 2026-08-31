// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `users` → kind 0 profile metadata. Kind 0 is replaceable per PUBKEY and has
// no `d` tag, so it must be signed by the user's own key — never the holon's
// (which would overwrite the holon's profile with every member). The host
// signs only when it can derive that user's key (`requiresAuthor: 'user'`).

import type { Companion, LensCodec, NostrEventLike, Projected, ProjectionCtx, Reversed } from '../types.js';
import { commonTags, isUrl, nowOf } from '../tags.js';
import {
  GROUP_JOIN_REQUEST_KIND, GROUP_PUT_USER_KIND, GROUP_REMOVE_USER_KIND,
  groupJoinRequestTemplate, groupPutUserTemplate, groupRemoveUserTemplate,
} from '../groups.js';
import { IDENTITY_ATTESTATION_KIND, buildAttestationTemplate, telegramIdentifier } from '../../shifts/attestation.js';

export const PROFILE_KIND = 0;

export interface UserRecord {
  id?: string | number;
  username?: string | number;
  first_name?: string;
  last_name?: string;
  about?: string;
  bio?: string;
  picture?: string;
  photo_url?: string;
  [key: string]: unknown;
}

/** Only public-facing fields ever leave the record (never values/needs/participated). */
export function profileContent(user: UserRecord): Record<string, string> {
  const out: Record<string, string> = {};
  const display = [user.first_name, user.last_name].filter((s) => typeof s === 'string' && s.trim()).join(' ').trim();
  if (user.username !== undefined && user.username !== null && String(user.username).trim()) out.name = String(user.username);
  if (display) out.display_name = display;
  if (!out.name && display) out.name = display;
  const about = user.about ?? user.bio;
  if (typeof about === 'string' && about.trim()) out.about = about;
  const pic = user.picture ?? user.photo_url;
  if (isUrl(pic)) out.picture = pic;
  return out;
}

/** Telegram ids are numeric; only those may carry a `telegram:` identity. */
const isTelegramId = (id: string | number) => /^\d+$/.test(String(id));

/**
 * Kind-31926 identity attestation (Elinor's Telegram↔npub directory), signed
 * by the service-level identity provider. Replaceable per (provider, d):
 * the `p` list must always be the member's COMPLETE current key set — a key
 * omitted here is thereby UNLINKED. Today that set is the one derived key;
 * a future multi-key linker must extend this list, never fork the event.
 */
function attestationCompanion(
  ctx: ProjectionCtx, id: string | number, content: Record<string, string>,
): Companion[] {
  if (!ctx.providerPubkey || !isTelegramId(id)) return [];
  const pk = ctx.pubkeyFor?.(id);
  if (!pk) return [];
  const name = content.display_name ?? content.name;
  return [{
    template: buildAttestationTemplate({ telegramId: id, pubkeys: [pk], name, now: nowOf(ctx) }),
    authorHint: { role: 'provider' },
    dedupe: { key: `attest|${telegramIdentifier(id)}`, state: `${pk}|${name ?? ''}` },
  }];
}

/** NIP-29 membership companions: the holon admits the member (9000), the member asks to join (9021). */
function membershipCompanions(ctx: ProjectionCtx, holon: string, id: string | number): Companion[] {
  const pk = ctx.pubkeyFor?.(id);
  if (!pk) return [];
  return [
    { template: groupPutUserTemplate(ctx, holon, pk), dedupe: { key: `member|${holon}|${pk}`, state: 'in' } },
    { template: groupJoinRequestTemplate(ctx, holon), authorHint: { userId: id }, dedupe: { key: `join|${holon}|${pk}`, state: 'in' } },
  ];
}

export const profileCodec: LensCodec<UserRecord> = {
  lens: 'users',
  kinds: [PROFILE_KIND, GROUP_PUT_USER_KIND, GROUP_REMOVE_USER_KIND, GROUP_JOIN_REQUEST_KIND, IDENTITY_ATTESTATION_KIND],
  requiresAuthor: 'user',
  primary: '30078',
  project(holon, item, ctx): Projected | null {
    if (item.id === undefined || item.id === null) return null;
    const content = profileContent(item);
    if (!content.name) return null;
    const tags = commonTags(ctx, holon, 'users', item.id);
    // NIP-39 external-identity claim. No proof element: Elinor verifies the
    // link interactively (one-tap confirm with that Telegram member).
    if (isTelegramId(item.id)) tags.push(['i', telegramIdentifier(item.id)]);
    return {
      primary: {
        kind: PROFILE_KIND,
        created_at: nowOf(ctx),
        tags,
        content: JSON.stringify(content),
      },
      companions: [
        ...membershipCompanions(ctx, holon, item.id),
        ...attestationCompanion(ctx, item.id, content),
      ],
    };
  },
  // A profile is never retracted — it belongs to the person, not the holon;
  // leaving the holon is a NIP-29 remove-user by the holon key.
  retract(holon, id, ctx) {
    const pk = ctx.pubkeyFor?.(id);
    return pk ? [groupRemoveUserTemplate(ctx, holon, pk)] : [];
  },
  /**
   * Kind 0 has no `d` and no holon: the record is whoever `userIdFor(pubkey)`
   * says, in every holon that has a `users` record for them (the host fans
   * out). `holon` is left empty here; `ownerOnly` makes the host check that
   * the signer IS that user.
   */
  parse(event: NostrEventLike, ctx: ProjectionCtx): Reversed<UserRecord> | null {
    if (event.kind !== PROFILE_KIND) return null;
    const uid = ctx.userIdFor?.(event.pubkey);
    if (uid === undefined || uid === null) return null;
    let meta: Record<string, unknown>;
    try { meta = JSON.parse(event.content || '{}'); } catch { return null; }
    if (!meta || typeof meta !== 'object') return null;
    const patch: Partial<UserRecord> = {};
    const display = typeof meta.display_name === 'string' && meta.display_name.trim() ? meta.display_name.trim() : undefined;
    const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : undefined;
    if (display) patch.first_name = display;
    else if (name) patch.first_name = name;
    if (name && name !== display) patch.username = name;
    if (typeof meta.about === 'string') patch.about = meta.about;
    if (isUrl(meta.picture)) patch.picture = meta.picture;
    return {
      lens: 'users', holon: '', id: String(uid), kind: PROFILE_KIND, pubkey: event.pubkey,
      createdAt: event.created_at, eventId: event.id, patch, ownerOnly: true,
    };
  },
  /** `first_name` absorbs a display name that may contain the last name; last_name is then cleared. */
  merge(current, r): UserRecord | null {
    if (!r.patch) return null;
    const next: UserRecord = { ...current };
    let changed = false;
    for (const [k, v] of Object.entries(r.patch)) {
      if (v === undefined || (current as Record<string, unknown>)[k] === v) continue;
      (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
    if (changed && r.patch.first_name !== undefined && typeof current.last_name === 'string' && current.last_name
      && r.patch.first_name !== current.first_name) {
      const full = `${current.first_name ?? ''} ${current.last_name}`.trim();
      if (r.patch.first_name !== full) next.last_name = '';
      else next.first_name = current.first_name; // display_name was our own composite — no change
    }
    return changed && Object.keys(next).some((k) => (next as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k]) ? next : null;
  },
};
