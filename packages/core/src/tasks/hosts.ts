// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Who leads an event. When an event names hosts, THEY are the ones credited
// for it — the completion and the thanks (`appreciation`) go to them. With no
// host named, everyone who took part is credited, as on any task.
// `completion-plan.ts` asks `creditedMembers`; nothing else decides.
//
// Core owns the rule; UIs edit the list with the helpers below and never
// decide for themselves who gets the credit.

import { isEventQuest } from './kind.js';
import type { Quest, QuestParticipant } from './types.js';

function sameId(a: unknown, b: unknown): boolean {
  return a != null && b != null && String(a) !== '' && String(a) === String(b);
}

/** The stored list, tolerating a missing field or a JSON string off the wire. */
function stored(value: unknown): QuestParticipant[] {
  let list: unknown = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: QuestParticipant[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const host = raw as QuestParticipant;
    if (host.id == null || String(host.id) === '') continue;
    if (out.some((h) => sameId(h.id, host.id))) continue;
    out.push(host);
  }
  return out;
}

/**
 * The hosts named on an event. Empty when nobody is named, and for anything
 * that is not an event — tasks and marketplace items have no hosts.
 */
export function hostsOf(quest: Quest | null | undefined): QuestParticipant[] {
  if (!quest || !isEventQuest(quest)) return [];
  return stored(quest.hosts);
}

export function isHost(quest: Quest | null | undefined, userId: string | number): boolean {
  return hostsOf(quest).some((h) => sameId(h.id, userId));
}

export function addHost(quest: Quest, user: QuestParticipant): Quest {
  const hosts = stored(quest.hosts);
  if (user.id == null || hosts.some((h) => sameId(h.id, user.id))) return { ...quest, hosts };
  return { ...quest, hosts: [...hosts, user] };
}

export function removeHost(quest: Quest, userId: string | number): Quest {
  return { ...quest, hosts: stored(quest.hosts).filter((h) => !sameId(h.id, userId)) };
}

export function toggleHost(quest: Quest, user: QuestParticipant): Quest {
  if (user.id == null) return quest;
  return stored(quest.hosts).some((h) => sameId(h.id, user.id)) ? removeHost(quest, user.id) : addHost(quest, user);
}

/**
 * Who a quest credits — its completion and its appreciation: the hosts when
 * an event names any, otherwise everyone who took part.
 */
export function creditedMembers(quest: Quest): QuestParticipant[] {
  const hosts = hostsOf(quest);
  if (hosts.length) return hosts;
  return Array.isArray(quest.participants) ? quest.participants : [];
}
