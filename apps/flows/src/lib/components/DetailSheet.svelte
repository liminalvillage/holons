<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What a tap on the diagram brings forward. A bar says who it is, how much
  // of the view it carries and how much of the whole Pot reaches it, and
  // offers to go there — the same diagram, rooted on them. A ribbon says who
  // pays whom and how much of the payer's own split that is. A bar that
  // stands for many ("+12 more", "other funds") lists them, each a way on.
  import {
    FLOW_DIRECT_ID,
    FLOW_KEPT_ID,
    FLOW_OTHER_FUNDS_ID,
    FLOW_OTHER_PROJECTS_ID,
    listParties,
    partyIdOf,
    rolledUpNodes,
    type FlowGraphIndex,
    type SankeyLayout,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import FlowList from "./FlowList.svelte";
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import { pct } from "$lib/format";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { hrefFor, searchHref } from "$lib/urls";
  import type { FlowListRow, Selection } from "$lib/viewTypes";

  export let selection: Selection;
  export let index: FlowGraphIndex;
  export let track: ValueFlowTrack;
  export let layout: SankeyLayout;
  /** The party the view is rooted on, when it is rooted on one. */
  export let focusId: string | null = null;
  export let format: (value: number) => string;
  /** View parameters carried to wherever the reader goes next. */
  export let params: URLSearchParams | null = null;

  const dispatch = createEventDispatcher<{ close: void }>();
  /** How many of a long list a sheet shows before pointing at search. */
  const LIST = 40;

  const partyOf = (nodeId: string) => {
    const id = partyIdOf(nodeId);
    return id ? (index.byId.get(id) ?? null) : null;
  };
  const labelOf = (nodeId: string) =>
    layout.nodes.find((n) => n.id === nodeId)?.label ??
    track.nodes.find((n) => n.id === nodeId)?.label ??
    partyOf(nodeId)?.label ??
    nodeId;
  const hrefOfNode = (nodeId: string) => {
    const party = partyOf(nodeId);
    return party ? hrefFor(party, params) : null;
  };

  $: node = selection.type === "node" ? selection.node : null;
  $: link = selection.type === "link" ? selection.link : null;
  $: party = node ? partyOf(node.id) : null;
  $: isFocus = !!party && party.id === focusId;
  $: source = link ? partyOf(link.source) : null;
  $: target = link ? partyOf(link.target) : null;
  /** The ribbon as the payer's own split has it. */
  $: edge =
    source && target
      ? (index.out.get(source.id)?.find((l) => l.target === target!.id) ?? null)
      : null;

  $: shown = new Set(track.nodes.map((n) => partyIdOf(n.id)).filter(Boolean));
  /** The parties a many-in-one bar stands for. */
  $: members = ((): { rows: FlowListRow[]; more: string | null } => {
    if (!node) return { rows: [], more: null };
    const row = (
      id: string,
      label: string,
      kind: string,
      value: number,
    ): FlowListRow => ({
      id,
      label,
      kind,
      value: format(value),
    });
    if (node.id === FLOW_OTHER_FUNDS_ID || node.id === FLOW_OTHER_PROJECTS_ID) {
      const kind = node.id === FLOW_OTHER_FUNDS_ID ? "fund" : "project";
      const rest = listParties(index, { kind }).filter(
        (r) => !shown.has(r.id) && r.share > 0,
      );
      return {
        rows: rest.slice(0, LIST).map((r) => ({
          id: r.id,
          label: r.label,
          kind: r.kind,
          value: pct(r.share),
        })),
        more: rest.length > LIST ? searchHref("", kind) : null,
      };
    }
    if (node.id === FLOW_DIRECT_ID) {
      const seats = (index.out.get(index.graph.root) ?? [])
        .map((l) => ({ l, p: index.byId.get(l.target) }))
        .filter((x) => x.p && x.p.kind !== "fund" && x.l.share > 0)
        .sort((a, b) => b.l.share - a.l.share);
      return {
        rows: seats.slice(0, LIST).map((x) => ({
          id: x.p!.id,
          label: x.p!.label,
          kind: x.p!.kind,
          value: pct(x.l.share),
        })),
        more: seats.length > LIST ? searchHref("", "project") : null,
      };
    }
    const rolled = rolledUpNodes(track, layout, node.id);
    return {
      rows: rolled
        .slice(0, LIST)
        .map((r) =>
          row(partyIdOf(r.id) ?? r.id, r.label, r.kind ?? "other", r.value),
        ),
      more: null,
    };
  })();

  $: title = node
    ? node.label
    : `${labelOf(link!.source)} → ${labelOf(link!.target)}`;

  async function copy(href: string) {
    try {
      await navigator.clipboard.writeText(new URL(href, location.origin).href);
      showNotice($t("share.copied"));
    } catch {
      showNotice($t("share.failed"));
    }
  }
  const hrefOfRow = (r: FlowListRow) => {
    const p = index.byId.get(r.id);
    return p ? hrefFor(p, params) : null;
  };
</script>

<BottomSheet {title} on:close={() => dispatch("close")}>
  <svelte:fragment slot="head">
    <h2>{title}</h2>
    {#if node}<KindChip kind={party?.kind ?? node.kind ?? "other"} />{/if}
  </svelte:fragment>

  {#if node}
    <dl class="facts">
      <div>
        <dt>{isFocus ? $t("sheet.reaches") : $t("sheet.inView")}</dt>
        <dd>{node.display ?? format(node.value)}</dd>
      </div>
      {#if party && party.kind !== "pot"}
        <div>
          <dt>{$t("sheet.ofPot")}</dt>
          <dd>{pct(party.share)}</dd>
        </div>
        {#if party.rest > 0 && party.share - party.rest > 0.005}
          <div>
            <dt>{$t("sheet.keeps")}</dt>
            <dd>{pct(party.rest)}</dd>
          </div>
        {/if}
      {/if}
    </dl>

    {#if node.segments?.length}
      <ul class="segments">
        {#each node.segments as seg (seg.kind)}
          <li>
            <i class="swatch {seg.kind}"></i>{seg.label}<b
              >{seg.display ?? format(seg.value)}</b
            >
          </li>
        {/each}
      </ul>
    {/if}

    {#if node.id === FLOW_KEPT_ID}
      <p class="muted">{$t("sheet.keptBody")}</p>
    {:else if node.id === FLOW_DIRECT_ID}
      <p class="muted">{$t("sheet.directBody")}</p>
    {/if}
    {#if party?.unclaimedUntil}
      <p class="notice warn">
        {$t("party.unclaimed", {
          date: new Date(party.unclaimedUntil).toLocaleDateString(),
        })}
      </p>
    {/if}

    {#if members.rows.length}
      <h3 class="section-title">
        {$t("sheet.members", { n: members.rows.length })}
      </h3>
      <FlowList rows={members.rows} hrefOf={hrefOfRow} />
      {#if members.more}
        <a class="btn quiet more" href={members.more}>{$t("common.seeAll")}</a>
      {/if}
    {/if}

    {#if party && !isFocus}
      {@const href = hrefFor(party, params)}
      <div class="actions">
        <a class="btn" {href}>{$t("sheet.open")}<Icon name="chevron-right" /></a
        >
        <button class="btn quiet" on:click={() => copy(href)}
          ><Icon name="copy" />{$t("share.copy")}</button
        >
      </div>
    {/if}
  {:else if link}
    <dl class="facts">
      <div>
        <dt>{$t("sheet.inView")}</dt>
        <dd>{link.display ?? format(link.value)}</dd>
      </div>
      {#if edge}
        <div>
          <dt>{$t("sheet.ofSplit", { name: source?.label ?? "" })}</dt>
          <dd>{pct(edge.local)}</dd>
        </div>
        {#if edge.share > 0}
          <div>
            <dt>{$t("sheet.ofPot")}</dt>
            <dd>{pct(edge.share)}</dd>
          </div>
        {/if}
        <div>
          <dt>{$t("sheet.through")}</dt>
          <dd>
            {edge.via === "interior"
              ? $t("sheet.viaInterior")
              : edge.zone
                ? $t("sheet.viaRing", { n: edge.zone })
                : $t("sheet.viaExterior")}
          </dd>
        </div>
      {/if}
    </dl>
    <div class="actions">
      {#each [link.source, link.target] as end (end)}
        {@const href = hrefOfNode(end)}
        {#if href && partyIdOf(end) !== focusId}
          <a class="btn quiet" {href}
            >{$t("sheet.openNamed", { name: labelOf(end) })}</a
          >
        {/if}
      {/each}
    </div>
  {/if}
</BottomSheet>

<style>
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
    gap: 10px;
    margin: 8px 0 4px;
  }
  .facts div {
    background: var(--paper);
    border-radius: 12px;
    padding: 10px 12px;
    min-width: 0;
  }
  dt {
    font-size: 0.76rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  dd {
    margin: 2px 0 0;
    font-size: 1.15rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  .segments {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
    font-size: 0.92rem;
  }
  .segments li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .segments b {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .swatch {
    width: 0.7em;
    height: 0.7em;
    border-radius: 3px;
    background: var(--muted);
  }
  .swatch.claimed {
    background: var(--teal);
  }
  .swatch.available {
    background: color-mix(in srgb, var(--teal) 45%, var(--card));
    border: 1px solid var(--line);
  }
  p {
    margin-top: 10px;
    font-size: 0.92rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 16px;
  }
  .actions .btn {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more {
    margin-top: 10px;
    width: 100%;
  }
</style>
