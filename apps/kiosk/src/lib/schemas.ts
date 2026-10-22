// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Lens → its JSON Schema, mirroring the dashboard's map sidebar catalog
// (apps/web/src/lib/schemas.ts) so the two surfaces ask for the same fields.
// Two deliberate departures, where the kiosk writes a shape of its own:
// quests and events use core's schemas (`created` as an ISO string, the
// participants/appreciation arrays the board reads) rather than the
// Murmurations profiles the dashboard renders for them.
//
// Loaded on demand: these are ~150 KB of JSON altogether and only the lens
// someone is adding to is ever needed, so each is its own chunk.

import type { JsonSchema } from "./lensform";
import type { LensId } from "./maplens";

type SchemaModule = { default: unknown };

const LOADERS: Partial<Record<LensId, () => Promise<SchemaModule>>> = {
  quests: () => import("@holons/core/schemas/quests.json"),
  needs: () =>
    import("@holons/core/schemas/murmurations/offers_wants_prototype-v0.0.2.json"),
  offers: () =>
    import("@holons/core/schemas/murmurations/offers_wants_prototype-v0.0.2.json"),
  communities: () =>
    import("@holons/core/schemas/murmurations/communities_schema-v0.1.0.json"),
  organizations: () =>
    import("@holons/core/schemas/murmurations/organizations_schema-v1.0.0.json"),
  projects: () =>
    import("@holons/core/schemas/murmurations/projects_schema-v0.1.0.json"),
  currencies: () =>
    import("@holons/core/schemas/murmurations/complementary_currencies-v2.0.0.json"),
  people: () =>
    import("@holons/core/schemas/murmurations/person_schema-v0.2.0.json"),
  holons: () =>
    import("@holons/core/schemas/murmurations/holons_schema-v0.0.1.json"),
  events: () => import("@holons/core/schemas/events.json"),
  library: () => import("@holons/core/schemas/library.json"),
  roles: () => import("@holons/core/schemas/roles.json"),
  announcements: () => import("@holons/core/schemas/announcements.json"),
  expenses: () => import("@holons/core/schemas/expenses.json"),
  checklists: () => import("@holons/core/schemas/checklists.json"),
  canvases: () => import("@holons/core/schemas/canvases.json"),
};

/** Does this lens have a schema the add form can be built from? */
export function hasLensSchema(lens: LensId): boolean {
  return lens in LOADERS;
}

/**
 * The lens's schema, or null when it has none or the chunk fails to load —
 * the form falls back to asking for the headline alone rather than refusing
 * the add.
 */
export async function loadLensSchema(lens: LensId): Promise<JsonSchema | null> {
  const load = LOADERS[lens];
  if (!load) return null;
  try {
    const mod = await load();
    return (mod.default ?? mod ?? null) as JsonSchema | null;
  } catch (err) {
    console.error("[kiosk] map: could not load the schema for", lens, err);
    return null;
  }
}
