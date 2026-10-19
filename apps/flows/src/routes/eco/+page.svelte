<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The whole map on one screen: the Pot, the funds it seats, and who they
  // and the Pot pay. Two thousand parties do not fit a phone, so core names
  // the largest few of each column and gathers the rest ("other funds",
  // "other projects") — and every gathered bar opens to the list behind it.
  //
  // That is the diagram. The map is the other way to see it: every party,
  // none gathered, in a space that turns (`FlowSpace`), each line as wide as
  // the share of the Pot it carries. `?view=diagram` is the Sankey.
  //
  // The map shows more than money: its drops take the eight capitals'
  // colours, and every party that was resourced glows with its count
  // (`?streams=money` shows the financial stream alone).
  import {
    CAPITALS,
    ecosystemTrack,
    layoutFlowSpace,
    listParties,
    partyNodeId,
    type FlowPartyKind,
    type FlowSpaceNode,
    type FlowViewLabels,
  } from "@holons/core/flows";
  import { page } from "$app/stores";
  import FlowChart from "$lib/components/FlowChart.svelte";
  import FlowList from "$lib/components/FlowList.svelte";
  import FlowSpace from "$lib/components/FlowSpace.svelte";
  import { capitalColour, capitalName } from "$lib/capitals";
  import KindChip from "$lib/components/KindChip.svelte";
  import SnapshotBadge from "$lib/components/SnapshotBadge.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { NARROW_PX } from "$lib/config";
  import { pct } from "$lib/format";
  import { index } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";
  import { hrefFor, searchHref, withParam } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  let innerWidth = 390;
  $: narrow = innerWidth < NARROW_PX;

  $: labels = {
    kept: $t("view.kept"),
    otherFunds: $t("view.otherFunds"),
    otherProjects: $t("view.otherProjects"),
    direct: $t("view.direct"),
  } satisfies FlowViewLabels;
  $: named = narrow ? 5 : 6;
  $: track = $index
    ? ecosystemTrack($index, { funds: named, projects: named, labels })
    : null;
  $: root = $index?.byId.get($index.graph.root) ?? null;

  $: diagram = $page.url.searchParams.get("view") === "diagram";
  $: streams = (
    $page.url.searchParams.get("streams") === "money" ? "money" : "eight"
  ) as "money" | "eight";
  $: capitals = $index
    ? new Map(
        $index.graph.nodes
          .filter((n) => n.resources)
          .map((n) => [n.id, n.resources!]),
      )
    : null;
  $: resourced = capitals?.size ?? 0;
  $: space = $index && !diagram ? layoutFlowSpace($index) : null;
  let picked: FlowSpaceNode | null = null;
  // A refined graph keeps the selection, as the party it now is.
  $: chosen = picked
    ? (space?.nodes.find((n) => n.id === picked!.id) ?? null)
    : null;

  const KINDS: { kind: FlowPartyKind; label: MessageKey }[] = [
    { kind: "fund", label: "eco.funds" },
    { kind: "project", label: "eco.projects" },
    { kind: "person", label: "eco.people" },
    { kind: "placeholder", label: "eco.unclaimed" },
  ];
  $: counts = KINDS.map((k) => ({
    ...k,
    n: $index?.graph.nodes.filter((node) => node.kind === k.kind).length ?? 0,
  })).filter((k) => k.n > 0);

  const top = (kind: FlowPartyKind): FlowListRow[] =>
    $index
      ? listParties($index, { kind, limit: 5 })
          .filter((r) => r.share > 0)
          .map((r) => ({
            id: r.id,
            label: r.label,
            kind: r.kind,
            value: pct(r.share),
          }))
      : [];
  $: funds = $index ? top("fund") : [];
  $: projects = $index ? top("project") : [];
  $: hrefOf = (row: FlowListRow) => {
    const n = $index?.byId.get(row.id);
    return n ? hrefFor(n) : null;
  };
</script>

<svelte:window bind:innerWidth />
<svelte:head><title>{$t("eco.title")} · Flows</title></svelte:head>

<SnapshotStatus />

