/**
 * Scoring feature. `/score` shows a member's contribution score, `/leaderboard`
 * ranks the whole holon, `/equation` shows the holon's value equation.
 *
 * The scoring maths (equation loading, per-user score, share normalisation)
 * lives in `@holons/core/scoring`; this module only fetches the holon's users +
 * equation and renders the results. Currency balances and REA-derived
 * aggregates aren't wired into the Discord UI yet, so scores are computed from
 * the raw user records (the same `users` lens membership feeds).
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getUsers, type UserDB } from '@holons/core/users';
import {
  calculateAllUserScores,
  getScoreBreakdown,
  loadEquation,
  toAggregates,
  type ScoreEquation,
} from '@holons/core/scoring';
import {
  applyGiven,
  applyReceived,
  createAppreciation,
  saveAppreciation,
  type AppreciationCountUser,
  type AppreciationDB,
} from '@holons/core/appreciation';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'scoring';

async function needHolon(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.reply({
    content:
      'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
    flags: MessageFlags.Ephemeral,
  });
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export const scoringFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('score')
      .setDescription('Show your contribution score in this holon')
      .addUserOption(opt =>
        opt
          .setName('member')
          .setDescription('Whose score to show (defaults to you)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Rank holon members by contribution score'),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('Show the rank of members by value points'),
    new SlashCommandBuilder()
      .setName('equation')
      .setDescription("Show this holon's value equation"),
    new SlashCommandBuilder()
      .setName('appreciate')
      .setDescription('Send appreciation to a member')
      .addUserOption(opt =>
        opt
          .setName('member')
          .setDescription('Who to appreciate')
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt.setName('reason').setDescription('What for').setRequired(false)
      )
      .addIntegerOption(opt =>
        opt
          .setName('amount')
          .setDescription('How many points (default 1)')
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

    if (interaction.commandName === 'appreciate') {
      await sendAppreciation(interaction, ctx, ctx.holonId);
      return;
    }

    const equation = await loadEquation(ctx.holosphere, ctx.holonId);

    if (interaction.commandName === 'equation') {
      await interaction.reply({ embeds: [equationEmbed(equation)] });
      return;
    }

    const users = await getUsers(
      ctx.holosphere as unknown as UserDB,
      ctx.holonId
    );

    if (
      interaction.commandName === 'leaderboard' ||
      interaction.commandName === 'status'
    ) {
      const scored = calculateAllUserScores(users, equation)
        .filter(u => u.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length === 0) {
        await interaction.reply({
          content: 'No scored activity in this holon yet.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = scored.slice(0, 25).map((u, i) => {
        const rank = medals[i] ?? `#${i + 1}`;
        return `${rank} **${u.username}** — ${u.score.toFixed(0)} (${pct(u.percentage)})`;
      });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('🏆 Leaderboard')
            .setDescription(lines.join('\n')),
        ],
      });
      return;
    }

    // commandName === 'score'
    const target = interaction.options.getUser('member') ?? interaction.user;
    const record = users.find(u => String(u.id) === String(target.id));
    if (!record) {
      await interaction.reply({
        content:
          target.id === interaction.user.id
            ? 'You are not a member of this holon yet. Use `/join`.'
            : `${target.username} is not a member of this holon.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const breakdown = getScoreBreakdown(toAggregates(record), equation);
    const all = calculateAllUserScores(users, equation);
    const mine = all.find(u => String(u.userId) === String(target.id));
    const rows: string[] = [];
    const add = (label: string, v: number): void => {
      if (v) rows.push(`• ${label}: ${v.toFixed(1)}`);
    };
    add('Initiated', breakdown.initiated);
    add('Completed', breakdown.completed);
    add('Sent', breakdown.sent);
    add('Received', breakdown.received);
    add('Collaboration', breakdown.collaboration);
    for (const [cur, v] of Object.entries(breakdown.currencies)) {
      add(cur, v);
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(ACCENT)
          .setTitle(`📊 Score — ${target.username}`)
          .setDescription(
            `**Total:** ${breakdown.total.toFixed(0)}${
              mine ? ` (${pct(mine.percentage)} of holon)` : ''
            }${rows.length ? `\n\n${rows.join('\n')}` : ''}`
          ),
      ],
      flags:
        target.id === interaction.user.id ? MessageFlags.Ephemeral : undefined,
    });
  },
};

const USERS_LENS = 'users';

/** `/appreciate @member [reason] [amount]` — records kudos + bumps tallies. */
async function sendAppreciation(
  interaction: ChatInputCommandInteraction,
  ctx: InvocationContext,
  holonId: string
): Promise<void> {
  const target = interaction.options.getUser('member', true);
  if (target.bot || target.id === interaction.user.id) {
    await interaction.reply({
      content: 'Pick another member to appreciate.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const amount = Math.max(1, interaction.options.getInteger('amount') ?? 1);
  const reason = interaction.options.getString('reason') ?? '';
  const db = ctx.holosphere as unknown as AppreciationDB;

  const appreciation = createAppreciation({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    from: { id: interaction.user.id, username: interaction.user.username },
    to: { id: target.id, username: target.username },
    amount,
    reason,
    date: Date.now(),
    holonId,
  });
  await saveAppreciation(db, appreciation);

  // Bump running tallies on both members' user records (best-effort).
  const bump = async (
    id: string,
    username: string,
    apply: (u: AppreciationCountUser, n: number) => AppreciationCountUser
  ): Promise<void> => {
    const existing = ((await ctx.holosphere.get(
      holonId,
      USERS_LENS,
      id
    )) as AppreciationCountUser | null) ?? { id, username };
    await ctx.holosphere.put(holonId, USERS_LENS, apply(existing, amount));
  };
  await bump(target.id, target.username, applyReceived);
  await bump(interaction.user.id, interaction.user.username, applyGiven);

  await interaction.reply({
    content: `🙏 ${interaction.user} appreciated ${target}${
      amount > 1 ? ` ×${amount}` : ''
    } — _${appreciation.reason}_`,
  });
}

function equationEmbed(eq: ScoreEquation): EmbedBuilder {
  const lines = [
    `• Initiated: ${eq.initiated}`,
    `• Completed: ${eq.completed}`,
    `• Sent: ${eq.sent}`,
    `• Received: ${eq.received}`,
    `• Collaboration: ${eq.collaboration}`,
  ];
  const currencies = Object.entries(eq.currencies ?? {})
    .filter(([, w]) => w)
    .map(([c, w]) => `• ${c}: ${w}`);
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🧮 Value equation')
    .setDescription(
      [...lines, ...currencies].join('\n') +
        '\n\n_Weights are applied to each member’s activity to compute their score._'
    );
}
