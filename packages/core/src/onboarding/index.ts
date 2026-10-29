// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/onboarding — onboarding into a holon: finish its steps, then
// your key is linked.
//
// Any holon can switch an onboarding on (`settings.onboarding`, see
// config.ts). From then on a request to link a key (a kind-9021,
// `@holons/core/holons` requestToJoin) is not answered at once. Instead:
//
//   1. Whoever answers for the holon (its bot, or an admin's screen) starts
//      the person's onboarding on the request's record — `startOnboarding`.
//   2. The current step's cards are dealt into the person's OWN holon
//      (`home`): their Telegram id when the request proved one, else their
//      key. They are ordinary cards, so the person ticks them like any card.
//   3. `refreshOnboarding` reads what they did, moves them on (the reducer),
//      deals the next step, and once every step is done links the key
//      (`approveJoin`). An admin card counts only by `confirmCard`.
//
// Progress lives on the holon's `joinrequests` record, which counts only
// from an admin's key — the person's ticks are facts read from their holon,
// never a claim they make about themselves to the holon.

import type { HoloSphere } from 'holosphere';
import { writeAcceptance } from '../holosphere/authority.js';
import type { NostrSigner } from '../holosphere/signers.js';
import { approveJoin, type JoinRequest } from '../holons/index.js';
import { JOIN_REQUESTS_LENS, joinRequestRecords, type JoinRequestRecord, type JoinRequestStatus } from '../holons/requests.js';
import { cleanName } from '../identity/ids.js';
import { readHolonSettings } from '../settings/persistence.js';
import { completedCards, dealCards, onboardingCardId } from './cards.js';
import { normalizeOnboarding, readOnboarding, type OnboardingCard, type OnboardingConfig } from './config.js';
import { readProfile, profileReady } from './profile.js';
import { advance, cardDone, cardKey, confirmable, stepDone, type OnboardingFacts } from './reducer.js';

export * from './config.js';
export * from './edit.js';
export * from './reducer.js';
export * from './profile.js';
export * from './cards.js';

/** Where a person's onboarding cards live: their proven Telegram id, else their key. */
export function onboardingHome(request: Pick<JoinRequest, 'pubkey'>, verifiedTelegramId?: string | null): string {
  return verifiedTelegramId && /^\d{1,20}$/.test(verifiedTelegramId) ? verifiedTelegramId : request.pubkey.toLowerCase();
}

export interface OnboardingCardView extends OnboardingCard {
  step: string;
  /** The card's id in the person's holon. */
  questId: string;
  done: boolean;
}

export interface OnboardingStepView {
  id: string;
  title: string;
  state: 'done' | 'current' | 'later';
  cards: OnboardingCardView[];
}

/** One person's onboarding, as every surface shows it. */
export interface OnboardingView {
  holon: string;
  pubkey: string;
  name: string;
  home: string;
  status: JoinRequestStatus;
  /** The step they are on; null once through. */
  step: string | null;
  finished: boolean;
  steps: OnboardingStepView[];
}

/** The view of a record, given what the person did. Pure. */
export function viewOf(holon: string, config: OnboardingConfig, record: JoinRequestRecord, facts: OnboardingFacts): OnboardingView {
  const at = advance(config, record, facts);
  const current = at.step === null ? config.steps.length : config.steps.findIndex((s) => s.id === at.step);
  return {
    holon,
    pubkey: record.id,
    name: record.name,
    home: record.home ?? record.id,
    status: record.status,
    step: at.step,
    finished: at.finished,
    steps: config.steps.map((step, i) => ({
      id: step.id,
      title: step.title,
      state: i < current || stepDone(step, record, facts) ? 'done' : i === current ? 'current' : 'later',
      cards: step.cards.map((card) => ({
        ...card,
        step: step.id,
        questId: onboardingCardId(holon, step.id, card.id),
        done: cardDone(step, card, record, facts),
      })),
    })),
  };
}

/**
 * The steps as a newcomer would see them standing on step `at` (an index):
 * what an admin previews while editing. Saved as it is — untitled cards and
 * empty steps left out, as a save would.
 */
export function previewSteps(holon: string, config: OnboardingConfig, at = 0): OnboardingStepView[] {
  return normalizeOnboarding(config).steps.map((step, i) => ({
    id: step.id,
    title: step.title,
    state: i < at ? 'done' : i === at ? 'current' : 'later',
    cards: step.cards.map((card) => ({ ...card, step: step.id, questId: onboardingCardId(holon, step.id, card.id), done: i < at })),
  }));
}

async function factsFor(hs: HoloSphere, holon: string, home: string, config: OnboardingConfig): Promise<OnboardingFacts> {
  const [completed, profile] = await Promise.all([completedCards(hs, holon, home, config), readProfile(hs, home)]);
  return { completed, profileReady: profileReady(profile) };
}

const isOnboarding = (r: JoinRequestRecord | undefined): r is JoinRequestRecord & { home: string } => !!r?.home;

/** One person's onboarding in a holon, or null when they are not onboarding there. */
export async function onboardingView(hs: HoloSphere, holon: string, pubkey: string): Promise<OnboardingView | null> {
  const record = (await joinRequestRecords(hs, holon)).get(String(pubkey).toLowerCase());
  if (!isOnboarding(record)) return null;
  const config = await readOnboarding(hs, holon);
  return viewOf(holon, config, record, await factsFor(hs, holon, record.home, config));
}

