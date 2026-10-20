// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The network layout, off the main thread: a force run over two thousand
// parties takes a phone a second or more, and the page must not freeze for it.

import {
  indexFlowGraph,
  layoutFlowForce,
  type FlowGraph,
} from "@holons/core/flows";

self.onmessage = (e: MessageEvent<{ id: number; graph: FlowGraph }>) => {
  const { id, graph } = e.data;
  self.postMessage({ id, space: layoutFlowForce(indexFlowGraph(graph)) });
};
