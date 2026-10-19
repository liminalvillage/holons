<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One party of the map: who its income comes through, drawn on the left of
  // it, and who it passes that income on to, on the right — then the same as
  // lists. A person, a project, a fund and the Pot are all drawn this way, so
  // following a flow from one to the next never changes the picture, only
  // who is in the middle of it.
  //
  // Everything shown is read off the snapshot through core's selectors. A
  // holon's own split is then read afresh (`refine`) and the diagram redrawn
  // from it, with a line saying so when the snapshot had drifted.
  import {
    centredTrack,
    membershipsOf,
    partyNodeId,
    upstreamShares,
    type FlowGraphIndex,
    type FlowViewLabels,
  } from "@holons/core/flows";
  import { page } from "$app/stores";
  import FlowChart from "./FlowChart.svelte";
  import FlowList from "./FlowList.svelte";
  import KindChip from "./KindChip.svelte";
  import UnitSwitch from "./UnitSwitch.svelte";
  import { NARROW_PX } from "$lib/config";
  import { pct, valueText } from "$lib/format";
  import { refine, refined } from "$lib/graph";
  import { locale, t } from "$lib/i18n";
  import { potLive } from "$lib/live";
  import { hrefFor, withParam } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  /** Rows of a list before "Show more". */
  const LIST_LIMIT = 20;

  export let index: FlowGraphIndex;
  export let id: string;
  /** The reader's own page: the wording turns to "you". */
  export let own = false;
  /** Under an account screen: no heading of its own, the lists before the diagram. */
  export let bare = false;

  let innerWidth = 390;
  $: narrow = innerWidth < NARROW_PX;

  $: node = index.byId.get(id)!;
  $: params = $page.url.searchParams;
  $: asked = Number(params.get("up"));
  $: up = asked === 1 || asked === 2 ? asked : narrow ? 1 : 2;
  $: unit = $potLive.units.includes(params.get("unit") ?? "")
    ? (params.get("unit") as string)
    : "";
  $: reaching =
    unit && node.share > 0
      ? (node.share / 100) * ($potLive.totals[unit] ?? 0)
      : 0;

  $: labels = {
    kept: own ? $t("view.keptOwn") : $t("view.kept"),
    otherFunds: $t("view.otherFunds"),
    otherProjects: $t("view.otherProjects"),
    direct: $t("view.direct"),
  } satisfies FlowViewLabels;

  $: track = centredTrack(index, id, {
    up,
    labels,
    ...(reaching > 0 ? { amount: { unit, total: reaching } } : {}),
  });
  $: text = (value: number) => valueText(value, track.unit, $locale);
  /** A percent of what reaches the party, as the unit on screen. */
  $: ofReaching = (percent: number) =>
    reaching > 0 ? text((percent / 100) * reaching) : pct(percent);

  $: seaters = membershipsOf(index, id);
  $: direct = new Set(seaters.map((r) => r.id));
  $: sources = seaters.map(
    (r): FlowListRow => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      value: ofReaching(r.share),
      note:
        r.local != null ? $t("party.seat", { pct: pct(r.local) }) : undefined,
    }),
  );
  $: through = upstreamShares(index, id)
    .filter((r) => !direct.has(r.id))
    .map(
      (r): FlowListRow => ({
        id: r.id,
        label: r.label,
        kind: r.kind,
        value: ofReaching(r.share),
      }),
    );
  $: recipients = [...(index.out.get(id) ?? [])]
    .filter((l) => l.local > 0)
    .sort((a, b) => b.local - a.local)
    .map((l): FlowListRow => {
      const p = index.byId.get(l.target);
      return {
        id: l.target,
        label: p?.label ?? l.target,
        kind: p?.kind ?? "other",
        value: ofReaching(l.local),
      };
    });
  $: keeps = node.share > 0 ? (node.rest / node.share) * 100 : 0;

  $: hrefOf = (row: FlowListRow) => {
    const p = index.byId.get(row.id);
    return p ? hrefFor(p, params) : null;
  };

  // A holon's split is read afresh once it is on screen.
  $: if (node && node.kind !== "person" && node.kind !== "placeholder")
    void refine(id);
  $: drift = $refined[id]?.drift ?? [];

  $: summary = $t("view.summary", {
    name: node.label,
    sources: sources.length,
    recipients: recipients.length,
  });
</script>

<svelte:window bind:innerWidth />

