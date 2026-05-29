<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { calculateZonePercentages, ZONE_COLORS } from './types';

  export let steepness: number = 50;
  export let nzones: number = 6;
  export let hasChanges: boolean = false;
  export let syncing: boolean = false;
  export let hasBundleDeployed: boolean = false;

  const dispatch = createEventDispatcher<{
    steepnessChange: number;
    nzonesChange: number;
    sync: void;
    reset: void;
    deploy: void;
    redeploy: void;
  }>();

  $: zonePercentages = calculateZonePercentages(steepness, nzones);

  function handleSteepnessChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    dispatch('steepnessChange', value);
  }

  function handleNzonesChange(e: Event) {
    const value = parseInt((e.target as HTMLInputElement).value);
    if (value >= 1 && value <= 10) {
      dispatch('nzonesChange', value);
    }
  }

  function incrementZones() {
    if (nzones < 10) {
      dispatch('nzonesChange', nzones + 1);
    }
  }

  function decrementZones() {
    if (nzones > 1) {
      dispatch('nzonesChange', nzones - 1);
    }
  }
</script>

<div class="flow-controls">
  <div class="control-section">
    <div class="control-group">
      <label class="control-label" for="steepness-slider">
         Exterior Reward Sharing        <span class="control-value">{steepness}%</span>
      </label>
      <input
        id="steepness-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        value={steepness}
        on:input={handleSteepnessChange}
        class="slider steepness-slider"
      />
      <div class="slider-labels">
        <span>Steep (0%)</span>
        <span>Even (100%)</span>
      </div>
    </div>

    <div class="control-group zones-group">
      <label class="control-label" for="zones-number">
        Number of Zones
      </label>
      <div class="zones-input">
        <button
          class="zones-btn"
          on:click={decrementZones}
          disabled={nzones <= 1}
        >
          −
        </button>
        <input
          id="zones-number"
          type="number"
          min="1"
          max="10"
          value={nzones}
          on:change={handleNzonesChange}
          class="zones-number"
        />
        <button
          class="zones-btn"
          on:click={incrementZones}
          disabled={nzones >= 10}
        >
          +
        </button>
      </div>
    </div>

    <div class="zone-bar-chart">
      {#each zonePercentages as percent, i}
        <div class="bar-column">
          <div class="bar-track">
            <div
              class="bar-fill"
              style="height: {percent}%; background: {ZONE_COLORS[i % ZONE_COLORS.length]};"
            ></div>
          </div>
          <span class="bar-label">Z{i + 1}</span>
          <span class="bar-value">{percent.toFixed(1)}%</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="action-buttons">
    {#if !hasBundleDeployed}
      <button
        class="btn btn-deploy"
        on:click={() => dispatch('deploy')}
        disabled={syncing}
      >
        {#if syncing}
          <span class="spinner"></span>
          Deploying...
        {:else}
          Deploy Bundle
        {/if}
      </button>
    {:else}
      <button
        class="btn btn-reset"
        on:click={() => dispatch('reset')}
        disabled={!hasChanges || syncing}
      >
        Reset
      </button>
      <button
        class="btn btn-sync"
        on:click={() => dispatch('sync')}
        disabled={!hasChanges || syncing}
      >
        {#if syncing}
          <span class="spinner"></span>
          Syncing...
        {:else}
          Sync to Chain
        {/if}
      </button>
      <button
        class="btn btn-redeploy"
        on:click={() => dispatch('redeploy')}
        disabled={syncing}
        title="Deploy a new Bundle contract (old one will be replaced)"
      >
        Redeploy
      </button>
    {/if}
  </div>
</div>

<style>
  .flow-controls {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    background: var(--color-bg-secondary);
    border-radius: 0.5rem;
  }

  .control-section {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .control-group {
    flex: 1;
    min-width: 180px;
  }

  .zones-group {
    flex: 0 0 auto;
    min-width: 120px;
  }

  .control-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.875rem;
    color: var(--color-text-primary);
    margin-bottom: 0.5rem;
  }

  .control-value {
    font-family: monospace;
    color: #60a5fa;
    font-weight: 500;
  }

  .slider {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--color-bg-tertiary);
    appearance: none;
    cursor: pointer;
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid var(--color-bg-secondary);
    transition: transform 0.15s;
  }

  .slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
  }

  .slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3b82f6;
    cursor: pointer;
    border: 2px solid var(--color-bg-secondary);
  }

  .steepness-slider::-webkit-slider-thumb {
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--color-text-muted);
    margin-top: 0.25rem;
  }

  .zones-input {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .zones-btn {
    width: 32px;
    height: 32px;
    border-radius: 0.25rem;
    background: var(--color-bg-tertiary);
    border: 1px solid var(--color-border-light);
    color: var(--color-text-primary);
    font-size: 1.25rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
  }

  .zones-btn:hover:not(:disabled) {
    background: var(--color-border-light);
    border-color: #6b7280;
  }

  .zones-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .zones-number {
    width: 48px;
    height: 32px;
    text-align: center;
    font-size: 1rem;
    font-weight: 600;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border-light);
    border-radius: 0.25rem;
    color: var(--color-text-primary);
  }

  .zones-number::-webkit-inner-spin-button,
  .zones-number::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .zone-bar-chart {
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem;
    background: var(--color-bg-primary);
    border-radius: 0.375rem;
    height: 120px;
    flex: 1;
    min-width: 180px;
  }

  .bar-column {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
  }

  .bar-track {
    flex: 1;
    width: 100%;
    max-width: 16px;
    background: var(--color-bg-tertiary);
    border-radius: 0.25rem 0.25rem 0 0;
    display: flex;
    align-items: flex-end;
    overflow: hidden;
  }

  .bar-fill {
    width: 100%;
    border-radius: 0.25rem 0.25rem 0 0;
    transition: height 0.3s ease;
    min-height: 2px;
  }

  .bar-label {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--color-text-muted);
    margin-top: 0.25rem;
  }

  .bar-value {
    font-size: 0.5rem;
    font-family: monospace;
    color: var(--color-text-muted);
  }

  .action-buttons {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding-top: 0.5rem;
    border-top: 1px solid rgba(71, 85, 105, 0.5);
  }

  .btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-reset {
    background: transparent;
    border: 1px solid var(--color-border-light);
    color: var(--color-text-muted);
  }

  .btn-reset:hover:not(:disabled) {
    background: rgba(71, 85, 105, 0.3);
    color: var(--color-text-primary);
  }

  .btn-sync {
    background: var(--color-accent);
    color: #fff;
  }

  .btn-sync:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .btn-deploy {
    background: var(--color-accent);
    color: #fff;
  }

  .btn-deploy:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .btn-redeploy {
    background: var(--color-accent);
    color: #fff;
  }

  .btn-redeploy:hover:not(:disabled) {
    background: var(--color-accent-hover);
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  @media (max-width: 640px) {
    .control-section {
      flex-direction: column;
    }

    .action-buttons {
      flex-direction: column;
    }

    .btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
