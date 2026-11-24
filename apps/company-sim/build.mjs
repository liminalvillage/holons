// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bundles the simulation into ONE self-contained file: dist/index.html with
// the core engine and the UI inlined, so it opens from disk or any static host.
import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const opts = {
  entryPoints: ['src/ui.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  write: false,
  logLevel: 'warning',
};

async function emit(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
  const html = (await readFile('src/index.html', 'utf8')).replace('<!--APP-->', `<script>${js}</script>`);
  await mkdir('dist', { recursive: true });
  await writeFile('dist/index.html', html);
  console.log(`dist/index.html ${(html.length / 1024).toFixed(0)} KB`);
}

if (process.argv.includes('--watch')) {
  const ctx = await context({ ...opts, plugins: [{ name: 'emit', setup: (b) => b.onEnd((r) => r.errors.length || emit(r)) }] });
  await ctx.watch();
} else {
  await emit(await build(opts));
}