{#if !bare}
  <header class="head">
    <h1>{node.label}</h1>
    <p class="meta">
      <KindChip kind={node.kind} />
      {#if node.kind !== "pot"}
        <span class="share">
          {node.share > 0
            ? $t("party.ofPot", { pct: pct(node.share) })
            : $t("party.unseated")}
        </span>
      {/if}
    </p>
  </header>
{/if}

{#if node.kind === "placeholder"}
  <p class="notice warn">{$t("party.placeholder")}</p>
{/if}
{#if node.unclaimedUntil}
  <p class="notice warn">
    {$t("party.unclaimed", {
      date: new Date(node.unclaimedUntil).toLocaleDateString($locale),
    })}
  </p>
{/if}
{#if drift.length}
  <p class="notice">
    {$t("party.drift", {
      date: new Date(index.graph.at).toLocaleDateString($locale),
    })}
  </p>
{/if}

{#if bare}
  {#if sources.length}
    <h2 class="section-title">
      {own ? $t("party.sourcesOwn") : $t("party.sources")}
    </h2>
    <FlowList rows={sources} {hrefOf} limit={LIST_LIMIT} />
  {/if}
  <slot name="after-sources" />

  {#if through.length}
    <h2 class="section-title">{$t("party.through")}</h2>
    <FlowList rows={through} {hrefOf} />
  {/if}

  {#if recipients.length}
    <h2 class="section-title">
      {own ? $t("party.recipientsOwn") : $t("party.recipients")}
    </h2>
    <FlowList rows={recipients} {hrefOf} limit={LIST_LIMIT} />
    {#if keeps > 0.005}
      <p class="muted keeps">
        {own
          ? $t("party.keepsOwn", { pct: pct(keeps) })
          : $t("party.keeps", { pct: pct(keeps) })}
      </p>
    {/if}
  {/if}
  <slot name="after-recipients" />

  <h2 class="section-title">{$t("account.seeFlow")}</h2>
  <div class="controls">
    <UnitSwitch
      units={node.share > 0 ? $potLive.units : []}
      value={unit}
      hrefOf={(u) => withParam($page.url, "unit", u || null)}
    />
    {#if through.length}
      <a
        class="chip"
        href={withParam($page.url, "up", up === 2 ? "1" : "2")}
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        >{up === 2 ? $t("view.hideOrigins") : $t("view.showOrigins")}</a
      >
    {/if}
  </div>

  <section class="card chart">
    <FlowChart
      {track}
      {index}
      focusId={id}
      focusNodeId={partyNodeId(id)}
      topN={narrow ? 6 : 8}
      label={summary}
      {params}
    >
      <p slot="empty" class="muted empty">{$t("party.nothing")}</p>
    </FlowChart>
  </section>
{:else}
  <div class="controls">
    <UnitSwitch
      units={node.share > 0 ? $potLive.units : []}
      value={unit}
      hrefOf={(u) => withParam($page.url, "unit", u || null)}
    />
    {#if through.length}
      <a
        class="chip"
        href={withParam($page.url, "up", up === 2 ? "1" : "2")}
        data-sveltekit-replacestate
        data-sveltekit-noscroll
        >{up === 2 ? $t("view.hideOrigins") : $t("view.showOrigins")}</a
      >
    {/if}
  </div>

  <section class="card chart">
    <FlowChart
      {track}
      {index}
      focusId={id}
      focusNodeId={partyNodeId(id)}
      topN={narrow ? 6 : 8}
      label={summary}
      {params}
    >
      <p slot="empty" class="muted empty">{$t("party.nothing")}</p>
    </FlowChart>
  </section>

  {#if sources.length}
    <h2 class="section-title">
      {own ? $t("party.sourcesOwn") : $t("party.sources")}
    </h2>
    <FlowList rows={sources} {hrefOf} limit={LIST_LIMIT} />
  {/if}

  {#if through.length}
    <h2 class="section-title">{$t("party.through")}</h2>
    <FlowList rows={through} {hrefOf} />
  {/if}

  {#if recipients.length}
    <h2 class="section-title">
      {own ? $t("party.recipientsOwn") : $t("party.recipients")}
    </h2>
    <FlowList rows={recipients} {hrefOf} limit={LIST_LIMIT} />
    {#if keeps > 0.005}
      <p class="muted keeps">
        {own
          ? $t("party.keepsOwn", { pct: pct(keeps) })
          : $t("party.keeps", { pct: pct(keeps) })}
      </p>
    {/if}
  {/if}
{/if}

<style>
  .head h1 {
    font-size: 1.5rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
  }
  .share {
    font-size: 0.9rem;
    color: var(--ink-soft);
    font-weight: 600;
  }
  .notice {
    margin-top: 12px;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 14px 0 10px;
  }
  .chip {
    min-height: 40px;
    padding: 0 14px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--teal-ink);
  }
  .chart {
    padding: 10px 6px;
    overflow: hidden;
  }
  .empty {
    padding: 28px 12px;
    text-align: center;
  }
  .keeps {
    margin-top: 8px;
    font-size: 0.9rem;
  }
</style>
