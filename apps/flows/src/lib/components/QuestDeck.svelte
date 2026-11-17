<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One quest at a time: swipe right for yes, left to skip, or use the two
  // buttons or the arrow keys. A card carries only what a first look needs
  // — the title, a line, who proposes it and how close it is to happening.
  // The rest waits for a yes. A tap opens it without deciding.
  import type { BoardQuest } from "@holons/core/tasks";
  import { createEventDispatcher } from "svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n";
  import { partyName } from "$lib/quests";
  import {
    badgeOpacity,
    cardTransform,
    swipeDecision,
    type QuestSwipe,
  } from "$lib/questDeck";

  /** Ranked, best first; the first is the top card. */
  export let quests: BoardQuest[];
  /** A board's name as people read it (a fund's label). */
  export let boardLabel: (id: string) => string = (id) => id;

  const dispatch = createEventDispatcher<{
    decide: { id: string; swipe: QuestSwipe };
    open: { id: string };
  }>();

  $: stack = quests.slice(0, 3);
  $: top = stack[0] ?? null;

  let deckW = 0;
  $: threshold = Math.min(110, (deckW || 320) * 0.35);

  let dragging = false;
  let dx = 0;
  let dy = 0;
  let startX = 0;
  let startY = 0;
  let tappedId: string | null = null;
  let leaving: { id: string; swipe: QuestSwipe; from: string } | null = null;

  $: badges = badgeOpacity(dx, threshold);

  function down(e: PointerEvent) {
    if (leaving || !top || (e.button != null && e.button !== 0)) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dy = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = (e.clientY - startY) * 0.4;
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    const tap = Math.hypot(dx, dy) < 6;
    const swipe = swipeDecision(dx, threshold);
    tappedId = null;
    if (swipe) commit(swipe);
    else {
      if (tap && top) tappedId = top.id;
      dx = 0;
      dy = 0;
    }
  }
  function cancel() {
    dragging = false;
    tappedId = null;
    dx = 0;
    dy = 0;
  }
  // Open on the click, not on pointerup: the sheet must not appear under
  // the finger before the same tap lands (as the kiosk deck learned).
  function click() {
    const id = tappedId;
    tappedId = null;
    if (id) dispatch("open", { id });
  }
  function key(e: KeyboardEvent) {
    if (!top || leaving) return;
    if (e.key === "ArrowRight") commit("yes");
    else if (e.key === "ArrowLeft") commit("no");
    else if (e.key === "Enter" || e.key === " ")
      dispatch("open", { id: top.id });
    else return;
    e.preventDefault();
  }

  function commit(swipe: QuestSwipe) {
    if (!top || leaving) return;
    leaving = { id: top.id, swipe, from: cardTransform(dx, dy) };
    const id = top.id;
    setTimeout(() => {
      leaving = null;
      dx = 0;
      dy = 0;
      dispatch("decide", { id, swipe });
    }, 320);
  }

  const covered = (q: BoardQuest) => Math.round(q.coverage * 100);
</script>

