/**
 * Expenses feature. `/expense` records a shared cost; `/balances` shows who
 * owes whom. All accounting (expense creation, currency normalisation, the
 * credit-matrix balance computation) lives in `@holons/core/expenses`.
 */
import {
  MessageFlags,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  computeBalances,
  createExpense,
  normalizeCurrency,
  type Expense,
} from '@holons/core/expenses';
import {
  ensureUserProfile,
  getUsers,
  type UserDB,
  type UserProfile,
} from '@holons/core/users';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';
import { balancesView, formatAmount, memberName } from '../ui/format.js';
import { userLike } from './users.js';

const FEATURE_ID = 'expenses';
const EXPENSES_BUCKET = 'expenses';

function generateExpenseId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function nameResolver(users: UserProfile[]): (id: string | number) => string {
  const byId = new Map(users.map(u => [String(u.id), memberName(u)]));
  return id => byId.get(String(id)) ?? String(id);
}

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

export const expensesFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('expense')
      .setDescription('Record a shared expense')
      .addNumberOption(opt =>
        opt.setName('amount').setDescription('Amount paid').setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName('description')
          .setDescription('What it was for')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName('currency')
          .setDescription('Currency code (default EUR)')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt
          .setName('split')
          .setDescription('Who shares the cost (default: everyone)')
          .setRequired(false)
          .addChoices(
            { name: 'everyone', value: 'everyone' },
            { name: 'just me', value: 'me' }
          )
      ),
    new SlashCommandBuilder()
      .setName('balances')
      .setDescription('Show who owes whom in this holon')
      .addStringOption(opt =>
        opt
          .setName('currency')
          .setDescription('Limit to one currency')
          .setRequired(false)
      ),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }

    if (interaction.commandName === 'expense') {
      await recordExpense(interaction, ctx, ctx.holonId);
      return;
    }
    await showBalances(interaction, ctx, ctx.holonId);
  },
};

async function recordExpense(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const db = ctx.holosphere as unknown as UserDB;
  // Make sure the payer is a member so they appear in balances.
  await ensureUserProfile(db, userLike(interaction.user), holonId);

  const amount = interaction.options.getNumber('amount', true);
  const description = interaction.options.getString('description', true);
  const currency = interaction.options.getString('currency') ?? 'EUR';
  const split = interaction.options.getString('split') ?? 'everyone';
  const paidBy = interaction.user.id;

  let splitWith: Array<string | number>;
  if (split === 'me') {
    splitWith = [paidBy];
  } else {
    const members = await getUsers(db, holonId);
    splitWith = members.length > 0 ? members.map(m => m.id) : [holonId];
  }

  const expense = createExpense({
    id: generateExpenseId(),
    holonId,
    amount,
    currency,
    description,
    paidBy,
    splitWith,
  });

  if (!expense) {
    await interaction.reply({
      content: 'Amount must be a positive number.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await ctx.holosphere.put(holonId, EXPENSES_BUCKET, expense);

  const cur = normalizeCurrency(expense.currency).toUpperCase();
  const shares = expense.splitWith.length;
  const embed = new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('💸 Expense recorded')
    .setDescription(`**${expense.description}**`)
    .addFields(
      {
        name: 'Amount',
        value: `${formatAmount(expense.amount)} ${cur}`,
        inline: true,
      },
      {
        name: 'Paid by',
        value: interaction.user.username,
        inline: true,
      },
      {
        name: 'Split between',
        value: `${shares} ${shares === 1 ? 'person' : 'people'}`,
        inline: true,
      }
    );
  await interaction.reply({ embeds: [embed] });
}

async function showBalances(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const db = ctx.holosphere as unknown as UserDB;
  const expenses = ((await ctx.holosphere.getAll(holonId, EXPENSES_BUCKET)) ??
    []) as Expense[];
  const users = await getUsers(db, holonId);

  if (expenses.length === 0) {
    await interaction.reply({
      content: 'No expenses recorded yet. Add one with `/expense`.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const nameFor = nameResolver(users);
  const requested = interaction.options.getString('currency');
  const currencies = requested
    ? [normalizeCurrency(requested)]
    : [...new Set(expenses.map(e => normalizeCurrency(e.currency)))];

  const sections = currencies.map(currency => {
    const result = computeBalances(expenses, users, currency);
    return `__${currency.toUpperCase()}__\n${balancesView(result, currency, nameFor)}`;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle('⚖️ Balances')
        .setDescription(sections.join('\n\n')),
    ],
  });
}
