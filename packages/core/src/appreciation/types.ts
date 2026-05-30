// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/appreciation — type definitions.
//
// Direct member-to-member appreciation ("kudos"). Extracted from
// packages/telegram-ui/src/Quests.ts (`sendAppreciation`).

/** A participant in an appreciation (UI-shaped; kept open). */
export interface AppreciationActor {
  id: string | number;
  username?: string | null;
  first_name?: string | null;
  [key: string]: unknown;
}

/** A recorded appreciation (`appreciations` lens). */
export interface Appreciation {
  id: string;
  from: AppreciationActor;
  to: AppreciationActor;
  amount: number;
  reason: string;
  /** Epoch ms (matches the Telegram bot's existing records). */
  date: number;
  holonId: string;
}

/** A user record carrying running appreciation tallies. */
export interface AppreciationCountUser {
  id: string | number;
  appreciationReceived?: number;
  appreciationGiven?: number;
  [key: string]: unknown;
}

/** Minimal Holosphere surface used by the persistence helpers. */
export interface AppreciationDB {
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
}
