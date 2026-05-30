/**
 * Pure presentation helpers — no discord.js imports, so they're trivially
 * unit-testable. `DiscordUI` turns these into EmbedBuilders / components.
 */
import type { Quest } from '@holons/core/tasks';
import type { ShoppingChecklist, ShoppingItem } from '@holons/core/shopping';
import type { BalancesResult } from '@holons/core/expenses';
import type { Checklist } from '@holons/core/checklists';

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

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberLike {
  id: string | number;
  username?: string | null;
  first_name?: string | null;
}

export function memberName(member: MemberLike): string {
  return member.username || member.first_name || String(member.id ?? 'unknown');
}

export function memberListView(members: MemberLike[]): string {
  if (!members || members.length === 0) {
    return '_No members yet. Use `/join` to register._';
  }
  return members.map(m => `• ${memberName(m)}`).join('\n');
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/** Round to 2 decimals and drop a trailing `.00`. */
export function formatAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * Render net balances for one currency. `nameFor` resolves a user id to a
 * display name (defaults to the raw id). Positive net = is owed; negative =
 * owes.
 */
export function balancesView(
  result: BalancesResult,
  currency: string,
  nameFor: (id: string | number) => string = String
): string {
  const cur = currency.toUpperCase();
  const nonZero = result.balances.filter(b => Math.abs(b.net) >= 0.005);
  if (nonZero.length === 0) return `Everyone is settled up in ${cur}. 🎉`;

  return nonZero
    .sort((a, b) => b.net - a.net)
    .map(b => {
      const name = nameFor(b.userId);
      if (b.net > 0)
        return `🟢 **${name}** is owed ${formatAmount(b.net)} ${cur}`;
      return `🔴 **${name}** owes ${formatAmount(-b.net)} ${cur}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

export function checklistView(checklist: Checklist): string {
  if (!checklist.items || checklist.items.length === 0) {
    return '_This checklist is empty._';
  }
  return checklist.items
    .map(item => `${item.checked ? '☑️' : '⬜'} ${item.text}`)
    .join('\n');
}

export function checklistSummaryLine(checklist: Checklist): string {
  const total = checklist.items?.length ?? 0;
  const done = (checklist.items ?? []).filter(i => i.checked).length;
  return `📝 **${checklist.id}** — ${done}/${total} done`;
}
