// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// What every log fold on the bot reads before folding: the lens's entries,
// the policy log, the signed membership log, settings, users, the identity
// directory — plus the two things only the bot knows: each member's derived
// key (it holds the derivation secret) and, through the policy's pins, the
// partners whose logs fold in. One place, so /fundclaims and /votes cannot
// drift from each other or from the kiosk.

import {
  MEMBERS_LENS,
  POLICY_LENS,
  importPartnerLogs,
  lensContext,
  logTemplate,
  readMembersLog,
} from '@holons/core/protocol';
import { attestationsFrom, SHIFT_IDENTITY_LENS } from '@holons/core/shifts';
import { deriveTelegramNostrKey } from '@holons/core/auth';
import { linkedKeysOf } from '@holons/core/users';

/**
 * Everything a `fold*FromLenses` takes for `lens`, from the instance.
 * @param {object} db HoloSphere (the holon key)
 * @param {string} holon
 * @param {string} lens the append-only lens to fold
 * @param {{ secret?: string }} [options]
 */
export async function readLogContext(db, holon, lens, { secret = '' } = {}) {
  const h = String(holon);
  const [entries, policyEntries, settings, users, dir] = await Promise.all([
    db.getLog(h, lens),
    db.getLog(h, POLICY_LENS).catch(() => []),
    db.get(h, 'settings', h).catch(() => null),
    db.getAll(h, 'users').catch(() => []),
    db.getAllGlobal(SHIFT_IDENTITY_LENS).catch(() => []),
  ]);
  await db.getAll(h, MEMBERS_LENS).catch(() => []);
  const membersLog = await readMembersLog(db, h);
  const extraKeyToParty = [];
  for (const u of users || []) {
    if (!u || u.id === undefined || u.id === null) continue;
    if (secret) {
      try {
        extraKeyToParty.push([
          deriveTelegramNostrKey(u.id, secret).publicKey,
          String(u.id),
        ]);
      } catch {
        /* skip */
      }
    }
    for (const k of linkedKeysOf(u)) extraKeyToParty.push([k, String(u.id)]);
  }
  const base = {
    holonId: h,
    policyEntries,
    membersLog,
    settings,
    users,
    attestations: attestationsFrom(dir || []),
    extraKeyToParty,
    extraMembers: extraKeyToParty.map(([k]) => k),
    holonPubkey: db.currentPubkey,
  };
  // The partners the policy pins are read by their own rules.
  const rule = lensContext(base).policyFor(lens);
  const imports = await importPartnerLogs(db, lens, rule).catch(() => []);
  return { ...base, entries, imports, users: users || [] };
}

/**
 * Sign an entry as the member (derived key) and add it to the log; without
 * a derivation secret the holon key signs on the member's behalf.
 * @param {object} db
 * @param {{ memberSigner: (id: string) => any }} identity
 * @param {string} userId
 * @param {string} holon
 * @param {string} lens
 * @param {{ item: object, refs?: object }} appendable
 * @param {{ at?: number }} [options] unix seconds to stamp (default now)
 */
export async function appendAsMember(
  db,
  identity,
  userId,
  holon,
  lens,
  appendable,
  { at } = {}
) {
  const signer = identity.memberSigner(userId);
  const created_at = at ?? Math.floor(Date.now() / 1000);
  if (signer) {
    const event = signer.sign(
      logTemplate({
        holon: String(holon),
        lens,
        appName: db.appname,
        item: appendable.item,
        refs: appendable.refs,
        created_at,
      })
    );
    await db.appendSigned(event);
    return event;
  }
  return db.append(String(holon), lens, appendable.item, {
    refs: appendable.refs,
    created_at,
  });
}

/** Member id → display name, from the users lens. */
export async function memberNames(db, holon) {
  const map = new Map();
  let users = [];
  try {
    users = (await db.getAll(String(holon), 'users')) || [];
  } catch {
    users = [];
  }
  for (const u of users) {
    if (!u || u.id === undefined || u.id === null) continue;
    const name = u.first_name || u.username || String(u.id);
    map.set(String(u.id), u.username ? `${name} (@${u.username})` : name);
  }
  return map;
}
