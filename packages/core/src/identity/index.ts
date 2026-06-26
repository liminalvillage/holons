/**
 * @holons/core/identity — one shared place to turn a user record into a display
 * name, and to build a holon-wide id→name map from the scattered sources.
 *
 * A user's name can live in several lenses: the `users` profile lens (richest:
 * first/last/username), quest participants/initiators (real first/last names),
 * and the REA event stream (only a username on each agent). Every UI used to
 * re-derive this — the bot's `getDisplayName`, the web's `resolvedName`, the
 * kiosk's `nameOf`/`questNameMap` — and they drifted. This module owns the
 * *source-priority* logic; surface-specific *formatting* (last-name style, the
 * '@' handle prefix, fallback strings) is expressed through {@link NameOptions}.
 *
 * Pairs with @holons/core/scoring's `extractReaUsers`, whose `{id,name}` results
 * feed in as the weakest naming source.
 */

/**
 * A user-ish record from any source. Tolerates snake_case (Telegram users and
 * quest participants), camelCase (the quest initiator), and a bare REA `name`.
 */
export interface NameRecord {
  id?: string | number;
  first_name?: string | null;
  last_name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  /** REA agents carry a single display string here (usually the username). */
  name?: string | null;
}

/** Trimmed name parts, with '' for any absent field. */
export interface NameParts {
  id: string;
  first: string;
  last: string;
  username: string;
}

/** Normalize a record to trimmed name parts, reconciling the field-name shapes. */
export function nameParts(rec: NameRecord | null | undefined): NameParts {
  const first = String(rec?.first_name ?? rec?.firstName ?? '').trim();
  const last = String(rec?.last_name ?? rec?.lastName ?? '').trim();
  const username = String(rec?.username ?? rec?.name ?? '').trim();
  const id = rec?.id != null ? String(rec.id) : '';
  return { id, first, last, username };
}

export interface NameOptions {
  /** 'full' → "Ada Lovelace"; 'initial' → "Ada L." (bot style). Default 'full'. */
  lastName?: 'full' | 'initial';
  /** Prefix the username fallback with '@'. Default false. */
  at?: boolean;
  /** Fall back to "#<id>" before {@link NameOptions.unknown}. Default true. */
  idFallback?: boolean;
  /** Final fallback when there's no name, username, or id. Default 'Unknown'. */
  unknown?: string;
}

/** First/last real name only (no username/id), or '' when neither is present. */
export function realName(rec: NameRecord | null | undefined): string {
  const { first, last } = nameParts(rec);
  if (!first && !last) return '';
  return first && last ? `${first} ${last}` : first || last;
}

/**
 * Best display name for a single record: first/last → username → #id → unknown,
 * formatted per {@link NameOptions}.
 */
export function userName(
  rec: NameRecord | null | undefined,
  opts: NameOptions = {},
): string {
  const { first, last, username, id } = nameParts(rec);
  if (first || last) {
    if (first && last) {
      return opts.lastName === 'initial'
        ? `${first} ${last.charAt(0)}.`
        : `${first} ${last}`;
    }
    return first || last;
  }
  if (username) return opts.at ? `@${username}` : username;
  if (opts.idFallback !== false && id) return `#${id}`;
  return opts.unknown ?? 'Unknown';
}

/**
 * id → real name from quest participants and initiators. Only ids carrying an
 * actual first/last name are included, so this never downgrades a better name
 * from another source to a bare username.
 */
export function questParticipantNames(
  quests: Iterable<{ participants?: unknown; initiator?: unknown }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const q of quests) {
    const people = [
      ...(Array.isArray(q?.participants) ? q.participants : []),
      q?.initiator,
    ].filter(Boolean) as NameRecord[];
    for (const p of people) {
      const id = p?.id != null ? String(p.id) : '';
      if (!id || m.has(id)) continue;
      const full = realName(p);
      if (full) m.set(id, full);
    }
  }
  return m;
}

/** Merge id→name maps in increasing priority — later maps win, '' is ignored. */
export function mergeNameMaps(
  ...maps: Array<Map<string, string> | Iterable<readonly [string, string]>>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of maps) {
    for (const [k, v] of m) if (v) out.set(k, v);
  }
  return out;
}

export interface NameSources {
  /** Weakest: REA agents (`{id,name}` from `extractReaUsers`); name ≈ username. */
  reaUsers?: Iterable<{ id: string | number; name?: string | null }>;
  /** Quest participants/initiators — real first/last names. */
  quests?: Iterable<{ participants?: unknown; initiator?: unknown }>;
  /** Strongest: users-lens profiles. */
  profiles?: Iterable<NameRecord>;
}

/**
 * Build a holon-wide id→name map from the scattered sources, in priority order
 * reaUsers < quests < profiles. Keys are every id seen, so the result both
 * *names* a known roster and can *discover* one. `opts` formats the profile
 * names (e.g. the kiosk's '@' handle fallback); REA names are taken verbatim
 * and quest names are always the full real name.
 */
export function buildNameMap(
  sources: NameSources,
  opts: NameOptions = {},
): Map<string, string> {
  const rea = new Map<string, string>();
  for (const u of sources.reaUsers ?? []) {
    const id = u?.id != null ? String(u.id) : '';
    if (!id) continue;
    rea.set(id, (u.name && String(u.name)) || `#${id}`);
  }
  const quests = sources.quests
    ? questParticipantNames(sources.quests)
    : new Map<string, string>();
  const profiles = new Map<string, string>();
  for (const p of sources.profiles ?? []) {
    const id = p?.id != null ? String(p.id) : '';
    if (!id) continue;
    profiles.set(id, userName(p, opts));
  }
  return mergeNameMaps(rea, quests, profiles);
}
