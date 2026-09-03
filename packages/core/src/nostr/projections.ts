// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Registry of lens → codec, plus the adapter that turns codecs into the
// generic hooks `holosphere/projections.js` consumes.

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1';
import * as nip19 from 'nostr-tools/nip19';
import type { LensCodec, NostrEventLike, ProjectionCtx, ProjectionHook, Reversed } from './types.js';
import { calendarCodec } from './codecs/calendar.js';
import { classifiedCodec } from './codecs/classified.js';
import { profileCodec } from './codecs/profile.js';
import { setCodec } from './codecs/sets.js';
import { badgeCodec } from './codecs/badges.js';
import { groupCodec } from './codecs/group.js';

/** All lenses that have a standard-kind projection. */
export const PROJECTION_CODECS: Readonly<Record<string, LensCodec<any>>> = {
  quests: calendarCodec('quests'),
  events: calendarCodec('events'),
  offers: classifiedCodec,
  users: profileCodec,
  checklists: setCodec('checklists'),
  shopping: setCodec('shopping'),
  library: setCodec('library'),
  roles: badgeCodec,
  settings: groupCodec,
};

export const PROJECTABLE_LENSES: readonly string[] = Object.keys(PROJECTION_CODECS);

/** Kinds whose external edits are folded back into each lens (phase 2). */
export const REVERSE_KINDS: Readonly<Record<string, readonly number[]>> = Object.fromEntries(
  Object.entries(PROJECTION_CODECS).filter(([, c]) => c.parse && c.merge).map(([l, c]) => [l, c.kinds]),
);

/**
 * Parse `HOLOSPHERE_PROJECTIONS`. Projections are ON by default: unset/empty
 * and `all` → every lens; `off` opts out; otherwise a comma-separated list
 * (unknown names are dropped).
 */
export function parseProjectionList(raw: string | undefined | null): string[] {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'off' || v === 'false' || v === '0' || v === 'none') return [];
  if (!v || v === 'all' || v === 'true' || v === '1') return [...PROJECTABLE_LENSES];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && PROJECTABLE_LENSES.includes(s));
}

/** Codec hooks for `lenses`, bound to a context. */
export function buildProjections(lenses: readonly string[], ctx: ProjectionCtx): ProjectionHook[] {
  const hooks: ProjectionHook[] = [];
  for (const lens of lenses) {
    const codec = PROJECTION_CODECS[lens];
    if (!codec) continue;
    hooks.push({
      lens,
      kinds: codec.kinds,
      requiresAuthor: codec.requiresAuthor,
      project: (holon, _lens, item) => codec.project(holon, item as never, ctx),
      retract: (holon, _lens, id) => codec.retract(holon, id, ctx),
      ...(codec.parse && codec.merge
        ? {
            parse: (event: NostrEventLike) => codec.parse!(event, ctx) as Reversed | null,
            merge: (current: unknown, r: Reversed) => codec.merge!(current as never, r as never, ctx),
          }
        : {}),
    });
  }
  return hooks;
}

/**
 * A Nostr secret key as 64-char hex, whatever form it was given in:
 * hex, NIP-19 `nsec1…` (the form every `*_NSEC` env var should hold) or
 * raw bytes. Throws on anything else.
 */
export function nsecToHex(secret: string | Uint8Array): string {
  if (typeof secret !== 'string') return bytesToHex(secret);
  const v = secret.trim();
  if (/^nsec1/i.test(v)) {
    const { type, data } = nip19.decode(v.toLowerCase());
    if (type !== 'nsec') throw new Error(`expected an nsec, got ${type}`);
    return bytesToHex(data as Uint8Array);
  }
  if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error('expected 64 hex chars or an nsec1… string');
  return v.toLowerCase();
}

/** NIP-19 `nsec1…` encoding of a secret key (hex, nsec or bytes). */
export function toNsec(secret: string | Uint8Array): string {
  return nip19.nsecEncode(hexToBytes(nsecToHex(secret)));
}

/** A fresh random secret key as `nsec1…`. */
export function generateNsec(): string {
  return nip19.nsecEncode(schnorr.utils.randomPrivateKey());
}

/** Hex x-only pubkey of a Nostr secret key (hex, nsec or bytes). */
export function pubkeyOf(privateKey: string | Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(nsecToHex(privateKey))));
}

/** Inputs for {@link projectionOptionsFor}. */
export interface ProjectionOptionsInput extends Omit<ProjectionCtx, 'appName' | 'holonPubkey'> {
  appName: string;
  /** The instance's signing key; its pubkey addresses every projected event. */
  privateKey: string | Uint8Array;
  /** `HOLOSPHERE_PROJECTIONS`-style value; unset → every projectable lens. */
  lenses?: string | readonly string[] | null;
  /** Per-user signer for kind 0 / RSVPs (the bot derives member keys). */
  signerFor?: (userId: string | number) => string | Uint8Array | null | undefined;
  /** Service-level identity provider key (kind-31926 attestations). */
  providerKey?: string | Uint8Array | null;
  /** Who may edit a holon's records over standard kinds (reverse sync). */
  trustedAuthors?: (holon: string) => string[] | Promise<string[]>;
  /** Fold external edits back (default on). */
  reverseSync?: boolean;
  reverseLookbackSec?: number;
}

/**
 * The `nostr` block every surface passes to `createHoloSphere`: standard-kind
 * projections for the configured lenses (all of them by default) plus the
 * reverse sync of external edits. Returns `{}` when projections are off, so
 * it can always be spread/passed as-is.
 */
export function projectionOptionsFor(input: ProjectionOptionsInput): {
  projections?: ProjectionHook[];
  signerFor?: ProjectionOptionsInput['signerFor'];
  providerKey?: ProjectionOptionsInput['providerKey'];
  trustedAuthors?: ProjectionOptionsInput['trustedAuthors'];
  reverseSync?: boolean;
  reverseLookbackSec?: number;
} {
  const { appName, privateKey, lenses, signerFor, providerKey, trustedAuthors, reverseSync, reverseLookbackSec, ...ctx } = input;
  const list = Array.isArray(lenses)
    ? lenses.filter((l) => PROJECTABLE_LENSES.includes(l))
    : parseProjectionList(lenses as string | undefined | null);
  if (!list.length) return {};
  const projections = buildProjections(list, { ...ctx, appName, holonPubkey: pubkeyOf(privateKey) });
  return {
    projections,
    ...(signerFor ? { signerFor } : {}),
    ...(providerKey ? { providerKey } : {}),
    ...(trustedAuthors ? { trustedAuthors } : {}),
    reverseSync: reverseSync ?? true,
    ...(reverseLookbackSec ? { reverseLookbackSec } : {}),
  };
}
