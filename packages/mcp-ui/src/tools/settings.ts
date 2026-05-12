// Thin MCP wrappers around @holons/core/settings — holon settings, flow
// settings, federation link helpers, and value-equation persistence. Web and
// Telegram both import the same primitives from `@holons/core/settings` so
// settings written through this MCP surface land in the same `(holon,
// 'settings', holon)` slot they read back from.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  FlowSettings,
  addFederationLink,
  loadSettings,
  removeFederationLink,
  saveSettings,
  type FederationLink,
  type HolonSettings,
} from '@holons/core/settings';
import type { ToolDeps } from './index.js';

// --- helpers -------------------------------------------------------------

function ok(payload: unknown) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function fail(message: string, extra?: Record<string, unknown>) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { success: false, error: message, ...(extra ?? {}) },
          null,
          2,
        ),
      },
    ],
  };
}

/** Parse a JSON arg, returning null if the result is not an object. */
function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const decoded = JSON.parse(raw);
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

// --- registration --------------------------------------------------------

export function registerSettingsTools(server: McpServer, deps: ToolDeps): void {
  // settings_load --------------------------------------------------------
  server.registerTool(
    'settings_load',
    {
      description:
        "Load raw holon settings via @holons/core/settings loadSettings. Returns the persisted object (or null) from (holon, 'settings', holon).",
      inputSchema: {
        holon: z.string().describe('Holon id (e.g. Telegram chat id, Discord channel id).'),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const settings = await loadSettings(hs, args.holon);
        return ok({ success: true, holon: args.holon, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // settings_save --------------------------------------------------------
  server.registerTool(
    'settings_save',
    {
      description:
        "Save a raw HolonSettings (or partial settings) document via @holons/core/settings saveSettings. Persists to (holon, 'settings').",
      inputSchema: {
        holon: z.string(),
        settings: z
          .string()
          .describe('JSON-encoded HolonSettings object (or any settings-shaped object).'),
      },
    },
    async (args) => {
      try {
        const parsed = parseJsonObject(args.settings);
        if (!parsed) return fail("'settings' must be a JSON-encoded object.");
        const hs = await deps.getHoloSphere();
        await saveSettings(hs, args.holon, parsed);
        return ok({ success: true, holon: args.holon, settings: parsed });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // flow_settings_get ---------------------------------------------------
  server.registerTool(
    'flow_settings_get',
    {
      description:
        'Construct a FlowSettings instance for the holon and return the normalised HolonSettings (parsed from holosphere, or defaults when nothing is stored).',
      inputSchema: {
        holon: z.string(),
      },
    },
    async (args) => {
      try {
        const hs = await deps.getHoloSphere();
        const flow = new FlowSettings(args.holon);
        const settings: HolonSettings = await flow.loadSettings(hs, args.holon);
        return ok({ success: true, holon: args.holon, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // federation_link_add -------------------------------------------------
  server.registerTool(
    'federation_link_add',
    {
      description:
        "Add (or update) a federation link via @holons/core/settings addFederationLink. The `target` JSON must include at least { targetId, targetName, relationship } — additional FederationLink fields (lenses, timestamp) are accepted but recomputed on save.",
      inputSchema: {
        holon: z.string(),
        target: z
          .string()
          .describe(
            'JSON-encoded FederationLink seed { targetId: string, targetName: string, relationship: "federated"|"notifies" }.',
          ),
      },
    },
    async (args) => {
      try {
        const parsed = parseJsonObject(args.target) as Partial<FederationLink> | null;
        if (!parsed) return fail("'target' must be a JSON-encoded object.");
        const { targetId, targetName, relationship } = parsed;
        if (typeof targetId !== 'string' || !targetId) {
          return fail("'target.targetId' is required (string).");
        }
        if (typeof targetName !== 'string') {
          return fail("'target.targetName' is required (string).");
        }
        if (relationship !== 'federated' && relationship !== 'notifies') {
          return fail("'target.relationship' must be 'federated' or 'notifies'.");
        }

        const hs = await deps.getHoloSphere();
        const settings = await addFederationLink(
          hs,
          args.holon,
          targetId,
          targetName,
          relationship,
        );
        return ok({ success: true, holon: args.holon, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // federation_link_remove ----------------------------------------------
  server.registerTool(
    'federation_link_remove',
    {
      description:
        'Remove a federation link (and its lens config) for the holon via @holons/core/settings removeFederationLink.',
      inputSchema: {
        holon: z.string(),
        target: z.string().describe('Target holon id to unlink.'),
      },
    },
    async (args) => {
      try {
        if (!args.target) return fail("'target' is required.");
        const hs = await deps.getHoloSphere();
        const settings = await removeFederationLink(hs, args.holon, args.target);
        return ok({ success: true, holon: args.holon, removedTarget: args.target, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // equation_save -------------------------------------------------------
  // The settings barrel re-exports `./equation.ts`. That module is currently
  // empty (Unit 1 owns the value-equation logic in core/scoring) so we go via
  // the public settings primitives: load → merge → save. Equation is stored
  // under `settings.valueEquation`, which is exactly what
  // `loadEquation(holosphere, holonId)` reads back from core/scoring.
  server.registerTool(
    'equation_save',
    {
      description:
        "Persist a ScoreEquation for the holon by merging it into the holon's settings under `valueEquation`. Reads the existing settings, layers the new equation in, and writes the whole document back via saveSettings.",
      inputSchema: {
        holon: z.string(),
        equation: z
          .string()
          .describe('JSON-encoded ScoreEquation object (see @holons/core/scoring).'),
      },
    },
    async (args) => {
      try {
        const equation = parseJsonObject(args.equation);
        if (!equation) return fail("'equation' must be a JSON-encoded object.");

        const hs = await deps.getHoloSphere();
        const existing = (await loadSettings(hs, args.holon)) ?? {};
        const updated = {
          ...(existing as Record<string, unknown>),
          valueEquation: equation,
        };
        await saveSettings(hs, args.holon, updated);
        return ok({ success: true, holon: args.holon, equation, settings: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
