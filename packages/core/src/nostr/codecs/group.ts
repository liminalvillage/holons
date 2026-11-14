// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// `settings` ← NIP-29 group metadata (39000), reverse only.
// A settings write projects NOTHING: the group state (39000 metadata, 39001
// admins, 39002 members) is published whole by `@holons/core/holons`
// `publishGroupState` (wired on every settings and genes write by
// `attachGroupState`), because its `about` is the purpose gene — which a
// per-record projection cannot read — and a second publisher of the same
// replaceable event would put the description back.
// Reverse: a 39000 by a trusted key patches name / picture. Its `about` is
// derived (the purpose gene, else the description) and never folded back:
// a holon's purpose is written as its purpose gene, by its admins only.

import type { LensCodec, NostrEventLike, ProjectionCtx, Reversed } from '../types.js';
import { tagValue } from '../tags.js';
import { GROUP_METADATA_KIND, type GroupSettingsLike } from '../groups.js';

export interface SettingsRecord extends GroupSettingsLike {
  id?: string | number;
}

export const groupCodec: LensCodec<SettingsRecord> = {
  lens: 'settings',
  kinds: [GROUP_METADATA_KIND],
  primary: '30078',
  // The group state has one publisher, `publishGroupState` (see above).
  project() {
    return null;
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
    const picture = tagValue(event, 'picture');
    if (typeof picture === 'string' && /^https?:\/\//i.test(picture)) patch.picture = picture;
    return { lens: 'settings', holon, id: holon, kind: event.kind, pubkey: event.pubkey, createdAt: event.created_at, eventId: event.id, patch };
  },
  merge(current, r) {
    if (!r.patch) return null;
    const next: SettingsRecord = { ...current };
    let changed = false;
    for (const [k, v] of Object.entries(r.patch)) {
      if (v === undefined || (current as Record<string, unknown>)[k] === v) continue;
      (next as Record<string, unknown>)[k] = v;
      changed = true;
    }
    return changed ? next : null;
  },
};
