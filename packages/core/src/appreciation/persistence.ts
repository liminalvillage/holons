// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/appreciation — Holosphere persistence helpers.

import type { Appreciation, AppreciationDB } from './types.js';

export const APPRECIATIONS_LENS = 'appreciations';

/** Persist an appreciation record. */
export async function saveAppreciation(
  db: AppreciationDB,
  appreciation: Appreciation
): Promise<void> {
  await db.put(String(appreciation.holonId), APPRECIATIONS_LENS, appreciation);
}

/** List a holon's appreciations, newest first. */
export async function listAppreciations(
  db: AppreciationDB,
  holonId: string | number
): Promise<Appreciation[]> {
  const list = ((await db.getAll(String(holonId), APPRECIATIONS_LENS)) ??
    []) as Appreciation[];
  return list.filter(Boolean).sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}
