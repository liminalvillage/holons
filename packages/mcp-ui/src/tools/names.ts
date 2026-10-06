// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Names beside ids in every tool result. One resolver per instance
// (`@holons/core/identity`), the same rule the kiosk, the web and the bot
// apply: the holon's users, the person's own record, the key directory,
// kind-0 profiles, settings and HNS — and the one short form when nothing
// names an id, so an agent never has to guess what a hex key is.

import { createNameResolver, type NameResolver } from '@holons/core/identity';

const resolvers = new WeakMap<object, NameResolver>();

/** The instance's resolver (created on first use). */
export function nameResolver(hs: object): NameResolver {
  let r = resolvers.get(hs);
  if (!r) {
    r = createNameResolver(hs as never, {});
    resolvers.set(hs, r);
  }
  return r;
}

/**
 * `id → name` for every id given, resolved against `holon`. Ids nothing
 * names come back in the short form; nothing is left out.
 */
export async function namesFor(
  hs: object,
  holon: string | null | undefined,
  ids: Iterable<string | number | null | undefined>,
): Promise<Record<string, string>> {
  const list = [...new Set([...ids].filter((id) => id !== null && id !== undefined && String(id) !== '').map(String))];
  if (!list.length) return {};
  const r = nameResolver(hs);
  r.setHolon(holon ?? null);
  try {
    const out: Record<string, string> = {};
    for (const [id, name] of await r.resolve(list)) if (list.includes(id)) out[id] = name;
    return out;
  } catch (err) {
    console.warn('[mcp] names could not be resolved:', (err as Error)?.message);
    return {};
  }
}
