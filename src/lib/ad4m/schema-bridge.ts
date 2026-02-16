/**
 * JSON Schema to AD4M Subject Class Bridge
 *
 * Uses Ad4mModel.fromJSONSchema() to dynamically create AD4M Subject Classes
 * from Harvest's existing JSON schema definitions. This validates that the
 * schema bridge approach works and provides a zero-rewrite migration path
 * for schema-driven entities.
 *
 * Harvest has 17+ JSON schemas in src/components/schemas/ that define data types
 * using the Murmurations Network format. This bridge converts those schemas into
 * AD4M subject classes that can be used alongside the hand-crafted models in
 * models/index.ts.
 *
 * When to use hand-crafted models vs schema-bridge:
 * - Hand-crafted (@ModelOptions): Core data types (Quest, Settings, Member) that
 *   need precise control over predicates, flags, and collections.
 * - Schema-bridge (fromJSONSchema): User-contributed schemas, community schemas,
 *   and schemas where automatic mapping is sufficient.
 *
 * @module ad4m/schema-bridge
 */

import { Ad4mModel } from '@coasys/ad4m';

// Import Harvest's schema registry
// NOTE: These imports reference the actual schema files in the Harvest repo.
// The schemas are plain JSON and can be imported directly.
import holonsSchema from '../../components/schemas/holons_schema-v0.0.1.json';
import questsSchema from '../../components/schemas/quests_schema_v0.0.1.json';
import chromosomeSchema from '../../components/schemas/chromosome.schema.json';
import dnaSequenceSchema from '../../components/schemas/dna-sequence.schema.json';
import offersWantsSchema from '../../components/schemas/offers_wants_schema-v0.0.2.json';
import personV2Schema from '../../components/schemas/person_schema-v0.2.0.json';
import organizationsSchema from '../../components/schemas/organizations_schema-v1.0.0.json';
import communitiesSchema from '../../components/schemas/communities_schema-v0.1.0.json';
import projectsSchema from '../../components/schemas/projects_schema-v0.1.0.json';

/**
 * Configuration for how a schema is bridged to an AD4M Subject Class.
 */
export interface SchemaBridgeConfig {
  /** The JSON schema definition */
  schema: any;
  /** Name for the AD4M Subject Class (must be unique) */
  name: string;
  /** Predicate namespace (e.g., "holons://quest/") */
  namespace: string;
  /**
   * Default language for property storage.
   * "literal" = store as AD4M Literal (supports string, number, boolean, JSON)
   */
  resolveLanguage?: string;
  /**
   * Custom property-to-predicate mapping overrides.
   * Key = property name in schema, Value = full predicate URI
   */
  propertyMapping?: Record<string, string>;
}

/**
 * Result of bridging a schema to an AD4M Subject Class.
 */
export interface BridgedSchema {
  /** The generated Ad4mModel subclass */
  modelClass: typeof Ad4mModel;
  /** The schema name */
  name: string;
  /** The namespace used for predicates */
  namespace: string;
  /** Original JSON schema */
  schema: any;
}

// =============================================================================
// Pre-configured bridge configs for Harvest's core schemas
// =============================================================================

/**
 * Bridge configurations for Harvest's JSON schemas.
 *
 * Each config maps a Harvest schema to an AD4M namespace and class name.
 * These are used by createBridgedSchemas() to generate all subject classes at once.
 *
 * Note: Core models (HolonSettings, Quest, etc.) are hand-crafted in models/index.ts
 * with more precise decorator configurations. These bridged versions are alternatives
 * that demonstrate the fromJSONSchema() approach and can be used for less critical schemas.
 */
export const SCHEMA_BRIDGE_CONFIGS: SchemaBridgeConfig[] = [
  {
    schema: holonsSchema,
    name: 'HolonSchema',
    namespace: 'holons-schema://',
    resolveLanguage: 'literal',
  },
  {
    schema: questsSchema,
    name: 'QuestSchema',
    namespace: 'holons://quest-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: chromosomeSchema,
    name: 'ChromosomeSchema',
    namespace: 'holons://chromosome-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: dnaSequenceSchema,
    name: 'DNASequenceSchema',
    namespace: 'holons://dna-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: offersWantsSchema,
    name: 'OfferWantSchema',
    namespace: 'holons://offer-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: personV2Schema,
    name: 'PersonSchema',
    namespace: 'holons://person-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: organizationsSchema,
    name: 'OrganizationSchema',
    namespace: 'holons://org-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: communitiesSchema,
    name: 'CommunitySchema',
    namespace: 'holons://community-schema/',
    resolveLanguage: 'literal',
  },
  {
    schema: projectsSchema,
    name: 'ProjectSchema',
    namespace: 'holons://project-schema/',
    resolveLanguage: 'literal',
  },
];

// =============================================================================
// Bridge Functions
// =============================================================================

