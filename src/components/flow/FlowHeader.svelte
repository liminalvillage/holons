<script lang="ts">
  import { calculateZonePercentages, ZONE_COLORS } from './types';

  export let bundleAddress: string | null = null;
  export let networkName: string = 'Unknown';
  export let interiorPercent: number = 50;
  export let steepness: number = 50;
  export let nzones: number = 6;

  let copied = false;

  $: exteriorPercent = 100 - interiorPercent;
  $: zonePercentages = calculateZonePercentages(steepness, nzones);

  function copyAddress() {
    if (bundleAddress) {
      navigator.clipboard.writeText(bundleAddress);
      copied = true;
      setTimeout(() => copied = false, 2000);
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

  <div class="flow-breakdown">
    <div class="breakdown-label">Flow Distribution</div>
    <div class="breakdown-bar">
      <div
        class="interior-segment"
        style="width: {interiorPercent}%"
        title="Interior: {interiorPercent}%"
      >
        <span class="segment-label">Interior {interiorPercent}%</span>
      </div>
      {#each zonePercentages as percent, i}
        <div
          class="zone-segment"
          style="width: {(exteriorPercent * percent / 100)}%; background-color: {ZONE_COLORS[i % ZONE_COLORS.length]}"
          title="Zone {i + 1}: {(exteriorPercent * percent / 100).toFixed(1)}%"
        >
          {#if (exteriorPercent * percent / 100) > 8}
            <span class="segment-label">Z{i + 1}</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .flow-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1rem;
    background: rgba(30, 41, 59, 0.5);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    gap: 1rem;
    flex-wrap: wrap;
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

  .flow-breakdown {
    flex: 1;
    min-width: 200px;
    max-width: 400px;
  }

  .breakdown-label {
    font-size: 0.75rem;
    color: #94a3b8;
    margin-bottom: 0.25rem;
  }

  .breakdown-bar {
    display: flex;
    height: 24px;
    border-radius: 0.25rem;
    overflow: hidden;
    background: #1e293b;
  }

  .interior-segment {
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #334155 0%, #475569 100%);
    color: #e2e8f0;
    font-size: 0.75rem;
    font-weight: 500;
    min-width: 0;
    transition: width 0.3s ease;
  }

  .zone-segment {
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 0.625rem;
    font-weight: 600;
    min-width: 0;
    transition: width 0.3s ease;
  }

  .segment-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 0.25rem;
  }

  @media (max-width: 640px) {
    .flow-header {
      flex-direction: column;
      align-items: stretch;
    }

    .flow-breakdown {
      max-width: none;
    }
  }
</style>
