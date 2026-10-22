// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Minimal shim for the untyped `lune` package (same as apps/web's copy):
// only `phase()` is used, for the year timeline's moon-phase markers.
declare module "lune" {
  export function phase(date: Date): {
    phase: number;
    illuminated: number;
    age: number;
    distance: number;
    angular_diameter: number;
    sun_distance: number;
    sun_angular_diameter: number;
  };
}
