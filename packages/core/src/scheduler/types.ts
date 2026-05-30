// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
//
// @holons/core/scheduler — type definitions.
//
// Platform-agnostic scheduling: reminders (one-shot or recurring) persisted per
// holon. Distilled from packages/telegram-ui/src/Scheduler.js, keeping the
// time/recurrence math and persistence here while delivery (sending the
// message) stays in each UI.

/** Supported recurrence cadences. */
export type Frequency =
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

export const FREQUENCIES: Frequency[] = [
  'hourly',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
];

/** A scheduled reminder. One-shot when `frequency` is null/absent. */
export interface Reminder {
  id: string;
  holonId: string;
  text: string;
  /** ISO timestamp of the next fire. */
  fireAt: string;
  createdBy?: string | number;
  /** UI-specific delivery target (e.g. Discord channel id). */
  channelId?: string;
  frequency?: Frequency | null;
  created?: string;
  [key: string]: unknown;
}

/** Minimal Holosphere surface used by the scheduler persistence helpers. */
export interface SchedulerDB {
  get(holonId: string, lens: string, key?: string | number): Promise<unknown>;
  getAll(holonId: string, lens: string): Promise<unknown[]>;
  put(holonId: string, lens: string, value: unknown): Promise<unknown>;
  delete(holonId: string, lens: string, key: string | number): Promise<unknown>;
}
