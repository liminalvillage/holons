// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The network view's layout: funds and projects pulled together by their
// links (core's `layoutFlowForce`), worked out in a worker and kept for the
// graph it was made from. Where there is no worker it runs here, after a
// frame, so the page has painted first.

import {
  indexFlowGraph,
  layoutFlowForce,
  type FlowGraph,
  type FlowSpace,
} from "@holons/core/flows";

let worker: Worker | null = null;
let asked = 0;
const waiting = new Map<number, (space: FlowSpace) => void>();
let last: { graph: FlowGraph; space: Promise<FlowSpace> } | null = null;

function start(): Worker | null {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./network.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (e: MessageEvent<{ id: number; space: FlowSpace }>) => {
      waiting.get(e.data.id)?.(e.data.space);
      waiting.delete(e.data.id);
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** The network layout of `graph`; the same graph asked twice is laid out once. */
export function networkOf(graph: FlowGraph): Promise<FlowSpace> {
  if (last?.graph === graph) return last.space;
  const w = start();
  const space = w
    ? new Promise<FlowSpace>((done) => {
        const id = ++asked;
        waiting.set(id, done);
        w.postMessage({ id, graph });
      })
    : new Promise<FlowSpace>((done) =>
        setTimeout(() => done(layoutFlowForce(indexFlowGraph(graph))), 16),
      );
  last = { graph, space };
  return space;
}
