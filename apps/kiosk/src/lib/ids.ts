// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Identity comparison for the ids the views juggle. Participant ids
// round-trip through holosphere as number or string depending on the writer,
// so identity is compared stringified — the same rule core's membership
// helpers use (never `===` on raw ids).

/** Loose id equality: `7` and `"7"` are the same person. */
export function sameId(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): boolean {
  return a != null && b != null && String(a) === String(b);
}
