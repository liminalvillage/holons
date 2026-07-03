/**
 * Subject class registry for the AD4M backend.
 *
 * Generates Ad4mModel subject classes from JSON Schemas — supplied either as
 * an in-memory Map (the browser path, where schemas are bundled by the app)
 * or read from disk (the Node path, via `schemaDir`).  Each lens name maps to
 * a model class that handles SHACL-based CRUD on AD4M perspectives.
 *
 * Node builtins (fs/path/url) are imported lazily inside the disk-reading
 * branch only, so this module stays safe to bundle into browser clients when
 * schemas are provided in memory.
 */

import { Ad4mModel } from '@coasys/ad4m';

const LENS_MODELS = new Map();
let _loaded = false;

/**
 * Derive a PascalCase subject-class name from a lens name.
 * `Ad4mModel.fromJSONSchema` requires a non-empty `options.name` (the SDNA
 * class name); our lens/schema titles are lowercase (`quests`, `rea_events`),
 * so map them to a valid class identifier (`Quests`, `ReaEvents`).
 */
function toClassName(lensName) {
  return String(lensName)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'Lens';
}

/**
 * The generic fallback model for lenses without a dedicated JSON schema.
 * Stores the entire payload as a JSON literal under a single `data` property.
 *
 * The schema deliberately declares NO `id` property: AD4M reserves `id` as the
 * alias for a subject's base-expression URI. Declaring it as a data property
 * makes `findAll` hydrate each instance's `_baseExpression` from the `id`
 * *link value* (the logical key) instead of the full URI, which breaks the
 * lens-prefix scoping in AD4MBackend.getAll (every instance gets filtered out).
 * With `data` as the sole required property, `findAll` returns full-URI base
 * expressions and the logical id is recovered from the URI's last segment.
 */
let GenericLensModel = null;

function ensureGenericModel() {
  if (GenericLensModel) return GenericLensModel;
  GenericLensModel = Ad4mModel.fromJSONSchema({
    title: 'GenericLens',
    type: 'object',
    properties: {
      data: { type: 'string' },
    },
    required: ['data'],
  }, { name: 'GenericLens', namespace: 'holons://generic/' });
  return GenericLensModel;
}

/**
 * Registry entry model for tracking holon → perspective mappings.
 */
let HolonRegistryEntry = null;

export function getRegistryModel() {
  if (HolonRegistryEntry) return HolonRegistryEntry;
  HolonRegistryEntry = Ad4mModel.fromJSONSchema({
    title: 'HolonRegistryEntry',
    type: 'object',
    properties: {
      holonId:         { type: 'string' },
      perspectiveUuid: { type: 'string' },
      h3Cell:          { type: 'string' },
      name:            { type: 'string' },
      createdAt:       { type: 'string' },
    },
    required: ['holonId', 'perspectiveUuid'],
  }, { name: 'HolonRegistryEntry', namespace: 'holons://registry/' });
  return HolonRegistryEntry;
}

/**
 * Load all JSON schemas from the core/schemas directory and generate
 * subject class models.  Safe to call multiple times — only loads once.
 *
 * @param {string} [schemaDir] - Override path to schemas directory.
 *   Defaults to `../../core/schemas` relative to this file (monorepo layout).
 * @param {Map<string, object>} [schemas] - Pre-loaded schema map (lens → schema object).
 *   If provided, skips disk reading entirely.
 * @returns {Map<string, typeof Ad4mModel>}
 */
export async function loadSubjectClasses(schemaDir, schemas) {
  if (_loaded) return LENS_MODELS;

  if (schemas instanceof Map) {
    for (const [lensName, schema] of schemas) {
      try {
        const Model = Ad4mModel.fromJSONSchema(schema, {
          name: toClassName(lensName),
          namespace: `holons://${lensName}/`,
        });
        LENS_MODELS.set(lensName, Model);
      } catch (err) {
        console.warn(`[subjects] Failed to create model for lens "${lensName}":`, err.message);
      }
    }
    _loaded = true;
    return LENS_MODELS;
  }

  // Disk-reading path: Node/Electron only. Import builtins lazily so the
  // browser bundle (which always supplies `schemas` in memory) never pulls
  // fs/path/url in.
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const { join, basename } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = fileURLToPath(new URL('.', import.meta.url));

  const dir = schemaDir || join(here, '../../core/schemas');
  if (!existsSync(dir)) {
    console.warn(`[subjects] Schema directory not found: ${dir}. Only GenericLensModel will be available.`);
    _loaded = true;
    return LENS_MODELS;
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const lensName = basename(file, '.json');
    try {
      const schema = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      const Model = Ad4mModel.fromJSONSchema(schema, {
        name: toClassName(lensName),
        namespace: `holons://${lensName}/`,
      });
      LENS_MODELS.set(lensName, Model);
    } catch (err) {
      console.warn(`[subjects] Failed to load schema "${file}":`, err.message);
    }
  }

  _loaded = true;
  return LENS_MODELS;
}

/**
 * Get the Ad4mModel class for a given lens name.
 * Returns null if no schema exists for that lens.
 */
export function getModelForLens(lens) {
  return LENS_MODELS.get(lens) ?? null;
}

/**
 * Get the model for a lens, falling back to GenericLensModel.
 */
export function getModelOrGeneric(lens) {
  return LENS_MODELS.get(lens) ?? ensureGenericModel();
}

/**
 * Every loaded lens model plus the generic fallback. Used to batch-register
 * subject-class SDNA onto a perspective (`Ad4mModel.registerAll`) so instances
 * can be created — an AD4M perspective rejects `createSubject` for a class
 * whose SHACL/SDNA it has never seen ("No SHACL constructor found").
 */
export function getAllModels() {
  return [...LENS_MODELS.values(), ensureGenericModel()];
}

/**
 * Reset the loaded state (for testing).
 */
export function resetSubjectClasses() {
  LENS_MODELS.clear();
  _loaded = false;
}
