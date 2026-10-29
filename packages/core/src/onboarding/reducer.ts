// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The one rule of an onboarding: where a person stands, and when they are
// through. Pure — the bot, the kiosk and MCP all ask it the same question.

import type { OnboardingCard, OnboardingConfig, OnboardingStep } from './config.js';

/** A card's name within one holon's onboarding: `<step>/<card>`. */
export const cardKey = (step: string, card: string): string => `${step}/${card}`;

/** What the holon noted: the step the person is on, the cards an admin vouched for. */
export interface OnboardingProgress {
  step?: string;
  confirmed?: readonly string[];
}

/** What the person did, read from their own holon. */
export interface OnboardingFacts {
  /** Card keys whose card the person completed. */
  completed: ReadonlySet<string>;
  profileReady: boolean;
}

/** Is this card done? Each kind of card listens to its own witness only. */
export function cardDone(step: OnboardingStep, card: OnboardingCard, progress: OnboardingProgress, facts: OnboardingFacts): boolean {
  const key = cardKey(step.id, card.id);
  switch (card.confirm) {
    case 'profile':
      return facts.profileReady;
    case 'admin':
      return (progress.confirmed ?? []).includes(key);
    default:
      return facts.completed.has(key);
  }
}

export const stepDone = (step: OnboardingStep, progress: OnboardingProgress, facts: OnboardingFacts): boolean =>
  step.cards.every((card) => cardDone(step, card, progress, facts));

export interface Advance {
  /** The step the person is on now; null once every step is done. */
  step: string | null;
  /** Steps finished by this move, in order. */
  passed: string[];
  finished: boolean;
  /** The noted step differs from where the person stands now. */
  changed: boolean;
}

/**
 * Move the person on past every step that is done. A step the config no
 * longer has puts them back at the first step that is not done — a card
 * already done stays done, so they lose nothing.
 */
export function advance(config: OnboardingConfig, progress: OnboardingProgress, facts: OnboardingFacts): Advance {
  const steps = config.steps;
  let i = steps.findIndex((s) => s.id === progress.step);
  if (i < 0) i = 0;
  const passed: string[] = [];
  while (i < steps.length && stepDone(steps[i], progress, facts)) passed.push(steps[i++].id);
  const step = steps[i]?.id ?? null;
  return { step, passed, finished: step === null, changed: step !== (progress.step ?? null) };
}

/** Can `card` of `step` be vouched for by an admin? Only admin cards can. */
export function confirmable(config: OnboardingConfig, step: string, card: string): boolean {
  return config.steps.some((s) => s.id === step && s.cards.some((c) => c.id === card && c.confirm === 'admin'));
}
