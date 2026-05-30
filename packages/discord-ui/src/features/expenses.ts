/**
 * Expenses feature. `/expense` records a shared cost; `/balances` shows who
 * owes whom. All accounting (expense creation, currency normalisation, the
 * credit-matrix balance computation) lives in `@holons/core/expenses`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  EmbedBuilder,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import {
  computeBalances,
  createExpense,
  normalizeCurrency,
  splitAmongAll,
  toggleParticipant as toggleExpenseParticipant,
  type Expense,
} from '@holons/core/expenses';
import {
  ensureUserProfile,
  getUsers,
  type UserDB,
  type UserProfile,
} from '@holons/core/users';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
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

/** Embed for one expense, listing who currently shares the cost. */
function expenseEmbed(
  expense: Expense,
  users: UserProfile[],
  payerName: string
): EmbedBuilder {
  const cur = normalizeCurrency(expense.currency).toUpperCase();
  const nameFor = nameResolver(users);
  const sharers = expense.splitWith.map(id => nameFor(id));
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('💸 Expense')
    .setDescription(`**${expense.description}**`)
    .addFields(
      {
        name: 'Amount',
        value: `${formatAmount(expense.amount)} ${cur}`,
        inline: true,
      },
      { name: 'Paid by', value: payerName, inline: true },
      {
        name: `Split between (${sharers.length})`,
        value: sharers.length ? sharers.join(', ') : '_no one yet_',
      }
    );
}

/**
 * Participant-picker buttons: one per member (toggles inclusion in the split),
 * up to 20 / 5-per-row, plus a "Split with everyone" action. Mirrors the
 * Telegram expense participant checklist.
 */
function expenseComponents(
  expense: Expense,
  users: UserProfile[]
): ActionRowBuilder<ButtonBuilder>[] {
  const included = new Set(expense.splitWith.map(String));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const members = users.slice(0, 20);
  for (let i = 0; i < members.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const m of members.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(
            encodeCustomId(
              'expenses',
              'toggle',
              String(expense.id),
              String(m.id)
            )
          )
          .setLabel(memberName(m).slice(0, 70))
          .setStyle(
            included.has(String(m.id))
              ? ButtonStyle.Primary
              : ButtonStyle.Secondary
          )
      );
    }
    rows.push(row);
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId('expenses', 'splitall', String(expense.id)))
        .setLabel('Split with everyone')
        .setStyle(ButtonStyle.Success)
        .setEmoji('👥')
    )
  );
  return rows;
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
      .setName('spent')
      .setDescription('Submit an expense')
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
    new SlashCommandBuilder()
      .setName('balance')
      .setDescription('Print the balance table')
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

    if (
      interaction.commandName === 'expense' ||
      interaction.commandName === 'spent'
    ) {
      await recordExpense(interaction, ctx, ctx.holonId);
      return;
    }
    await showBalances(interaction, ctx, ctx.holonId);
  },

  async handleComponent(
    interaction: MessageComponentInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [expenseId, userId] = parsed.args;
    const expense = (await ctx.holosphere.get(
      ctx.holonId,
      EXPENSES_BUCKET,
      expenseId
    )) as Expense | null;
    if (!expense) {
      await interaction.reply({
        content: 'That expense no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const members = await getUsers(
      ctx.holosphere as unknown as UserDB,
      ctx.holonId
    );

    let updated: Expense;
    if (parsed.action === 'splitall') {
      updated = splitAmongAll(
        expense,
        members.length > 0 ? members.map(m => m.id) : [ctx.holonId]
      );
    } else {
      // action === 'toggle'
      updated = toggleExpenseParticipant(expense, userId, ctx.holonId);
    }
    await ctx.holosphere.put(ctx.holonId, EXPENSES_BUCKET, updated);

    const payer = members.find(m => String(m.id) === String(updated.paidBy));
    await interaction.update({
      embeds: [
        expenseEmbed(
          updated,
          members,
          payer ? memberName(payer) : String(updated.paidBy)
        ),
      ],
      components: expenseComponents(updated, members),
    });
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

  const members = await getUsers(db, holonId);
  const splitWith: Array<string | number> =
    split === 'me'
      ? [paidBy]
      : members.length > 0
        ? members.map(m => m.id)
        : [holonId];

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

  await interaction.reply({
    embeds: [expenseEmbed(expense, members, interaction.user.username)],
    components: expenseComponents(expense, members),
  });
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
