/**
 * Library feature. `/library` lets a holon track shared items (tools, books,
 * equipment) and lend them out. All item logic — creation, borrow/return
 * rules, ownership checks, stats — lives in `@holons/core/library`; this module
 * only translates Discord interactions into those calls and renders the result.
 */
import {
  MessageFlags,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import {
  addItem,
  borrowItem,
  getItem,
  getItemIcon,
  getLibraryStats,
  getTypeDisplayName,
  listItems,
  removeItem,
  returnItem,
  setItemValue,
  type BorrowActor,
  type LibraryDB,
  type LibraryItem,
} from '@holons/core/library';
import type { Feature, InvocationContext } from '../types.js';
import { encodeCustomId, type ParsedCustomId } from '../ui/customId.js';
import { ACCENT } from '../ui/DiscordUI.js';

const FEATURE_ID = 'library';
/** Default loan length when the borrower doesn't pick a return date. */
const DEFAULT_LOAN_DAYS = 7;

function db(ctx: InvocationContext): LibraryDB {
  return ctx.holosphere as unknown as LibraryDB;
}

function actorFrom(interaction: {
  user: { id: string; username: string };
}): BorrowActor {
  return { id: interaction.user.id, username: interaction.user.username };
}

function defaultReturnDate(): Date {
  // No `Date.now()` budget concern here — runtime only, never in a workflow.
  return new Date(Date.now() + DEFAULT_LOAN_DAYS * 24 * 60 * 60 * 1000);
}

/** Parse a YYYY-MM-DD return date; fall back to the default loan on blank/invalid. */
function parseReturnDate(input: string): Date {
  const trimmed = input.trim();
  if (!trimmed) return defaultReturnDate();
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? defaultReturnDate() : parsed;
}

/** Modal asking when an item will be returned. */
function borrowModal(itemId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(encodeCustomId(FEATURE_ID, 'borrowModal', itemId))
    .setTitle('Borrow item')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('return')
          .setLabel('Return by (YYYY-MM-DD, blank = +7 days)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(20)
      )
    );
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

function itemEmbed(item: LibraryItem): EmbedBuilder {
  const icon = getItemIcon(item);
  const lines: string[] = [`**Type:** ${getTypeDisplayName(item.type)}`];
  if (item.category) lines.push(`**Category:** ${item.category}`);
  if (item.value) lines.push(`**Value:** ${item.value} credits`);
  if (item.borrowed) {
    const until = item.returnBy
      ? ` until ${new Date(item.returnBy).toLocaleDateString()}`
      : '';
    lines.push(
      `**Status:** 📤 Borrowed by ${item.borrower ?? 'someone'}${until}`
    );
  } else {
    lines.push('**Status:** ✅ Available');
  }
  if (item.description) lines.push(`\n${item.description}`);
  return new EmbedBuilder()
    .setColor(item.borrowed ? 0xffa500 : ACCENT)
    .setTitle(`${icon} ${item.id}`)
    .setDescription(lines.join('\n'));
}

function itemComponents(item: LibraryItem): ActionRowBuilder<ButtonBuilder>[] {
  const id = String(item.id);
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (item.borrowed) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(FEATURE_ID, 'return', id))
        .setLabel('Return')
        .setStyle(ButtonStyle.Success)
        .setEmoji('📥')
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(FEATURE_ID, 'borrow', id))
        .setLabel('Borrow')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📤')
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId(FEATURE_ID, 'delete', id))
      .setLabel('Remove')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );
  return [row];
}

