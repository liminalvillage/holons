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
  applyAddFederationLink,
  applyRemoveFederationLink,
  getDefaultHolonSettings,
  getLensDescription,
  loadSettings,
  parseHolonSettings,
  removeFederationLink,
  saveSettings,
  type FederationLink,
  type HolonSettings,
  type LensType,
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

  // settings_defaults_get ----------------------------------------------
  server.registerTool(
    'settings_defaults_get',
    {
      description:
        'Pure: return the default HolonSettings skeleton for a holon id (no I/O). Wraps @holons/core/settings getDefaultHolonSettings.',
      inputSchema: {
        holon: z.string().describe('Holon id to seed into the defaults.'),
      },
    },
    async (args) => {
      try {
        const settings = getDefaultHolonSettings(args.holon);
        return ok({ success: true, holon: args.holon, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // settings_lens_description_get --------------------------------------
  server.registerTool(
    'settings_lens_description_get',
    {
      description:
        'Pure: return the human-readable description for a lens type. Wraps @holons/core/settings getLensDescription.',
      inputSchema: {
        lensType: z.string().describe('Lens identifier (e.g. "tasks", "expenses", "library").'),
      },
    },
    async (args) => {
      try {
        const description = getLensDescription(args.lensType as LensType);
        return ok({ success: true, lensType: args.lensType, description });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // settings_parse ------------------------------------------------------
  server.registerTool(
    'settings_parse',
    {
      description:
        'Pure: normalise raw holosphere settings data into a populated HolonSettings (defaults for missing fields). Wraps @holons/core/settings parseHolonSettings. Accepts a JSON-encoded object.',
      inputSchema: {
        input: z
          .string()
          .describe('JSON-encoded raw settings object to normalise.'),
      },
    },
    async (args) => {
      try {
        const raw = parseJsonObject(args.input);
        if (!raw) return fail("'input' must be a JSON-encoded object.");
        const settings = parseHolonSettings(raw);
        return ok({ success: true, settings });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // settings_apply_add_federation_link ---------------------------------
  server.registerTool(
    'settings_apply_add_federation_link',
    {
      description:
        'Pure mutation: apply an add-federation-link mutation to a HolonSettings object and return the result (no I/O). Wraps @holons/core/settings applyAddFederationLink. The `link` JSON must include { targetId, targetName, relationship }.',
      inputSchema: {
        settings: z
          .string()
          .describe('JSON-encoded HolonSettings object to mutate.'),
        link: z
          .string()
          .describe(
            'JSON-encoded FederationLink seed { targetId: string, targetName: string, relationship: "federated"|"notifies" }.',
          ),
      },
    },
    async (args) => {
      try {
        const settingsRaw = parseJsonObject(args.settings);
        if (!settingsRaw) return fail("'settings' must be a JSON-encoded object.");
        const linkRaw = parseJsonObject(args.link) as Partial<FederationLink> | null;
        if (!linkRaw) return fail("'link' must be a JSON-encoded object.");

        const { targetId, targetName, relationship } = linkRaw;
        if (typeof targetId !== 'string' || !targetId) {
          return fail("'link.targetId' is required (string).");
        }
        if (typeof targetName !== 'string') {
          return fail("'link.targetName' is required (string).");
        }
        if (relationship !== 'federated' && relationship !== 'notifies') {
          return fail("'link.relationship' must be 'federated' or 'notifies'.");
        }

        const settings = parseHolonSettings(settingsRaw);
        const updated = applyAddFederationLink(settings, targetId, targetName, relationship);
        return ok({ success: true, settings: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // settings_apply_remove_federation_link ------------------------------
  server.registerTool(
    'settings_apply_remove_federation_link',
    {
      description:
        'Pure mutation: apply a remove-federation-link mutation to a HolonSettings object and return the result (no I/O). Wraps @holons/core/settings applyRemoveFederationLink.',
      inputSchema: {
        settings: z
          .string()
          .describe('JSON-encoded HolonSettings object to mutate.'),
        target: z.string().describe('Target holon id to unlink.'),
      },
    },
    async (args) => {
      try {
        if (!args.target) return fail("'target' is required.");
        const settingsRaw = parseJsonObject(args.settings);
        if (!settingsRaw) return fail("'settings' must be a JSON-encoded object.");

        const settings = parseHolonSettings(settingsRaw);
        const updated = applyRemoveFederationLink(settings, args.target);
        return ok({ success: true, removedTarget: args.target, settings: updated });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
}
