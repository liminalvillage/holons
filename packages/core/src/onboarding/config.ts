// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// A holon's onboarding: the steps a newcomer walks before their key is
// linked. It lives on the holon's settings (`settings.onboarding`), a
// guarded field — only an admin's word counts, or a member could wave
// anyone in.
//
// Each step is a handful of cards. How a card counts as done:
//   self     the person completes it themselves (watch the video)
//   admin    someone who speaks for the holon vouches for it (the call)
//   profile  the person's profile is filled in — "you need a profile to
//            apply" is just the first card

import type { HoloSphere } from 'holosphere';
import { readHolonSettings } from '../settings/persistence.js';

/** The settings field the onboarding lives in. */
export const ONBOARDING_KEY = 'onboarding';

export type CardConfirm = 'self' | 'admin' | 'profile';

export interface OnboardingCard {
  id: string;
  title: string;
  description?: string;
  /** Where the card points: a video, a booking page, a form. */
  link?: string;
  confirm: CardConfirm;
}

export interface OnboardingStep {
  id: string;
  title: string;
  cards: OnboardingCard[];
}

export interface OnboardingConfig {
  /** Off: a request to link a key is answered the old way, at once. */
  enabled: boolean;
  /** In order; one step is dealt at a time. */
  steps: OnboardingStep[];
}

/** Where a holon starts when it switches onboarding on: a visitor's way in. */
export const DEFAULT_ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  {
    id: 'profile',
    title: 'Your profile',
    cards: [{ id: 'profile', title: 'Fill in your profile', description: 'Who you are, and what you can offer and give.', confirm: 'profile' }],
  },
  {
    id: 'call',
    title: 'Onboarding call',
    cards: [{ id: 'call', title: 'Have your onboarding call', description: 'A short video call with someone from the holon. They tick this card.', confirm: 'admin' }],
  },
  {
    id: 'arrival',
    title: 'Before you arrive',
    cards: [
      { id: 'dates', title: 'Share your arrival info and dates', confirm: 'self' },
      { id: 'buddy', title: 'Meet your buddy', description: 'Someone from the holon is your first contact. They tick this card.', confirm: 'admin' },
      { id: 'video', title: 'Watch the welcome video and playlist', confirm: 'self' },
    ],
  },
]);

const CONFIRMS: readonly CardConfirm[] = ['self', 'admin', 'profile'];

/** A stable id: lowercase letters, digits, `_`. Ids end up inside card ids. */
export function slugId(raw: unknown, fallback: string): string {
  const s = String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return s || fallback;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function unique(id: string, taken: Set<string>): string {
  let out = id;
  for (let n = 2; taken.has(out); n++) out = `${id}_${n}`;
  taken.add(out);
  return out;
}

/**
 * Whatever is stored → a usable onboarding. Untitled cards and empty steps
 * drop out, ids are made safe and unique, an unknown `confirm` is `self`.
 * Nothing stored (or no steps) → the default steps, switched off.
 */
export function normalizeOnboarding(raw: unknown): OnboardingConfig {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const enabled = doc.enabled === true;
  if (!Array.isArray(doc.steps)) return { enabled, steps: structuredClone([...DEFAULT_ONBOARDING_STEPS]) };
  const stepIds = new Set<string>();
  const steps: OnboardingStep[] = [];
  for (const [i, s] of doc.steps.entries()) {
    const step = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const cardIds = new Set<string>();
    const cards: OnboardingCard[] = [];
    for (const [j, c] of (Array.isArray(step.cards) ? step.cards : []).entries()) {
      const card = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>;
      const title = text(card.title);
      if (!title) continue;
      const confirm = CONFIRMS.includes(card.confirm as CardConfirm) ? (card.confirm as CardConfirm) : 'self';
      const description = text(card.description);
      const link = text(card.link);
      cards.push({
        id: unique(slugId(card.id ?? title, `card_${j + 1}`), cardIds),
        title,
        ...(description ? { description } : {}),
        ...(link ? { link } : {}),
        confirm,
      });
    }
    if (!cards.length) continue;
    const title = text(step.title) || cards[0].title;
    steps.push({ id: unique(slugId(step.id ?? title, `step_${i + 1}`), stepIds), title, cards });
  }
  return { enabled, steps };
}

/** The holon's onboarding, as its settings hold it. */
export async function readOnboarding(hs: HoloSphere, holon: string): Promise<OnboardingConfig> {
  const settings = await readHolonSettings(hs, holon);
  return normalizeOnboarding(settings?.[ONBOARDING_KEY]);
}

/**
 * Save the holon's onboarding, merged over its settings document. Counts
 * only from an admin's key. Returns what was stored.
 */
export async function saveOnboarding(hs: HoloSphere, holon: string, config: unknown): Promise<OnboardingConfig> {
  const clean = normalizeOnboarding(config);
  let existing: Record<string, unknown> | null = null;
  try {
    existing = (await hs.get(String(holon), 'settings', String(holon))) as Record<string, unknown> | null;
  } catch {
    // A failed read must not cost the admin their edit.
  }
  await hs.put(String(holon), 'settings', { ...(existing ?? {}), id: String(holon), [ONBOARDING_KEY]: clean });
  return clean;
}
