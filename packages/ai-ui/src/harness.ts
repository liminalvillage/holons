// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Turn harness — deterministic guards around an agent loop so a model can't
// fake or dodge actions. Provider- and UI-neutral: the voice server
// (@holons/voice-ui) and the kiosk's in-browser direct pipeline both enforce
// the same contract with these primitives, in the spirit of OpenClaw's agent
// harness: a runtime only claims a turn it can actually perform, every tool
// execution is reported as a fact (name + outcome), and a reply's claims are
// checked against those facts — never taken on trust.
//
// 1. Audit — every dispatched tool call is recorded with its outcome.
// 2. Claim check — a reply asserting a completed action with no successful
//    write behind it is a hallucination; run one corrective pass instead of
//    letting it reach the user.
// 3. Write check — an action-shaped request must end in at least one
//    attempted write (a clarifying question is the one legitimate way out).
// 4. Staging check — where writes are STAGED for a person to approve (the
//    kiosk's review drawer), a reply that says the thing is done is just as
//    false as one with no write behind it: nothing has landed yet.

import type { HistoryMessage } from './providers/types.js';

/** One dispatched tool call, as a fact: what ran and whether it succeeded. */
export interface ToolAudit {
  name: string;
  ok: boolean;
  /** The write was staged for approval, not performed. */
  staged?: boolean;
}

/**
 * Tool names that mutate state (vs. read/compute). `navigate` is a UI action,
 * not a data write, but it counts here so a fulfilled "go to the calendar"
 * passes the write checks — callers exclude it from data-side effects like
 * lens-cache flushes.
 */
const WRITE_NAME =
  /(create|add|remove|delete|toggle|save|complete|update|set|join|leave|borrow|return|publish|seed|rsvp|clear|apply|put|migrate|normalize|navigate)/;

export function isWriteTool(name: string): boolean {
  if (name.startsWith('lens_get')) return false;
  return WRITE_NAME.test(name);
}

/** A write that actually landed — a staged one has not. */
export function hasSuccessfulWrite(audit: ToolAudit[]): boolean {
  return audit.some((a) => a.ok && !a.staged && isWriteTool(a.name));
}

/** A write was attempted — staging counts: the turn did its part. */
export function hasWriteAttempt(audit: ToolAudit[]): boolean {
  return audit.some((a) => a.staged || isWriteTool(a.name));
}

/** Something was staged this turn and nothing was written outright. */
export function hasStagedWrite(audit: ToolAudit[]): boolean {
  return audit.some((a) => a.ok && a.staged);
}

/**
 * Whether a spoken reply asserts that an action was carried out ("I've added
 * …", "the task has been deleted"). Deliberately requires a claim-of-agency
 * construction, not just a past-tense verb, so answers that merely describe
 * state ("the task marked done is …") don't trigger a correction pass.
 */
const CLAIM =
  /\b(i(?:'ve| have| already)?|has been|have been|is now|are now|successfully|it's been)\b[^.!?]{0,80}\b(deleted|removed|created|added|completed|marked|saved|updated|renamed|assigned|joined|borrowed|returned|cleared|cancell?ed|done|switched|opened|moved|(?:re)?scheduled|changed)\b/i;

export function claimsCompletedAction(reply: string): boolean {
  return CLAIM.test(reply);
}

/**
 * Whether a reply claims an action was carried out when this turn only
 * STAGED it. "I've prepared / queued / it's ready to review" pass — the claim
 * regex needs a completion verb — while "I've added Marco" is corrected.
 */
export function claimsDespiteStaging(reply: string, audit: ToolAudit[]): boolean {
  return claimsCompletedAction(reply) && hasStagedWrite(audit) && !hasSuccessfulWrite(audit);
}

/**
 * System-prompt fragment for a runtime that stages writes for approval.
 * Appended by the embedder; kept here so every staging surface says the same.
 */
export const STAGING_GUIDANCE =
  'Writes are STAGED, never applied by you: each write tool call adds a ' +
  'proposed change to a review panel the user sees on screen, and only the ' +
  'user can apply it, by touch. So after calling the tools, tell the user ' +
  'what is ready to review — say "I\'ve prepared" or "ready to apply", ' +
  'never that something was added, moved, created or done. You cannot ' +
  'apply changes yourself: when the user says apply, confirm, go ahead or ' +
  'yes, call NO tool and answer that they need to tap Apply on the panel. ' +
  'Use plan_discard when the user drops a proposed change. Stage the FULL ' +
  'request in one turn (several tool calls if needed), then stop.';

/**
 * Whether the user's utterance asks for something to be DONE (vs. asked).
 * Used to enforce that such turns end in at least one attempted write: a
 * "sure, done!" with zero write calls is exactly the failure mode small
 * models fall into.
 */
const ACTION_REQUEST =
  /\b(add|create|make|new|delete|remove|complete|finish|mark|schedule|move|reschedule|rename|change|update|set|assign|join|leave|borrow|return|cancel|clear|put|switch|go to|navigate)\b/i;

export function looksLikeActionRequest(text: string): boolean {
  return ACTION_REQUEST.test(text);
}

/**
 * The corrective user-role message injected when the reply claimed an action
 * no successful write tool backs. Sent with the failed exchange in history so
 * the model sees exactly what it said.
 */
export function correctionPrompt(
  audit: ToolAudit[],
  reason: 'claimed' | 'no_write' | 'staged' = 'claimed',
): string {
  const called =
    audit.length === 0
      ? 'no tools at all'
      : audit
          .map((a) => `${a.name} (${a.staged ? 'STAGED' : a.ok ? 'ok' : 'FAILED'})`)
          .join(', ');
  if (reason === 'staged') {
    return (
      'SYSTEM CHECK — not the user speaking. Your last reply said the change ' +
      `was done, but this turn you called ${called}: the changes are only ` +
      'STAGED in the review panel and nothing has been written. Restate your ' +
      'reply so it says what is READY for the user to review and apply — ' +
      'never that it was done.'
    );
  }
  const opening =
    reason === 'claimed'
      ? 'Your last reply claimed an action was completed,'
      : 'The user asked for an action to be performed,';
  return (
    `SYSTEM CHECK — not the user speaking. ${opening} but this turn you ` +
    `called ${called}: no write succeeded or was staged, so NOTHING was ` +
    'actually changed. Fulfill the original request now with the proper ' +
    'tool calls, or reply honestly that it was not done and why. Never ' +
    'claim success without a successful tool call.'
  );
}

/** History entries representing the rejected exchange, for the retry pass. */
export function correctionHistory(
  history: HistoryMessage[],
  userText: string,
  badReply: string,
): HistoryMessage[] {
  return [
    ...history,
    { role: 'user', content: userText },
    { role: 'assistant', content: badReply },
  ];
}
