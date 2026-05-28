<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { dndzone } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  import { calculateZonePercentages, ZONE_COLORS } from './types';
  import type { ZonedHolon } from './types';

  export let bundleAddress: string | null = null;
  export let networkName: string = 'Unknown';
  export let interiorPercent: number = 50;
  export let steepness: number = 50;
  export let nzones: number = 6;
  export let federatedHolons: ZonedHolon[] = [];

  const dispatch = createEventDispatcher<{
    interiorChange: number;
    holonDropped: { holonId: string; zone: number };
  }>();

  let copied = false;
  const flipDurationMs = 150;

  $: exteriorPercent = 100 - interiorPercent;
  $: zonePercentages = calculateZonePercentages(steepness, nzones);
  // Share of the whole bar each exterior zone occupies.
  $: zoneShares = zonePercentages.map((p) => (exteriorPercent * p) / 100);

  // Holons grouped by their assigned zone (1..nzones).
  $: holonsByZone = (() => {
    const map: Record<number, ZonedHolon[]> = {};
    for (let z = 1; z <= nzones; z++) map[z] = [];
    for (const h of federatedHolons) {
      if (h.zone >= 1 && h.zone <= nzones) map[h.zone].push(h);
    }
    return map;
  })();

  // Local DnD copies per zone; synced from holonsByZone unless a drag is active.
  let dndByZone: Record<number, ZonedHolon[]> = {};
  let draggingZone: number | null = null;
  $: if (draggingZone === null) {
    const next: Record<number, ZonedHolon[]> = {};
    for (let z = 1; z <= nzones; z++) next[z] = [...(holonsByZone[z] || [])];
    dndByZone = next;
  }

  function handleConsider(zone: number, e: CustomEvent<{ items: ZonedHolon[] }>) {
    draggingZone = zone;
    dndByZone[zone] = e.detail.items;
    dndByZone = { ...dndByZone };
  }

  function handleFinalize(zone: number, e: CustomEvent<{ items: ZonedHolon[] }>) {
    dndByZone[zone] = e.detail.items;
    dndByZone = { ...dndByZone };
    draggingZone = null;

    // A holon that's now in this zone but wasn't before was just dropped here.
    const moved = e.detail.items.find(
      (h) => !(holonsByZone[zone] || []).some((x) => x.id === h.id)
    );
    if (moved && moved.zone !== zone) {
      dispatch('holonDropped', { holonId: moved.id, zone });
    }
  }

  function handleInteriorInput(e: Event) {
    dispatch('interiorChange', parseInt((e.target as HTMLInputElement).value));
  }

  function copyAddress() {
    if (bundleAddress) {
      navigator.clipboard.writeText(bundleAddress);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    }
  }

  function truncateAddress(address: string): string {
    if (address.length <= 14) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }
</script>

