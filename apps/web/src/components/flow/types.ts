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

// Calculate zone percentages based on steepness
export function calculateZonePercentages(
  steepness: number,
  nzones: number,
): number[] {
  if (nzones <= 0) return [];

  // steepness: 0-100, represents decay factor (higher = more even distribution)
  const decay = steepness / 100;

  let weights: number[] = [];
  let total = 0;

  for (let z = 0; z < nzones; z++) {
    const weight = Math.pow(decay, z);
    weights.push(weight);
    total += weight;
  }

  // Normalize to percentages
  if (total === 0) {
    return weights.map(() => 100 / nzones);
  }

  return weights.map((w) => (w / total) * 100);
}

// Convert steepness from UI value (0-100) to contract value (BigInt)
export function steepnessToContract(uiValue: number): bigint {
  // Contract expects 0 < s < 1e18 (WAD scale, strictly between)
  // Clamp to valid range: 1 to 999999999999999999 (just under 1e18)
  const minValue = 1n;
  const maxValue = BigInt(1e18) - 1n;
  const scaled = BigInt(Math.floor((uiValue / 100) * 1e18));
  if (scaled <= 0n) return minValue;
  if (scaled >= BigInt(1e18)) return maxValue;
  return scaled;
}

// Convert steepness from contract value (BigInt) to UI value (0-100)
export function steepnessFromContract(contractValue: bigint): number {
  return Number((contractValue * 100n) / BigInt(1e18));
}

export type { HolonBundle, FlowConfig };
