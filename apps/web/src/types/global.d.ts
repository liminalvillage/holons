/// <reference types="@types/mapbox-gl" />
/// <reference types="svelte" />

declare module '@mapbox/mapbox-gl-geocoder';

declare namespace mapboxgl {
    export type Map = import('mapbox-gl').Map;
    export type MapMouseEvent = import('mapbox-gl').MapMouseEvent;
    export type GeoJSONSource = import('mapbox-gl').GeoJSONSource;
}

declare namespace svelteHTML {
  // Add the following interfaces
  interface HTMLAttributes<T> {
    [key: string]: any;
  }
  
  interface SVGAttributes<T> {
    [key: string]: any;
  }
  
  interface DOMAttributes<T> {
    [key: string]: any;
  }
}

declare module "*.svelte" {
  import type { ComponentType } from "svelte";
  const component: ComponentType;
  export default component;
}

declare module "mapbox-gl" {
  const mapboxgl: any;
  export default mapboxgl;
}

declare module "h3-js" {
  export function latLngToCell(lat: number, lng: number, res: number): string;
  export function cellToLatLng(h3Index: string): [number, number];
  export function cellToBoundary(h3Index: string, formatAsGeoJson?: boolean): Array<[number, number]>;
  export function getResolution(h3Index: string): number;
  export function isValidCell(h3Index: string): boolean;
  export function getHexagonEdgeLengthAvg(res: number, unit: string): number;
  export function cellToParent(h3Index: string, res: number): string;
  export function cellToChildren(h3Index: string, res: number): string[];
  export function polygonToCells(polygon: any, res: number): string[];
} 