// Single source of truth for the Holons category-color palette.
// Both UIs (web + telegram) must produce identical hex/rgb for the same
// (category, type, dark) input by going through this module.

export type CategoryItemType = 'task' | 'event' | 'quest' | string;

export interface PaletteEntry {
  // HSL saturation and lightness applied to the hashed hue when category
  // is non-empty.
  saturation: number;
  lightness: number;
  // Default value (string, hex or hsl) when category is empty/undefined.
  defaultColor: string;
}

// Light-mode palette. Sourced from apps/web/src/components/Tasks.svelte
// (the canonical web implementation referenced by the bot's previous
// inline copy).
export const LIGHT_PALETTE: Record<string, PaletteEntry> = {
  task: { saturation: 70, lightness: 85, defaultColor: '#E5E7EB' },
  event: { saturation: 85, lightness: 80, defaultColor: 'hsl(280, 70%, 85%)' },
  quest: { saturation: 75, lightness: 82, defaultColor: 'hsl(200, 70%, 85%)' },
};

// Dark-mode palette. Sourced from packages/telegram-ui/src/UI.js
// (only the bot currently renders dark variants).
export const DARK_PALETTE: Record<string, PaletteEntry> = {
  task: { saturation: 25, lightness: 22, defaultColor: '#1f2937' },
  event: { saturation: 30, lightness: 24, defaultColor: 'hsl(280, 25%, 22%)' },
  quest: { saturation: 28, lightness: 24, defaultColor: 'hsl(200, 25%, 22%)' },
};

export function getPaletteEntry(type: CategoryItemType, dark: boolean): PaletteEntry {
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
  return palette[type] ?? palette.task;
}
