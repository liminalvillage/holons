<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { activeTab, boardReady, idle } from "$lib/stores";
  import GlobalPills from "$lib/components/GlobalPills.svelte";
  import CalendarView from "$lib/views/CalendarView.svelte";
  import ShiftsView from "$lib/views/ShiftsView.svelte";
  import TasksView from "$lib/views/TasksView.svelte";
  import LibraryView from "$lib/views/LibraryView.svelte";
  import ChecklistsView from "$lib/views/ChecklistsView.svelte";
  import RolesView from "$lib/views/RolesView.svelte";
  import StatusView from "$lib/views/StatusView.svelte";
  import FlowsView from "$lib/views/FlowsView.svelte";
</script>

<!-- The surface follows the chrome: framed inside the card while someone is
     at the screen, edge to edge once the kiosk goes idle (the layout's card
     does the same one level out). -->
<div class="surface" class:idle={$idle}>
  <!-- Mount the view only once the holon's initial data has settled (see
       boardReady): a fresh mount on the full set plays the entrance animation
       cleanly, the same way switching tabs does. Keyed on the tab so each
       switch remounts and re-animates. -->
  {#if $boardReady}
    <!-- The pills band sits OUTSIDE the tab key: switching tabs swaps its
         segments in place instead of remounting/re-animating the bar. -->
    <GlobalPills />
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
        {/if}
      </div>
    {/key}
  {/if}
</div>

<style>
  .surface {
    flex: 1;
    min-height: 0;
    background: var(--card);
    /* The frame scales with the screen: a hand's width on a wall display,
       a sliver on a phone. */
    margin: 0 var(--frame) var(--frame);
    --frame: clamp(0.4rem, 2vw, 1.4rem);
    border-radius: 0 0 min(var(--radius), 2.5vw) min(var(--radius), 2.5vw);
    box-shadow: var(--shadow-soft);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition:
      margin 0.5s ease,
      border-radius 0.5s ease; /* the header's own fade timing */
  }
  .surface.idle {
    margin: 0;
    border-radius: 0;
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
