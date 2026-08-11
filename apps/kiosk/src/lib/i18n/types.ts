// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Message catalog types. A message is either a plain string or a cardinal
// plural pair picked by the `n` interpolation parameter — one/other covers
// English, Italian, and Spanish, so no CLDR machinery is needed.

export type Msg = string | { one: string; other: string };
