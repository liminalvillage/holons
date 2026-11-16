// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors

// Finding quests: what a quest can be found BY (its facets — category, kind,
// people, tags) and whether it answers a query (free text plus picked
// facets). Every surface that offers a search over quests — a drawer of
// unscheduled ones, a backlog, the bot — asks here, so the same words find
// the same quests everywhere.
//
// Tags are the quest's `tags` array where it has one (marketplace items do)
// and the #hashtags written in its title or description, which is how people
// tag a quest in a chat. People are the initiator and the participants, by
// username when they have one, else by name.

import { questKind, type QuestKind } from './kind.js';
import type { Quest, QuestParticipant } from './types.js';

export type QuestFacetKind = 'category' | 'kind' | 'person' | 'tag';

export interface QuestFacet {
  kind: QuestFacetKind;
  /** Normalised value, what a filter compares: lower case, no `#`/`@`. */
  value: string;
  /** As first written, for display. */
  label: string;
}

export interface QuestQuery {
  /** Free text: every word must appear somewhere in the quest. */
  text?: string;
  /** Picked facets: a quest must carry ALL of them. */
  facets?: Array<Pick<QuestFacet, 'kind' | 'value'>>;
}

const HASHTAG = /(^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;

const norm = (s: string): string =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

/** The #hashtags in a text, as written (without the `#`), in order, deduped. */
export function hashtagsIn(text: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? '').matchAll(HASHTAG)) {
    const tag = m[2];
    if (/^\d+$/.test(tag)) continue; // "#3" is a number, not a tag
    const key = norm(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function listOf<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** How a person shows in a facet: @username, else their name. */
function personLabel(p: QuestParticipant | null | undefined): string | null {
  if (!p) return null;
  const user = String(p.username ?? '').trim().replace(/^@/, '');
  if (user) return `@${user}`;
  const name = [p.firstName ?? p.first_name, p.lastName ?? p.last_name]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || null;
}

/** Everything a quest can be found by, deduped per kind. */
export function questFacets(quest: Quest): QuestFacet[] {
  const out: QuestFacet[] = [];
  const seen = new Set<string>();
  const add = (kind: QuestFacetKind, label: string | null | undefined) => {
    const shown = String(label ?? '').trim();
    if (!shown) return;
    const value = norm(shown.replace(/^[#@]/, ''));
    if (!value) return;
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, value, label: shown });
  };
  add('category', quest.category);
  const kind: QuestKind = questKind(quest);
  if (kind !== 'other') add('kind', kind);
  add('person', personLabel(quest.initiator as QuestParticipant | undefined));
  for (const p of listOf<QuestParticipant>(quest.participants)) add('person', personLabel(p));
  for (const t of listOf<unknown>((quest as { tags?: unknown }).tags)) {
    if (typeof t === 'string') add('tag', `#${t.replace(/^#/, '')}`);
  }
  for (const t of hashtagsIn(`${quest.title ?? ''} ${quest.description ?? ''}`)) add('tag', `#${t}`);
  return out;
}

/** Does the quest answer the query? An empty query matches everything. */
export function matchesQuestQuery(quest: Quest, query: QuestQuery): boolean {
  const facets = questFacets(quest);
  for (const want of query.facets ?? []) {
    const value = norm(String(want.value ?? '').replace(/^[#@]/, ''));
    if (!facets.some((f) => f.kind === want.kind && f.value === value)) return false;
  }
  const words = norm(query.text ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/^[#@]/, ''))
    .filter(Boolean);
  if (!words.length) return true;
  const hay = norm(
    [quest.title, quest.description, quest.location, ...facets.map((f) => f.label)]
      .filter(Boolean)
      .join(' '),
  );
  return words.every((w) => hay.includes(w));
}

/** A facet across a set of quests, with how many carry it. */
export interface QuestFacetCount extends QuestFacet {
  count: number;
}

/**
 * The facets a set of quests offers, most common first (then by label) —
 * what a search shows as ready-made filters.
 */
export function questFacetCounts(quests: Quest[]): QuestFacetCount[] {
  const byKey = new Map<string, QuestFacetCount>();
  for (const q of quests) {
    for (const f of questFacets(q)) {
      const key = `${f.kind}:${f.value}`;
      const cur = byKey.get(key);
      if (cur) cur.count++;
      else byKey.set(key, { ...f, count: 1 });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
}
