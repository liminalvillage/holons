// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `roles` → NIP-58 badges. A role is a badge DEFINITION (30009, holon key,
// `d = holons:roles:<holon>:<id>`); its current holders receive one badge
// AWARD (kind 8, holon key, `p` per holder with a resolvable key). The award
// is re-issued only when the holder set changes (`dedupe`). Kind 30008
// (profile badges) is the USER's list of accepted badges — not emitted here:
// it is replaceable per pubkey and would clobber badges from elsewhere.
// One-way: awards are holon-authored, so nothing is folded back.

import type { Companion, EventTemplate, LensCodec, Projected, ProjectionCtx } from '../types.js';
import { commonTags, deletionTemplate, isUrl, nowOf, projectionAddress, projectionDTag, pushIf } from '../tags.js';
import { personId } from './reactions.js';

export const BADGE_DEFINITION_KIND = 30009;
export const BADGE_AWARD_KIND = 8;

export interface RoleRecord {
  id?: string | number;
  title?: string;
  description?: string;
  picture?: string | null;
  image?: string | null;
  participants?: Array<{ id?: string | number | null; username?: string } | string>;
  [key: string]: unknown;
}

function projectRole(holon: string, role: RoleRecord, ctx: ProjectionCtx): Projected | null {
  if (role.id === undefined || role.id === null) return null;
  const dTag = projectionDTag('roles', holon, role.id);
  const tags: string[][] = [['d', dTag]];
  pushIf(tags, 'name', role.title ?? String(role.id));
  pushIf(tags, 'description', role.description);
  const img = role.picture ?? role.image;
  if (isUrl(img)) tags.push(['image', img]);
  tags.push(...commonTags(ctx, holon, 'roles', role.id));
  const primary: EventTemplate = { kind: BADGE_DEFINITION_KIND, created_at: nowOf(ctx), tags, content: '' };

  const holders: string[] = [];
  for (const p of Array.isArray(role.participants) ? role.participants : []) {
    const uid = personId(p as never);
    if (uid === undefined || uid === null) continue;
    const pk = ctx.pubkeyFor?.(uid);
    if (pk && !holders.includes(pk)) holders.push(pk);
  }
  const companions: Companion[] = [];
  if (holders.length) {
    holders.sort();
    companions.push({
      template: {
        kind: BADGE_AWARD_KIND,
        created_at: nowOf(ctx),
        tags: [
          ['a', projectionAddress(BADGE_DEFINITION_KIND, ctx.holonPubkey, dTag)],
          ...holders.map((pk) => ['p', pk]),
          ...commonTags(ctx, holon, 'roles', role.id),
        ],
        content: '',
      },
      dedupe: { key: `award|${dTag}`, state: holders.join(',') },
    });
  }
  return { primary, companions };
}

export const badgeCodec: LensCodec<RoleRecord> = {
  lens: 'roles',
  kinds: [BADGE_DEFINITION_KIND, BADGE_AWARD_KIND],
  primary: '30078',
  project: (holon, role, ctx) => projectRole(holon, role, ctx),
  retract: (holon, id, ctx) => [deletionTemplate(ctx, [{ kind: BADGE_DEFINITION_KIND, dTag: projectionDTag('roles', holon, id) }])],
};