/** Everyone onboarding in a holon now (still pending), newest first. */
export async function listOnboarding(hs: HoloSphere, holon: string): Promise<OnboardingView[]> {
  const records = [...(await joinRequestRecords(hs, holon)).values()].filter(isOnboarding).filter((r) => r.status === 'pending');
  if (!records.length) return [];
  const config = await readOnboarding(hs, holon);
  const views = await Promise.all(records.map(async (r) => viewOf(holon, config, r, await factsFor(hs, holon, r.home, config))));
  return views.sort((a, b) => (records.find((r) => r.id === b.pubkey)?.at ?? 0) - (records.find((r) => r.id === a.pubkey)?.at ?? 0));
}

export interface OnboardingRunOptions {
  /** The holon's admin signer: without it a finished onboarding waits to be linked. */
  signer?: NostrSigner | null;
  appName?: string;
  /** Deal the current step's cards when this instance's key counts in the person's holon (default true). */
  deal?: boolean;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

export interface OnboardingResult {
  view: OnboardingView;
  record: JoinRequestRecord;
  /** Steps finished since the holon last noted where the person was. */
  passed: string[];
  /** Card ids written into the person's holon. */
  dealt: string[];
  /** The key was linked by this call. */
  linked: boolean;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * Move a pending record on and keep it: ONE write of the record per call,
 * since two in the same second would race on the relay. Then deal the
 * current step and, when every step is done, link the key.
 */
async function run(
  hs: HoloSphere,
  holon: string,
  config: OnboardingConfig,
  record: JoinRequestRecord & { home: string },
  opts: OnboardingRunOptions,
  dirty: boolean,
): Promise<OnboardingResult> {
  const facts = await factsFor(hs, holon, record.home, config);
  const at = advance(config, record, facts);
  let next: JoinRequestRecord = { ...record, step: at.step ?? DONE };
  let linked = false;
  if (at.finished && opts.signer) {
    await approveJoin(hs, holon, record.id, opts.signer, { appName: opts.appName, name: record.name, now: opts.now });
    next = { ...next, status: 'approved', by: 'onboarding' };
    linked = true;
  }
  if (dirty || at.changed || linked) {
    next = { ...next, at: (opts.now ?? nowSec)() };
    await hs.put(holon, JOIN_REQUESTS_LENS, next);
  }

  let dealt: string[] = [];
  const current = config.steps.find((s) => s.id === at.step);
  if (current && opts.deal !== false && (await writeAcceptance(hs, record.home)).status !== 'held') {
    const holonName = String((await readHolonSettings(hs, holon))?.name ?? '');
    dealt = await dealCards(hs, holon, record.home, current, { holonName, name: record.name });
  }
  return { view: viewOf(holon, config, next, facts), record: next, passed: at.passed, dealt, linked };
}

/** The step a finished onboarding is noted at. */
const DONE = 'done';

export interface StartOnboardingOptions extends OnboardingRunOptions {
  /** The person's holon (see `onboardingHome`). */
  home: string;
  name?: string;
  telegramId?: string;
  /** Where the surface announced it (a Telegram message id). */
  messageId?: number;
}

/**
 * Start a person's onboarding: the holon notes their request at the first
 * step with where their cards live, moves them past anything already done
 * (a profile they brought) and deals the cards. Admin key only.
 */
export async function startOnboarding(hs: HoloSphere, holon: string, request: JoinRequest, opts: StartOnboardingOptions): Promise<OnboardingResult> {
  const config = await readOnboarding(hs, holon);
  const record: JoinRequestRecord & { home: string } = {
    id: request.pubkey.toLowerCase(),
    eventId: request.eventId,
    name: cleanName(opts.name ?? request.reason),
    status: 'pending',
    at: (opts.now ?? nowSec)(),
    home: opts.home,
    step: config.steps[0]?.id ?? DONE,
    confirmed: [],
    ...(opts.telegramId ? { telegramId: opts.telegramId } : {}),
    ...(typeof opts.messageId === 'number' ? { messageId: opts.messageId } : {}),
  };
  return run(hs, holon, config, record, opts, true);
}

/**
 * Bring a person's onboarding up to date: move them past what they did,
 * deal what comes next, and link their key once every step is done. Run by
 * whoever answers for the holon; safe to repeat. Null when they are not
 * onboarding there; a settled one is only viewed.
 */
export async function refreshOnboarding(hs: HoloSphere, holon: string, pubkey: string, opts: OnboardingRunOptions = {}): Promise<OnboardingResult | null> {
  const record = (await joinRequestRecords(hs, holon)).get(String(pubkey).toLowerCase());
  if (!isOnboarding(record)) return null;
  const config = await readOnboarding(hs, holon);
  if (record.status !== 'pending') {
    const facts = await factsFor(hs, holon, record.home, config);
    return { view: viewOf(holon, config, record, facts), record, passed: [], dealt: [], linked: false };
  }
  return run(hs, holon, config, record, opts, false);
}

/**
 * An admin vouches for an admin card (the call happened, the buddy met
 * them), then the onboarding moves on. Null when they are not onboarding
 * there or the card is not one an admin confirms.
 */
export async function confirmCard(
  hs: HoloSphere,
  holon: string,
  pubkey: string,
  step: string,
  card: string,
  opts: OnboardingRunOptions = {},
): Promise<OnboardingResult | null> {
  const record = (await joinRequestRecords(hs, holon)).get(String(pubkey).toLowerCase());
  if (!isOnboarding(record) || record.status !== 'pending') return null;
  const config = await readOnboarding(hs, holon);
  if (!confirmable(config, step, card)) return null;
  const confirmed = [...new Set([...(record.confirmed ?? []), cardKey(step, card)])];
  return run(hs, holon, config, { ...record, confirmed }, opts, true);
}
