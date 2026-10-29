// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk's side of onboarding into a holon (@holons/core/onboarding owns
// the meaning). A newcomer sees their steps and ticks their cards here; an
// admin switches the onboarding on, sees who is walking it and vouches for
// the cards a person can't tick alone.
//
// Who moves people on is whoever answers for the holon — its bot, for a
// Telegram group. This screen only writes what is its own to write (cards in
// the person's own holon, when the session key counts there) and then
// nudges the bot, which re-reads before acting: a nudge is never trusted.

import { get } from "svelte/store";
import { writeAcceptance } from "@holons/core/holosphere";
import { holonMembers } from "@holons/core/protocol";
import { applyTaskCompletion, type Quest } from "@holons/core/tasks";
import {
  CARDS_LENS,
  confirmCard,
  dealCards,
  listOnboarding,
  onboardingView,
  readOnboarding,
  readProfile,
  saveOnboarding,
  saveProfile,
  type OnboardingCardView,
  type OnboardingConfig,
  type OnboardingProfile,
  type OnboardingView,
} from "@holons/core/onboarding";
import { resolveAppName } from "./config";
import { getHolosphere } from "./holosphere";
import { sessionSigner } from "./hubmembers";
import { sessionKeyPub } from "./sessionKey";

export type { OnboardingCardView, OnboardingConfig, OnboardingView };

/** Where the session key stands with a holon's onboarding. */
export type MyOnboarding =
  | { state: "nokey" }
  | { state: "off"; config: OnboardingConfig }
  | { state: "linked"; config: OnboardingConfig }
  | { state: "none"; config: OnboardingConfig }
  | {
      state: "walking";
      config: OnboardingConfig;
      view: OnboardingView;
      /** The session key counts in the person's holon: cards are ticked here. */
      canTick: boolean;
      profile: OnboardingProfile | null;
    };

/**
 * The session key's onboarding in `holon`. Deals the current step's cards
 * into the person's holon when this key may write there (a key's own holon:
 * the bot cannot).
 */
export async function loadMyOnboarding(holon: string): Promise<MyOnboarding> {
  const pub = get(sessionKeyPub);
  if (!pub) return { state: "nokey" };
  const hs = await getHolosphere();
  const config = await readOnboarding(hs, holon);
  if ((await holonMembers(hs, holon)).has(pub))
    return { state: "linked", config };
  const view = await onboardingView(hs, holon, pub);
  if (!view) return { state: config.enabled ? "none" : "off", config };
  if (view.status === "approved") return { state: "linked", config };
  const canTick = (await writeAcceptance(hs, view.home)).status !== "held";
  const step = config.steps.find((s) => s.id === view.step);
  if (canTick && step && view.status === "pending")
    await dealCards(hs, holon, view.home, step, { name: view.name });
  return {
    state: "walking",
    config,
    view,
    canTick,
    profile: await readProfile(hs, view.home),
  };
}

/** Ask the bot to re-read this person's onboarding. Best-effort. */
export async function nudge(holon: string): Promise<void> {
  const pubkey = get(sessionKeyPub);
  if (!pubkey) return;
  try {
    await fetch("/api/onboarding/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ holon, pubkey }),
    });
  } catch {
    /* the bot's sweep catches it */
  }
}

/** Tick one of the person's own cards, then nudge. */
export async function tickCard(
  view: OnboardingView,
  card: OnboardingCardView,
): Promise<void> {
  const hs = await getHolosphere();
  const cur = (await hs.get(
    view.home,
    CARDS_LENS,
    card.questId,
  )) as Quest | null;
  if (!cur) throw new Error("card not dealt yet");
  const person = /^\d+$/.test(view.home) ? Number(view.home) : view.home;
  const done = applyTaskCompletion(cur, person);
  if (!done.ok && done.reason !== "already-completed")
    throw new Error(done.reason);
  if (done.ok) await hs.put(view.home, CARDS_LENS, done.task);
  await nudge(view.holon);
}

/** Fill in the person's profile (their own holon), then nudge. */
export async function saveMyProfile(
  view: OnboardingView,
  fields: Partial<OnboardingProfile>,
): Promise<void> {
  const hs = await getHolosphere();
  await saveProfile(hs, view.home, fields);
  await nudge(view.holon);
}

// ── The admin's side ───────────────────────────────────────────────────────

export async function loadOnboardingAdmin(
  holon: string,
): Promise<{ config: OnboardingConfig; people: OnboardingView[] }> {
  const hs = await getHolosphere();
  const [config, people] = await Promise.all([
    readOnboarding(hs, holon),
    listOnboarding(hs, holon),
  ]);
  return { config, people };
}

/** Switch the holon's onboarding on or off, keeping its steps. */
export async function setOnboardingEnabled(
  holon: string,
  enabled: boolean,
): Promise<OnboardingConfig> {
  const hs = await getHolosphere();
  const config = await readOnboarding(hs, holon);
  return saveOnboarding(hs, holon, { ...config, enabled });
}

/** Vouch for an admin card; the key is linked when that was the last one. */
export async function confirmOnboardingCard(
  holon: string,
  view: OnboardingView,
  card: OnboardingCardView,
): Promise<boolean> {
  const hs = await getHolosphere();
  const result = await confirmCard(hs, holon, view.pubkey, card.step, card.id, {
    signer: sessionSigner(),
    appName: resolveAppName(),
  });
  if (!result) return false;
  // The person's next cards may be the bot's to deal (a Telegram holon).
  void fetch("/api/onboarding/nudge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ holon, pubkey: view.pubkey }),
  }).catch(() => {});
  return true;
}
