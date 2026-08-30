// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `users` → kind 0 profile metadata. Kind 0 is replaceable per PUBKEY and has
// no `d` tag, so it must be signed by the user's own key — never the holon's
// (which would overwrite the holon's profile with every member). The host
// signs only when it can derive that user's key (`requiresAuthor: 'user'`).

import type { LensCodec, Projected } from '../types.js';
import { commonTags, isUrl, nowOf } from '../tags.js';

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

export const profileCodec: LensCodec<UserRecord> = {
  lens: 'users',
  kinds: [PROFILE_KIND],
  requiresAuthor: 'user',
  primary: '30078',
  project(holon, item, ctx): Projected | null {
    if (item.id === undefined || item.id === null) return null;
    const content = profileContent(item);
    if (!content.name) return null;
    return {
      primary: {
        kind: PROFILE_KIND,
        created_at: nowOf(ctx),
        tags: commonTags(ctx, holon, 'users', item.id),
        content: JSON.stringify(content),
      },
    };
  },
  // A profile is never retracted — it belongs to the person, not the holon.
  retract() {
    return [];
  },
};
