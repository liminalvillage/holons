// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// Test helpers for specs that need a join request as it arrives — any DNA
// hash or none, at any time — without the person-side checks
// `applyToHolon` makes. Never imported by product code (the package exports
// only each domain's index).

import type { HoloSphere } from 'holosphere';
import type { NostrSigner } from '../holosphere/signers.js';
import { groupJoinRequestTemplate } from '../nostr/groups.js';
import { holonProjectionCtx, type HolonPublishOptions, type SignedEvent } from './index.js';

export interface SignJoinRequestOptions extends HolonPublishOptions {
  reason?: string;
  telegramId?: string | number;
  /** The DNA hash the request carries, whatever the holon's is. */
  dna?: string | null;
  /** Hand it to the relay side as `applyToHolon` does (default true). */
  publish?: boolean;
}

/** A kind-9021 signed by `signer`, as a person's surface would send it. */
export function signJoinRequest(hs: HoloSphere, holon: string, signer: NostrSigner, opts: SignJoinRequestOptions = {}): SignedEvent {
  const ctx = holonProjectionCtx(hs, holon, opts);
  const event = signer.sign(groupJoinRequestTemplate(ctx, holon, opts.reason ?? '', opts.telegramId, opts.dna));
  if (opts.publish !== false) hs.publishNostrEvents(event);
  return event;
}
