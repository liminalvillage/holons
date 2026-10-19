<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A track, drawn and made tappable: the layout, the diagram, and the sheet a
  // tap opens. Every screen that shows a diagram shows it through this, so
  // they select, describe and move on the same way.
  import {
    layoutSankey,
    type FlowGraphIndex,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import DetailSheet from "./DetailSheet.svelte";
  import Sankey from "./Sankey.svelte";
  import { valueText } from "$lib/format";
  import { locale } from "$lib/i18n";
  import type { Selection } from "$lib/viewTypes";

  export let track: ValueFlowTrack;
  export let index: FlowGraphIndex;
  /** The party the view is rooted on, when it is rooted on one. */
  export let focusId: string | null = null;
  /** The node id of that party in the track. */
  export let focusNodeId: string | null = null;
  /** Bars kept per column before the rest roll into one. */
  export let topN = 8;
  export let label = "";
  export let params: URLSearchParams | null = null;

  $: layout = layoutSankey(track, { topN, nodeWidth: 0.065, nodeGap: 0.024 });
  $: format = (value: number) => valueText(value, track.unit, $locale);

  let selection: Selection | null = null;
  // A selection belongs to the drawing it was made on.
  $: if (track) selection = null;
  $: selectedId = selection
    ? selection.type === "node"
      ? selection.node.id
      : selection.link.id
    : null;
</script>

<Sankey
  {layout}
  {format}
  {selectedId}
  focusId={focusNodeId}
  {label}
  onSelectNode={(node) => (selection = { type: "node", node })}
  onSelectLink={(link) => (selection = { type: "link", link })}
>
  <slot name="empty" slot="empty" />
</Sankey>

{#if selection}
  <DetailSheet
    {selection}
    {index}
    {track}
    {layout}
    {focusId}
    {format}
    {params}
    on:close={() => (selection = null)}
  />
{/if}
