// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A compile-level guard for the add form. Svelte turns an in-place mutation
// of reactive state (`values[name] = x`) into a call that re-reads an
// identifier lifted from the wrong scope: in this form's
// fill-from-description loop it emitted a bare `f` — the field loop's
// variable, which does not exist in that function — and every draft ended in
// "ReferenceError: f is not defined". Nothing typecheck, svelte-check or the
// production build looks at catches it; only the generated code shows it.
//
// So: this component changes reactive state by assigning a new value, never
// by writing into one. That is the whole assertion.

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile, preprocess } from "svelte/compiler";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

async function compiled(file: string): Promise<string> {
  const path = fileURLToPath(new URL(file, import.meta.url));
  const source = await readFile(path, "utf8");
  const pre = await preprocess(source, vitePreprocess(), { filename: path });
  return compile(pre.code, { filename: path, generate: "client" }).js.code;
}

describe("the add form's generated code", () => {
  it("never mutates reactive state in place", async () => {
    const js = await compiled("./LensForm.svelte");
    // The marker Svelte emits for exactly that, and the reference it carries
    // is the one that isn't in scope.
    expect(js).not.toMatch(/invalidate_inner_signals\(/);
  });

  it("compiles without warnings", async () => {
    const path = fileURLToPath(new URL("./LensForm.svelte", import.meta.url));
    const source = await readFile(path, "utf8");
    const pre = await preprocess(source, vitePreprocess(), { filename: path });
    const { warnings } = compile(pre.code, {
      filename: path,
      generate: "client",
    });
    expect(warnings.map((w) => `${w.code}: ${w.message}`)).toEqual([]);
  });
});
