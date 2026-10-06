// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The kiosk's side of key-based membership: who is seated in a hub founded
// from a screen, who is asking to be, and the signer that lets this session
// answer. Meaning lives in @holons/core/holons (join requests are NIP-29
// kind-9021 events, seats are the signed `_members` log); this module only
// hands it the session key and remembers which requests this screen waved
// away — NIP-29 has no "decline" event, so a decline is local.

import { signerFromSecretKey, type NostrSigner } from "@holons/core/holosphere";
import {
  approveJoin,
  leaveHolon,
  removeSeat,
  requestToJoin,
  watchJoinRequests,
  type JoinRequest,
} from "@holons/core/holons";
import { addHolonMember, removeHolonMember } from "@holons/core/protocol";
import type { Role } from "@holons/core/protocol";
import { resolveAppName } from "./config";
import { getHolosphere } from "./holosphere";
import { getSessionSecret } from "./sessionKey";

export type { JoinRequest };

/** The adopted session key as a signer, or null when nobody's key is up. */
export function sessionSigner(): NostrSigner | null {
  const secret = getSessionSecret();
  return secret ? signerFromSecretKey(secret) : null;
}

const opts = () => ({ appName: resolveAppName() });

/** Live join requests of `hub` (verified, newest per key, seated keys left out). */
export function watchRequests(
  hub: string,
  onChange: (requests: JoinRequest[]) => void,
): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  void getHolosphere().then((hs) => {
    if (stopped) return;
    stop = watchJoinRequests(hs, hub, (r) =>
      onChange(r.filter((x) => !isDismissed(hub, x.pubkey))),
    );
  });
  return () => {
    stopped = true;
    stop?.();
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

/** Ask to join `hub` as the session key (a kind-9021, carrying a name). */
export async function askToJoin(hub: string, name: string): Promise<boolean> {
  const signer = sessionSigner();
  if (!signer) return false;
  const hs = await getHolosphere();
  requestToJoin(hs, hub, signer, { ...opts(), reason: name });
  return true;
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
