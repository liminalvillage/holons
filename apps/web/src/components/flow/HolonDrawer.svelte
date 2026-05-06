<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ZonedHolon } from './types';

  export let holons: ZonedHolon[] = [];
  export let isOpen: boolean = true;

  const dispatch = createEventDispatcher<{
    toggle: void;
    holonClick: { holonId: string };
    holonRemove: { holonId: string };
  }>();

  // Filter to unassigned holons (zone === -1)
  $: unassignedHolons = holons.filter(h => h.zone === -1 || h.zone === 0);
  $: assignedCount = holons.filter(h => h.zone >= 1).length;

  function handleDragStart(e: DragEvent, holon: ZonedHolon) {
    if (e.dataTransfer) {
      e.dataTransfer.setData('holonId', holon.id);
      e.dataTransfer.effectAllowed = 'move';

      // Create a custom drag image
      const dragImage = document.createElement('div');
      dragImage.className = 'drag-ghost';
      dragImage.textContent = holon.name.slice(0, 2).toUpperCase();
      dragImage.style.cssText = `
        position: absolute;
        top: -1000px;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #334155;
        border: 2px solid #60a5fa;
        color: #e2e8f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 600;
        font-size: 12px;
      `;
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 20, 20);

      // Clean up after drag
      setTimeout(() => dragImage.remove(), 0);
    }
  }

  function handleDragEnd(e: DragEvent) {
    // Clean up any drag state if needed
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

    <div class="holon-list">
      {#if unassignedHolons.length === 0}
        <div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12h8M12 8v8" />
          </svg>
          <span>No unassigned holons</span>
          <span class="empty-hint">Add federated holons from the Federation tab</span>
        </div>
      {:else}
        {#each unassignedHolons as holon (holon.id)}
          <div
            class="holon-card"
            draggable="true"
            on:dragstart={(e) => handleDragStart(e, holon)}
            on:dragend={handleDragEnd}
            on:click={() => handleHolonClick(holon.id)}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleHolonClick(holon.id); }}
            role="button"
            tabindex="0"
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
      {/if}
    </div>

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
    background: rgba(30, 41, 59, 0.95);
    border-left: 1px solid #334155;
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
    background: rgba(30, 41, 59, 0.95);
    border: 1px solid #334155;
    border-right: none;
    border-radius: 0.5rem 0 0 0.5rem;
    color: #94a3b8;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    z-index: 10;
  }

  .drawer-toggle:hover {
    background: #334155;
    color: #e2e8f0;
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
    color: #e2e8f0;
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
    color: #64748b;
  }

  .stat-divider {
    color: #475569;
  }

  .drawer-instructions {
    font-size: 0.75rem;
    color: #64748b;
    padding: 0.5rem;
    background: rgba(51, 65, 85, 0.3);
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
    color: #64748b;
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
    background: rgba(51, 65, 85, 0.4);
    border: 1px solid #475569;
    border-radius: 0.375rem;
    cursor: grab;
    transition: all 0.2s;
  }

  .holon-card:hover {
    background: rgba(71, 85, 105, 0.4);
    border-color: #64748b;
  }

  .holon-card:active {
    cursor: grabbing;
  }

  .holon-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: #334155;
    border: 2px solid #64748b;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.75rem;
    color: #e2e8f0;
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
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .holon-status {
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
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
    color: #64748b;
    opacity: 0.5;
    flex-shrink: 0;
  }

  .holon-card:hover .drag-handle {
    opacity: 1;
  }

  .assigned-section {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid #334155;
  }

  .section-header {
    font-size: 0.75rem;
    font-weight: 500;
    color: #94a3b8;
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
    color: #94a3b8;
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
