// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Editing a holon's onboarding steps, as an admin's screen does it: pure
// operations on a draft. Two rules:
//
//   • An id is given once, when the step or card is made, and never derived
//     from its title again. Ids live inside the cards dealt to people and on
//     their progress, so renaming "Call" to "Onboarding call" must not make
//     everyone walking it start over.
//   • A draft keeps blank items. A card whose title is still being typed
//     must survive every edit; `normalizeOnboarding` drops it on save.

import type { CardConfirm, OnboardingCard, OnboardingConfig, OnboardingStep } from './config.js';

/** A fresh id no step (or card) of this draft has. */
export function newOnboardingId(prefix: 'step' | 'card', taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) {
    const id = `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}

const allCardIds = (config: OnboardingConfig) => config.steps.flatMap((s) => s.cards.map((c) => c.id));

const withSteps = (config: OnboardingConfig, steps: OnboardingStep[]): OnboardingConfig => ({ ...config, steps });

const mapStep = (config: OnboardingConfig, stepId: string, f: (s: OnboardingStep) => OnboardingStep): OnboardingConfig =>
  withSteps(
    config,
    config.steps.map((s) => (s.id === stepId ? f(s) : s)),
  );

function moved<T>(list: T[], index: number, by: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, index + by));
  if (index < 0 || to === index) return list;
  const out = [...list];
  const [item] = out.splice(index, 1);
  out.splice(to, 0, item);
  return out;
}

/** A blank card, ticked by the person unless said otherwise. */
export function blankCard(config: OnboardingConfig, fields: Partial<Omit<OnboardingCard, 'id'>> = {}): OnboardingCard {
  return { id: newOnboardingId('card', allCardIds(config)), title: '', confirm: 'self', ...fields };
}

/** Add a step at the end, with one blank card to fill in. */
export function addStep(config: OnboardingConfig, title = ''): { config: OnboardingConfig; step: OnboardingStep } {
  const step: OnboardingStep = {
    id: newOnboardingId(
      'step',
      config.steps.map((s) => s.id),
    ),
    title,
    cards: [blankCard(config)],
  };
  return { config: withSteps(config, [...config.steps, step]), step };
}

/** Add a card at the end of a step. */
export function addCard(
  config: OnboardingConfig,
  stepId: string,
  fields: Partial<Omit<OnboardingCard, 'id'>> = {},
): { config: OnboardingConfig; card: OnboardingCard | null } {
  if (!config.steps.some((s) => s.id === stepId)) return { config, card: null };
  const card = blankCard(config, fields);
  return { config: mapStep(config, stepId, (s) => ({ ...s, cards: [...s.cards, card] })), card };
}

export function updateStep(config: OnboardingConfig, stepId: string, fields: { title?: string }): OnboardingConfig {
  return mapStep(config, stepId, (s) => ({ ...s, ...fields }));
}

export type CardFields = Partial<{ title: string; description: string; link: string; confirm: CardConfirm }>;

/** Change a card; an emptied description or link goes away. */
export function updateCard(config: OnboardingConfig, stepId: string, cardId: string, fields: CardFields): OnboardingConfig {
  return mapStep(config, stepId, (s) => ({
    ...s,
    cards: s.cards.map((c) => {
      if (c.id !== cardId) return c;
      const next: OnboardingCard = { ...c, ...fields };
      if (fields.description === '') delete next.description;
      if (fields.link === '') delete next.link;
      return next;
    }),
  }));
}

/** Move a step up (-1) or down (+1); at either end nothing moves. */
export function moveStep(config: OnboardingConfig, stepId: string, by: -1 | 1): OnboardingConfig {
  const at = config.steps.findIndex((s) => s.id === stepId);
  const steps = moved(config.steps, at, by);
  return steps === config.steps ? config : withSteps(config, steps);
}

/** Move a card within its step. */
export function moveCard(config: OnboardingConfig, stepId: string, cardId: string, by: -1 | 1): OnboardingConfig {
  const step = config.steps.find((s) => s.id === stepId);
  const at = step ? step.cards.findIndex((c) => c.id === cardId) : -1;
  if (!step || at < 0) return config;
  const cards = moved(step.cards, at, by);
  return cards === step.cards ? config : mapStep(config, stepId, (s) => ({ ...s, cards }));
}

export function removeStep(config: OnboardingConfig, stepId: string): OnboardingConfig {
  return withSteps(
    config,
    config.steps.filter((s) => s.id !== stepId),
  );
}

export function removeCard(config: OnboardingConfig, stepId: string, cardId: string): OnboardingConfig {
  return mapStep(config, stepId, (s) => ({ ...s, cards: s.cards.filter((c) => c.id !== cardId) }));
}

export type DraftIssue =
  /** A card without a title is not saved until it has one. */
  | { kind: 'untitled-card'; step: string; card: string }
  /** A step without one titled card is not saved at all. */
  | { kind: 'empty-step'; step: string };

/** What in the draft would not survive a save, for the editor to point at. */
export function draftIssues(config: OnboardingConfig): DraftIssue[] {
  const out: DraftIssue[] = [];
  for (const s of config.steps) {
    const titled = s.cards.filter((c) => c.title.trim());
    if (!titled.length) out.push({ kind: 'empty-step', step: s.id });
    for (const c of s.cards) if (!c.title.trim()) out.push({ kind: 'untitled-card', step: s.id, card: c.id });
  }
  return out;
}
