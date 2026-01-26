export interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  orderIndex: number;
  isDefault?: boolean;
}

export interface KanbanConfig {
  id: string;
  columns: KanbanColumn[];
  createdAt?: string;
  updatedAt?: string;
}

export const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'col-backlog', name: 'Backlog', orderIndex: 0, isDefault: true },
  { id: 'col-todo', name: 'To Do', orderIndex: 1 },
  { id: 'col-inprogress', name: 'In Progress', orderIndex: 2 },
  { id: 'col-done', name: 'Done', orderIndex: 3 }
];

export const COLUMN_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];
