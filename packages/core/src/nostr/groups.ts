// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// NIP-29 relay-based groups, holon-authored. A holon IS a group: group id =
// holon id (the `h` tag HoloSphere already stamps). relay.holons.io (strfry)
// does not implement NIP-29, so the HOLON KEY publishes the state events a
// NIP-29 relay would sign — 39000 metadata, 39001 admins, 39002 members —
// and the moderation events an admin would send (9000 put-user, 9001
// remove-user); members publish their own 9021 join / 9022 leave requests.
// Consumers trust these from the holon's pubkey, which is the same trust root
// the reverse sync uses. A real NIP-29 relay can take over later unchanged.

import type { EventTemplate, ProjectionCtx } from './types.js';
import { HOLONS_ORIGIN_TAG, nowOf } from './tags.js';

export const GROUP_METADATA_KIND = 39000;
export const GROUP_ADMINS_KIND = 39001;
export const GROUP_MEMBERS_KIND = 39002;
export const GROUP_PUT_USER_KIND = 9000;
export const GROUP_REMOVE_USER_KIND = 9001;
export const GROUP_JOIN_REQUEST_KIND = 9021;
export const GROUP_LEAVE_REQUEST_KIND = 9022;

export interface GroupSettingsLike {
  name?: string;
  title?: string;
  purpose?: string | string[];
  description?: string;
  picture?: string | null;
  admin?: string;
  /** Holons: a holon readable by anyone on the relay. */
  isPublic?: boolean;
  [key: string]: unknown;
}

const base = (ctx: ProjectionCtx, holon: string): string[][] => [
  ['n', ctx.appName],
  [HOLONS_ORIGIN_TAG, 'group', holon, holon],
];

/** 39000 — name/about/picture + public|private, open|closed. */
export function groupMetadataTemplate(ctx: ProjectionCtx, holon: string, settings: GroupSettingsLike): EventTemplate {
  const tags: string[][] = [['d', holon], ...base(ctx, holon)];
  const name = settings.name || settings.title;
  if (typeof name === 'string' && name.trim()) tags.push(['name', name]);
  const about = Array.isArray(settings.purpose) ? settings.purpose.filter((p) => typeof p === 'string').join('\n') : settings.purpose ?? settings.description;
  if (typeof about === 'string' && about.trim()) tags.push(['about', about]);
  if (typeof settings.picture === 'string' && /^https?:\/\//i.test(settings.picture)) tags.push(['picture', settings.picture]);
  tags.push([settings.isPublic === false ? 'private' : 'public']);
  tags.push(['closed']); // membership is granted by the holon (Telegram join), never self-served
  return { kind: GROUP_METADATA_KIND, created_at: nowOf(ctx), tags, content: '' };
}

/** 39001 — the holon key plus the settings admin (when their key resolves). */
export function groupAdminsTemplate(ctx: ProjectionCtx, holon: string, settings: GroupSettingsLike): EventTemplate {
  const tags: string[][] = [['d', holon], ...base(ctx, holon), ['p', ctx.holonPubkey, 'admin']];
  const admin = typeof settings.admin === 'string' ? settings.admin.replace(/^@/, '') : '';
  const pk = admin ? ctx.pubkeyFor?.(admin) : undefined;
  if (pk && pk !== ctx.holonPubkey) tags.push(['p', pk, 'admin']);
  return { kind: GROUP_ADMINS_KIND, created_at: nowOf(ctx), tags, content: '' };
}

/** 39002 — every member whose key resolves, sorted for a stable state hash. */
export function groupMembersTemplate(ctx: ProjectionCtx, holon: string, memberIds: Array<string | number>): EventTemplate {
  const pks = new Set<string>();
  for (const id of memberIds) {
    const pk = ctx.pubkeyFor?.(id);
    if (pk) pks.add(pk);
  }
  const tags: string[][] = [['d', holon], ...base(ctx, holon), ...[...pks].sort().map((pk) => ['p', pk])];
  return { kind: GROUP_MEMBERS_KIND, created_at: nowOf(ctx), tags, content: '' };
}

/** Stable fingerprint of a group state template (tags only), for change detection. */
export function groupStateHash(t: EventTemplate): string {
  return JSON.stringify(t.tags.filter((x) => x[0] !== 'n'));
}

export function groupPutUserTemplate(ctx: ProjectionCtx, holon: string, pubkey: string, role: 'member' | 'admin' = 'member'): EventTemplate {
  return { kind: GROUP_PUT_USER_KIND, created_at: nowOf(ctx), tags: [['h', holon], ['p', pubkey, role], ...base(ctx, holon)], content: '' };
}

export function groupRemoveUserTemplate(ctx: ProjectionCtx, holon: string, pubkey: string): EventTemplate {
  return { kind: GROUP_REMOVE_USER_KIND, created_at: nowOf(ctx), tags: [['h', holon], ['p', pubkey], ...base(ctx, holon)], content: '' };
}

/** 9021/9022 — signed by the member. */
export function groupJoinRequestTemplate(ctx: ProjectionCtx, holon: string, reason = ''): EventTemplate {
  return { kind: GROUP_JOIN_REQUEST_KIND, created_at: nowOf(ctx), tags: [['h', holon], ...base(ctx, holon)], content: reason };
}

export function groupLeaveRequestTemplate(ctx: ProjectionCtx, holon: string): EventTemplate {
  return { kind: GROUP_LEAVE_REQUEST_KIND, created_at: nowOf(ctx), tags: [['h', holon], ...base(ctx, holon)], content: '' };
}

/**
 * The full holon-authored group state for one holon. `members` = ids from the
 * `users` lens. Hosts publish these (signed with the holon key) whenever the
 * hash changes — see the bot's group publisher.
 */
export function buildGroupState(ctx: ProjectionCtx, holon: string, settings: GroupSettingsLike, memberIds: Array<string | number>): EventTemplate[] {
  return [
    groupMetadataTemplate(ctx, holon, settings),
    groupAdminsTemplate(ctx, holon, settings),
    groupMembersTemplate(ctx, holon, memberIds),
  ];
}

/** Read a 39002 (from a trusted author) back to a member pubkey list. */
export function parseGroupMembers(event: { kind: number; tags: string[][] }): string[] | null {
  if (event.kind !== GROUP_MEMBERS_KIND) return null;
  return event.tags.filter((t) => t[0] === 'p' && /^[0-9a-f]{64}$/i.test(t[1] ?? '')).map((t) => t[1].toLowerCase());
}
