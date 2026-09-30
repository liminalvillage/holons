// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A holon's contributors, scored the way every Flows board ranks them — the
 * roster an equation-mode split divides by. One loader, so a cascade child
 * or an upstream read by the kiosk, the web or the MCP gets the same shares
 * the holon's own board shows. Quiet: a holon with no events has no roster.
 */

import { REAEventStore } from '../rea/index.js';
import { REAAggregator, computeHolonUserScores, extractReaUsers, loadEquation } from '../scoring/index.js';
import type { AllocationMember } from './allocation.js';

export async function scoreAllocationMembers(holosphere: any, holonId: string): Promise<AllocationMember[]> {
  let events: any[] = [];
  let users: any[] = [];
  try {
    events = ((await holosphere.getAll(holonId, 'rea_events')) as any[]) ?? [];
  } catch {
    events = [];
  }
  try {
    users = ((await holosphere.getAll(holonId, 'users')) as any[]) ?? [];
  } catch {
    users = [];
  }
  const roster = new Map<string, { id: string; name?: string }>();
  for (const u of extractReaUsers(events)) roster.set(String(u.id), u as { id: string; name?: string });
  for (const u of users) {
    const id = String(u?.id ?? '');
    if (id) roster.set(id, { id, name: u?.first_name ?? u?.username ?? id });
  }
  if (roster.size === 0) return [];
  const aggregator = new REAAggregator(new REAEventStore({ getAll: async () => events } as any));
  const equation = await loadEquation(holosphere, holonId);
  const scored = await computeHolonUserScores(aggregator, holonId, [...roster.values()] as never, equation);
  return scored
    .filter((s) => s.percentage > 0)
    .map((s) => ({
      id: String(s.userId),
      name: roster.get(String(s.userId))?.name ?? String(s.userId),
      percentage: s.percentage,
    }));
}
