// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/drafting
 *
 * Drafting a record from a description: the tool schema an LLM is forced to
 * call, the prompt around it, and the validation of what comes back. Pure —
 * the provider call itself belongs to whichever edge holds the key (a server
 * route, or the browser when the device has its own).
 *
 * Used by the kiosk's map add form: describe the thing in a line, and the
 * fields its lens's schema asks for come back filled in, for a person to
 * check before saving.
 */

export {
  DRAFT_TOOL_NAME,
  DRAFT_MAX_FIELDS,
  DRAFT_MAX_DESCRIPTION_CHARS,
  DraftValidationError,
  buildDraftPrompt,
  buildDraftTool,
  parseDraft,
  type DraftField,
  type DraftFieldKind,
  type DraftRequest,
  type DraftValues,
} from './draft.js';
