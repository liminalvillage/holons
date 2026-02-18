<!--
  AD4M Settings UI Panel

  Provides controls for:
  - Switching between holosphere/ad4m/dual backend modes
  - Configuring executor URL and auth token
  - Testing the connection
  - Running data sync from HoloSphere to AD4M

  Uses Tailwind classes consistent with the rest of the Harvest app.
  Dark theme with blue accents.

  @component
-->
<script lang="ts">
  import { onDestroy, getContext } from 'svelte';
  import { ad4mConfig, isAd4mEnabled } from './config';
  import type { BackendMode } from './config';
  import { Ad4mConnection } from './connection';
  import type { ConnectionState } from './connection';
  import { syncHolonToAd4m } from './sync';
  import type { SyncReport, LensSyncResult } from './sync';

  // Props
  export let holonId: string = '';

  // Local state
  let executorUrl = '';
  let token = '';
  let mode: BackendMode = 'holosphere';
  let connectionStatus: ConnectionState = 'disconnected';
  let connectionError: string = '';
  let isTesting = false;
  let isSyncing = false;
  let syncProgress = '';
  let syncReport: SyncReport | null = null;
  let showAdvanced = false;
  let perspectiveUuid = '';

  // Load from store
  const unsubConfig = ad4mConfig.subscribe((config) => {
    executorUrl = config.executorUrl;
    token = config.token;
    mode = config.mode;
    perspectiveUuid = config.perspectiveUuid || '';
  });

  onDestroy(unsubConfig);

  // Mode descriptions
  const modeDescriptions: Record<BackendMode, string> = {
    holosphere: 'All data stored in HoloSphere (GunDB/Nostr). Default mode.',
    ad4m: 'All data stored in AD4M. Requires a running AD4M executor.',
    dual: 'Writes to both backends. Reads from HoloSphere. Validates against AD4M.',
  };

  const modeIcons: Record<BackendMode, string> = {
    holosphere: '🌐',
    ad4m: '🔮',
    dual: '⚡',
  };

  // Status indicators
  const statusColors: Record<ConnectionState, string> = {
    disconnected: 'bg-gray-500',
    connecting: 'bg-yellow-500 animate-pulse',
    connected: 'bg-green-500',
    authenticated: 'bg-green-400',
    error: 'bg-red-500',
  };

  const statusLabels: Record<ConnectionState, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting...',
    connected: 'Connected',
    authenticated: 'Authenticated',
    error: 'Error',
  };

  // Handlers
  function saveConfig() {
    ad4mConfig.setConfig({
      executorUrl,
      token,
      mode,
      perspectiveUuid: perspectiveUuid || undefined,
    });
  }

  function handleModeChange(newMode: BackendMode) {
    mode = newMode;
    ad4mConfig.setMode(newMode);
  }

  async function testConnection() {
    isTesting = true;
    connectionError = '';
    connectionStatus = 'connecting';

    try {
      const conn = new Ad4mConnection({
        executorUrl,
        token: token || undefined,
      });

      await conn.connect();
      connectionStatus = conn.connectionState;

      // Try to get agent status
      if (conn.ad4mClient) {
        const status = await conn.ad4mClient.agent.status();
        if (status.isInitialized) {
          connectionStatus = 'authenticated';
        }
      }

      await conn.disconnect();
    } catch (error: any) {
      connectionStatus = 'error';
      connectionError = error.message || String(error);
    } finally {
      isTesting = false;
    }
  }

  async function runSync() {
    if (!holonId) {
      syncProgress = 'Error: No holon ID provided';
      return;
    }

    isSyncing = true;
    syncReport = null;
    syncProgress = 'Initializing sync...';

    try {
      // Get holosphere from context (may not be available in all contexts)
      const holosphere = getContext('holosphere') as any;
      if (!holosphere) {
        syncProgress = 'Error: HoloSphere not available in this context';
        isSyncing = false;
        return;
      }

      syncReport = await syncHolonToAd4m(
        holosphere,
        { executorUrl, token: token || undefined },
        holonId,
        (_lens, current, total, message) => {
          syncProgress = message;
        }
      );

      syncProgress = `Sync ${syncReport.status}: ${syncReport.totalItemsWritten} items synced`;
    } catch (error: any) {
      syncProgress = `Sync failed: ${error.message || String(error)}`;
    } finally {
      isSyncing = false;
    }
  }

  function resetConfig() {
    ad4mConfig.reset();
    connectionStatus = 'disconnected';
    connectionError = '';
    syncReport = null;
  }
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center gap-3 mb-2">
    <span class="text-2xl">🔮</span>
    <div>
      <h3 class="text-white text-lg font-semibold">AD4M Integration</h3>
      <p class="text-gray-400 text-sm">Connect Harvest to the AD4M semantic web</p>
    </div>
  </div>

  <!-- Mode Selector -->
  <div class="space-y-3">
    <label class="block text-sm font-medium text-gray-300">Backend Mode</label>
    <div class="grid grid-cols-3 gap-2">
      {#each (['holosphere', 'ad4m', 'dual'] as BackendMode[]) as m}
        <button
          class="relative flex flex-col items-center p-3 rounded-xl border-2 transition-all duration-200 {mode === m
            ? 'border-blue-500 bg-blue-500/10 text-white'
            : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600 hover:text-gray-300'}"
          on:click={() => handleModeChange(m)}
        >
          <span class="text-xl mb-1">{modeIcons[m]}</span>
          <span class="text-xs font-medium capitalize">{m}</span>
        </button>
      {/each}
    </div>
    <p class="text-xs text-gray-500">{modeDescriptions[mode]}</p>
  </div>

  <!-- Connection Settings (shown when AD4M is enabled) -->
  {#if mode !== 'holosphere'}
    <div class="space-y-4 p-4 bg-gray-800/40 rounded-xl border border-gray-700/50">
      <!-- Connection Status -->
      <div class="flex items-center justify-between">
        <span class="text-sm text-gray-300">Connection Status</span>
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full {statusColors[connectionStatus]}"></div>
          <span class="text-xs text-gray-400">{statusLabels[connectionStatus]}</span>
        </div>
      </div>

      {#if connectionError}
        <div class="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p class="text-xs text-red-400">{connectionError}</p>
        </div>
      {/if}

      <!-- Executor URL -->
      <div class="space-y-1">
        <label for="ad4m-url" class="block text-xs font-medium text-gray-400">Executor URL</label>
        <input
          id="ad4m-url"
          type="text"
          bind:value={executorUrl}
          on:change={saveConfig}
          placeholder="ws://localhost:12000/graphql"
          class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
        />
      </div>

      <!-- Token -->
      <div class="space-y-1">
        <label for="ad4m-token" class="block text-xs font-medium text-gray-400">Auth Token</label>
        <input
          id="ad4m-token"
          type="password"
          bind:value={token}
          on:change={saveConfig}
          placeholder="JWT token from AD4M executor"
          class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
        />
      </div>

      <!-- Quick connect buttons -->
      <div class="flex gap-2">
        <button
          on:click={() => { executorUrl = 'ws://localhost:12000/graphql'; saveConfig(); }}
          class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
        >
          Local
        </button>
        <button
          on:click={() => { executorUrl = 'wss://lucksus.ad4m.dev:12001/graphql'; saveConfig(); }}
          class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
        >
          Remote (WWW)
        </button>
      </div>

      <!-- Test Connection Button -->
      <button
        on:click={testConnection}
        disabled={isTesting}
        class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {#if isTesting}
          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          Testing...
        {:else}
          🔌 Test Connection
        {/if}
      </button>
    </div>
  {/if}

  <!-- Data Sync Section (shown when AD4M is enabled and a holon is selected) -->
  {#if mode !== 'holosphere' && holonId}
    <div class="space-y-3 p-4 bg-gray-800/40 rounded-xl border border-gray-700/50">
      <div class="flex items-center gap-2">
        <span class="text-base">📦</span>
        <h4 class="text-sm font-medium text-gray-300">Data Migration</h4>
      </div>
      <p class="text-xs text-gray-500">
        Sync data from HoloSphere to AD4M for this holon.
        This reads all lens data and writes it to the AD4M perspective.
      </p>

      <button
        on:click={runSync}
        disabled={isSyncing}
        class="w-full py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
      >
        {#if isSyncing}
          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          Syncing...
        {:else}
          🔄 Sync to AD4M
        {/if}
      </button>

      {#if syncProgress}
        <p class="text-xs text-gray-400">{syncProgress}</p>
      {/if}

      <!-- Sync Report -->
      {#if syncReport}
        <div class="space-y-2 text-xs">
          <div class="flex justify-between text-gray-400">
            <span>Items read:</span>
            <span class="text-white">{syncReport.totalItemsRead}</span>
          </div>
          <div class="flex justify-between text-gray-400">
            <span>Items written:</span>
            <span class="text-green-400">{syncReport.totalItemsWritten}</span>
          </div>
          {#if syncReport.totalErrors > 0}
            <div class="flex justify-between text-gray-400">
              <span>Errors:</span>
              <span class="text-red-400">{syncReport.totalErrors}</span>
            </div>
          {/if}
          <div class="flex justify-between text-gray-400">
            <span>Duration:</span>
            <span class="text-white">{(syncReport.durationMs / 1000).toFixed(1)}s</span>
          </div>

          <!-- Per-lens details (collapsible) -->
          <details class="mt-2">
            <summary class="text-gray-500 cursor-pointer hover:text-gray-400 select-none">
              Lens details ({syncReport.lensResults.length} lenses)
            </summary>
            <div class="mt-2 space-y-1 pl-2 border-l border-gray-700">
              {#each syncReport.lensResults as result}
                <div class="flex justify-between">
                  <span class="text-gray-500">{result.lens}</span>
                  <span class="{result.errors.length > 0 ? 'text-yellow-400' : 'text-gray-400'}">
                    {result.itemsWritten}/{result.itemsRead}
                    {#if result.errors.length > 0}
                      ({result.errors.length} err)
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          </details>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Advanced Settings -->
  <div>
    <button
      on:click={() => showAdvanced = !showAdvanced}
      class="text-xs text-gray-500 hover:text-gray-400 transition-colors flex items-center gap-1"
    >
      <span class="transition-transform {showAdvanced ? 'rotate-90' : ''}">&rsaquo;</span>
      Advanced
    </button>

    {#if showAdvanced}
      <div class="mt-3 space-y-3 p-3 bg-gray-800/30 rounded-lg border border-gray-700/30">
        <!-- Perspective UUID Override -->
        <div class="space-y-1">
          <label for="ad4m-perspective" class="block text-xs font-medium text-gray-500">
            Perspective UUID (override)
          </label>
          <input
            id="ad4m-perspective"
            type="text"
            bind:value={perspectiveUuid}
            on:change={saveConfig}
            placeholder="Auto-mapped from holon ID"
            class="w-full px-3 py-1.5 bg-gray-900/40 border border-gray-700/50 rounded-lg text-xs text-gray-300 placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
          />
        </div>

        <!-- Auto-connect -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={$ad4mConfig.autoConnect}
            on:change={(e) => ad4mConfig.setAutoConnect(e.currentTarget.checked)}
            class="w-4 h-4 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500"
          />
          <span class="text-xs text-gray-400">Auto-connect on startup</span>
        </label>

        <!-- Reset -->
        <button
          on:click={resetConfig}
          class="px-3 py-1.5 text-xs bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg border border-red-600/30 transition-colors"
        >
          Reset to Defaults
        </button>
      </div>
    {/if}
  </div>
</div>
