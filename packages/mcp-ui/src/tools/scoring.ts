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
  calculateAllUserScores,
  calculatePercentageShare,
  calculateTaskCompletionScores,
  calculateUserScore,
  getActionScore,
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

  server.tool(
    'score_calculate_user',
    "Calculate a single user's total score from raw user data using the supplied (or default) value equation. Internally derives aggregates via toAggregates(). Wraps @holons/core/scoring: calculateUserScore.",
    {
      user: z
        .string()
        .describe(
          'JSON-encoded user data (object with initiated/completed/sent/received/hours/collaboration/wants/offers — arrays or counts).',
        ),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ user, equation }) => {
      try {
        const userData = parseJson<any>(user, {}, 'user');
        const eq = parseJson<ScoreEquation>(equation, DEFAULT_EQUATION, 'equation');
        const aggregates = toAggregates(userData);
        const score = calculateUserScore(aggregates, eq);
        return ok({ score, aggregates });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_calculate_all',
    'Calculate scores + percentage shares for every user in a list using the supplied (or default) value equation. Wraps @holons/core/scoring: calculateAllUserScores.',
    {
      users: z
        .string()
        .describe('JSON-encoded array of user objects (each with id + REA fields).'),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ users, equation }) => {
      try {
        const userList = parseJson<any[]>(users, [], 'users');
        if (!Array.isArray(userList)) {
          throw new Error('users must be a JSON array');
        }
        const eq = parseJson<ScoreEquation>(equation, DEFAULT_EQUATION, 'equation');
        const scored = calculateAllUserScores(userList, eq);
        return ok({ scored, count: scored.length });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_action',
    'Compute the score delta for a specific action (initiated/completed/joined/hours/sent/received). Wraps @holons/core/scoring: getActionScore.',
    {
      actionType: z
        .enum(['initiated', 'completed', 'joined', 'hours', 'sent', 'received'])
        .describe('Action type to score.'),
      amount: z
        .number()
        .optional()
        .describe('Quantity (e.g., hours, count). Defaults to 1.'),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ actionType, amount, equation }) => {
      try {
        const eq = parseJson<ScoreEquation>(equation, DEFAULT_EQUATION, 'equation');
        const action = getActionScore(actionType, amount ?? 1, eq);
        return ok({ action });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_task_completion',
    'Compute contribution scores for task completion: the initiator earns initiated points, each participant earns completed + hours + collaboration points. Wraps @holons/core/scoring: calculateTaskCompletionScores.',
    {
      initiatorId: z
        .string()
        .nullable()
        .optional()
        .describe('Initiator user id, or null/omitted when no initiator.'),
      participantIds: z
        .array(z.string())
        .describe('Participant user ids who completed the task.'),
      timeTracking: z
        .string()
        .optional()
        .describe(
          'JSON-encoded Record<userId, hours>. Hours logged per participant. Defaults to {}.',
        ),
      equation: z
        .string()
        .optional()
        .describe('JSON-encoded ScoreEquation. Defaults to DEFAULT_EQUATION when omitted.'),
    },
    async ({ initiatorId, participantIds, timeTracking, equation }) => {
      try {
        const tt = parseJson<Record<string, number>>(timeTracking, {}, 'timeTracking');
        const eq = parseJson<ScoreEquation>(equation, DEFAULT_EQUATION, 'equation');
        const scoresMap = calculateTaskCompletionScores(
          initiatorId ?? null,
          participantIds,
          tt,
          eq,
        );
        const scores: Record<string, { total: number; breakdown: any[] }> = {};
        for (const [userId, entry] of scoresMap.entries()) {
          scores[userId] = entry;
        }
        return ok({ scores, count: scoresMap.size });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );

  server.tool(
    'score_aggregator_to_aggregates',
    'Convert raw user data (or REA-style event-derived object) into the canonical UserAggregates shape used by scoring. Wraps @holons/core/scoring: toAggregates.',
    {
      events: z
        .string()
        .describe(
          'JSON-encoded user data object whose fields will be normalized into UserAggregates.',
        ),
    },
    async ({ events }) => {
      try {
        const userData = parseJson<any>(events, {}, 'events');
        const aggregates = toAggregates(userData);
        return ok({ aggregates });
      } catch (e: any) {
        return err(e?.message ?? String(e));
      }
    },
  );
}
