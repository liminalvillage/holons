/**
 * Announcements feature. `/announce <text>` records a community announcement
 * and posts it in the current channel, then fans it out to federated partner
 * holons that have opted into the `announcements` lens.
 *
 * Target selection, lens-permission rules and federated-message tracking live
 * in `@holons/core/announcements`; this module owns Discord delivery. Because
 * Discord has no guild→announce-channel binding yet, cross-guild delivery is
 * best-effort: we post to the system channel of any guild bound to a target
 * holon, and always report which partners were targeted.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Client,
  type TextChannel,
} from 'discord.js';
import {
  createAnnouncement,
  getFederationTracking,
  recordFederatedMessage,
  saveAnnouncement,
  saveFederationTracking,
  selectFederationTargets,
  targetAcceptsLens,
  type FederationInfo,
} from '@holons/core/announcements';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';
import { log } from '../utils/logger.js';

const FEATURE_ID = 'announcements';

/** Colon/underscore-free id for the announcement record. */
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

async function getFederation(
  ctx: InvocationContext,
  holonId: string
): Promise<FederationInfo | null> {
  const hs = ctx.holosphere as unknown as {
    getFederation?: (id: string) => Promise<FederationInfo | null>;
  };
  if (!hs.getFederation) return null;
  try {
    return await hs.getFederation(holonId);
  } catch {
    return null;
  }
}

function announcementEmbed(content: string, author: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📣 Announcement')
    .setDescription(content)
    .setFooter({ text: `by ${author}` });
}

/** Guild ids (other than the source) bound to `targetHolon`. */
async function guildsBoundTo(
  ctx: InvocationContext,
  client: Client,
  targetHolon: string
): Promise<string[]> {
  const matches: string[] = [];
  for (const guildId of client.guilds.cache.keys()) {
    try {
      if ((await ctx.bindings.get(guildId)) === targetHolon) {
        matches.push(guildId);
      }
    } catch {
      /* skip unreadable bindings */
    }
  }
  return matches;
}

export const announcementsFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('announce')
      .setDescription('Post a community announcement (federated to partners)')
      .addStringOption(opt =>
        opt
          .setName('text')
          .setDescription('Announcement text')
          .setRequired(true)
      ),
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
    const text = interaction.options.getString('text', true).trim();
    const announcement = createAnnouncement({
      id: genId(),
      content: text,
      chat: ctx.holonId,
      user: { id: interaction.user.id, username: interaction.user.username },
    });
    await saveAnnouncement(
      ctx.holosphere as unknown as Parameters<typeof saveAnnouncement>[0],
      announcement
    );

    await interaction.reply({
      embeds: [announcementEmbed(text, interaction.user.username)],
    });

    // Federation fan-out (best-effort).
    const fedInfo = await getFederation(ctx, ctx.holonId);
    const targets = selectFederationTargets(fedInfo, ctx.holonId);
    if (targets.length === 0) return;

    let tracking = await getFederationTracking(
      ctx.holosphere as unknown as Parameters<typeof getFederationTracking>[0],
      ctx.holonId,
      announcement.id
    );
    const client = interaction.client;
    let delivered = 0;
    let accepted = 0;
    for (const target of targets) {
      const targetFed = await getFederation(ctx, target);
      if (!targetAcceptsLens(targetFed, ctx.holonId)) continue;
      accepted += 1;
      for (const guildId of await guildsBoundTo(ctx, client, target)) {
        const guild = client.guilds.cache.get(guildId);
        const channel = guild?.systemChannel as TextChannel | null | undefined;
        if (!channel?.isTextBased()) continue;
        try {
          const sent = await channel.send({
            embeds: [
              announcementEmbed(text, interaction.user.username).setFooter({
                text: `Linked from holon ${ctx.holonId}`,
              }),
            ],
          });
          tracking = recordFederatedMessage(tracking, {
            holonId: target,
            ref: sent.id,
          });
          delivered += 1;
        } catch (err) {
          log.warn('Federated announcement delivery failed', {
            target,
            error: String(err),
          });
        }
      }
    }
    await saveFederationTracking(
      ctx.holosphere as unknown as Parameters<typeof saveFederationTracking>[0],
      tracking
    );
    await interaction.followUp({
      content: `📡 Federation: ${accepted}/${targets.length} partner(s) accept announcements; delivered to ${delivered} bound channel(s).`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
