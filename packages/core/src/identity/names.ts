/**
 * Single-record naming: normalize a user-ish record and pick its best display
 * name. Lives apart from index.ts so resolver.ts can use it without importing
 * the barrel that re-exports resolver.ts (an import cycle).
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
  const { first, last, id } = nameParts(rec);
  // A handle that is only the id spelled out (the bot's default when Telegram
  // gives no username) or digits alone is not a name.
  const username = nameParts(rec).username;
  const handle = username && username !== id && !/^\d+$/.test(username) ? username : '';
  if (first || last) {
    if (first && last) {
      return opts.lastName === 'initial'
        ? `${first} ${last.charAt(0).toUpperCase()}.`
        : `${first} ${last}`;
    }
    return first || last;
  }
  if (handle) {
    const bare = handle.replace(/^@/, '');
    return opts.at ? `@${bare}` : bare;
  }
  if (opts.idFallback !== false && id) return `#${id}`;
  return opts.unknown ?? 'Unknown';
}
