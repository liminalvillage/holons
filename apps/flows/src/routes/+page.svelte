<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The front door is the navigator: the Pot as a glowing orb, what it pays
  // hanging below it, and a tap on any orb goes IN — the next level unfolds
  // out of it — down through funds, ventures, people and who they pass it
  // on to (core's `buildFractal`, drawn by `ExploreSpace`). The trail on top
  // goes back up, and so does the browser's Back: `?at=<id>` is where you are.
  //
  // The orb in focus wears a dialog (`FlowPopup`) and everything happens in
  // it, over the scene: a tap on the orb in focus opens it out to the full
  // reading (needs, yields, who is under it); its split is set with sliders
  // right there while the scene redraws the draft; an amount typed in shows
  // where it would trickle, on every orb. Closing it is always back here.
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { onDestroy, onMount } from "svelte";
  import {
    buildFractal,
    fractalPath,
    fractalWay,
    trickleAmount,
  } from "@holons/core/flows";
  import ExploreSpace from "$lib/components/ExploreSpace.svelte";
  import FlowPopup from "$lib/components/FlowPopup.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import StartSheet from "$lib/components/StartSheet.svelte";
  import { currentUser } from "$lib/auth";
  import { index, snapshot } from "$lib/graph";
  import { t } from "$lib/i18n";
  import { defaultQuestFunds, readQuestFunds } from "$lib/questDeck";
  import { questsSettled, watchBoards } from "$lib/quests";
  import { withParam } from "$lib/urls";

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

  // Quests on the way down are ventures too: read the boards they live on.
  let watched = new Set<string>();
  let stop: (() => void) | null = null;
  $: wanted = $index
    ? [
        ...(readQuestFunds(viewer) ??
          defaultQuestFunds($index, viewer ? [viewer] : [])),
        ...trail.filter((id) => $index!.byId.get(id)?.kind === "fund"),
      ]
    : [];
  $: if (wanted.some((id) => !watched.has(id))) {
    watched = new Set([...watched, ...wanted]);
    stop?.();
    stop = watchBoards([...watched]);
  }
  onDestroy(() => stop?.());

  const labelOfId = (id: string) => fractal?.byId.get(id)?.label ?? id;

  // ── The dialog, and what it draws on the scene ──
  let mode: "card" | "more" | "split" = "card";
  type Draft = {
    shares: Map<string, number>;
    names: Map<string, string>;
    widest: number;
  };
  let draft: Draft | null = null;
  let popH = 0;
  let innerWidth = 0;
  // Beside the scene on a wide screen, over its lower part on a phone.
  $: wide = innerWidth >= 900;
  let funding: { from: string; amount: number } | null = null;
  $: amounts =
    funding && $index
      ? trickleAmount($index, funding.amount, { from: funding.from })
      : null;
  /** Each party the focus pays, as a percent of its own split: the pipes. */
  $: splitOf = (id: string) =>
    new Map(($index?.out.get(id) ?? []).map((l) => [l.target, l.local]));
  function onFocus() {
    mode = mode === "more" ? "card" : "more";
  }
  /** On the scene, a tap away from an opened dialog first folds it. */
  function pick(id: string) {
    if (mode !== "card" && focus && id === parent?.id) {
      mode = "card";
      return;
    }
    go(id);
  }
  // ── A first look, signed out ──
  // The scene says nothing about what this is or how to get in: a stranger
  // at the top level gets one card with the way in, until they wave it off.
  const WELCOMED = "flows_welcomed";
  let welcomed = true;
  onMount(() => {
    try {
      welcomed = localStorage.getItem(WELCOMED) === "1";
    } catch {
      welcomed = false;
    }
  });
  function dismissWelcome() {
    welcomed = true;
    try {
      localStorage.setItem(WELCOMED, "1");
    } catch {
      /* private window: shown again next visit */
    }
  }
  $: welcome = !welcomed && !$currentUser && !at;
  /** Someone sent here by an invite starts their own fund or project from the door. */
  let starting = false;

  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || mode === "card") return;
    if (document.querySelector("dialog[open]")) return;
    mode = "card";
  }
</script>

<svelte:head><title>Flows</title></svelte:head>

<svelte:window on:keydown={onKey} bind:innerWidth />

<div class="home">
  {#if fractal && focus}
    <ExploreSpace
      full
      {focus}
      byId={fractal.byId}
      {parent}
      onPick={pick}
      {onFocus}
      draft={mode === "split" ? draft : null}
      {amounts}
      links={splitOf(focus.id)}
      cover={wide ? 0 : popH + 24}
      label={$t("explore.label", {
        name: focus.label,
        n: focus.children.length,
      })}
    />

    {#if trail.length > 1}
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
    {/if}

    {#if welcome}
      <aside class="welcome" aria-labelledby="welcome-title">
        <h1 id="welcome-title">{$t("landing.title")}</h1>
        <p>{$t("landing.lead")}</p>
        <div class="ways">
          <button class="btn" on:click={() => (starting = true)}
            ><Icon name="plus" />{$t("start.title")}</button
          >
          <a class="btn quiet" href="/me">{$t("login.title")}</a>
          <a class="btn quiet" href="/story"
            ><Icon name="sprout" />{$t("landing.story")}</a
          >
          <button class="btn quiet" on:click={dismissWelcome}
            >{$t("landing.lookAround")}</button
          >
        </div>
      </aside>
    {/if}

    {#if $index}
      <FlowPopup
        {fractal}
        index={$index}
        {focus}
        onPick={go}
        bind:mode
        {funding}
        onFund={(f) => (funding = f)}
        onDraft={(d) => (draft = d)}
        bind:height={popH}
      />
    {/if}
    {#if starting}
      <StartSheet
        on:close={() => (starting = false)}
        on:started={(e) => {
          starting = false;
          dismissWelcome();
          void goto(`/h/${encodeURIComponent(e.detail)}`);
        }}
      />
    {/if}
  {:else}
    <div class="wait">
      <SnapshotStatus />
      {#if $snapshot.status === "loading"}<p>{$t("stage.loading")}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .home {
    position: fixed;
    inset: 0;
    background: #05090b;
  }
  .home > :global(.stage) {
    position: absolute;
    inset: 0;
  }
  .trail {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 60px);
    left: 0;
    right: 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 2px 4px;
    padding: 0 var(--gutter);
    font-size: 0.84rem;
    color: rgba(230, 243, 241, 0.6);
    pointer-events: none;
  }
  .trail button,
  .trail b {
    pointer-events: auto;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trail button {
    min-height: 32px;
    padding: 0 6px;
    font-weight: 600;
    color: rgba(230, 243, 241, 0.75);
  }
  .trail b {
    color: #e6f3f1;
    padding: 0 6px;
  }
  .welcome {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 64px);
    left: var(--gutter);
    right: var(--gutter);
    max-width: 30rem;
    margin: 0 auto;
    display: grid;
    gap: 8px;
    padding: 16px;
    border-radius: var(--radius);
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    z-index: 2;
  }
  .welcome h1 {
    font-size: 1.25rem;
    line-height: 1.2;
    margin: 0;
  }
  .welcome p {
    margin: 0;
    font-size: 0.88rem;
    color: var(--ink-soft);
  }
  .welcome .ways {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 4px;
  }
  .wait {
    height: 100%;
    overflow-y: auto;
    display: grid;
    place-content: center;
    gap: 12px;
    padding: var(--gutter);
    text-align: center;
    color: #e6f3f1;
  }
</style>
