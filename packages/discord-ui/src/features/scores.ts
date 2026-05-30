/**
 * Scores feature. `/scores` shows a contribution leaderboard for the holon.
 *
 * The whole scoring pipeline is core: an REA event store + aggregator feed
 * `computeHolonUserScores`, weighted by the holon's value equation. This module
 * only wires holosphere into those and renders the ranking.
 */
import {
  EmbedBuilder,
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { REAEventStore } from '@holons/core/rea';
import {
  REAAggregator,
  computeHolonUserScores,
  loadEquation,
} from '@holons/core/scoring';
import { getUsers, type UserDB, type UserProfile } from '@holons/core/users';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';
import {
  leaderboardView,
  memberName,
  type LeaderboardEntry,
} from '../ui/format.js';

const FEATURE_ID = 'scores';

export const scoresFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('scores')
      .setDescription('Contribution leaderboard for this holon'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await interaction.reply({
        content:
          'This server is not bound to a holon yet. Ask an admin to run `/holon bind`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const holonId = ctx.holonId;
    const db = ctx.holosphere as unknown as UserDB;

    const users = await getUsers(db, holonId);
    if (users.length === 0) {
      await interaction.reply({
        content: 'No members yet. Use `/join` to register, then contribute.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Scoring can touch many holosphere reads — acknowledge first.
    await interaction.deferReply();

    const eventStore = new REAEventStore(ctx.holosphere as never);
    const aggregator = new REAAggregator(eventStore);
    const equation = await loadEquation(ctx.holosphere, holonId);
    const scored = await computeHolonUserScores(
      aggregator,
      holonId,
      users,
      equation
    );

    const nameById = new Map(
      users.map((u: UserProfile) => [String(u.id), memberName(u)])
    );
    const entries: LeaderboardEntry[] = scored.map(s => ({
      name: nameById.get(String(s.userId)) ?? String(s.userId),
      score: s.score,
      percentage: s.percentage,
    }));

    const embed = new EmbedBuilder()
      .setColor(ACCENT)
      .setTitle('🏆 Contribution leaderboard')
      .setDescription(leaderboardView(entries));

    await interaction.editReply({ embeds: [embed] });
  },
};