{#if $index && track && root}
  <header class="head">
    <h1>{$t("eco.title")}</h1>
    <p class="muted">
      <a href={hrefFor(root)}>{root.label}</a>
    </p>
  </header>

  <ul class="counts">
    {#each counts as c (c.kind)}
      <li>
        <a href={searchHref("", c.kind)}
          ><b>{c.n.toLocaleString()}</b>{$t(c.label)}</a
        >
      </li>
    {/each}
  </ul>

  <div class="switch" role="group" aria-label={$t("eco.viewLabel")}>
    <a
      href={withParam($page.url, "view", null)}
      class:on={!diagram}
      aria-current={!diagram ? "true" : undefined}
      data-sveltekit-replacestate
      data-sveltekit-noscroll>{$t("eco.viewSpace")}</a
    >
    <a
      href={withParam($page.url, "view", "diagram")}
      class:on={diagram}
      aria-current={diagram ? "true" : undefined}
      data-sveltekit-replacestate
      data-sveltekit-noscroll>{$t("eco.viewDiagram")}</a
    >
  </div>

  {#if space && space.links.length}
    <section class="card chart">
      <FlowSpace
        {space}
        {capitals}
        {streams}
        format={pct}
        selectedId={chosen?.id ?? null}
        onSelect={(node) => (picked = node)}
        label={$t("eco.spaceSummary", { name: root.label })}
      />
    </section>
    {#if chosen}
      <section class="card picked" aria-live="polite">
        <div class="who">
          <KindChip kind={chosen.kind} />
          <h2>{chosen.label}</h2>
          <p class="muted">
            {#if chosen.reached}
              <b>{pct(chosen.share)}</b> · {$t("sheet.ofPot")}
            {:else}
              {$t("space.notReached")}
            {/if}
            {#if $index.into.get(chosen.id)?.length}
              · {$t("space.paidBy", {
                n: $index.into.get(chosen.id)?.length ?? 0,
              })}
            {/if}
            {#if $index.out.get(chosen.id)?.length}
              · {$t("space.pays", {
                n: $index.out.get(chosen.id)?.length ?? 0,
              })}
            {/if}
          </p>
        </div>
        <a class="open" href={hrefFor(chosen)}>{$t("sheet.open")}</a>
      </section>
    {/if}
    <div
      class="switch streams"
      role="group"
      aria-label={$t("eco.streamsLabel")}
    >
      <a
        href={withParam($page.url, "streams", null)}
        class:on={streams === "eight"}
        aria-current={streams === "eight" ? "true" : undefined}
        data-sveltekit-replacestate
        data-sveltekit-noscroll>{$t("eco.streamsEight")}</a
      >
      <a
        href={withParam($page.url, "streams", "money")}
        class:on={streams === "money"}
        aria-current={streams === "money" ? "true" : undefined}
        data-sveltekit-replacestate
        data-sveltekit-noscroll>{$t("eco.streamsMoney")}</a
      >
    </div>
    <ul class="capitals" aria-label={$t("eco.capitalsLabel")}>
      {#each CAPITALS as c (c)}
        {#if streams === "eight" || c === "financial"}
          <li class:money={c === "financial"}>
            <i style="background:{capitalColour(c)}"></i>{$t(capitalName(c))}
            {#if c === "financial"}<em>{$t("eco.oneOfEight")}</em>{/if}
          </li>
        {/if}
      {/each}
    </ul>
    <p class="muted hint">
      {$t("eco.spaceHint")}
      {#if streams === "eight"}
        {resourced
          ? $t("eco.resourcedHint", { n: resourced })
          : $t("eco.noResourcesHint")}
      {/if}
    </p>
  {:else}
    <section class="card chart">
      <FlowChart
        {track}
        index={$index}
        focusNodeId={partyNodeId(root.id)}
        topN={named + 2}
        label={$t("eco.summary", { name: root.label })}
      >
        <p slot="empty" class="muted empty">{$t("eco.empty")}</p>
      </FlowChart>
    </section>
    <p class="muted hint">{$t("eco.hint")}</p>
  {/if}

  {#if funds.length}
    <h2 class="section-title">{$t("eco.topFunds")}</h2>
    <FlowList rows={funds} {hrefOf} />
    <a class="all" href={searchHref("", "fund")}>{$t("common.seeAll")}</a>
  {/if}
  {#if projects.length}
    <h2 class="section-title">{$t("eco.topProjects")}</h2>
    <FlowList rows={projects} {hrefOf} />
    <a class="all" href={searchHref("", "project")}>{$t("common.seeAll")}</a>
  {/if}

  <p class="foot"><SnapshotBadge /></p>
{/if}

<style>
  .head h1 {
    font-size: 1.5rem;
  }
  .counts {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0;
    padding: 0;
  }
  .counts a {
    display: flex;
    flex-direction: column;
    min-width: 5.2rem;
    min-height: var(--tap);
    justify-content: center;
    padding: 8px 14px;
    border-radius: 14px;
    background: var(--card);
    border: 1px solid var(--line);
    text-decoration: none;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-weight: 600;
  }
  .counts b {
    font-size: 1.2rem;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    margin-bottom: 10px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  .switch a {
    min-height: 40px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .switch a.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }
  .streams {
    margin: 10px 0 0;
  }
  .capitals {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 10px 0 0;
    padding: 0;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .capitals li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .capitals i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .capitals .money {
    font-weight: 700;
    color: var(--ink);
  }
  .capitals em {
    font-style: normal;
    font-weight: 600;
    color: var(--muted);
  }
  .chart {
    padding: 10px 6px;
    overflow: hidden;
  }
  .picked {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
  }
  .who h2 {
    font-size: 1.05rem;
    overflow-wrap: anywhere;
  }
  .who p {
    font-size: 0.85rem;
  }
  .who b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
  .open {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    padding: 0 18px;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
    text-decoration: none;
  }
  .empty {
    padding: 28px 12px;
    text-align: center;
  }
  .hint {
    font-size: 0.85rem;
    margin-top: 8px;
  }
  .all {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    font-weight: 700;
    text-decoration: none;
  }
  .foot {
    margin-top: 18px;
  }
</style>
