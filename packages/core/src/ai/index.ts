// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/ai
 *
 * The one Claude client every text-AI surface uses — server-side only (it
 * holds the key). Key + model from the env, effort per route, the refusal
 * fallback, structured JSON output, and one error type a route maps to a
 * status. Speech stays with OpenAI, outside this module.
 */

export {
  AI_DEFAULT_MODEL,
  AIError,
  aiApiKey,
  aiConfigured,
  aiModel,
  complete,
  completeJSON,
  createClaude,
  toAIError,
  type AIEffort,
  type AIEnv,
  type AIErrorKind,
  type CompleteOptions,
  type CompleteResult,
} from './claude.js';
