import type { ComponentType } from 'svelte';

export interface SidebarItem {
  name: string;
  icon: ComponentType;
  link: string;
}
