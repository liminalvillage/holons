// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// NIP-25 reactions for `appreciation[]`: one kind-7 `+` per appreciator,
// signed with THEIR key, on the record's projected address; withdrawing is a
// kind-7 `-` (NIP-25's "dislike" read as "take my thanks back" — stateless
// and symmetric, unlike a NIP-09 delete that would need the reaction id).
// Reactions are per-actor by construction, so they never clobber each other
// the way a shared `appreciation[]` array does under concurrent writes.

import type { Companion, NostrEventLike, ProjectionCtx, Reversed } from '../types.js';
import { commonTags, nowOf, parseProjectionAddress, parseProjectionDTag, projectionAddress, tagValue } from '../tags.js';

export const REACTION_KIND = 7;

type Person = { id?: string | number; username?: string } | string | number;

export function personId(p: Person): string | number | undefined {
  if (typeof p === 'string' || typeof p === 'number') return p;
  return p?.id ?? p?.username;
}

/** Kind-7 companions for every entry of `appreciation[]` (present = `+`). */
export function reactionCompanions(
  ctx: ProjectionCtx, holon: string, lens: string, id: string | number, primaryKind: number, dTag: string, appreciation: unknown,
): Companion[] {
  const list = Array.isArray(appreciation) ? appreciation : [];
  const address = projectionAddress(primaryKind, ctx.holonPubkey, dTag);
  const out: Companion[] = [];
  for (const p of list) {
    const uid = personId(p as Person);
    if (uid === undefined || uid === null) continue;
    out.push({
      template: {
        kind: REACTION_KIND,
        created_at: nowOf(ctx),
        tags: [['a', address], ['k', String(primaryKind)], ['p', ctx.holonPubkey], ...commonTags(ctx, holon, lens, id)],
        content: '+',
      },
      authorHint: { userId: uid },
      dedupe: { key: `reaction|${uid}|${dTag}`, state: '+' },
    });
  }
  return out;
}

/** A kind-7 on a Holons address → the signer gives (`+`/emoji) or withdraws (`-`) thanks. */
export function parseReaction(event: NostrEventLike, ctx: ProjectionCtx, lens: string): Reversed | null {
  if (event.kind !== REACTION_KIND) return null;
  const a = parseProjectionAddress(tagValue(event, 'a'));
  if (!a) return null;
  const addr = parseProjectionDTag(a.dTag);
  if (!addr || addr.lens !== lens) return null;
  const content = (event.content || '').trim();
  const status = content === '-' ? 'remove' : 'add';
  return {
    lens, holon: addr.holon, id: addr.id, kind: event.kind, pubkey: event.pubkey,
    createdAt: event.created_at, eventId: event.id,
    reaction: { pubkey: event.pubkey, userId: ctx.userIdFor?.(event.pubkey), status },
  };
}
