// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Registry of lens → codec, plus the adapter that turns codecs into the
// generic hooks `holosphere/projections.js` consumes.

import type { LensCodec, ProjectionCtx, ProjectionHook } from './types.js';
import { calendarCodec } from './codecs/calendar.js';
import { classifiedCodec } from './codecs/classified.js';
import { profileCodec } from './codecs/profile.js';
import { setCodec } from './codecs/sets.js';

/** All lenses that have a standard-kind projection. */
export const PROJECTION_CODECS: Readonly<Record<string, LensCodec<any>>> = {
  quests: calendarCodec('quests'),
  events: calendarCodec('events'),
  offers: classifiedCodec,
  users: profileCodec,
  checklists: setCodec('checklists'),
  shopping: setCodec('shopping'),
  library: setCodec('library'),
};

export const PROJECTABLE_LENSES: readonly string[] = Object.keys(PROJECTION_CODECS);

/**
 * Parse `HOLOSPHERE_PROJECTIONS`: `off`/empty → none, `all` → every lens,
 * otherwise a comma-separated list (unknown names are dropped).
 */
export function parseProjectionList(raw: string | undefined | null): string[] {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v || v === 'off' || v === 'false' || v === '0' || v === 'none') return [];
  if (v === 'all' || v === 'true' || v === '1') return [...PROJECTABLE_LENSES];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && PROJECTABLE_LENSES.includes(s));
}

/** Codec hooks for `lenses`, bound to a context. */
export function buildProjections(lenses: readonly string[], ctx: ProjectionCtx): ProjectionHook[] {
  const hooks: ProjectionHook[] = [];
  for (const lens of lenses) {
    const codec = PROJECTION_CODECS[lens];
    if (!codec) continue;
    hooks.push({
      lens,
      kinds: codec.kinds,
      requiresAuthor: codec.requiresAuthor,
      project: (holon, _lens, item) => codec.project(holon, item as never, ctx),
      retract: (holon, _lens, id) => codec.retract(holon, id, ctx),
    });
  }
  return hooks;
}
