// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Fund claims on the kiosk: reading the `flow_claims` log with everything the
// fold needs, and recording entries signed as the logged-in person.
//
// A claim is a signed, append-only entry; who it counts for and whether it
// counts is decided by `@holons/core/flows` `foldClaimsFromLenses` from the
// holon's membership log, settings, users and identity directory — the same
// fold every other surface runs. Recording goes two ways, like shift signups:
//   - a Telegram login is signed server-side under the member's derived key
//     (/api/flows/log), the browser then applies + publishes the event;
//   - a key login signs right here with the adopted session key.
// The kiosk's own device key never signs a claim: nobody vouches for it.

import type { HoloSphere, LogEntry } from "holosphere";
import { get } from "svelte/store";
import { signerFromSecretKey } from "@holons/core/holosphere";
import {
  MEMBERS_LENS,
  POLICY_LENS,
  logTemplate,
  readMembersLog,
  type Appendable,
  type LogEvent,
  type MembershipEnvelope,
} from "@holons/core/protocol";
import {
  FLOW_CLAIMS_LENS,
  buildClaim,
  buildClaimVerdict,
  buildPayout,
} from "@holons/core/flows";
import { attestationsFrom, SHIFT_IDENTITY_LENS } from "@holons/core/shifts";
import type { IdentityAttestation } from "@holons/core/shifts";
import { currentUser } from "./auth";
import { resolveAppName } from "./config";
import { getSessionSecret } from "./sessionKey";

export type { LogEvent };

/** Everything the claims fold reads besides settings and users. */
export interface ClaimsLogs {
  entries: LogEvent<unknown>[];
  policy: LogEvent<unknown>[];
  members: MembershipEnvelope[];
  attestations: IdentityAttestation[];
}

const asEvent = (e: LogEntry): LogEvent<unknown> => ({
  id: e.id,
  pubkey: e.pubkey,
  created_at: e.created_at,
  refs: e.refs,
  item: e.item,
});

/**
 * Watch the logs the fold reads. `onChange` fires with the full picture on
 * every change; returns the unsubscribe function.
 */
export function watchClaimsLogs(
  hs: HoloSphere,
  holon: string,
  onChange: (logs: ClaimsLogs) => void,
): () => void {
  const state: ClaimsLogs = { entries: [], policy: [], members: [], attestations: [] };
  let alive = true;
  let scheduled = false;
  const emit = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (alive) onChange({ ...state, entries: [...state.entries], policy: [...state.policy] });
    });
  };
  const entries = new Map<string, LogEvent<unknown>>();
  const policy = new Map<string, LogEvent<unknown>>();
  const offEntries = hs.subscribeLog(holon, FLOW_CLAIMS_LENS, (e) => {
    entries.set(e.id, asEvent(e));
    state.entries = [...entries.values()];
    emit();
  });
  const offPolicy = hs.subscribeLog(holon, POLICY_LENS, (e) => {
    policy.set(e.id, asEvent(e));
    state.policy = [...policy.values()];
    emit();
  });
  // The membership log and the identity directory are read, not watched:
  // both change rarely, and a re-read on the next claim is soon enough.
  const refreshMembers = async () => {
    try {
      await hs.getAll(holon, MEMBERS_LENS); // catches the lens up from the relays
      state.members = await readMembersLog(hs, holon);
    } catch {
      state.members = [];
    }
    try {
      const dir = (await hs.getAllGlobal(SHIFT_IDENTITY_LENS)) as never[];
      state.attestations = attestationsFrom(dir || []);
    } catch {
      state.attestations = [];
    }
    emit();
  };
  void refreshMembers();
  const timer = setInterval(() => void refreshMembers(), 5 * 60_000);
  return () => {
    alive = false;
    clearInterval(timer);
    offEntries();
    offPolicy();
  };
}

/** Who this session signs log entries as, or null when it cannot. */
export async function claimSigner(): Promise<{ pubkey: string; party: string; mode: "server" | "local" } | null> {
  const user = get(currentUser);
  if (!user) return null;
  if (user.provider !== "telegram") {
    return getSessionSecret() ? { pubkey: String(user.id), party: String(user.id), mode: "local" } : null;
  }
  try {
    const res = await fetch("/api/flows/log");
    const body = res.ok ? await res.json() : null;
    return body?.pubkey ? { pubkey: body.pubkey, party: String(user.id), mode: "server" } : null;
  } catch {
    return null;
  }
}

/** Sign an entry as the logged-in person and add it to the log. Returns the signed event. */
export async function recordLogEntry(
  hs: HoloSphere,
  holon: string,
  lens: string,
  appendable: Appendable<Record<string, unknown>>,
) {
  const user = get(currentUser);
  if (!user) throw new Error("Sign in to record a claim");
  const refs = appendable.refs as Record<string, string | string[]> | undefined;
  if (user.provider !== "telegram") {
    const secret = getSessionSecret();
    if (!secret) throw new Error("This session cannot sign (reload lost the key)");
    const event = signerFromSecretKey(secret).sign(
      logTemplate({ holon, lens, appName: resolveAppName(), item: appendable.item, refs }),
    );
    await hs.appendSigned(event as never);
    return event;
  }
  const res = await fetch("/api/flows/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ holon, lens, item: appendable.item, refs }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.event) throw new Error(String(body?.error ?? `Signing failed (${res.status})`));
  await hs.appendSigned(body.event);
  return body.event;
}

export function recordClaim(hs: HoloSphere, holon: string, input: { party: string; amount: number; unit: string; memo?: string; percentage?: number }) {
  return recordLogEntry(hs, holon, FLOW_CLAIMS_LENS, buildClaim(input) as never);
}
export function recordVerdict(hs: HoloSphere, holon: string, claimId: string, verdict: "attest" | "dispute", reason?: string) {
  return recordLogEntry(hs, holon, FLOW_CLAIMS_LENS, buildClaimVerdict(claimId, verdict, reason) as never);
}
export function recordPayout(hs: HoloSphere, holon: string, input: { claimId: string; party: string; amount: number; unit: string; memo?: string }) {
  return recordLogEntry(hs, holon, FLOW_CLAIMS_LENS, buildPayout(input) as never);
}
