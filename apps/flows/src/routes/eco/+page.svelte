<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The whole map on one screen: the Pot, the funds it seats, and who they
  // and the Pot pay.
  //
  // It opens on the Flow (`PotFalls`): the Pot across the top, pouring down
  // into the pots it seats and on into theirs, each band as wide as its
  // share. A tap on a pot gives its numbers and tools; `?from=<id>` pours
  // the view from that pot instead of the root.
  // Two thousand parties do not fit a phone, so core names
  // the largest few of each column and gathers the rest ("other funds",
  // "other projects") — and every gathered bar opens to the list behind it.
  //
  // That is the diagram. The map is the other way to see it: every party,
  // none gathered, in a space that turns (`FlowSpace`), each line as wide as
  // the share of the Pot it carries. `?view=network` pulls the funds and the
  // projects together by their links instead (`layoutFlowForce`, laid out
  // off the main thread), so a project several funds back sits between them.
  // `?view=diagram` is the Sankey; `?view=map` the space above.
  //
  // Over the map and the network sits a search: what it finds stays lit and
  // named while the rest fades, and choosing one flies there.
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
    type FlowSpace as FlowSpaceLayout,
    type FlowSpaceNode,
    type FlowViewLabels,
  } from "@holons/core/flows";
  import { page } from "$app/stores";
  import FlowChart from "$lib/components/FlowChart.svelte";
  import FlowList from "$lib/components/FlowList.svelte";
  import FlowSpace from "$lib/components/FlowSpace.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import PotFalls from "$lib/components/PotFalls.svelte";
  import { capitalColour, capitalName } from "$lib/capitals";
  import KindChip from "$lib/components/KindChip.svelte";
  import SnapshotBadge from "$lib/components/SnapshotBadge.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { NARROW_PX } from "$lib/config";
  import { index } from "$lib/graph";
  import { networkOf } from "$lib/network";
  import { t, type MessageKey, pctOf } from "$lib/i18n";
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

  $: view = (
    ["map", "diagram", "network"].includes(
      $page.url.searchParams.get("view") ?? "",
    )
      ? $page.url.searchParams.get("view")
      : "flow"
  ) as "flow" | "map" | "network" | "diagram";
  $: spatial = view === "map" || view === "network";
  // The pot the Flow pours from: one on the map, else the root.
  $: asked = $page.url.searchParams.get("from") ?? "";
  $: fromId = $index && asked && $index.byId.has(asked) ? asked : null;
  $: fromHref = (id: string) =>
    withParam($page.url, "from", id === $index?.graph.root ? null : id);
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
  $: tree = $index && view === "map" ? layoutFlowSpace($index) : null;
  // The network arrives when the worker is done; until then it is arranging.
  let network: FlowSpaceLayout | null = null;
  let arranging = false;
  $: if ($index && view === "network") arrange($index.graph);
  function arrange(graph: NonNullable<typeof $index>["graph"]) {
    arranging = true;
    void networkOf(graph).then((laid) => {
      if ($index?.graph !== graph) return;
      network = laid;
      arranging = false;
    });
  }
  $: space = view === "network" ? network : tree;
  let picked: FlowSpaceNode | null = null;
  // A refined graph keeps the selection, as the party it now is.
  $: chosen = picked
    ? (space?.nodes.find((n) => n.id === picked!.id) ?? null)
    : null;

  /** What the chosen party says about itself, off the snapshot. */
  $: about = chosen ? ($index?.byId.get(chosen.id)?.description ?? "") : "";

  /** Everyone the chosen party links to, either way, the widest line first; tappable below the map. */
  const LINKED_CHIPS = 24;
  $: linked = (() => {
    if (!chosen || !space) return [] as FlowSpaceNode[];
    const byId = new Map(space.nodes.map((n) => [n.id, n]));
    const seen = new Set<string>();
    const out: { node: FlowSpaceNode; w: number }[] = [];
    for (const l of space.links) {
      const other =
        l.source === chosen.id
          ? l.target
          : l.target === chosen.id
            ? l.source
            : null;
      if (!other || other === chosen.id || seen.has(other)) continue;
      const node = byId.get(other);
      if (!node) continue;
      seen.add(other);
      out.push({ node, w: l.width });
    }
    return out.sort((p, q) => q.w - p.w).map((e) => e.node);
  })();

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
            value: $pctOf(r.share),
          }))
      : [];
  $: funds = $index ? top("fund") : [];
  $: projects = $index ? top("project") : [];
  // ── Find on the map ──
  let query = "";
  let open = false;
  let active = 0;
  $: inView = space ? new Set(space.nodes.map((n) => n.id)) : null;
  $: found =
    $index && inView && query.trim()
      ? listParties($index, { query }).filter((r) => inView!.has(r.id))
      : [];
  $: highlight = query.trim() ? new Set(found.map((r) => r.id)) : null;
  $: suggestions = found.slice(0, 6);
  $: if (active >= suggestions.length) active = 0;

  function choose(id: string) {
    const node = space?.nodes.find((n) => n.id === id);
    if (!node) return;
    picked = node;
    open = false;
  }
  function onFindKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      open = true;
      const n = suggestions.length || 1;
      active = (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
    } else if (e.key === "Enter" && suggestions[active]) {
      e.preventDefault();
      choose(suggestions[active].id);
    } else if (e.key === "Escape") {
      if (open) open = false;
      else query = "";
    }
  }

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
    {#each [{ v: "flow", label: $t("eco.viewFlow") }, { v: "map", label: $t("eco.viewSpace") }, { v: "network", label: $t("eco.viewNetwork") }, { v: "diagram", label: $t("eco.viewDiagram") }] as o (o.v)}
      <a
        href={withParam($page.url, "view", o.v === "flow" ? null : o.v)}
        class:on={view === o.v}
        aria-current={view === o.v ? "true" : undefined}
        data-sveltekit-replacestate
        data-sveltekit-noscroll>{o.label}</a
      >
    {/each}
  </div>

  {#if spatial && (arranging || (space && space.links.length))}
    <div class="find">
      <label class="field">
        <Icon name="search" />
        <span class="sr">{$t("eco.findLabel")}</span>
        <input
          type="search"
          bind:value={query}
          placeholder={$t("eco.findPlaceholder")}
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls="find-list"
          aria-activedescendant={open && suggestions[active]
            ? `find-${active}`
            : undefined}
          on:input={() => ((open = true), (active = 0))}
          on:focus={() => (open = true)}
          on:blur={() => setTimeout(() => (open = false), 150)}
          on:keydown={onFindKey}
        />
        {#if query}
          <button
            class="clear"
            type="button"
            aria-label={$t("eco.findClear")}
            on:click={() => ((query = ""), (open = false))}
            ><Icon name="close" /></button
          >
        {/if}
      </label>
      {#if query.trim()}
        <p class="found muted" aria-live="polite">
          {found.length
            ? $t("eco.findCount", { n: found.length })
            : $t("eco.findNone")}
        </p>
      {/if}
      {#if open && suggestions.length}
        <ul class="suggest" id="find-list" role="listbox">
          {#each suggestions as r, i (r.id)}
            <li
              id="find-{i}"
              role="option"
              aria-selected={i === active}
              class:active={i === active}
            >
              <button
                type="button"
                tabindex="-1"
                on:mousedown|preventDefault={() => choose(r.id)}
                on:click={() => choose(r.id)}
              >
                <KindChip kind={r.kind} />
                <span class="name">{r.label}</span>
                <span class="share">{$pctOf(r.share)}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if view === "flow"}
    {#if fromId}
      <a class="back" href={fromHref(root.id)} data-sveltekit-noscroll
        ><Icon name="arrow-left" />{$t("falls.backToPot")}</a
      >
    {/if}
    <section class="card chart falls">
      <PotFalls
        index={$index}
        focusId={fromId ?? root.id}
        {fromHref}
        {narrow}
        label={$t("falls.summary", {
          name: $index.byId.get(fromId ?? root.id)?.label ?? root.label,
        })}
      >
        <p slot="empty" class="muted empty">{$t("eco.empty")}</p>
      </PotFalls>
    </section>
    <p class="muted hint">{$t("falls.hint")}</p>
  {:else if spatial && arranging && !space}
    <section class="card chart arranging" aria-busy="true">
      <p class="muted">{$t("eco.arranging")}</p>
    </section>
  {:else if spatial && space && space.links.length}
    <section class="card chart">
      {#key view}
        <FlowSpace
          {space}
          {capitals}
          {streams}
          {highlight}
          format={$pctOf}
          selectedId={chosen?.id ?? null}
          onSelect={(node) => (picked = node)}
          label={view === "network"
            ? $t("eco.networkSummary", { name: root.label })
            : $t("eco.spaceSummary", { name: root.label })}
        />
      {/key}
    </section>
    {#if chosen}
      <section class="card picked" aria-live="polite">
        <div class="who">
          <KindChip kind={chosen.kind} />
          <h2>{chosen.label}</h2>
          {#if about}
            <p class="about">{about}</p>
          {/if}
          <p class="muted">
            {#if chosen.reached}
              <b>{$pctOf(chosen.share)}</b> · {$t("sheet.ofPot")}
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
      {#if linked.length}
        <section class="card linked">
          <h3 class="muted">{$t("space.linked")}</h3>
          <ul>
            {#each linked.slice(0, LINKED_CHIPS) as n (n.id)}
              <li>
                <button
                  type="button"
                  aria-label={$t("sheet.openNamed", { name: n.label })}
                  on:click={() => (picked = n)}
                >
                  <KindChip kind={n.kind} />
                  <span class="name">{n.label}</span>
                  {#if n.reached}<span class="share">{$pctOf(n.share)}</span
                    >{/if}
                </button>
              </li>
            {/each}
          </ul>
          {#if linked.length > LINKED_CHIPS}
            <p class="muted more">
              {$t("space.linkedMore", { n: linked.length - LINKED_CHIPS })}
            </p>
          {/if}
        </section>
      {/if}
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
      {#if view === "network"}{$t("eco.networkHint")}{/if}
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
    <a class="all" href={searchHref("", "pots")}>{$t("common.seeAll")}</a>
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
    max-width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    gap: 2px;
    padding: 3px;
    margin-bottom: 10px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  @media (max-width: 360px) {
    .switch a {
      padding: 0 10px;
    }
  }
  .switch a {
    flex-shrink: 0;
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
  .falls {
    padding: 14px 8px 6px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: var(--tap);
    font-weight: 700;
    text-decoration: none;
  }
  .arranging {
    min-height: 320px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .find {
    position: relative;
    margin-bottom: 10px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    padding: 0 6px 0 14px;
    border-radius: 999px;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--ink-soft);
  }
  .field:focus-within {
    border-color: var(--teal);
    box-shadow: 0 0 0 3px var(--teal-wash);
  }
  .field input {
    flex: 1 1 auto;
    min-width: 0;
    height: 44px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    outline: none;
  }
  .field input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    color: var(--ink-soft);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }
  .found {
    margin: 6px 4px 0;
    font-size: 0.82rem;
  }
  .suggest {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--tap) + 4px);
    z-index: 5;
    list-style: none;
    margin: 0;
    padding: 4px;
    border-radius: 16px;
    background: var(--card);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-soft);
  }
  .suggest button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--tap);
    padding: 0 10px;
    border-radius: 12px;
    text-align: start;
    color: var(--ink);
  }
  .suggest li.active button {
    background: var(--teal-wash);
  }
  .suggest .name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .suggest .share {
    flex: 0 0 auto;
    font-size: 0.82rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
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
  .who .about {
    margin: 4px 0 6px;
    color: var(--ink-soft);
    line-height: 1.4;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .linked {
    margin-top: 10px;
  }
  .linked h3 {
    margin: 0 0 8px;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .linked ul {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0;
    padding: 0;
  }
  .linked button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 40px;
    padding: 0 12px 0 8px;
    border-radius: 999px;
    background: var(--paper-deep);
    border: 1px solid var(--line);
    color: var(--ink);
    font-size: 0.85rem;
    font-weight: 600;
    text-align: start;
  }
  .linked button:hover,
  .linked button:focus-visible {
    border-color: var(--teal);
    background: var(--teal-wash);
  }
  .linked .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .linked .share {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .linked .more {
    margin: 8px 2px 0;
    font-size: 0.82rem;
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
