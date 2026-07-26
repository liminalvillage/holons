<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { activeTab, boardReady } from "$lib/stores";
  import CalendarView from "$lib/views/CalendarView.svelte";
  import TasksView from "$lib/views/TasksView.svelte";
  import LibraryView from "$lib/views/LibraryView.svelte";
  import RolesView from "$lib/views/RolesView.svelte";
  import StatusView from "$lib/views/StatusView.svelte";
</script>

<div class="surface">
  <!-- Mount the view only once the holon's initial data has settled (see
       boardReady): a fresh mount on the full set plays the entrance animation
       cleanly, the same way switching tabs does. Keyed on the tab so each
       switch remounts and re-animates. -->
  {#if $boardReady}
    {#key $activeTab}
      <div class="view">
        {#if $activeTab === "tasks"}
          <TasksView />
        {:else if $activeTab === "calendar"}
          <CalendarView />
        {:else if $activeTab === "library"}
          <LibraryView />
        {:else if $activeTab === "roles"}
          <RolesView />
        {:else if $activeTab === "status"}
          <StatusView />
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
    margin: 0 1.4rem 1.4rem;
    border-radius: 0 0 var(--radius) var(--radius);
    box-shadow: var(--shadow-soft);
    overflow: hidden;
    display: flex;
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
