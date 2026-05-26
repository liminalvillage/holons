/**
 * Type definitions for the map components
 */

export type LensType =
  | "quests"
  | "needs"
  | "offers"
  | "communities"
  | "organizations"
  | "projects"
  | "currencies"
  | "people"
  | "holons"
  | "events"
  | "library"
  | "roles"
  | "announcements"
  | "expenses"
  | "checklists"
  | "appreciations"
  | "rea_events"
  | "canvases";

export interface LensOption {
  value: LensType;
  label: string;
}

export interface HexagonStats {
  total: number;
  completed?: number;
}
