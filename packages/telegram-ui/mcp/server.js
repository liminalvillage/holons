#!/usr/bin/env node
/**
 * HolonsBot MCP Server — thin shim that delegates to @holons/mcp-ui.
 *
 * The historical implementation lived here; it has been superseded by
 * @holons/mcp-ui which exposes every @holons/core function as an
 * independently-callable MCP tool. This file remains for backwards
 * compatibility with existing Claude Desktop / Atlas configurations
 * that reference this path.
 */
import 'dotenv/config';

// Defer to the new package. If the import fails (e.g. workspace not yet
// installed), print a friendly message instead of crashing silently.
try {
  await import('@holons/mcp-ui/dist/index.js');
} catch (err) {
  console.error('Failed to load @holons/mcp-ui — run `pnpm install` first.');
  console.error(err);
  process.exit(1);
}
