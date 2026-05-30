/**
 * Encoding for Discord component `customId`s.
 *
 * Discord caps a customId at 100 characters and gives us a single opaque
 * string per button/select/modal. We pack routing info into it as
 * colon-separated segments:
 *
 *     <feature>:<action>[:<arg>...]
 *
 * The router splits this back out and dispatches to the owning feature's
 * component handler. Segments must not contain ':'; holon/quest/shopping ids
 * in this codebase are colon-free (base36 / `<ms>-<rand>`), so no escaping is
 * needed — we assert it instead to fail loudly if that ever changes.
 */

export interface ParsedCustomId {
  feature: string;
  action: string;
  args: string[];
}

export const CUSTOM_ID_SEP = ':';
export const CUSTOM_ID_MAX = 100;

export function encodeCustomId(
  feature: string,
  action: string,
  ...args: Array<string | number>
): string {
  const segments = [feature, action, ...args.map(String)];
  for (const seg of segments) {
    if (seg.includes(CUSTOM_ID_SEP)) {
      throw new Error(
        `customId segment "${seg}" contains the reserved separator "${CUSTOM_ID_SEP}"`
      );
    }
  }
  const id = segments.join(CUSTOM_ID_SEP);
  if (id.length > CUSTOM_ID_MAX) {
    throw new Error(`customId "${id}" exceeds ${CUSTOM_ID_MAX} characters`);
  }
  return id;
}

export function parseCustomId(customId: string): ParsedCustomId | null {
  if (!customId) return null;
  const [feature, action, ...args] = customId.split(CUSTOM_ID_SEP);
  if (!feature || !action) return null;
  return { feature, action, args };
}