/**
 * Create an AD4M Subject Class from a JSON schema.
 *
 * Wraps Ad4mModel.fromJSONSchema() with Harvest-specific defaults:
 * - Uses "literal" resolveLanguage by default for all properties
 * - Generates predicates from the namespace + property name
 * - Handles Murmurations-style schemas (which have metadata, creator, etc.)
 *
 * @param config - Bridge configuration
 * @returns The generated Ad4mModel subclass
 *
 * @example
 * ```typescript
 * const QuestModel = bridgeSchema({
 *   schema: questsSchema,
 *   name: 'Quest',
 *   namespace: 'holons://quest/',
 *   resolveLanguage: 'literal'
 * });
 *
 * // Use like any Ad4mModel:
 * const quest = new QuestModel(perspective);
 * quest.title = "Build the bridge";
 * await quest.save();
 * ```
 *
 * NOTE: The generated class may handle the "author" property differently than
 * hand-crafted models. Ad4mModel.fromJSONSchema() throws if the schema defines
 * a top-level "author" property (since Ad4mModel provides author via link authorship).
 * Schemas with "author" fields need to rename them (e.g., "initiator", "creator").
 */
export function bridgeSchema(config: SchemaBridgeConfig): typeof Ad4mModel {
  const { schema, name, namespace, resolveLanguage, propertyMapping } = config;

  // Clean up schema for AD4M compatibility:
  // 1. Remove "author" property if present (Ad4mModel provides it implicitly)
  // 2. Remove metadata fields that aren't actual data properties
  const cleanedSchema = cleanSchemaForAd4m(schema);

  return Ad4mModel.fromJSONSchema(cleanedSchema, {
    name,
    namespace,
    resolveLanguage: resolveLanguage || 'literal',
    propertyMapping,
  });
}

/**
 * Create all pre-configured bridged schemas.
 *
 * @returns Map of schema name to bridged schema info
 */
export function createBridgedSchemas(): Map<string, BridgedSchema> {
  const result = new Map<string, BridgedSchema>();

  for (const config of SCHEMA_BRIDGE_CONFIGS) {
    try {
      const modelClass = bridgeSchema(config);
      result.set(config.name, {
        modelClass,
        name: config.name,
        namespace: config.namespace,
        schema: config.schema,
      });
    } catch (error) {
      console.error(
        `[SchemaBridge] Failed to bridge schema "${config.name}":`,
        error
      );
      // Continue with other schemas — one failure shouldn't block all
    }
  }

  return result;
}

/**
 * Bridge a custom JSON schema at runtime.
 *
 * Useful for user-contributed schemas or schemas loaded dynamically.
 *
 * @param schema - The JSON schema definition
 * @param name - Unique name for the subject class
 * @param namespace - Predicate namespace (defaults to lowercase name + "://")
 * @returns The generated Ad4mModel subclass
 */
export function bridgeCustomSchema(
  schema: any,
  name: string,
  namespace?: string
): typeof Ad4mModel {
  return bridgeSchema({
    schema,
    name,
    namespace: namespace || `${name.toLowerCase()}://`,
    resolveLanguage: 'literal',
  });
}

// =============================================================================
// Schema Utilities
// =============================================================================

/**
 * Clean a JSON schema for AD4M compatibility.
 *
 * Handles:
 * - Removing "author" property (provided by Ad4mModel via link authorship)
 * - Stripping Murmurations "metadata" from individual properties
 *   (these are documentation, not data)
 * - Ensuring the schema has a top-level "type": "object"
 *
 * @param schema - The original JSON schema
 * @returns Cleaned schema safe for fromJSONSchema()
 */
function cleanSchemaForAd4m(schema: any): any {
  // Deep clone to avoid mutating the original
  const cleaned = JSON.parse(JSON.stringify(schema));

  // Remove top-level "author" property if present
  if (cleaned.properties?.author) {
    delete cleaned.properties.author;
    // Also remove from required array if present
    if (Array.isArray(cleaned.required)) {
      cleaned.required = cleaned.required.filter((r: string) => r !== 'author');
    }
  }

  // Remove Murmurations "metadata" field from each property
  // (it's documentation about the schema field, not actual data)
  if (cleaned.properties) {
    for (const [, propSchema] of Object.entries(cleaned.properties)) {
      if ((propSchema as any).metadata) {
        delete (propSchema as any).metadata;
      }
    }
  }

  // Remove top-level "metadata" (schema-level documentation)
  if (cleaned.metadata) {
    delete cleaned.metadata;
  }

  // Ensure type is "object"
  if (!cleaned.type) {
    cleaned.type = 'object';
  }

  return cleaned;
}

/**
 * Inspect a bridged schema's generated SDNA.
 *
 * Useful for debugging — shows the Prolog code that would be generated
 * for a bridged schema.
 *
 * @param modelClass - The bridged Ad4mModel subclass
 * @returns Object with sdna (Prolog code) and name
 */
export function inspectBridgedSDNA(modelClass: typeof Ad4mModel): { sdna: string; name: string } {
  if (typeof (modelClass as any).generateSDNA !== 'function') {
    throw new Error('Model class does not have generateSDNA(). Was it created with fromJSONSchema() or @ModelOptions?');
  }

  return (modelClass as any).generateSDNA();
}

/**
 * Get metadata about how a schema's properties map to AD4M predicates.
 *
 * @param modelClass - The Ad4mModel subclass (hand-crafted or bridged)
 * @returns Model metadata including property predicates and collection predicates
 */
export function getSchemaMapping(modelClass: typeof Ad4mModel) {
  return modelClass.getModelMetadata();
}
