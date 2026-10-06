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
import {
  createNameResolver,
  normalizeId,
  shortId,
  userName,
} from '@holons/core/identity';

// One name resolver per instance (`@holons/core/identity`): the same rule
// every surface applies — the holon's users, the person's own record, the
// key directory, kind-0 profiles, settings, never a bare id. Bot style:
// "Ada L.".
const resolvers = new WeakMap();

/** The instance's name resolver (created on first use). */
export function nameResolver(db) {
  let r = resolvers.get(db);
  if (!r) {
    r = createNameResolver(db, { format: { lastName: 'initial' } });
    resolvers.set(db, r);
  }
  return r;
}

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

/**
 * Member → display name, from the users lens, keyed by the member's id AND
 * by every key they hold — the derived one (with the secret) and the keys
 * they linked — so a claim or vote signed by any of them names the person.
 * A record with no name is shown in the short form (`#id`), never bare.
 * @param {object} db
 * @param {string} holon
 * @param {{ secret?: string }} [options] NOSTR_DERIVATION_SECRET (default: the env)
 */
export async function memberNames(
  db,
  holon,
  { secret = process.env.NOSTR_DERIVATION_SECRET ?? '' } = {}
) {
  const map = new Map();
  let users = [];
  try {
    users = (await db.getAll(String(holon), 'users')) || [];
  } catch {
    users = [];
  }
  for (const u of users) {
    if (!u || u.id === undefined || u.id === null) continue;
    const id = String(u.id);
    const own = userName(u, {
      lastName: 'initial',
      idFallback: false,
      unknown: '',
    });
    const handle = String(u.username ?? '').replace(/^@/, '');
    const withHandle =
      own && handle && !/^\d+$/.test(handle) && handle !== own
        ? `${own} (@${handle})`
        : own;
    const label = withHandle || shortId(id);
    map.set(id, label);
    const keys = [...linkedKeysOf(u)];
    if (secret && /^\d+$/.test(id)) {
      try {
        keys.push(deriveTelegramNostrKey(id, secret).publicKey);
      } catch {
        /* unparsable id */
      }
    }
    for (const k of keys) if (k && !map.has(k)) map.set(k, label);
  }
  return map;
}

/**
 * Names for `ids` in `holon`: members from the users lens, everyone and
 * everything else (partner holons, foreign keys) through the resolver.
 * Every id given is in the result — named, or in the short form.
 * @param {object} db
 * @param {string} holon
 * @param {Iterable<string>} ids
 * @returns {Promise<Map<string, string>>}
 */
export async function partyNames(db, holon, ids = []) {
  const map = await memberNames(db, holon);
  const rest = [
    ...new Set([...ids].map(id => String(id ?? '')).filter(Boolean)),
  ].filter(id => !map.has(id) && !map.has(normalizeId(id)));
  if (rest.length) {
    const r = nameResolver(db);
    r.setHolon(String(holon));
    try {
      for (const [id, name] of await r.resolve(rest)) map.set(id, name);
    } catch {
      for (const id of rest) map.set(id, shortId(id));
    }
  }
  return map;
}

/** One member's label in `holon`, resolved by any id or key. */
export async function memberDisplayName(db, holon, id) {
  const names = await partyNames(db, holon, [id]);
  return names.get(String(id)) ?? names.get(normalizeId(id)) ?? shortId(id);
}