<div class="deck-wrap">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
  <div
    class="deck"
    bind:clientWidth={deckW}
    tabindex="0"
    role="group"
    aria-label={$t("quests.deckLabel")}
    on:keydown={key}
  >
    {#each [...stack].reverse() as q, i (q.id)}
      {@const depth = stack.length - 1 - i}
      {@const isTop = depth === 0}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <article
        class="card"
        class:top={isTop}
        class:dragging={isTop && dragging}
        class:fly-yes={leaving?.id === q.id && leaving.swipe === "yes"}
        class:fly-no={leaving?.id === q.id && leaving.swipe === "no"}
        style:--depth={depth}
        style:--from={leaving?.id === q.id ? leaving.from : undefined}
        style:transform={isTop && !leaving ? cardTransform(dx, dy) : undefined}
        aria-hidden={!isTop}
        on:pointerdown={isTop ? down : undefined}
        on:pointermove={isTop ? move : undefined}
        on:pointerup={isTop ? up : undefined}
        on:pointercancel={isTop ? cancel : undefined}
        on:click={isTop ? click : undefined}
      >
        {#if isTop}
          <span class="stamp yes" style:opacity={badges.yes}
            >{$t("quests.badgeYes")}</span
          >
          <span class="stamp no" style:opacity={badges.no}
            >{$t("quests.badgeNo")}</span
          >
        {/if}
        <p class="by">
          {#if q.board}<span class="fund">{boardLabel(q.board)}</span>{/if}
          {$t("quests.by", { name: partyName(q, q.proposer) })}
        </p>
        <h2>{q.title}</h2>
        {#if q.description}<p class="line">{q.description}</p>{/if}
        <div class="close">
          <div class="bar" aria-hidden="true">
            <i style:width="{covered(q)}%"></i>
          </div>
          <p class="muted">
            {$t("quests.closeness", { pct: `${covered(q)}%` })} ·
            {$t("quests.inCount", { n: q.participants.length })} ·
            {$t("quests.until", {
              date: new Date(q.until).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              }),
            })}
          </p>
        </div>
      </article>
    {/each}
  </div>

  <div class="buttons">
    <button
      class="round no"
      on:click={() => commit("no")}
      disabled={!top || !!leaving}
      aria-label={$t("quests.no")}><Icon name="close" /></button
    >
    <button
      class="round yes"
      on:click={() => commit("yes")}
      disabled={!top || !!leaving}
      aria-label={$t("quests.yes")}><Icon name="check" /></button
    >
  </div>
</div>

<style>
  .deck-wrap {
    display: grid;
    gap: 16px;
  }
  .deck {
    position: relative;
    height: min(56dvh, 420px);
    outline: none;
  }
  .deck:focus-visible {
    outline: 2px solid var(--teal);
    outline-offset: 4px;
    border-radius: 22px;
  }
  .card {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 10px;
    padding: 22px 20px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 22px;
    box-shadow: var(--shadow-soft);
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    transform: translateY(calc(var(--depth) * 10px))
      scale(calc(1 - var(--depth) * 0.04));
    transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  .card.top {
    cursor: grab;
    touch-action: none;
    box-shadow: var(--shadow-sheet);
  }
  .card.top.dragging {
    cursor: grabbing;
    transition: none;
  }
  .fund {
    display: block;
    margin-bottom: 4px;
    color: var(--teal-ink);
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.9rem;
  }
  .by {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  h2 {
    font-size: 1.6rem;
    line-height: 1.15;
  }
  .line {
    color: var(--ink-soft);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .close {
    display: grid;
    gap: 6px;
    margin-top: 6px;
  }
  .bar {
    height: 8px;
    border-radius: 999px;
    background: var(--teal-wash);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--teal);
    border-radius: 999px;
  }
  .stamp {
    position: absolute;
    top: 22px;
    padding: 4px 12px;
    border: 3px solid;
    border-radius: 10px;
    font-weight: 900;
    letter-spacing: 0.08em;
    pointer-events: none;
  }
  .stamp.yes {
    left: 20px;
    color: var(--teal-ink);
    transform: rotate(-12deg);
  }
  .stamp.no {
    right: 20px;
    color: var(--muted);
    transform: rotate(12deg);
  }
  .buttons {
    display: flex;
    justify-content: center;
    gap: 28px;
  }
  .round {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 1.5px solid var(--line);
    background: var(--card);
    font-size: 1.6rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--shadow-soft);
    color: var(--ink-soft);
    cursor: pointer;
  }
  .round.yes {
    background: var(--teal);
    border-color: var(--teal);
    color: var(--on-teal);
  }
  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .fly-yes {
    animation: fly-yes 0.32s cubic-bezier(0.3, 0.6, 0.6, 1) forwards;
  }
  .fly-no {
    animation: fly-no 0.32s cubic-bezier(0.3, 0.6, 0.6, 1) forwards;
  }
  @keyframes fly-yes {
    from {
      transform: var(--from);
      opacity: 1;
    }
    to {
      transform: translate(120vw, -6vh) rotate(24deg);
      opacity: 0;
    }
  }
  @keyframes fly-no {
    from {
      transform: var(--from);
      opacity: 1;
    }
    to {
      transform: translate(-120vw, -6vh) rotate(-24deg);
      opacity: 0;
    }
  }
</style>
