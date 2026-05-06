declare module 'h3-js' {
  // Basic types
  export type H3Index = string;
  export type CoordPair = [number, number]; // [lat, lng]
  export type LatLng = [number, number]; // [lat, lng]
  
  // Core functions
  export function latLngToCell(lat: number, lng: number, res: number): H3Index;
  export function cellToLatLng(h3Index: H3Index): LatLng;
  export function cellToBoundary(h3Index: H3Index, formatAsGeoJson?: boolean): CoordPair[];
  export function getResolution(h3Index: H3Index): number;
  export function isValidCell(h3Index: string): boolean;
  export function getHexagonEdgeLengthAvg(res: number, unit: string): number;
  
  // Grid traversal
  export function gridDisk(h3Index: H3Index, k: number): H3Index[];
  export function gridDiskDistances(h3Index: H3Index, k: number): [H3Index[], number[]];
  export function gridRingUnsafe(h3Index: H3Index, k: number): H3Index[];
  export function gridPathCells(start: H3Index, end: H3Index): H3Index[];
  export function cellToLocalIj(origin: H3Index, h3Index: H3Index): [number, number];
  export function localIjToCell(origin: H3Index, coords: [number, number]): H3Index;
  
  // Hierarchical grid functions
  export function cellToParent(h3Index: H3Index, res: number): H3Index;
  export function cellToChildren(h3Index: H3Index, res: number): H3Index[];
  export function cellToCenterChild(h3Index: H3Index, res: number): H3Index;
  export function compactCells(h3Set: H3Index[]): H3Index[];
  export function uncompactCells(h3Set: H3Index[], res: number): H3Index[];
  
  // Miscellaneous
  export function cellToString(h3Index: H3Index): string;
  export function stringToCell(h3String: string): H3Index;
} 