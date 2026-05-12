/**
 * MCP tools for the `@holons/core/scoring` domain.
 *
 * Each tool wraps a single public function from core so it can be invoked
 * independently. No Telegram side-effects; pure scoring math + holosphere
 * reads for equation/users.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  DEFAULT_EQUATION,
  calculatePercentageShare,
  getScoreBreakdown,
  loadEquation,
  toAggregates,
  type ScoreEquation,
  type UserAggregates,
} from '@holons/core/scoring';
import type { ToolDeps } from './index.js';

function ok(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: true, ...(payload as object) }, null, 2),
      },
    ],
  };
}

function err(message: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ success: false, error: message }, null, 2),
      },
    ],
  };
}

function parseJson<T>(raw: string | undefined, fallback: T, field: string): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (e: any) {
    throw new Error(`Invalid JSON for ${field}: ${e?.message ?? e}`);
  }
}

function scoreUserBreakdown(
  userId: string | number,
  aggregatesJson: string,
  equationJson: string | undefined,
) {
  const aggregates = parseJson<UserAggregates>(
    aggregatesJson,
    {} as UserAggregates,
    'aggregates',
  );
  const equation = parseJson<ScoreEquation>(equationJson, DEFAULT_EQUATION, 'equation');
  const breakdown = getScoreBreakdown(aggregates, equation);
  return { userId, breakdown };
}

export function registerScoringTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'score_user',
    "Compute a single user's score breakdown from their aggregates using the supplied (or default) value equation. Wraps @holons/core/scoring: getScoreBreakdown.",
    {
      userId: z.union([z.string(), z.number()]).describe('User id (string or number).'),
      aggregates: z
        .string()
        .describe(
          'JSON-encoded UserAggregates ({ initiated, completed, sent, received, hours, collaboration, wants, offers }).',
        ),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ userId, aggregates, equation }) => {
      try {
        return ok(scoreUserBreakdown(userId, aggregates, equation));
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_all_users',
    'Compute score breakdowns for many users in a holon. Loads each user from holosphere by id, then runs @holons/core/scoring: getScoreBreakdown per user with shared total → percentage.',
    {
      userIds: z.array(z.string()).describe('User ids to score.'),
      holon: z.string().describe('Holon id to fetch user data from.'),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ userIds, holon, equation }) => {
      try {
        const eq = parseJson<ScoreEquation>(equation, DEFAULT_EQUATION, 'equation');
        const hs = await deps.getHoloSphere();

        const users = await Promise.all(
          userIds.map(async (id) => {
            try {
              const data = await hs.get(holon, 'users', id);
              return { ...(data ?? {}), id };
            } catch {
              return { id };
            }
          }),
        );

        const scored = users.map((user) => {
          const aggregates = toAggregates(user);
          const breakdown = getScoreBreakdown(aggregates, eq);
          return {
            userId: String(user.id),
            username: user.username || String(user.id),
            aggregates,
            breakdown,
          };
        });

        const totalScore = scored.reduce((sum, u) => sum + u.breakdown.total, 0);
        const out: Record<string, unknown> = {};
        for (const u of scored) {
          out[u.userId] = {
            username: u.username,
            score: u.breakdown.total,
            percentage: calculatePercentageShare(u.breakdown.total, totalScore),
            aggregates: u.aggregates,
            breakdown: u.breakdown,
          };
        }
        return ok({ holon, scores: out });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_breakdown',
    'Get a detailed score breakdown by category for a user. Wraps @holons/core/scoring: getScoreBreakdown.',
    {
      userId: z.union([z.string(), z.number()]).describe('User id (string or number).'),
      aggregates: z.string().describe('JSON-encoded UserAggregates.'),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ userId, aggregates, equation }) => {
      try {
        return ok(scoreUserBreakdown(userId, aggregates, equation));
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_equation_load',
    'Load (and cache) the value equation for a holon from holosphere settings. Wraps @holons/core/scoring: loadEquation.',
    {
      holon: z.string().describe('Holon id whose equation to load.'),
    },
    async ({ holon }) => {
      try {
        const hs = await deps.getHoloSphere();
        const equation = await loadEquation(hs, holon);
        return ok({ holon, equation });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );
}
