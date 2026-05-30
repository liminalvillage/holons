/**
 * Federation feature. `/federation` manages this holon's links to other holons
 * and publishes items across the federation.
 *
 * Link management and publishing logic live in `@holons/core/federation` and
 * `@holons/core/settings`; this module only collects the Discord inputs and
 * renders the outcome. Federation calls expect the concrete HoloSphere
 * instance (they reach for `.getFederation`), which `ctx.holosphere` is at
 * runtime.
 */
import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import {
  getFederationSnapshot,
  publishToFederation,
  readSettingsHex,
} from '@holons/core/federation';
import {
  addFederationLink,
  loadSettings,
  parseHolonSettings,
  removeFederationLink,
} from '@holons/core/settings';
import type { Feature, InvocationContext } from '../types.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'federation';

/** Federation/settings helpers want the concrete HoloSphere instance. */
function hs(ctx: InvocationContext): any {
  return ctx.holosphere as unknown as any;
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

export const federationFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('federation')
      .setDescription('Manage federation links and publishing')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Add or update a federation link')
          .addStringOption(opt =>
            opt
              .setName('holon-id')
              .setDescription('The partner holon id')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Display name for the partner')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('relationship')
              .setDescription('How items flow')
              .setRequired(false)
              .addChoices(
                { name: 'federated (two-way)', value: 'federated' },
                { name: 'notifies (one-way)', value: 'notifies' }
              )
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Remove a federation link')
          .addStringOption(opt =>
            opt
              .setName('holon-id')
              .setDescription('The partner holon id to unlink')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('List this holon’s federation links')
      )
      .addSubcommand(sub =>
        sub
          .setName('publish')
          .setDescription('Publish an item to all federated partners')
          .addStringOption(opt =>
            opt
              .setName('lens')
              .setDescription('Lens/bucket (e.g. quests, offers)')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('item-id')
              .setDescription('Id of the item to publish')
              .setRequired(true)
          )
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
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const targetId = interaction.options.getString('holon-id', true).trim();
      const targetName = interaction.options.getString('name', true).trim();
      const relationship =
        (interaction.options.getString('relationship') as
          | 'federated'
          | 'notifies'
          | null) ?? 'federated';
      await addFederationLink(
        hs(ctx),
        ctx.holonId,
        targetId,
        targetName,
        relationship
      );
      await interaction.reply({
        content: `🔗 Linked to **${targetName}** (\`${targetId}\`) as *${relationship}*.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'remove') {
      const targetId = interaction.options.getString('holon-id', true).trim();
      await removeFederationLink(hs(ctx), ctx.holonId, targetId);
      await interaction.reply({
        content: `🔗 Removed link to \`${targetId}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'list') {
      const snapshot = await getFederationSnapshot(hs(ctx), ctx.holonId);
      const settings = parseHolonSettings(
        (await loadSettings(hs(ctx), ctx.holonId)) ?? {}
      );
      const hex = await readSettingsHex(hs(ctx), ctx.holonId);
      const links = settings.federation ?? [];
      const linkLines =
        links.length > 0
          ? links
              .map(
                l =>
                  `• **${l.targetName}** (\`${l.targetId}\`) — ${l.relationship}`
              )
              .join('\n')
          : '_No configured links._';
      const fedLine =
        snapshot.federated.length > 0
          ? snapshot.federated
              .map(id => `• ${snapshot.partnerNames[id] ?? id}`)
              .join('\n')
          : '_None._';
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('🌐 Federation')
            .addFields(
              { name: 'Links', value: linkLines },
              { name: 'Federated partners', value: fedLine },
              { name: 'Geo cell', value: hex ? `\`${hex}\`` : '_none_' }
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // sub === 'publish'
    const lens = interaction.options.getString('lens', true).trim();
    const itemId = interaction.options.getString('item-id', true).trim();
    const item = (await ctx.holosphere.get(ctx.holonId, lens, itemId)) as {
      id?: string;
      [k: string]: unknown;
    } | null;
    if (!item) {
      await interaction.reply({
        content: `No item \`${itemId}\` found in lens \`${lens}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const outcome = await publishToFederation(
      {
        holosphere: hs(ctx),
        holonId: ctx.holonId,
        lens,
        item: { ...item, id: itemId },
      },
      { kind: 'all' }
    );
    const errors = outcome.errors.length
      ? `\n⚠️ ${outcome.errors.length} error(s).`
      : '';
    await interaction.reply({
      content: `📡 Published to ${outcome.publishedTo} destination(s).${errors}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
