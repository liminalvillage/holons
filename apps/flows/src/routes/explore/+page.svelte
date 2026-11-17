<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Explore: one way down through everything, the same at every level.
  //
  //   Pot → funds → ventures → people → who they pass it on to → …
  //
  // A project and a quest are both a VENTURE (core's `buildFractal`): what it
  // needs going in, what it yields coming out, the people standing in it by
  // role, and its bandwidth — the share of the Pot reaching it, drawn wider
  // as resources are committed to what it needs. Shown, not paid.
  //
  // The scene (`ExploreSpace`) is one level at a time; a tap goes in, the
  // trail on top goes back. `?at=<id>` is where you are, so a level is a link
  // and the browser's back goes up. The card under the scene says the same
  // as the scene, in words, and is what a keyboard walks.
  //
  // Quests come from the boards of the funds on the way down and of the funds
  // I follow; a board once watched stays watched for the visit.
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy } from "svelte";
  import {
    buildFractal,
    fractalPath,
    fractalWay,
    type FractalNode,
  } from "@holons/core/flows";
  import ExploreSpace from "$lib/components/ExploreSpace.svelte";
  import FractalDetail from "$lib/components/FractalDetail.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { currentUser } from "$lib/auth";
  import { index } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { defaultQuestFunds, readQuestFunds } from "$lib/questDeck";
  import { questsSettled, watchBoards } from "$lib/quests";
  import { hrefFor, withParam } from "$lib/urls";

  $: viewer = $currentUser ? String($currentUser.id) : null;

  $: fractal = $index ? buildFractal($index, $questsSettled) : null;

  // ── Where I am ──
  $: at = $page.url.searchParams.get("at") ?? "";
  let trail: string[] = [];
  $: if (fractal) trail = follow(trail, at || fractal.root);
  function follow(was: string[], id: string): string[] {
    const f = fractal!;
    if (!f.byId.has(id)) return [f.root];
    if (was.at(-1) === id) return was;
    const back = was.indexOf(id);
    if (back >= 0) return was.slice(0, back + 1);
    // Under where I am, a few levels down too: the trail grows down to it.
    const way = was.length ? fractalWay(f, was.at(-1)!, id) : null;
    if (way) return [...was, ...way.slice(1)];
    return fractalPath(f, id);
  }
  $: focus = fractal
    ? (fractal.byId.get(trail.at(-1) ?? "") ??
      fractal.byId.get(fractal.root) ??
      null)
    : null;
  $: parent =
    fractal && trail.length > 1
      ? (fractal.byId.get(trail[trail.length - 2]) ?? null)
      : null;

  function go(id: string) {
    if (!fractal) return;
    void goto(withParam($page.url, "at", id === fractal.root ? null : id), {
      noScroll: true,
      keepFocus: true,
    });
  }

  // ── Which boards to read ──
  let watched = new Set<string>();
  let stop: (() => void) | null = null;
  $: wanted = $index
    ? [
        ...(readQuestFunds(viewer) ??
          defaultQuestFunds($index, viewer ? [viewer] : [])),
        ...trail.filter((id) => $index!.byId.get(id)?.kind === "fund"),
        ...(focus?.kind === "venture" && focus.origin === "project"
          ? (fractal?.byId.get(focus.id)?.parents ?? []).filter(
              (id) => $index!.byId.get(id)?.kind === "fund",
            )
          : []),
      ]
    : [];
  $: if (wanted.some((id) => !watched.has(id))) {
    watched = new Set([...watched, ...wanted]);
    stop?.();
    stop = watchBoards([...watched]);
  }
  onDestroy(() => stop?.());

  $: kids = focus
    ? focus.children
        .map((id) => fractal!.byId.get(id))
        .filter((c): c is FractalNode => !!c)
    : [];
  $: pageHref =
    focus && $index?.byId.has(focus.id)
      ? hrefFor($index.byId.get(focus.id)!)
      : null;
  const labelOfId = (id: string) => fractal?.byId.get(id)?.label ?? id;
</script>

<svelte:head><title>{$t("nav.explore")} · Flows</title></svelte:head>

<SnapshotStatus />

<p class="lede">{$t("explore.lede")}</p>

{#if !fractal || !focus}
  <p class="muted">{$t("explore.loading")}</p>
{:else}
  <nav class="trail" aria-label={$t("explore.trail")}>
    {#each trail as id, i (id)}
      {#if i}<Icon name="chevron-right" />{/if}
      {#if i === trail.length - 1}
        <b aria-current="page">{labelOfId(id)}</b>
      {:else}
        <button on:click={() => go(id)}>{labelOfId(id)}</button>
      {/if}
    {/each}
  </nav>

  <ExploreSpace
    {focus}
    byId={fractal.byId}
    {parent}
    onPick={go}
    label={$t("explore.label", { name: focus.label, n: kids.length })}
  />

  <ul class="legend">
    <li><i class="ball"></i>{$t("explore.legend.size")}</li>
    <li><i class="drop money"></i>{$t("explore.legend.money")}</li>
    <li><i class="drop gold"></i>{$t("explore.legend.gold")}</li>
  </ul>

  <article class="card">
    <FractalDetail {fractal} {focus} onPick={go}>
      <svelte:fragment slot="links">
        {#if pageHref}<a class="ghost" href={pageHref}
            >{$t("explore.act.page")}</a
          >{/if}
        <a class="ghost" href="/quests"
          ><Icon name="flag" /> {$t("explore.act.deck")}</a
        >
        <a class="ghost" href="/eco"
          ><Icon name="flow" /> {$t("explore.act.flow")}</a
        >
      </svelte:fragment>
    </FractalDetail>
  </article>
{/if}

<style>
  .lede {
    margin: 0 0 10px;
    color: var(--ink-soft);
    font-size: 0.95rem;
  }
  .muted {
    color: var(--muted);
  }
  .trail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 4px;
    margin: 0 0 10px;
    font-size: 0.88rem;
    color: var(--muted);
  }
  .trail button {
    color: var(--teal-ink);
    font-weight: 700;
    padding: 6px 2px;
    max-width: 40vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail b {
    color: var(--ink);
  }
  .legend {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 10px 0 14px;
    padding: 0;
    font-size: 0.8rem;
    color: var(--muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ball {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 35%, #fff, var(--kind-project));
  }
  .drop {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .drop.money {
    background: var(--cap-financial);
  }
  .drop.gold {
    background: #e0a92e;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 16px;
    box-shadow: var(--shadow-soft);
  }
</style>
