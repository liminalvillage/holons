// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// The one way a key's holder publishes their profile from Holons: read the
// kind 0 they already have, lay the edit over it, sign with their own key.
// Kind 0 is replaceable per pubkey with no `d`, so a blind write from here
// would erase whatever another Nostr client set (nip05, lud16, banner…).
// Telegram-derived keys never come through here — the bot projects theirs
// from the `users` record, and those keys have no life outside Holons.

import type { NostrSigner } from '../holosphere/signers.js';
import { profileContent } from '../nostr/codecs/profile.js';
import type { NostrEventLike } from '../nostr/types.js';
import { isPlaceholderName } from './ids.js';
import { fetchProfiles, mergeProfileContent, PROFILE_KIND, type ProfileQueryHost } from './profiles.js';

/** The fields a person edits about themselves. */
export interface ProfilePatch {
  first_name?: string;
  last_name?: string;
  username?: string;
  picture?: string;
  about?: string;
}

/** What `publishProfile` needs of holosphere. */
export interface ProfilePublishHost extends ProfileQueryHost {
  publishNostrEvents(events: unknown): void;
  get(holon: string, lens: string, key: string): Promise<unknown>;
  put(holon: string, lens: string, data: Record<string, unknown>): Promise<unknown>;
}

export interface PublishProfileOptions {
  /** Also update the person's `users/<pubkey>` record in this holon. */
  holon?: string | null;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

/**
 * Publish the signer's kind 0 with `patch` laid over what the relays hold,
 * and mirror the edit into their `users` record of `holon` when given. The
 * event is returned; null when the patch names nothing (or only a placeholder).
 */
export async function publishProfile(
  hs: ProfilePublishHost,
  signer: NostrSigner,
  patch: ProfilePatch,
  opts: PublishProfileOptions = {},
): Promise<NostrEventLike | null> {
  const me = String(signer.pubkey).toLowerCase();
  const clean: ProfilePatch = {};
  for (const [k, v] of Object.entries(patch) as Array<[keyof ProfilePatch, unknown]>) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if ((k === 'first_name' || k === 'username') && s && isPlaceholderName(s, me)) continue;
    clean[k] = s;
  }
  if (!Object.keys(clean).length) return null;

  // The record as this holon knows it, so the kind 0 carries the WHOLE name
  // (an edit of the first name alone keeps the last name).
  let record: Record<string, unknown> = { id: me };
  if (opts.holon) {
    try {
      const cur = await hs.get(opts.holon, 'users', me);
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) record = { ...(cur as Record<string, unknown>) };
    } catch {
      /* no record yet */
    }
  }
  for (const [k, v] of Object.entries(clean)) {
    if (v === '') delete record[k];
    else record[k] = v;
  }
  record.id = me;

  const existing = (await fetchProfiles(hs, [me])).get(me)?.raw ?? {};
  const content = profileContent(record as never);
  // `name` is the handle: touched only when the handle was edited, or set
  // when the profile has none yet. `display_name` follows a name edit.
  const hasName = typeof existing.name === 'string' && existing.name.trim();
  const next = mergeProfileContent(existing, {
    name: clean.username !== undefined ? (content.name ?? '') : hasName ? undefined : content.name,
    display_name: clean.first_name !== undefined || clean.last_name !== undefined ? (content.display_name ?? '') : undefined,
    about: clean.about !== undefined ? (content.about ?? '') : undefined,
    picture: clean.picture !== undefined ? (content.picture ?? '') : undefined,
  });
  const event = signer.sign({
    kind: PROFILE_KIND,
    created_at: opts.now ? opts.now() : Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(next),
  }) as unknown as NostrEventLike;
  hs.publishNostrEvents(event);
  if (opts.holon) {
    try {
      await hs.put(opts.holon, 'users', record);
    } catch {
      /* the relay has the profile; the record follows when the holon allows */
    }
  }
  return event;
}
