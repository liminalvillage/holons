/**
 * discord.js presentation helpers — turns the pure views in `format.ts` into
 * embeds and interactive component rows. This is the Discord analogue of
 * telegram-ui's `UI.js` (embeds instead of HTML, buttons instead of inline
 * keyboards).
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { Quest } from '@holons/core/tasks';
import type { ShoppingChecklist } from '@holons/core/shopping';
import type { Checklist } from '@holons/core/checklists';
import { encodeCustomId } from './customId.js';
import { checklistView, questEmbedView, shoppingListView } from './format.js';

/** Holons accent colour for embeds. */
export const ACCENT = 0x7c5cff;

export function questEmbed(quest: Quest): EmbedBuilder {
  const view = questEmbedView(quest);
  const embed = new EmbedBuilder()
    .setColor(quest.status === 'completed' ? 0x57f287 : ACCENT)
    .setTitle(view.title)
    .setFooter({ text: view.footer });
  if (view.description) embed.setDescription(view.description);
  embed.addFields(view.fields);
  const thanks = (quest.appreciation ?? []).length;
  if (thanks > 0)
    embed.addFields({ name: 'Appreciation', value: `🙏 ${thanks}` });
  return embed;
}

/**
 * Action buttons for a quest. While ongoing: Join/Leave + Complete. Once
 * completed: an Appreciate button so members can thank contributors.
 */
export function questComponents(
  featureId: string,
  quest: Quest
): ActionRowBuilder<ButtonBuilder>[] {
  const questId = String(quest.id ?? '');
  const completed = quest.status === 'completed';

  if (completed) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(featureId, 'appreciate', questId))
          .setLabel('Appreciate')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🙏')
      ),
    ];
  }

  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(featureId, 'toggle', questId))
        .setLabel('Join / Leave')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(featureId, 'complete', questId))
        .setLabel('Complete')
        .setStyle(ButtonStyle.Success)
    ),
  ];
}

export function shoppingEmbed(
  checklist: ShoppingChecklist | null
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('🛒 Shopping List')
    .setDescription(shoppingListView(checklist));
}

/**
 * Toggle buttons for shopping items (up to 20, 5 per row) plus a final row
 * with a "Remove checked" action. Discord allows at most 5 action rows / 25
 * components per message, so we cap the item count.
 */
export function shoppingComponents(
  featureId: string,
  checklist: ShoppingChecklist | null
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const items = (checklist?.items ?? []).slice(0, 20);

  for (let i = 0; i < items.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    for (const item of items.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(featureId, 'toggle', String(item.id)))
          .setLabel(item.text.slice(0, 80))
          .setStyle(item.checked ? ButtonStyle.Secondary : ButtonStyle.Primary)
      );
    }
    rows.push(row);
  }

  if (items.length > 0) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(featureId, 'clearChecked'))
          .setLabel('Remove checked')
          .setStyle(ButtonStyle.Danger)
      )
    );
  }
  return rows;
}

export function checklistEmbed(checklist: Checklist): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`📝 ${checklist.id}`)
    .setDescription(checklistView(checklist));
}

/**
 * Toggle buttons for checklist items, addressed by index (up to 20, 5 per
 * row). The checklist id is colon-free (core rejects `_`; the feature also
 * rejects `:`), so it packs safely into the customId.
 */
export function checklistComponents(
  featureId: string,
  checklist: Checklist
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const items = (checklist.items ?? []).slice(0, 20);

  for (let i = 0; i < items.length; i += 5) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    items.slice(i, i + 5).forEach((item, j) => {
      const index = i + j;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(encodeCustomId(featureId, 'toggle', checklist.id, index))
          .setLabel(item.text.slice(0, 80))
          .setStyle(item.checked ? ButtonStyle.Secondary : ButtonStyle.Primary)
      );
    });
    rows.push(row);
  }
  return rows;
}
