<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import type { ZonedHolon } from './types';

  export let holons: ZonedHolon[] = [];
  export let isOpen: boolean = true;

  const dispatch = createEventDispatcher<{
    toggle: void;
    holonClick: { holonId: string };
    holonRemove: { holonId: string };
    holonDropped: { holonId: string; zone: number };
  }>();

  const flipDurationMs = 150;

  // Filter to unassigned holons (zone === -1)
  $: unassignedHolons = holons.filter(h => h.zone === -1 || h.zone === 0);
  $: assignedCount = holons.filter(h => h.zone >= 1).length;

  // Local DnD copy; synced from unassignedHolons unless a drag is active.
  let dndHolons: ZonedHolon[] = [];
  let isDragging = false;
  $: if (!isDragging) {
    dndHolons = [...unassignedHolons];
  }

  function handleConsider(e: CustomEvent<{ items: ZonedHolon[] }>) {
    isDragging = true;
    dndHolons = e.detail.items;
  }

  function handleFinalize(e: CustomEvent<{ items: ZonedHolon[] }>) {
    dndHolons = e.detail.items;
    isDragging = false;
    // A holon that's now here but wasn't unassigned before was dropped back.
    const moved = e.detail.items.find(
      h => !unassignedHolons.some(x => x.id === h.id)
    );
    if (moved && moved.zone >= 1) {
      dispatch('holonDropped', { holonId: moved.id, zone: -1 });
    }
  }

  function toggleDrawer() {
    dispatch('toggle');
  }

  function handleHolonClick(holonId: string) {
    dispatch('holonClick', { holonId });
  }
</script>

