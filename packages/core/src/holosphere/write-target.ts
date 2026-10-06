// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a write actually lands, for the projections core hangs on
 * `put` / `delete` (the REA ledger, the roster mirror). HoloSphere follows a
 * hologram at the target — or the record's own source envelope — to the
 * owner's graph; whatever a projection derives from the write belongs there
 * too. Read from the local store only: a projection never waits on a relay to
 * learn where a write went.
 */

/** The slice of a HoloSphere instance these helpers read. */
export interface WriteTargetHost {
  isHologram?(data: unknown): boolean;
  parseSoulPath?(soul: string): { holon: string; lens: string; key: string } | null;
  store?: {
    get(holon: string, lens: string, id: string): { item?: unknown } | undefined;
  };
}

export interface WriteTarget {
  holon: string;
  lens: string;
  key: string;
}

/** `put`'s two trailing arguments, whichever spelling the caller used. */
export function splitWriteArgs(
  passwordOrOptions: unknown,
  options: unknown,
): { password: string | null; options: Record<string, any> } {
  if (passwordOrOptions && typeof passwordOrOptions === 'object') {
    const o = passwordOrOptions as Record<string, any>;
    return { password: o.password ?? null, options: o };
  }
  return {
    password: typeof passwordOrOptions === 'string' && passwordOrOptions ? passwordOrOptions : null,
    options: (options && typeof options === 'object' ? options : {}) as Record<string, any>,
  };
}

/** The record the local store holds at an address, as stored (pointers unresolved). */
export function storedItem(
  host: WriteTargetHost,
  holon: string,
  lens: string,
  key: string,
): Record<string, unknown> | null {
  try {
    const item = host.store?.get(holon, lens, key)?.item;
    return item && typeof item === 'object' ? (item as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The address a `put(holon, lens, data)` is redirected to, or its own. */
export function resolveWriteTarget(
  host: WriteTargetHost,
  holon: string,
  lens: string,
  data: Record<string, unknown>,
  options: Record<string, any>,
): WriteTarget {
  const key = String(data.id ?? '');
  if (options.disableHologramRedirection) return { holon, lens, key };
  const env = data._hologram as Record<string, unknown> | undefined;
  if (env && typeof env.sourceHolon === 'string') {
    const soul = typeof env.soul === 'string' ? host.parseSoulPath?.(env.soul) : null;
    return {
      holon: (env.sourceHolon as string) ?? soul?.holon ?? holon,
      lens: (typeof env.sourceLens === 'string' ? env.sourceLens : soul?.lens) ?? lens,
      key: String((env.sourceKey as string | undefined) ?? soul?.key ?? key),
    };
  }
  const atPath = key ? host.store?.get(holon, lens, key)?.item : undefined;
  if (atPath && host.isHologram?.(atPath) && typeof (atPath as any).soul === 'string') {
    const soul = host.parseSoulPath?.((atPath as any).soul);
    if (soul) return { holon: soul.holon, lens: soul.lens, key: soul.key };
  }
  return { holon, lens, key };
}
