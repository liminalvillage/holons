// Import all schema files
import communities from '../components/schemas/communities_schema-v0.1.0.json';
import currencies from '../components/schemas/complementary_currencies-v2.0.0.json';
import holons from '../components/schemas/holons_schema-v0.0.1.json';
import kvm from '../components/schemas/karte_von_morgen-v1.0.0.json';
import offersWantsProto from '../components/schemas/offers_wants_prototype-v0.0.2.json';
import offersWants from '../components/schemas/offers_wants_schema-v0.0.2.json';
import organizations from '../components/schemas/organizations_schema-v1.0.0.json';
import owpGoods from '../components/schemas/owp-goods_to_lend-v0.0.1.json';
import personV1 from '../components/schemas/person_schema-v0.1.0.json';
import personV2 from '../components/schemas/person_schema-v0.2.0.json';
import projects from '../components/schemas/projects_schema-v0.1.0.json';
import quests from '../components/schemas/quests_schema_v0.0.1.json';
import socialGraph from '../components/schemas/small_social_graph_people-v0.0.1.json';
import solidarity from '../components/schemas/solidarity_economy_initiatives-v0.2.0.json';
import systemsChange from '../components/schemas/systems_change_map-v2.0.0.json';
// DNA Editor schemas
import chromosome from '../components/schemas/chromosome.schema.json';
import dnaSequence from '../components/schemas/dna-sequence.schema.json';

// Map schema names to their definitions
export const schemas = {
    'communities_schema-v0.1.0': communities,
    'complementary_currencies-v2.0.0': currencies,
    'holons_schema-v0.0.1': holons,
    'karte_von_morgen-v1.0.0': kvm,
    'offers_wants_prototype-v0.0.2': offersWantsProto,
    'offers_wants_schema-v0.0.2': offersWants,
    'organizations_schema-v1.0.0': organizations,
    'owp-goods_to_lend-v0.0.1': owpGoods,
    'person_schema-v0.1.0': personV1,
    'person_schema-v0.2.0': personV2,
    'projects_schema-v0.1.0': projects,
    'quests_schema_v0.0.1': quests,
    'small_social_graph_people-v0.0.1': socialGraph,
    'solidarity_economy_initiatives-v0.2.0': solidarity,
    'systems_change_map-v2.0.0': systemsChange,
    // DNA Editor schemas
    'chromosome': chromosome,
    'dna-sequence': dnaSequence
};

export type SchemaName = keyof typeof schemas; 