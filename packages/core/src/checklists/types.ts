// @holons/core/checklists — domain types for checklist subtask CRUD.
// UI-agnostic. Mirrors the data shape used by the Telegram bot
// (packages/telegram-ui/src/Checklists.js) and the web Svelte UI
// (apps/web/src/components/Checklists.svelte).

/** Standard checklist types supported across Holons UIs. */
export const CHECKLIST_TYPES = {
  CHECKLIST: 'checklist',
  AGENDA: 'agenda',
  SHOPPING: 'shopping',
  QUEST: 'quest',
  ROLE: 'role',
} as const;

export type ChecklistType =
  (typeof CHECKLIST_TYPES)[keyof typeof CHECKLIST_TYPES];

/** A single checkbox item on a checklist. */
export interface ChecklistItem {
  text: string;
  checked: boolean;
}

/** Persisted checklist record. */
export interface Checklist {
  id: string;
  type?: ChecklistType;
  items: ChecklistItem[];
  created?: Date | string;
  creator?: string | number | null;
  // Quest/role linkage (optional, present on subtask checklists)
  questId?: string;
  roleId?: string;
  parentTitle?: string;
  holonId?: string | number;
  // Legacy fields used only for migration of old records
  questTitle?: string;
  roleTitle?: string;
  isTaskChecklist?: boolean;
  isRoleChecklist?: boolean;
}

/** Options accepted by {@link createChecklistObject}. */
export interface CreateChecklistOptions {
  creator?: string | number | null;
  questId?: string;
  roleId?: string;
  parentTitle?: string;
  holonId?: string | number;
}

/**
 * Minimal storage interface required by core checklist operations.
 * Matches the Holosphere DB shape used by HolonsBot:
 *   db.get(holonId, bucket, key)
 *   db.getAll(holonId, bucket)
 *   db.put(holonId, bucket, value)
 *   db.delete(holonId, bucket, key)
 */
export interface ChecklistStore {
  get(
    holonId: string,
    bucket: string,
    key: string
  ): Promise<any> | any;
  getAll(holonId: string, bucket: string): Promise<any[]> | any[];
  put(holonId: string, bucket: string, value: any): Promise<unknown> | unknown;
  delete(holonId: string, bucket: string, key: string): Promise<unknown> | unknown;
}
