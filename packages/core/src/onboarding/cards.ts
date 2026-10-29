// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Onboarding steps as ordinary cards in the person's own holon. People
// already know how a card works by the time they arrive, and their personal
// board shows it without a separate checklist tool.
//
// Every card has a deterministic id per holon, step and card, so dealing is
// idempotent from any surface: what exists is never written again, and a
// completion the person made is never overwritten.

import type { HoloSphere } from 'holosphere';
import { createTask } from '../tasks/creation.js';
import type { Quest, QuestParticipant } from '../tasks/types.js';
import type { OnboardingConfig, OnboardingStep } from './config.js';
import { cardKey } from './reducer.js';

export const CARDS_LENS = 'quests';

/** What tags a card as one holon's onboarding card. */
export interface OnboardingTag {
  holon: string;
  step: string;
  card: string;
  confirm: string;
}

/** The card's id in the person's holon. */
export function onboardingCardId(holon: string, step: string, card: string): string {
  return `onboarding-${String(holon).replace(/[^A-Za-z0-9_-]/g, '_')}-${step}-${card}`;
}

/** The person as a card names them: a Telegram id is a number on the wire. */
export function personOf(home: string, name?: string): QuestParticipant {
  const id = /^\d{1,20}$/.test(home) ? Number(home) : home;
  return { id, ...(name ? { first_name: name } : {}) };
}

/** The cards of one step, as records for the person's holon. */
export function stepCards(holon: string, holonName: string, home: string, step: OnboardingStep, opts: { name?: string; now?: number } = {}): Quest[] {
  return step.cards.map((card) => {
    const base = createTask({ holonId: home, initiator: { id: holon, ...(holonName ? { username: holonName } : {}) }, title: card.title, now: opts.now });
    const tag: OnboardingTag = { holon, step: step.id, card: card.id, confirm: card.confirm };
    return {
      ...base,
      id: onboardingCardId(holon, step.id, card.id),
      ...(card.description ? { description: card.description } : {}),
      ...(card.link ? { link: card.link } : {}),
      category: 'onboarding',
      participants: [personOf(home, opts.name)],
      onboarding: tag,
    };
  });
}

const live = (rec: unknown): rec is Quest => !!rec && typeof rec === 'object' && (rec as { _deleted?: boolean })._deleted !== true;

/**
 * Write the step's cards the person's holon does not hold yet. Returns the
 * ids written. Only a key that counts in that holon should deal — the
 * caller checks (`writeAcceptance`).
 */
export async function dealCards(
  hs: HoloSphere,
  holon: string,
  home: string,
  step: OnboardingStep,
  opts: { holonName?: string; name?: string; now?: number } = {},
): Promise<string[]> {
  const written: string[] = [];
  for (const card of stepCards(holon, opts.holonName ?? '', home, step, opts)) {
    let cur: unknown = null;
    try {
      cur = await hs.get(home, CARDS_LENS, String(card.id));
    } catch {
      cur = null;
    }
    if (live(cur)) continue;
    await hs.put(home, CARDS_LENS, card);
    written.push(String(card.id));
  }
  return written;
}

/** The card keys whose card the person's holon shows completed. */
export async function completedCards(hs: HoloSphere, holon: string, home: string, config: OnboardingConfig): Promise<Set<string>> {
  const done = new Set<string>();
  for (const step of config.steps) {
    for (const card of step.cards) {
      if (card.confirm !== 'self') continue;
      try {
        const rec = await hs.get(home, CARDS_LENS, onboardingCardId(holon, step.id, card.id));
        if (live(rec) && rec.status === 'completed') done.add(cardKey(step.id, card.id));
      } catch {
        /* not readable: not done */
      }
    }
  }
  return done;
}
