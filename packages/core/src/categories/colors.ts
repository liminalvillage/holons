// Deterministic category -> color mapping.
// Hash matches the inline implementations previously duplicated across
// apps/web/src/components/{Tasks,CanvasView,MapSidebar,Star,kanban/KanbanCard}.svelte
// and packages/telegram-ui/src/UI.js, so swapping in this shared function
// preserves existing colors for any given category string.

import { getPaletteEntry, type CategoryItemType } from './palette.js';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash = hash & hash; // force 32-bit
  }
  return hash;
}

/**
 * Returns the deterministic background color for a category.
 *
 * Empty/undefined category returns the type's default color.
 * Same input always returns the same output across web + telegram UIs.
 */
export function colorFromCategory(
  category: string | null | undefined,
  type: CategoryItemType = 'task',
  dark: boolean = false,
): string {
  const entry = getPaletteEntry(type, dark);
  if (!category) return entry.defaultColor;
  const hue = Math.abs(hashString(category) % 360);
  return `hsl(${hue}, ${entry.saturation}%, ${entry.lightness}%)`;
}

// Alias matching the historical web naming.
export const getColorFromCategory = colorFromCategory;
