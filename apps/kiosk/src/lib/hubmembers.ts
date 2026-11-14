// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk's side of key-based membership: who is seated in a hub founded
// from a screen, who is asking to be, and the signer that lets this session
// answer. Meaning lives in @holons/core/holons (join requests are NIP-29
// kind-9021 events, seats are the signed `_members` log); this module only
// hands it the session key and remembers which requests this screen waved
// away — NIP-29 has no "decline" event, so a decline is local.

import { get } from "svelte/store";
import { signerFromSecretKey, type NostrSigner } from "@holons/core/holosphere";
import {
  applyToHolon,
  approveJoin,
  joinReadiness,
  leaveHolon,
  removeSeat,
  watchJoinRequests,
  type JoinReadiness,
  type JoinRequest,
} from "@holons/core/holons";
import { dnaHash, subscribeGenes } from "@holons/core/dna";
import { addHolonMember, removeHolonMember } from "@holons/core/protocol";
import type { Role } from "@holons/core/protocol";
import { resolveAppName } from "./config";
import { getHolosphere } from "./holosphere";
import { getSessionSecret, sessionKeyPub } from "./sessionKey";
import { currentUser } from "./auth";

export type { JoinRequest };

/** A join request with where it stands on the holon's DNA as it is now. */
export interface ReadiedRequest extends JoinRequest {
  readiness: JoinReadiness;
}

/** The adopted session key as a signer, or null when nobody's key is up. */
export function sessionSigner(): NostrSigner | null {
  const secret = getSessionSecret();
  return secret ? signerFromSecretKey(secret) : null;
}

const opts = () => ({ appName: resolveAppName() });

/**
 * Live join requests of `hub` (verified, newest per key, seated keys left
 * out), each with its readiness against the holon's DNA as it is now
 * (core `joinReadiness`): re-said whenever a request or a gene changes.
 */
export function watchRequests(
  hub: string,
  onChange: (requests: ReadiedRequest[]) => void,
): () => void {
  let stops: Array<() => void> = [];
  let stopped = false;
  let latest: JoinRequest[] = [];
  // undefined until the genes are read: `unknown`, never a guess.
  let current: string | null | undefined;
  const emit = () => {
    if (stopped) return;
    onChange(
      latest
        .filter((x) => !isDismissed(hub, x.pubkey))
        .map((r) => ({ ...r, readiness: joinReadiness(r, current) })),
    );
  };
  void getHolosphere().then((hs) => {
    if (stopped) return;
    stops = [
      watchJoinRequests(hs, hub, (r) => {
        latest = r;
        emit();
      }),
      subscribeGenes(hs, hub, (genes) => {
        current = dnaHash(genes);
        emit();
      }),
    ];
  });
  return () => {
    stopped = true;
    for (const stop of stops) stop();
  };
}

/** Seat a key. With a session key the NIP-29 companions go out too. */
export async function seat(
  hub: string,
  key: string,
  role: Role = "member",
  name?: string,
): Promise<string> {
  const hs = await getHolosphere();
  const signer = sessionSigner();
  const pub = signer
    ? await approveJoin(hs, hub, key, signer, { ...opts(), role, name })
    : await addHolonMember(hs, hub, key, role);
  undismiss(hub, pub);
  return pub;
}

/** Unseat a key. */
export async function unseat(hub: string, key: string): Promise<string> {
  const hs = await getHolosphere();
  const signer = sessionSigner();
  return signer
    ? removeSeat(hs, hub, key, signer, opts())
    : removeHolonMember(hs, hub, key);
}

/**
 * Ask to join `hub` as the session key, agreeing to the DNA whose hash is
 * `acknowledged` (null: the holon showed none to agree to) — core's
 * `applyToHolon`, which refuses a hash that is not the DNA now
 * (`DnaChanged`). A Telegram login also names its Telegram id, so the bot of
 * a Telegram group can prove it and link a member of the group at once.
 * Remembered on this screen as asked (see `askedHere`).
 */
export async function applyFor(
  hub: string,
  acknowledged: string | null,
  name: string,
): Promise<void> {
  const signer = sessionSigner();
  if (!signer) throw new Error("not logged in");
  const hs = await getHolosphere();
  const user = get(currentUser);
  const telegramId = user?.provider === "telegram" ? user.id : undefined;
  await applyToHolon(hs, hub, signer, {
    ...opts(),
    acknowledged,
    reason: name,
    telegramId,
  });
  markAsked(hub, signer.pubkey);
}

// ── Asked on this screen ───────────────────────────────────────────────────
//
// A request travels to whoever answers for the holon (its bot, its admins)
// and comes back as a record a moment later; meanwhile the onboarding
// screen says it was sent instead of "you haven't asked".

const ASKED_KEY = "kiosk_asked_joins";
const ASKED_FOR_MS = 15 * 60 * 1000;

function askedMarks(): Record<string, number> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ASKED_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

const askedMemory: Record<string, number> = {};

function markAsked(hub: string, pubkey: string): void {
  const mark = `${hub}|${pubkey.toLowerCase()}`;
  askedMemory[mark] = Date.now();
  try {
    sessionStorage.setItem(
      ASKED_KEY,
      JSON.stringify({ ...askedMarks(), [mark]: Date.now() }),
    );
  } catch {
    /* this screen's memory still has it */
  }
}

/** The session key asked to join `hub` from this screen a moment ago. */
export function askedHere(hub: string, now = Date.now()): boolean {
  const pub = get(sessionKeyPub);
  if (!pub) return false;
  const mark = `${hub}|${pub.toLowerCase()}`;
  const at = askedMemory[mark] ?? askedMarks()[mark];
  return typeof at === "number" && now - at < ASKED_FOR_MS;
}

/** Say goodbye (a kind-9022); an admin takes the seat away. */
export async function leave(hub: string): Promise<boolean> {
  const signer = sessionSigner();
  if (!signer) return false;
  const hs = await getHolosphere();
  leaveHolon(hs, hub, signer, opts());
  return true;
}

// ── Local dismissals ───────────────────────────────────────────────────────

const DISMISSED_KEY = "kiosk_dismissed_joins";

/** `hub|pubkey` marks, parsed; anything malformed dropped. */
export function parseDismissed(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const list = JSON.parse(raw);
    return new Set(
      Array.isArray(list)
        ? list.filter(
            (m): m is string => typeof m === "string" && m.includes("|"),
          )
        : [],
    );
  } catch {
    return new Set();
  }
}

function load(): Set<string> {
  try {
    return parseDismissed(localStorage.getItem(DISMISSED_KEY));
  } catch {
    return new Set();
  }
}
function save(set: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

export function isDismissed(hub: string, pubkey: string): boolean {
  return load().has(`${hub}|${pubkey.toLowerCase()}`);
}
export function dismissJoin(hub: string, pubkey: string): void {
  const set = load();
  set.add(`${hub}|${pubkey.toLowerCase()}`);
  save(set);
}
export function undismiss(hub: string, pubkey: string): void {
  const set = load();
  if (set.delete(`${hub}|${pubkey.toLowerCase()}`)) save(set);
}
