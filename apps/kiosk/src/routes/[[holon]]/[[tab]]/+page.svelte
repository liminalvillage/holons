<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { onDestroy } from "svelte";
  import { scale } from "svelte/transition";
  import { backOut } from "svelte/easing";
  import { activeTab, boardReady, holonId } from "$lib/stores";
  import {
    boardFullscreen,
    fullscreenMotion,
    setFullscreen,
  } from "$lib/fullscreen";
  import { t } from "$lib/i18n";
  import Icon from "$lib/components/Icon.svelte";
  import GlobalPills from "$lib/components/GlobalPills.svelte";
  import CalendarView from "$lib/views/CalendarView.svelte";
  import ShiftsView from "$lib/views/ShiftsView.svelte";
  import TasksView from "$lib/views/TasksView.svelte";
  import LibraryView from "$lib/views/LibraryView.svelte";
  import ChecklistsView from "$lib/views/ChecklistsView.svelte";
  import RolesView from "$lib/views/RolesView.svelte";
  import StatusView from "$lib/views/StatusView.svelte";
  import FlowsView from "$lib/views/FlowsView.svelte";
  import StockView from "$lib/views/StockView.svelte";
  import OffersView from "$lib/views/OffersView.svelte";

  // Full screen belongs to the board on screen: another holon (or leaving
  // the board) starts with the chrome back.
  let shownHolon = $holonId;
  $: if ($holonId !== shownHolon) {
    shownHolon = $holonId;
    setFullscreen(false);
  }
  onDestroy(() => setFullscreen(false));

  // Escape leaves full screen — unless a sheet or modal is open over the
  // board: that Escape is theirs.
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape" || !$boardFullscreen || e.defaultPrevented) return;
    if (document.querySelector('[aria-modal="true"]')) return;
    setFullscreen(false);
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="surface" class:full={$boardFullscreen}>
  <!-- Mount the view only once the holon's initial data has settled (see
       boardReady): a fresh mount on the full set plays the entrance animation
       cleanly, the same way switching tabs does. Keyed on the tab so each
       switch remounts and re-animates. -->
  {#if $boardReady}
    <!-- The pills band sits OUTSIDE the tab key: switching tabs swaps its
         segments in place instead of remounting/re-animating the bar. -->
    <div
      class="band"
      class:clip={$boardFullscreen || $fullscreenMotion}
      inert={$boardFullscreen}
    >
      <div class="band__in"><GlobalPills /></div>
    </div>
    {#key $activeTab}
      <div class="view">
        {#if $activeTab === "tasks"}
          <TasksView />
        {:else if $activeTab === "calendar"}
          <CalendarView />
        {:else if $activeTab === "shifts"}
          <ShiftsView />
        {:else if $activeTab === "library"}
          <LibraryView />
        {:else if $activeTab === "checklists"}
          <ChecklistsView />
        {:else if $activeTab === "roles"}
          <RolesView />
        {:else if $activeTab === "status"}
          <StatusView />
        {:else if $activeTab === "flows"}
          <FlowsView />
        {:else if $activeTab === "stock"}
          <StockView />
        {:else if $activeTab === "offers"}
          <OffersView />
        {/if}
      </div>
    {/key}
  {/if}
  <!-- The band's full-screen button, turned into the way back: it pops in
       at the corner once the chrome has folded away. -->
  {#if $boardFullscreen}
    <button
      type="button"
      class="unfull"
      on:click={() => setFullscreen(false)}
      aria-label={$t("pills.exitFullscreen")}
      title={$t("pills.exitFullscreen")}
      in:scale={{ start: 0.4, duration: 380, delay: 180, easing: backOut }}
      out:scale={{ start: 0.4, duration: 160 }}
    >
      <Icon name="close" />
    </button>
  {/if}
</div>

<style>
  .surface {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--card);
    /* The frame (`--frame`, set on .kiosk in the layout) is thin and, on a
       phone, all but gone: the board is the thing. */
    margin: 0 var(--frame) var(--frame);
    border-radius: 0 0 min(var(--radius), 1.2vw) min(var(--radius), 1.2vw);
    box-shadow: var(--shadow-soft);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* Full screen: the frame around the board goes, edge to edge. */
  .surface {
    transition:
      margin 0.45s cubic-bezier(0.2, 0.8, 0.2, 1),
      border-radius 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .surface.full {
    margin: 0;
    border-radius: 0;
  }
  /* The pills band folds up with the header (see the layout's .chrome). */
  .band {
    flex: 0 0 auto;
    display: grid;
    grid-template-rows: 1fr;
    transition:
      grid-template-rows 0.45s cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 0.3s ease;
  }
  .band__in {
    min-height: 0;
  }
  .band.clip .band__in {
    overflow: hidden;
  }
  .surface.full .band {
    grid-template-rows: 0fr;
    opacity: 0;
  }
  .unfull {
    position: absolute;
    top: 0.7rem;
    right: 0.7rem;
    z-index: 30;
    width: calc(2.5rem + 8px);
    height: calc(2.5rem + 8px);
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1.25rem;
    background: color-mix(in srgb, var(--paper) 88%, transparent);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    touch-action: manipulation;
    transition:
      background 0.2s ease,
      transform 0.25s ease;
  }
  .unfull :global(svg) {
    transition: transform 0.3s ease;
  }
  .unfull:hover :global(svg) {
    transform: rotate(90deg);
  }
  .unfull:active {
    transform: scale(0.9);
  }
  @media (prefers-reduced-motion: reduce) {
    .surface,
    .band {
      transition: none;
    }
  }
  .view {
    flex: 1;
    min-height: 0;
    /* Never let a view's min-content width push the surface wider than the
       screen — wide content must scroll inside the view instead. */
    min-width: 0;
    display: flex;
    flex-direction: column;
    animation: kiosk-fade 0.4s ease both;
  }
</style>
