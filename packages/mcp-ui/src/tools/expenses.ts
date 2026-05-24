// MCP tools wrapping @holons/core/expenses.
//
// Each tool is a thin shim: it parses JSON-encoded args (since core operates
// on plain objects, but MCP tool arguments must be JSON-Schema-typed scalars
// or simple shapes), calls the pure core function, and returns the result.
import { z } from 'zod';
import {
  addParticipant,
  calculateBalance,
  coerceSplitWith,
  computeBalances,
  computeCreditMatrix,
  computeUserCurrencyBalance,
  createExpense,
  normalizeCurrency,
  removeParticipant,
  splitAmongAll,
  toggleParticipant,
  type AgentId,
  type CreateExpenseInput,
  type Expense,
  type User,
} from '@holons/core/expenses';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './index.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function ok(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }],
  };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error: message }, null, 2) }],
    isError: true,
  };
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(
      `Invalid JSON for "${label}": ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function loadExpenses(
  deps: ToolDeps,
  args: { expenses?: string; holon?: string }
): Promise<Expense[]> {
  if (typeof args.expenses === 'string' && args.expenses.length > 0) {
    const parsed = parseJson<unknown>(args.expenses, 'expenses');
    if (!Array.isArray(parsed)) throw new Error('"expenses" must be a JSON array');
    return parsed as Expense[];
  }
  if (typeof args.holon === 'string' && args.holon.length > 0) {
    const h = await deps.getHoloSphere();
    const raw = await h.getAll(args.holon, 'expenses');
    if (Array.isArray(raw)) return raw as Expense[];
    if (raw && typeof raw === 'object') return Object.values(raw) as Expense[];
    return [];
  }
  throw new Error('Provide either "expenses" (JSON array) or "holon"');
}

export function registerExpensesTools(server: McpServer, deps: ToolDeps): void {
  server.tool(
    'expense_create',
    'Create a normalized expense via @holons/core. Optionally persists via HoloSphere when persist=true.',
    {
      holon: z.string().describe('HoloSphere holon id (used as fallback splitWith and for persistence).'),
      expense: z
        .string()
        .describe('JSON-encoded CreateExpenseInput: { id, amount, currency, description, paidBy, splitWith?, picture?, date? }. holonId is taken from the "holon" arg unless overridden here.'),
      persist: z.boolean().optional().describe('When true, h.put(holon, "expenses", created).'),
    },
    async ({ holon, expense, persist }) => {
      try {
        const input = parseJson<Partial<CreateExpenseInput>>(expense, 'expense');
        const fullInput: CreateExpenseInput = {
          holonId: input.holonId ?? holon,
          id: input.id ?? Date.now(),
          amount: Number(input.amount),
          currency: String(input.currency ?? ''),
          description: String(input.description ?? ''),
          paidBy: input.paidBy as AgentId,
          splitWith: input.splitWith,
          picture: input.picture ?? null,
          now: (input as any).now ?? (input as any).date,
        };
        const created = createExpense(fullInput);
        if (!created) return fail('createExpense rejected input (non-positive or invalid amount)');
        if (persist) {
          const h = await deps.getHoloSphere();
          await h.put(holon, 'expenses', created);
        }
        return ok({ expense: created, persisted: Boolean(persist) });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'expense_balance',
    'Compute the net balance for one user in one currency. Provide either "expenses" (JSON) or "holon" (fetch via HoloSphere).',
    {
      expenses: z.string().optional().describe('JSON array of Expense objects.'),
      holon: z.string().optional().describe('Holon id to fetch expenses from when "expenses" is omitted.'),
      userId: z.union([z.string(), z.number()]).describe('User whose net balance to compute.'),
      currency: z.string().describe('Currency code (will be normalized by core).'),
    },
    async ({ expenses, holon, userId, currency }) => {
      try {
        const list = await loadExpenses(deps, { expenses, holon });
        const net = calculateBalance(list, userId as AgentId, currency);
        return ok({ userId, currency, net, expenseCount: list.length });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'expense_credit_matrix',
    'Build the NxN credit matrix for a given currency over a set of expenses and users.',
    {
      expenses: z.string().optional().describe('JSON array of Expense objects.'),
      holon: z.string().optional().describe('Holon id to fetch expenses from when "expenses" is omitted.'),
      users: z.string().describe('JSON array of User objects ({ id, username?, first_name?, last_name? }).'),
      currency: z.string().describe('Currency code (normalized internally).'),
      allowedCurrencies: z
        .string()
        .optional()
        .describe('Optional JSON array of currency codes to gate the computation.'),
    },
    async ({ expenses, holon, users, currency, allowedCurrencies }) => {
      try {
        const list = await loadExpenses(deps, { expenses, holon });
        const userArr = parseJson<User[]>(users, 'users');
        const allowed = allowedCurrencies
          ? parseJson<string[]>(allowedCurrencies, 'allowedCurrencies')
          : [];
        const result = computeCreditMatrix(list, userArr, currency, allowed);
        return ok({ ...result, currency, expenseCount: list.length });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.tool(
    'expense_split_among_all',
    'Return a new Expense whose splitWith is replaced with the provided member ids.',
    {
      expense: z.string().describe('JSON-encoded Expense.'),
      members: z.string().describe('JSON-encoded array of member ids (string|number).'),
    },
    async ({ expense, members }) => {
      try {
        const exp = parseJson<Expense>(expense, 'expense');
        const memberIds = parseJson<AgentId[]>(members, 'members');
        const next = splitAmongAll(exp, memberIds);
        return ok({ expense: next });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // `amount` is accepted for forward-compat but ignored: core splits evenly.
  server.tool(
    'expense_add_participant',
    'Add a user to an expense splitWith (no-op if already present).',
    {
      expense: z.string().describe('JSON-encoded Expense.'),
      userId: z.union([z.string(), z.number()]).describe('User id to add.'),
      amount: z
        .number()
        .optional()
        .describe('Ignored by core (even split); accepted for forward compatibility.'),
    },
    async ({ expense, userId }) => {
      try {
        const exp = parseJson<Expense>(expense, 'expense');
        const next = addParticipant(exp, userId as AgentId);
        return ok({ expense: next });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // holonId is the sentinel used when the split would otherwise become empty.
  server.tool(
    'expense_toggle_participant',
    'Toggle a user in/out of an expense splitWith. Falls back to [holonId] when removing the last participant.',
    {
      expense: z.string().describe('JSON-encoded Expense.'),
      userId: z.union([z.string(), z.number()]).describe('User id to toggle.'),
      holonId: z
        .union([z.string(), z.number()])
        .describe('Holon id used as the sentinel when the split becomes empty.'),
    },
    async ({ expense, userId, holonId }) => {
      try {
        const exp = parseJson<Expense>(expense, 'expense');
        const next = toggleParticipant(exp, userId as AgentId, holonId as AgentId);
        return ok({ expense: next });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // holonId is accepted for forward-compat with the toggle variant; core's
  // removeParticipant does not currently re-seed an empty splitWith with the
  // holon sentinel, so we leave that behaviour to the caller.
  server.registerTool(
    'expense_remove_participant',
    {
      description:
        'Remove a user from an expense splitWith. Returns a new Expense (no-op if the user was not present).',
      inputSchema: {
        expense: z.string().describe('JSON-encoded Expense.'),
        userId: z.union([z.string(), z.number()]).describe('User id to remove.'),
        holonId: z
          .union([z.string(), z.number()])
          .describe('Holon id (accepted for forward-compat; not used by core.removeParticipant).'),
      },
    },
    async ({ expense, userId }) => {
      try {
        const exp = parseJson<Expense>(expense, 'expense');
        const next = removeParticipant(exp, userId as AgentId);
        return ok({ expense: next });
      } catch (err) {
        return fail(err);
      }
    }
  );

  // Core's computeBalances takes User[]; this tool accepts plain userIds and
  // synthesizes a minimal User[] so callers without a populated roster can
  // still compute net positions for an arbitrary id set.
  server.registerTool(
    'expense_compute_balances',
    {
      description:
        'Compute per-user net balances + credit matrix for a currency, given a list of user ids.',
      inputSchema: {
        expenses: z.string().describe('JSON array of Expense objects.'),
        userIds: z
          .array(z.union([z.string(), z.number()]))
          .describe('User ids participating in the calculation.'),
        currency: z
          .string()
          .optional()
          .describe('Currency code (normalized internally). Defaults to empty (zeroed result).'),
      },
    },
    async ({ expenses, userIds, currency }) => {
      try {
        const list = parseJson<Expense[]>(expenses, 'expenses');
        if (!Array.isArray(list)) throw new Error('"expenses" must be a JSON array');
        const users: User[] = (userIds ?? []).map((id) => ({ id: id as AgentId }));
        const result = computeBalances(list, users, currency ?? '');
        return ok({ ...result, currency: currency ?? '', expenseCount: list.length });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'expense_user_currency_balance',
    {
      description:
        'Net balance for a single user in one currency. Positive = user is owed; negative = user owes.',
      inputSchema: {
        expenses: z.string().describe('JSON array of Expense objects.'),
        userId: z.union([z.string(), z.number()]).describe('User to score.'),
        currency: z.string().describe('Currency code (normalized internally).'),
      },
    },
    async ({ expenses, userId, currency }) => {
      try {
        const list = parseJson<Expense[]>(expenses, 'expenses');
        if (!Array.isArray(list)) throw new Error('"expenses" must be a JSON array');
        const net = computeUserCurrencyBalance(list, userId as AgentId, currency);
        return ok({ userId, currency, net, expenseCount: list.length });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'expense_normalize_currency',
    {
      description:
        'Normalize a currency code the same way @holons/core does (lowercase, drop trailing s, strip non-letters).',
      inputSchema: {
        input: z.string().describe('Raw currency string.'),
      },
    },
    async ({ input }) => {
      try {
        return ok({ input, normalized: normalizeCurrency(input) });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    'expense_coerce_split_with',
    {
      description:
        'Coerce a legacy splitWith value (scalar / JSON-encoded / array) into an AgentId[] using core rules.',
      inputSchema: {
        value: z
          .string()
          .describe('JSON-encoded legacy splitWith value (string|number|array|null).'),
      },
    },
    async ({ value }) => {
      try {
        // Allow a bare scalar JSON token ("123" or 123) or an array. If JSON
        // parsing fails, fall back to the raw string.
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
        const coerced = coerceSplitWith(parsed);
        return ok({ value: parsed, splitWith: coerced });
      } catch (err) {
        return fail(err);
      }
    }
  );
}
