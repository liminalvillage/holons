// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @holons/core/drafting
 *
 * Drafting a record from a description: the JSON schema the model's answer
 * follows, the prompt around it, and the validation of what comes back. Pure —
 * the model call itself goes through @holons/core/ai at a server route.
 *
 * Used by the kiosk's map add form: describe the thing in a line, and the
 * fields its lens's schema asks for come back filled in, for a person to
 * check before saving.
 */

export {
  DRAFT_MAX_FIELDS,
  DRAFT_MAX_DESCRIPTION_CHARS,
  DraftValidationError,
  buildDraftPrompt,
  buildDraftSchema,
  parseDraft,
  type DraftField,
  type DraftFieldKind,
  type DraftRequest,
  type DraftValues,
} from './draft.js';