export const libraryFeature: Feature = {
  id: FEATURE_ID,
  commands: [
    new SlashCommandBuilder()
      .setName('library')
      .setDescription('Shared library of tools, books and equipment')
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Add an item to the library')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Item name / id')
              .setRequired(true)
          )
          .addStringOption(opt =>
            opt
              .setName('category')
              .setDescription('Category')
              .setRequired(false)
          )
          .addStringOption(opt =>
            opt
              .setName('description')
              .setDescription('Description')
              .setRequired(false)
          )
          .addIntegerOption(opt =>
            opt
              .setName('value')
              .setDescription('Credit value when borrowed')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('list')
          .setDescription('List library items')
          .addStringOption(opt =>
            opt
              .setName('filter')
              .setDescription('Filter by name or category')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub.setName('stats').setDescription('Show library statistics')
      )
      .addSubcommand(sub =>
        sub
          .setName('item')
          .setDescription('Show one item with borrow/return buttons')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Item name / id')
              .setRequired(true)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('value')
          .setDescription('Set an item’s credit value (owner only)')
          .addStringOption(opt =>
            opt
              .setName('name')
              .setDescription('Item name / id')
              .setRequired(true)
          )
          .addIntegerOption(opt =>
            opt
              .setName('value')
              .setDescription('Credit value when borrowed')
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
      const name = interaction.options.getString('name', true).trim();
      const result = await addItem(db(ctx), ctx.holonId, name, {
        createdBy: interaction.user.id,
        createdByUsername: interaction.user.username,
        category: interaction.options.getString('category') ?? undefined,
        description: interaction.options.getString('description') ?? undefined,
        value: interaction.options.getInteger('value') ?? undefined,
      });
      if (!result.ok) {
        await interaction.reply({
          content: `An item called **${name}** already exists.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [itemEmbed(result.item!)],
        components: itemComponents(result.item!),
      });
      return;
    }

    if (sub === 'list') {
      const filter = (interaction.options.getString('filter') ?? '')
        .trim()
        .toLowerCase();
      const items = (await listItems(db(ctx), ctx.holonId)).filter(i =>
        filter
          ? `${i.id} ${i.category ?? ''}`.toLowerCase().includes(filter)
          : true
      );
      if (items.length === 0) {
        await interaction.reply({
          content: 'No library items yet. Add one with `/library add`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const shown = items.slice(0, 25);
      const lines = shown.map(i => {
        const status = i.borrowed ? '📤' : '✅';
        return `${getItemIcon(i)} ${status} **${i.id}**${
          i.category ? ` · ${i.category}` : ''
        }`;
      });
      const more =
        items.length > shown.length
          ? `\n\n…and ${items.length - shown.length} more.`
          : '';
      await interaction.reply({
        content: `**Library** (${items.length})\n\n${lines.join('\n')}${more}`,
      });
      return;
    }

    if (sub === 'stats') {
      const stats = getLibraryStats(await listItems(db(ctx), ctx.holonId));
      const byType = Object.entries(stats.byType)
        .map(([t, n]) => `• ${getTypeDisplayName(t)}: ${n}`)
        .join('\n');
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ACCENT)
            .setTitle('📚 Library stats')
            .setDescription(
              `**Total:** ${stats.total}\n**Available:** ${stats.available}\n**Borrowed:** ${stats.borrowed}\n\n${byType}`
            ),
        ],
      });
      return;
    }

    if (sub === 'value') {
      const name = interaction.options.getString('name', true).trim();
      const value = interaction.options.getInteger('value', true);
      const result = await setItemValue(
        db(ctx),
        ctx.holonId,
        name,
        value,
        interaction.user.id
      );
      if (!result.ok) {
        await interaction.reply({
          content:
            result.reason === 'forbidden'
              ? 'Only the owner can set this item’s value.'
              : `No item called **${name}**.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [itemEmbed(result.item!)],
        components: itemComponents(result.item!),
      });
      return;
    }

    // sub === 'item'
    const name = interaction.options.getString('name', true).trim();
    const item = await getItem(db(ctx), ctx.holonId, name);
    if (!item) {
      await interaction.reply({
        content: `No item called **${name}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [itemEmbed(item)],
      components: itemComponents(item),
    });
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
    const [itemId] = parsed.args;

    if (parsed.action === 'borrow') {
      // Ask for a return date; an empty field falls back to the default loan.
      await interaction.showModal(borrowModal(itemId));
      return;
    }

    if (parsed.action === 'return') {
      const result = await returnItem(
        db(ctx),
        ctx.holonId,
        itemId,
        actorFrom(interaction)
      );
      if (!result.ok) {
        await interaction.reply({
          content:
            result.reason === 'forbidden'
              ? 'Only the current borrower can return this item.'
              : result.reason === 'not_borrowed'
                ? 'That item is not currently borrowed.'
                : 'That item no longer exists.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.update({
        embeds: [itemEmbed(result.item!)],
        components: itemComponents(result.item!),
      });
      return;
    }

    if (parsed.action === 'delete') {
      const item = await getItem(db(ctx), ctx.holonId, itemId);
      if (
        item &&
        String(item.createdBy ?? '') !== String(interaction.user.id)
      ) {
        await interaction.reply({
          content: 'Only the owner can remove this item.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await removeItem(db(ctx), ctx.holonId, itemId);
      await interaction.update({
        content: `🗑️ **${itemId}** removed from the library.`,
        embeds: [],
        components: [],
      });
    }
  },

  async handleModal(
    interaction: ModalSubmitInteraction,
    parsed: ParsedCustomId,
    ctx: InvocationContext
  ): Promise<void> {
    if (parsed.action !== 'borrowModal') return;
    if (!ctx.holonId) {
      await interaction.reply({
        content: 'This server is no longer bound to a holon.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [itemId] = parsed.args;
    const returnBy = parseReturnDate(
      interaction.fields.getTextInputValue('return')
    );
    const result = await borrowItem(
      db(ctx),
      ctx.holonId,
      itemId,
      actorFrom(interaction),
      returnBy
    );
    if (!result.ok) {
      await interaction.reply({
        content:
          result.reason === 'already_borrowed'
            ? 'That item is already borrowed.'
            : 'That item no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const payload = {
      embeds: [itemEmbed(result.item!)],
      components: itemComponents(result.item!),
    };
    // The modal was opened from the item message, so update it in place.
    if (interaction.isFromMessage()) {
      await interaction.update(payload);
    } else {
      await interaction.reply(payload);
    }
  },
};
