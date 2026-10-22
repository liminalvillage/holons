// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `settings` → NIP-29 group metadata (39000) + admins (39001), holon-signed.
// The members list (39002) needs the whole `users` lens, so hosts publish it
// from `buildGroupState` (see groups.ts) rather than per record.
// Reverse: a 39000 by a trusted key patches name / purpose / picture.

import type { LensCodec, NostrEventLike, ProjectionCtx, Reversed } from '../types.js';
import { tagValue } from '../tags.js';
import { GROUP_ADMINS_KIND, GROUP_METADATA_KIND, groupAdminsTemplate, groupMetadataTemplate, type GroupSettingsLike } from '../groups.js';

export interface SettingsRecord extends GroupSettingsLike {
  id?: string | number;
}

/** The settings doc is keyed by the holon id; other records on the lens are not the holon. */
function isHolonSettings(holon: string, item: SettingsRecord): boolean {
  return item.id !== undefined && item.id !== null && String(item.id) === holon;
}

export const groupCodec: LensCodec<SettingsRecord> = {
  lens: 'settings',
  kinds: [GROUP_METADATA_KIND, GROUP_ADMINS_KIND],
  primary: '30078',
  project(holon, item, ctx) {
    if (!isHolonSettings(holon, item)) return null;
    return {
      primary: groupMetadataTemplate(ctx, holon, item),
      companions: [{ template: groupAdminsTemplate(ctx, holon, item) }],
    };
  },
  // A group is not retracted when its settings doc is; membership outlives metadata.
  retract() {
    return [];
  },
  parse(event: NostrEventLike, _ctx: ProjectionCtx): Reversed<SettingsRecord> | null {
    if (event.kind !== GROUP_METADATA_KIND) return null;
    const holon = tagValue(event, 'd');
    if (!holon) return null;
    const patch: Partial<SettingsRecord> = {};
    const name = tagValue(event, 'name');
    if (typeof name === 'string' && name.trim()) patch.name = name;
    const about = tagValue(event, 'about');
    if (typeof about === 'string' && about.trim()) patch.purpose = about;
    const picture = tagValue(event, 'picture');
    if (typeof picture === 'string' && /^https?:\/\//i.test(picture)) patch.picture = picture;
    return { lens: 'settings', holon, id: holon, kind: event.kind, pubkey: event.pubkey, createdAt: event.created_at, eventId: event.id, patch };
  },
  merge(current, r) {
    if (!r.patch) return null;
    const next: SettingsRecord = { ...current };
    let changed = false;
    for (const [k, v] of Object.entries(r.patch)) {
      if (v === undefined) continue;
      if (k === 'purpose' && Array.isArray(current.purpose)) {
        if (current.purpose.join('\n') === v) continue;
        next.purpose = String(v).split('\n');
      } else if ((current as Record<string, unknown>)[k] === v) continue;
      else (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
    return changed ? next : null;
  },
};
