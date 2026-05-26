// Schemas wired into the map / sidebar / federation forms.
// Murmurations schemas live under @holons/core/schemas/murmurations/ — they
// drive the federation-facing lenses (Tasks, Needs, Offers, etc.). Core
// schemas live one level up and back the additional per-holon lenses
// (events, library, expenses, …) that the map exposes.
import communities from '@holons/core/schemas/murmurations/communities_schema-v0.1.0.json';
import currencies from '@holons/core/schemas/murmurations/complementary_currencies-v2.0.0.json';
import holons from '@holons/core/schemas/murmurations/holons_schema-v0.0.1.json';
import offersWantsProto from '@holons/core/schemas/murmurations/offers_wants_prototype-v0.0.2.json';
import offersWants from '@holons/core/schemas/murmurations/offers_wants_schema-v0.0.2.json';
import organizations from '@holons/core/schemas/murmurations/organizations_schema-v1.0.0.json';
import personV2 from '@holons/core/schemas/murmurations/person_schema-v0.2.0.json';
import projects from '@holons/core/schemas/murmurations/projects_schema-v0.1.0.json';
import quests from '@holons/core/schemas/murmurations/quests_schema_v0.0.1.json';

import events from '@holons/core/schemas/events.json';
import library from '@holons/core/schemas/library.json';
import roles from '@holons/core/schemas/roles.json';
import announcements from '@holons/core/schemas/announcements.json';
import expenses from '@holons/core/schemas/expenses.json';
import checklists from '@holons/core/schemas/checklists.json';
import appreciations from '@holons/core/schemas/appreciations.json';
import reaEvents from '@holons/core/schemas/rea_events.json';
import canvases from '@holons/core/schemas/canvases.json';

export const schemas = {
    'communities_schema-v0.1.0': communities,
    'complementary_currencies-v2.0.0': currencies,
    'holons_schema-v0.0.1': holons,
    'offers_wants_prototype-v0.0.2': offersWantsProto,
    'offers_wants_schema-v0.0.2': offersWants,
    'organizations_schema-v1.0.0': organizations,
    'person_schema-v0.2.0': personV2,
    'projects_schema-v0.1.0': projects,
    'quests_schema_v0.0.1': quests,
    events,
    library,
    roles,
    announcements,
    expenses,
    checklists,
    appreciations,
    rea_events: reaEvents,
    canvases
};

export type SchemaName = keyof typeof schemas;