<div class="flow-header">
  <div class="bundle-info">
    {#if bundleAddress}
      <div class="address-row">
        <span class="label">Bundle:</span>
        <button class="address" on:click={copyAddress} title="Click to copy">
          {truncateAddress(bundleAddress)}
          {#if copied}
            <span class="copied-badge">Copied!</span>
          {:else}
            <svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          {/if}
        </button>
        <span class="network-badge">{networkName}</span>
      </div>
    {:else}
      <div class="no-bundle">
        <span class="label">No bundle deployed</span>
        <span class="network-badge">{networkName}</span>
      </div>
    {/if}
  </div>

  <div class="flow-distribution">
    <div class="distribution-header">
      <span class="distribution-title">Flow Distribution</span>
      <span class="distribution-hint">Drag federated holons onto a zone</span>
    </div>

    <div class="distribution-bar">
      <!-- Z0 = interior; not a holon drop target. -->
      <div class="zone-segment z0" style="width: {interiorPercent}%" title="Z0: {interiorPercent}%">
        <span class="segment-head">Z0</span>
        <span class="segment-pct">{interiorPercent}%</span>
      </div>

      {#each Array(nzones) as _, i}
        {@const zone = i + 1}
        {@const share = zoneShares[i] || 0}
        {@const color = ZONE_COLORS[i % ZONE_COLORS.length]}
        <div
          class="zone-segment"
          style="width: {share}%; --zone-color: {color}; background-color: {color}"
          title="Z{zone}: {share.toFixed(1)}%"
        >
          <span class="segment-head">Z{zone}</span>
          {#if share > 5}
            <span class="segment-pct">{share.toFixed(0)}%</span>
          {/if}
          <div
            class="zone-drop"
            use:dndzone={{
              items: dndByZone[zone] || [],
              flipDurationMs,
              dropTargetStyle: { outline: '2px dashed rgba(255,255,255,0.9)' }
            }}
            on:consider={(e) => handleConsider(zone, e)}
            on:finalize={(e) => handleFinalize(zone, e)}
          >
            {#each dndByZone[zone] || [] as holon (holon.id)}
              <div
                class="holon-chip"
                title={holon.name}
                animate:flip={{ duration: flipDurationMs }}
              >
                {holon.name.slice(0, 2).toUpperCase()}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>

    <input
      type="range"
      min="0"
      max="100"
      step="1"
      value={interiorPercent}
      on:input={handleInteriorInput}
      class="distribution-slider"
      aria-label="Z0 share"
    />
  </div>
</div>

<style>
  .flow-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: rgba(30, 41, 59, 0.5);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .bundle-info {
    display: flex;
    align-items: center;
  }

  .address-row, .no-bundle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .label {
    color: #94a3b8;
    font-size: 0.875rem;
  }

  .address {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-family: monospace;
    font-size: 0.875rem;
    color: #e2e8f0;
    background: rgba(51, 65, 85, 0.5);
    border: 1px solid #475569;
    border-radius: 0.25rem;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .address:hover {
    background: rgba(71, 85, 105, 0.5);
    border-color: #64748b;
  }

  .copy-icon {
    width: 14px;
    height: 14px;
    opacity: 0.6;
  }

  .copied-badge {
    font-size: 0.75rem;
    color: #10b981;
  }

  .network-badge {
    font-size: 0.75rem;
    padding: 0.125rem 0.5rem;
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border-radius: 9999px;
    text-transform: capitalize;
  }

  .flow-distribution {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .distribution-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .distribution-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: #e2e8f0;
  }

  .distribution-hint {
    font-size: 0.75rem;
    color: #64748b;
  }

  .distribution-bar {
    display: flex;
    min-height: 64px;
    border-radius: 0.375rem;
    overflow: hidden;
    background: #1e293b;
  }

  .zone-segment {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    padding: 0.25rem 0;
    color: white;
    transition: width 0.25s ease;
    border-right: 1px solid rgba(15, 23, 42, 0.4);
  }

  .zone-segment:last-child {
    border-right: none;
  }

  .zone-segment.z0 {
    background: linear-gradient(135deg, #334155 0%, #475569 100%);
    color: #e2e8f0;
  }

  .segment-head {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.03em;
  }

  .segment-pct {
    font-size: 0.625rem;
    font-family: monospace;
    opacity: 0.9;
  }

  .zone-drop {
    flex: 1;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    justify-content: center;
    gap: 2px;
    padding: 2px;
    min-height: 26px;
  }

  .holon-chip {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: rgba(15, 23, 42, 0.55);
    border: 1.5px solid rgba(255, 255, 255, 0.7);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.6rem;
    font-weight: 600;
    cursor: grab;
    flex-shrink: 0;
  }

  .holon-chip:active {
    cursor: grabbing;
  }

  .distribution-slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: #334155;
    appearance: none;
    cursor: pointer;
  }

  .distribution-slider::-webkit-slider-thumb {
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    cursor: pointer;
    border: 3px solid #1e293b;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    transition: transform 0.15s;
  }

  .distribution-slider::-webkit-slider-thumb:hover {
    transform: scale(1.15);
  }

  .distribution-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    cursor: pointer;
    border: 3px solid #1e293b;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
</style>
