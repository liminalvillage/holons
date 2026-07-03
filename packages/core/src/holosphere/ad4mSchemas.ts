// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
/**
 * In-memory JSON Schema bundle for the AD4M backend's browser path.
 *
 * The AD4M backend generates one subject class per lens from that lens's JSON
 * Schema. In Node it reads them from disk (`schemaDir`); in the browser there
 * is no filesystem, so the app must supply them in memory. This bundles the
 * schemas at `packages/core/schemas/*.json` via Vite's `import.meta.glob`.
 *
 * `import.meta.glob` is a Vite build-time macro — only call this from inside a
 * Vite build (the kiosk/web apps). In a plain Node context use `schemaDir`
 * instead; calling this there will throw.
 */

type GlobImportMeta = ImportMeta & {
  glob: (
    pattern: string,
    opts: { eager: true; import: "default" },
  ) => Record<string, unknown>;
};

/** Load every core JSON Schema into a `lens name → schema object` map. */
export function loadAd4mSchemas(): Map<string, object> {
  // Kept inside the function so merely importing this module stays safe in
  // non-Vite (Node) contexts — only invoking it requires the Vite transform.
  const modules = (import.meta as GlobImportMeta).glob("../../schemas/*.json", {
    eager: true,
    import: "default",
  });

  const map = new Map<string, object>();
  for (const [path, schema] of Object.entries(modules)) {
    const name = path
      .split("/")
      .pop()!
      .replace(/\.json$/, "");
    if (schema && typeof schema === "object") {
      map.set(name, schema as object);
    }
  }
  return map;
}

export default loadAd4mSchemas;