<div class="holon-drawer" class:open={isOpen}>
  <button class="drawer-toggle" on:click={toggleDrawer} aria-label={isOpen ? 'Close drawer' : 'Open drawer'}>
    <svg class="toggle-icon" class:rotated={!isOpen} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>

  <div class="drawer-content">
    <div class="drawer-header">
      <h3 class="drawer-title">Federated Holons</h3>
      <div class="drawer-stats">
        <span class="stat">
          <span class="stat-value">{unassignedHolons.length}</span>
          <span class="stat-label">unassigned</span>
        </span>
        <span class="stat-divider">|</span>
        <span class="stat">
          <span class="stat-value">{assignedCount}</span>
          <span class="stat-label">in zones</span>
        </span>
      </div>
    </div>

    <div class="drawer-instructions">
      Drag holons to zones or click to select
    </div>

    <div
      class="holon-list"
      use:dndzone={{
        items: dndHolons,
        flipDurationMs,
        dropTargetStyle: { outline: '2px dashed #60a5fa', 'border-radius': '0.5rem' }
      }}
      on:consider={handleConsider}
      on:finalize={handleFinalize}
    >
      {#each dndHolons as holon (holon.id)}
        <div
          class="holon-card"
          on:click={() => handleHolonClick(holon.id)}
          on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleHolonClick(holon.id); }}
          role="button"
          tabindex="0"
          animate:flip={{ duration: flipDurationMs }}
        >
          <div class="holon-avatar">
            {holon.name.slice(0, 2).toUpperCase()}
          </div>
          <div class="holon-info">
            <span class="holon-name">{holon.name}</span>
            <span class="holon-status" class:active={holon.status === 'active'} class:pending={holon.status === 'pending'}>
              {holon.status}
            </span>
          </div>
          <div class="drag-handle" title="Drag to assign to zone">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="15" cy="6" r="1.5" />
              <circle cx="9" cy="12" r="1.5" />
              <circle cx="15" cy="12" r="1.5" />
              <circle cx="9" cy="18" r="1.5" />
              <circle cx="15" cy="18" r="1.5" />
            </svg>
          </div>
        </div>
      {/each}
    </div>
    {#if dndHolons.length === 0}
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8M12 8v8" />
        </svg>
        <span>No unassigned holons</span>
        <span class="empty-hint">Drag holons here to unassign, or add more from the Federation tab</span>
      </div>
    {/if}

    {#if assignedCount > 0}
      <div class="assigned-section">
        <div class="section-header">In Zones</div>
        <div class="assigned-list">
          {#each holons.filter(h => h.zone >= 1) as holon (holon.id)}
            <div class="assigned-chip" title="{holon.name} in Zone {holon.zone}">
              <span class="chip-zone">Z{holon.zone}</span>
              <span class="chip-name">{holon.name.slice(0, 8)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .holon-drawer {
    position: relative;
    width: 280px;
    background: var(--color-bg-secondary);
    border-left: 1px solid var(--color-bg-tertiary);
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease, margin 0.3s ease;
    overflow: hidden;
  }

  .holon-drawer:not(.open) {
    width: 0;
    margin-left: -1px;
  }

  .drawer-toggle {
    position: absolute;
    left: -32px;
    top: 50%;
    transform: translateY(-50%);
    width: 32px;
    height: 64px;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-bg-tertiary);
    border-right: none;
    border-radius: 0.5rem 0 0 0.5rem;
    color: var(--color-text-muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 10;
  }

  .drawer-toggle:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text-primary);
  }

  .toggle-icon {
    width: 20px;
    height: 20px;
    transition: transform 0.3s ease;
  }

  .toggle-icon.rotated {
    transform: rotate(180deg);
  }

  .drawer-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    overflow: hidden;
    min-width: 280px;
  }

  .drawer-header {
    margin-bottom: 0.75rem;
  }

  .drawer-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0 0 0.5rem 0;
  }

  .drawer-stats {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .stat {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .stat-value {
    font-size: 1.125rem;
    font-weight: 600;
    color: #60a5fa;
  }

  .stat-label {
    font-size: 0.75rem;
    color: var(--color-text-muted);
  }

  .stat-divider {
    color: var(--color-text-muted);
  }

  .drawer-instructions {
    font-size: 0.75rem;
    color: var(--color-text-muted);
    padding: 0.5rem;
    background: var(--color-bg-tertiary);
    border-radius: 0.25rem;
    margin-bottom: 0.75rem;
    text-align: center;
  }

  .holon-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
    color: var(--color-text-muted);
    text-align: center;
    gap: 0.5rem;
  }

  .empty-icon {
    width: 40px;
    height: 40px;
    opacity: 0.5;
  }

  .empty-hint {
    font-size: 0.75rem;
    opacity: 0.7;
  }

  .holon-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem;
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border-light);
    border-radius: 0.375rem;
    cursor: grab;
    transition: all 0.2s;
  }

  .holon-card:hover {
    background: rgba(71, 85, 105, 0.4);
    border-color: #6b7280;
  }

  .holon-card:active {
    cursor: grabbing;
  }

  .holon-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-bg-tertiary);
    border: 2px solid #6b7280;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.75rem;
    color: var(--color-text-primary);
    flex-shrink: 0;
  }

  .holon-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .holon-name {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .holon-status {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
  }

  .holon-status.active {
    color: #22c55e;
  }

  .holon-status.pending {
    color: #f59e0b;
  }

  .drag-handle {
    width: 20px;
    height: 20px;
    color: var(--color-text-muted);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .holon-card:hover .drag-handle {
    opacity: 1;
  }

  .assigned-section {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--color-bg-tertiary);
  }

  .section-header {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--color-text-muted);
    margin-bottom: 0.5rem;
  }

  .assigned-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .assigned-chip {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(59, 130, 246, 0.15);
    border-radius: 9999px;
    font-size: 0.75rem;
  }

  .chip-zone {
    color: #60a5fa;
    font-weight: 600;
  }

  .chip-name {
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .holon-drawer {
      position: fixed;
      right: 0;
      top: 0;
      bottom: 0;
      z-index: 50;
      box-shadow: -4px 0 12px rgba(0, 0, 0, 0.3);
    }

    .holon-drawer:not(.open) {
      right: -280px;
      width: 280px;
    }

    .drawer-toggle {
      left: -40px;
      width: 40px;
      height: 80px;
    }
  }
</style>
