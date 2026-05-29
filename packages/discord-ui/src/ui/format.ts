/**
 * Pure presentation helpers — no discord.js imports, so they're trivially
 * unit-testable. `DiscordUI` turns these into EmbedBuilders / components.
 */
import type { Quest } from '@holons/core/tasks';
import type { ShoppingChecklist, ShoppingItem } from '@holons/core/shopping';

const TYPE_LABELS: Record<string, string> = {
  task: '📋 Task',
  quest: '📋 Quest',
  event: '📅 Event',
  recurring: '🔁 Recurring',
  offer: '🎁 Offer',
  request: '🙏 Request',
  need: '🙏 Need',
};

export function questTypeLabel(type: string | undefined): string {
  return TYPE_LABELS[type ?? 'task'] ?? '📋 Task';
}

export function participantNames(quest: Quest): string[] {
  return (quest.participants ?? [])
    .map(
      p => p?.username || p?.firstName || (p?.id != null ? String(p.id) : '')
    )
    .filter((name): name is string => name.length > 0);
}

export interface QuestEmbedView {
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  footer: string;
}

/** Build a plain, render-agnostic view of a quest for an embed. */
export function questEmbedView(quest: Quest): QuestEmbedView {
  const fields: QuestEmbedView['fields'] = [];

  fields.push({
    name: 'Type',
    value: questTypeLabel(quest.type),
    inline: true,
  });
  fields.push({
    name: 'Status',
    value: quest.status === 'completed' ? '✅ Completed' : '🟢 Ongoing',
    inline: true,
  });

  const names = participantNames(quest);
  fields.push({
    name: `Participants (${names.length})`,
    value: names.length > 0 ? names.join(', ') : '—',
    inline: false,
  });

  if (quest.when)
    fields.push({ name: 'When', value: quest.when, inline: true });
  if (quest.location) {
    fields.push({ name: 'Where', value: quest.location, inline: true });
  }

  const initiator =
    quest.initiator?.username ||
    quest.initiator?.firstName ||
    (quest.initiator?.id != null ? String(quest.initiator.id) : 'unknown');

  return {
    title: quest.title || '(untitled)',
    description: quest.description || '',
    fields,
    footer: `Created by ${initiator}`,
  };
}

/** One-line summary used in the `/quests` list. */
export function questSummaryLine(quest: Quest): string {
  const done = quest.status === 'completed' ? '✅ ' : '';
  const count = participantNames(quest).length;
  const people = count > 0 ? ` · 👥 ${count}` : '';
  return `${done}${questTypeLabel(quest.type)} — **${quest.title}**${people}`;
}

/** Render a shopping checklist as grouped markdown lines. */
export function shoppingListView(checklist: ShoppingChecklist | null): string {
  if (!checklist || checklist.items.length === 0) {
    return '_The shopping list is empty._';
  }
  const byCategory = new Map<string, ShoppingItem[]>();
  for (const item of checklist.items) {
    const cat = (item.category as string) || '';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(item);
  }

  const lines: string[] = [];
  for (const [cat, items] of byCategory) {
    if (cat) lines.push(`__${cat}__`);
    for (const item of items) {
      lines.push(`${item.checked ? '☑️' : '⬜'} ${item.text}`);
    }
  }
  return lines.join('\n');
}
