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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
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
  const stoppers = quest.stoppers ?? [];
  if (quest.status === 'stopped' && stoppers.length > 0) {
    const names = stoppers
      .map(
        (s: { username?: string; id?: unknown }) => s.username ?? String(s.id)
      )
      .join(', ');
    embed.setColor(0xed4245);
    embed.addFields({ name: '🛑 Vetoed by', value: names });
  }
  return embed;
}

/** 🛑 Stop/veto toggle — label reflects whether the quest is already stopped. */
function stopButton(
  featureId: string,
  questId: string,
  stopped: boolean
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(encodeCustomId(featureId, 'stop', questId))
    .setLabel(stopped ? 'Lift veto' : 'Stop')
    .setStyle(stopped ? ButtonStyle.Secondary : ButtonStyle.Danger)
    .setEmoji('🛑');
}

/** 🙏 Appreciate button — available whether the quest is ongoing or done. */
function appreciateButton(featureId: string, questId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(encodeCustomId(featureId, 'appreciate', questId))
    .setLabel('Appreciate')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🙏');
}

/** Edit + Delete management row, shown in every quest state. */
function manageRow(
  featureId: string,
  questId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeCustomId(featureId, 'edit', questId))
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✏️'),
    new ButtonBuilder()
      .setCustomId(encodeCustomId(featureId, 'delete', questId))
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️')
  );
}

/**
 * Action buttons for a quest.
 *  - Ongoing:   Join/Leave + Complete + Stop + Appreciate, then Edit/Delete.
 *  - Stopped:   Lift-veto + Appreciate, then Edit/Delete (cannot complete).
 *  - Completed: Appreciate, then Edit/Delete.
 * Appreciate is always available; Stop (veto) is open to any member; Delete is
 * initiator-gated at the handler level (uses cascade deletion).
 */
export function questComponents(
  featureId: string,
  quest: Quest
): ActionRowBuilder<ButtonBuilder>[] {
  const questId = String(quest.id ?? '');

  if (quest.status === 'completed') {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        appreciateButton(featureId, questId)
      ),
      manageRow(featureId, questId),
    ];
  }

  if (quest.status === 'stopped') {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        stopButton(featureId, questId, true),
        appreciateButton(featureId, questId)
      ),
      manageRow(featureId, questId),
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
        .setStyle(ButtonStyle.Success),
      stopButton(featureId, questId, false),
      appreciateButton(featureId, questId)
    ),
    manageRow(featureId, questId),
  ];
}

/**
 * Edit modal for a quest — title, description, location and schedule. Each
 * input is pre-filled with the current value so unchanged fields round-trip.
 * The modal's customId carries the quest id so the submit handler knows which
 * record to mutate.
 */
export function questEditModal(featureId: string, quest: Quest): ModalBuilder {
  const questId = String(quest.id ?? '');
  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId(featureId, 'editSubmit', questId))
    .setTitle('Edit quest');

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200)
    .setValue(String(quest.title ?? ''));

  const description = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(2000)
    .setValue(String(quest.description ?? ''));

  const location = new TextInputBuilder()
    .setCustomId('location')
    .setLabel('Location')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(200)
    .setValue(String(quest.location ?? ''));

  const when = new TextInputBuilder()
    .setCustomId('when')
    .setLabel('When (e.g. 2026-06-01 18:00)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(100)
    .setValue(String(quest.when ?? ''));

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(title),
    new ActionRowBuilder<TextInputBuilder>().addComponents(description),
    new ActionRowBuilder<TextInputBuilder>().addComponents(location),
    new ActionRowBuilder<TextInputBuilder>().addComponents(when)
  );
  return modal;
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
