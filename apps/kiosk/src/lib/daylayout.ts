// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Side-by-side layout for colliding timed events — greedy interval-graph
// colouring. Events that overlap in time are split into columns so they sit
// next to each other instead of on top of each other. Each gets
// `{ col, cols }`: its column and how many columns its overlap cluster needs,
// which a view turns into an offset and a width. Shared by the day/week
// hour grid and the flow's day line; pure so it has a test.

export interface PackItem {
  id: string;
  /** Start and end on one axis (minutes, ms — any unit, same for both). */
  start: number;
  end: number;
}

export interface Packed {
  col: number;
  cols: number;
}

export function packColumns(items: PackItem[]): Map<string, Packed> {
  const sorted = items
    .map((it) => ({ ...it, col: 0 }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const out = new Map<string, Packed>();
  let group: typeof sorted = [];
  let colEnds: number[] = []; // running end of each active column
  let groupCols = 0;
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const it of group) out.set(it.id, { col: it.col, cols: groupCols });
    group = [];
    colEnds = [];
    groupCols = 0;
  };

  for (const it of sorted) {
    if (group.length && it.start >= clusterEnd) flush();
    let c = colEnds.findIndex((end) => end <= it.start);
    if (c === -1) {
      c = colEnds.length;
      colEnds.push(it.end);
    } else {
      colEnds[c] = it.end;
    }
    it.col = c;
    group.push(it);
    groupCols = Math.max(groupCols, colEnds.length);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}
