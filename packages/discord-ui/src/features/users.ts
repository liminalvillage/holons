/**
 * Membership feature. `/join` registers the caller as a member of the bound
 * holon, `/leave` removes them, `/members` lists everyone.
 *
 * A "member" is just a user profile under the holon's `users` lens — the same
 * model the Telegram bot uses — so membership here feeds expenses, scoring and
 * everything else that reads `users`.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  getUsers,
  joinHolon,
  leaveHolon,
  type TelegramUserLike,
  type UserDB,
} from '@holons/core/users';
import type { Feature, InvocationContext } from '../types.js';
import { memberListView } from '../ui/format.js';

const FEATURE_ID = 'members';

/** Map a Discord interaction user onto the core's user shape. */
export function userLike(user: {
  id: string;
  username: string;
  globalName?: string | null;
}): TelegramUserLike {
  return {
    id: user.id,
    username: user.username,
    first_name: user.globalName ?? user.username,
  };
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

export const usersFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('join')
      .setDescription('Join this holon as a member'),
    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Leave this holon'),
    new SlashCommandBuilder()
      .setName('members')
      .setDescription('List members of this holon'),
  ],

  async handleCommand(
    interaction: ChatInputCommandInteraction,
    ctx: InvocationContext
  ): Promise<void> {
    if (!ctx.holonId) {
      await needHolon(interaction);
      return;
    }
    const db = ctx.holosphere as unknown as UserDB;

    if (interaction.commandName === 'join') {
      const result = await joinHolon(
        db,
        userLike(interaction.user),
        ctx.holonId
      );
      await interaction.reply({
        content: result.profile
          ? '✅ You are now a member of this holon.'
          : 'Could not register you as a member.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.commandName === 'leave') {
      await leaveHolon(db, interaction.user.id, ctx.holonId);
      await interaction.reply({
        content: '👋 You have left this holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // members
    const members = await getUsers(db, ctx.holonId);
    await interaction.reply({
      content: `**Members** (${members.length})\n\n${memberListView(members)}`,
    });
  },
};
