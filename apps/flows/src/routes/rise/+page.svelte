<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The most resourced rise. Projects ranked by what reached them that is
  // not money — counted gifts their stewards said arrived — each as a row of
  // coloured blocks, one per gift, the top two starred. Beside each: the
  // share of the Pot that reaches it now, because the game's public rule is
  // that the resource base sets financial bandwidth: a fund that turns it
  // on sends part of what it gives by resource base (`resourced`).
  //
  // The ranking is core's (`rankByResources`); it reads the published map.
  import { rankByResources, type FlowPartyKind } from "@holons/core/flows";
  import { page } from "$app/stores";
  import CapitalBlocks from "$lib/components/CapitalBlocks.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import SnapshotBadge from "$lib/components/SnapshotBadge.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { pct } from "$lib/format";
  import { index } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";
  import { hrefFor, withParam } from "$lib/urls";

  const KINDS: { kind: FlowPartyKind | "all"; label: MessageKey }[] = [
    { kind: "project", label: "eco.projects" },
    { kind: "fund", label: "eco.funds" },
    { kind: "person", label: "eco.people" },
  ];
  const LIMIT = 50;

  $: asked = $page.url.searchParams.get("kind");
  $: kind = (KINDS.some((k) => k.kind === asked) ? asked : "project") as
    | FlowPartyKind
    | "all";
  $: ranked = $index
    ? rankByResources($index.graph.nodes.filter((n) => n.kind === kind))
    : [];
  $: shown = ranked.slice(0, LIMIT);
</script>

<svelte:head><title>{$t("rise.title")} · Flows</title></svelte:head>

<SnapshotStatus />

<header class="head">
  <h1>{$t("rise.title")}</h1>
  <p class="muted">{$t("rise.lead")}</p>
</header>

<section class="card rule">
  <p class="eyebrow">{$t("rise.ruleTitle")}</p>
  <p class="formula">
    <span>{$t("rise.ruleBase")}</span>
    <Icon name="chevron-right" />
    <span>{$t("rise.ruleBandwidth")}</span>
  </p>
  <p class="muted">{$t("rise.ruleBody")}</p>
</section>

<div class="switch" role="group" aria-label={$t("rise.kindLabel")}>
  {#each KINDS as k (k.kind)}
    <a
      href={withParam($page.url, "kind", k.kind === "project" ? null : k.kind)}
      class:on={kind === k.kind}
      aria-current={kind === k.kind ? "true" : undefined}
      data-sveltekit-replacestate
      data-sveltekit-noscroll>{$t(k.label)}</a
    >
  {/each}
</div>

{#if $index}
  {#if shown.length}
    <ol class="board">
      {#each shown as r (r.id)}
        {@const n = $index.byId.get(r.id)}
        <li class:top={r.star}>
          <span class="rank">
            {#if r.star}<span class="star" aria-label={$t("rise.star")}
                ><Icon name="star" /></span
              >{/if}{r.rank}
          </span>
          <a class="who" href={n ? hrefFor(n) : undefined}>
            <b>{r.label}</b>
            <CapitalBlocks byCapital={r.byCapital} max={30} />
          </a>
          <span class="nums">
            <b>{r.count}</b>
            <i>{n && n.share > 0 ? pct(n.share) : "—"}</i>
          </span>
        </li>
      {/each}
    </ol>
    <p class="muted key">{$t("rise.key")}</p>
  {:else}
    <div class="card empty">
      <Icon name="sprout" />
      <p class="muted">{$t("rise.empty")}</p>
    </div>
  {/if}
  <p class="foot"><SnapshotBadge /></p>
{/if}

<style>
  .head h1 {
    font-size: 1.5rem;
  }
  .head {
    display: grid;
    gap: 6px;
    margin-bottom: 14px;
  }
  .rule {
    display: grid;
    gap: 6px;
    padding: 14px 16px;
    margin-bottom: 14px;
  }
  .eyebrow {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .formula {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 1.05rem;
    font-weight: 800;
  }
  .formula span {
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    margin-bottom: 12px;
    border-radius: 999px;
    background: var(--paper-deep);
  }
  .switch a {
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--ink-soft);
  }
  .switch a.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }
  .board {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .board li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
  }
  .board li + li {
    border-top: 1px solid var(--line);
  }
  .board li.top {
    background: color-mix(in srgb, var(--cap-spiritual) 9%, var(--card));
  }
  .rank {
    flex: 0 0 2.6rem;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }
  .star {
    display: inline-flex;
    color: var(--cap-spiritual);
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-decoration: none;
    color: inherit;
  }
  .who b {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nums {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .nums b {
    font-size: 1.15rem;
    font-variant-numeric: tabular-nums;
  }
  .nums i {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--muted);
  }
  .key {
    font-size: 0.82rem;
    margin-top: 8px;
  }
  .empty {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.4rem;
    color: var(--cap-living);
  }
  .empty p {
    font-size: 0.95rem;
  }
  .foot {
    margin-top: 18px;
  }
</style>
