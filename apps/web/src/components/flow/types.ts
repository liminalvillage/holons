import type { HolonBundle, FlowConfig } from "../../lib/holons/HolonsContract";

export interface ZonedHolon {
  id: string;
  name: string;
  zone: number; // -1 = drawer (unassigned), 1-N = assigned zone
  angle: number; // Position angle in zone ring (radians)
  status: "active" | "pending" | "inactive";
  splitterAddress?: string;
}

export interface InteriorMember {
  userId: string;
  username: string;
  score: number;
  percentage: number;
  color: string;
  breakdown?: {
    initiated: number;
    completed: number;
    sent: number;
    received: number;
    hours: number;
    collaboration: number;
  };
}

export interface ZoneInfo {
  zone: number;
  percentage: number; // Flow percentage based on steepness
  holons: ZonedHolon[];
  innerRadius: number;
  outerRadius: number;
}

export interface FlowState {
  interiorPercent: number;
  exteriorPercent: number;
  steepness: bigint;
  nzones: number;
  hasChanges: boolean;
  syncing: boolean;
}

export interface OriginalValues {
  interiorPercent: number;
  steepness: bigint;
  nzones: number;
  zoneAssignments: Map<string, number>;
}

// Color palette for pie chart slices
export const COLOR_PALETTE = [
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#F59E0B", // Amber
  "#10B981", // Emerald
  "#06B6D4", // Cyan
  "#EF4444", // Red
  "#84CC16", // Lime
  "#F97316", // Orange
  "#6366F1", // Indigo
  "#14B8A6", // Teal
  "#A855F7", // Violet
];

// Zone colors (from innermost to outermost)
export const ZONE_COLORS = [
  "#3B82F6", // Zone 1 - Blue
  "#8B5CF6", // Zone 2 - Purple
  "#F59E0B", // Zone 3 - Amber
  "#10B981", // Zone 4 - Emerald
  "#EC4899", // Zone 5 - Pink
  "#06B6D4", // Zone 6 - Cyan
  "#EF4444", // Zone 7 - Red
  "#84CC16", // Zone 8 - Lime
  "#F97316", // Zone 9 - Orange
  "#6366F1", // Zone 10 - Indigo
];

// Zone percentages from the steepness decay.
//
// The implementation moved to `@holons/core/flows` so the kiosk (which has no
// wallet and no d3) can compute the same split, and so there is exactly one
// version of this math. Re-exported here to keep every existing import working.
// `allocation.test.ts` in core pins the output against the numbers this file
// used to produce.
export { calculateZonePercentages } from "@holons/core/flows";

// Steepness conversion between the UI scale (0-100) and the contract's WAD.
//
// It lives next to the contract calls in `lib/holons/allocationSync`, which is
// what both allocation editors sync through. Re-exported here so every existing
// import keeps working.
export {
  steepnessToContract,
  steepnessFromContract,
} from "../../lib/holons/allocationSync";

export type { HolonBundle, FlowConfig };
