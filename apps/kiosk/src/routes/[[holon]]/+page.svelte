<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import { activeTab } from "$lib/stores";
  import CalendarView from "$lib/views/CalendarView.svelte";
  import TasksView from "$lib/views/TasksView.svelte";
  import LibraryView from "$lib/views/LibraryView.svelte";
  import RolesView from "$lib/views/RolesView.svelte";
</script>

<div class="surface">
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
      {/if}
    </div>
  {/key}
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
    display: flex;
    flex-direction: column;
    animation: kiosk-fade 0.4s ease both;
  }
</style>
