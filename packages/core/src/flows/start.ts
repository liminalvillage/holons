// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Starting a fund or a project from scratch, with the key a person signed in
 * with: mint the holon's id, found it (that key becomes its first admin —
 * `protocol/founding.ts`), name it, and give it a split to edit.
 *
 * Fund and project are not two kinds of record: a holon is drawn as a fund
 * when its split seats other holons and as a project otherwise
 * (`classifyParty`). So every new holon starts with the same split — it
 * keeps nothing and has three empty rings — and becomes what it seats.
 *
 * Seating, admins and every later split change go through the usual paths:
 * the split editor, `addHolonMember`, split proposals.
 *
 * It is also written into the global registry (`registerHolon`), so others
 * can find it by name before anyone has seated it.
 */

import { registerHolon } from '../holosphere/registry.js';
import { foundHolon, newHolonId, type RandomBytes } from '../protocol/founding.js';
import type { AllocationConfig } from './allocation.js';
import { saveAllocationConfig } from './settings.js';

export const HOLON_NAME_MAX = 120;
export const HOLON_DESCRIPTION_MAX = 1000;

/** The split a new holon starts with: nothing kept, three rings to seat on. */
export const STARTER_SPLIT: AllocationConfig = {
  interiorPercent: 0,
  steepness: 50,
  nzones: 3,
  interiorMode: 'equation',
};

export interface StartHolonInput {
  name: string;
  description?: string;
  /** Injectable so specs can pin the id. */
  randomBytes?: RandomBytes;
}

export interface StartedHolon {
  holon: string;
  /** The key that founded it: its first admin. */
  anchor: string;
}

/** Found a new holon, named, with the starter split. */
export async function startHolon(holosphere: any, input: StartHolonInput): Promise<StartedHolon> {
  const name = String(input?.name ?? '').trim().slice(0, HOLON_NAME_MAX);
  if (!name) throw new Error('A new holon needs a name');
  const description = String(input?.description ?? '').trim().slice(0, HOLON_DESCRIPTION_MAX);
  const holon = newHolonId(input.randomBytes);
  const founded = await foundHolon(holosphere, holon, { name, ...(description ? { description } : {}) });
  await saveAllocationConfig(holosphere, holon, STARTER_SPLIT);
  // Best effort: being findable must not cost the start.
  await registerHolon(holosphere, { id: holon, name, purpose: description, type: 'pot' });
  return { holon, anchor: founded.anchor };
}
