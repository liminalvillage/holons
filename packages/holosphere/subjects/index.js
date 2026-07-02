/**
 * Subject class registry for the AD4M backend.
 *
 * Generates Ad4mModel subject classes from the JSON Schema files in
 * @holons/core/schemas/ via Ad4mModel.fromJSONSchema().  Each lens name
 * maps to a model class that handles SHACL-based CRUD on AD4M perspectives.
 *
 * NOTE: This module uses Node fs APIs because the AD4M backend only runs
 * in Node/Electron environments (the AD4M runtime itself requires it).
 */

import { Ad4mModel } from '@coasys/ad4m';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const LENS_MODELS = new Map();
let _loaded = false;

/**
 * The generic fallback model for lenses without a dedicated JSON schema.
 * Stores the entire payload as a JSON literal under a single `data` property.
 */
let GenericLensModel = null;

function ensureGenericModel() {
  if (GenericLensModel) return GenericLensModel;
  GenericLensModel = Ad4mModel.fromJSONSchema({
    title: 'GenericLens',
    type: 'object',
    properties: {
      id:   { type: 'string' },
      data: { type: 'string' },
    },
    required: ['id'],
  }, { namespace: 'holons://generic/' });
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
  }, { namespace: 'holons://registry/' });
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
export function loadSubjectClasses(schemaDir, schemas) {
  if (_loaded) return LENS_MODELS;

  if (schemas instanceof Map) {
    for (const [lensName, schema] of schemas) {
      try {
        const Model = Ad4mModel.fromJSONSchema(schema, {
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

  const dir = schemaDir || join(__dirname, '../../core/schemas');
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
 * Reset the loaded state (for testing).
 */
export function resetSubjectClasses() {
  LENS_MODELS.clear();
  _loaded = false;
}
