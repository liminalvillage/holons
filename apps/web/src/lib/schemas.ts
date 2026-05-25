// Murmurations schemas actively referenced by MapSidebar / federation.
// Dead entries removed; canonical copies live in @holons/core/schemas/murmurations/.
import communities from '@holons/core/schemas/murmurations/communities_schema-v0.1.0.json';
import currencies from '@holons/core/schemas/murmurations/complementary_currencies-v2.0.0.json';
import holons from '@holons/core/schemas/murmurations/holons_schema-v0.0.1.json';
import offersWantsProto from '@holons/core/schemas/murmurations/offers_wants_prototype-v0.0.2.json';
import offersWants from '@holons/core/schemas/murmurations/offers_wants_schema-v0.0.2.json';
import organizations from '@holons/core/schemas/murmurations/organizations_schema-v1.0.0.json';
import personV2 from '@holons/core/schemas/murmurations/person_schema-v0.2.0.json';
import projects from '@holons/core/schemas/murmurations/projects_schema-v0.1.0.json';
import quests from '@holons/core/schemas/murmurations/quests_schema_v0.0.1.json';

// Map schema names to their definitions
export const schemas = {
    'communities_schema-v0.1.0': communities,
    'complementary_currencies-v2.0.0': currencies,
    'holons_schema-v0.0.1': holons,
    'offers_wants_prototype-v0.0.2': offersWantsProto,
    'offers_wants_schema-v0.0.2': offersWants,
    'organizations_schema-v1.0.0': organizations,
    'person_schema-v0.2.0': personV2,
    'projects_schema-v0.1.0': projects,
    'quests_schema_v0.0.1': quests
};

export type SchemaName = keyof typeof schemas;
