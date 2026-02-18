<!--
  AD4M Connect UI Component

  Provides a connection flow for connecting to an AD4M executor:
  - Input fields for executor URL and auth token
  - Connect/disconnect controls
  - Agent status display (DID, locked/unlocked)
  - Passphrase unlock for locked agents
  - Connection error display

  Only shown when ad4mConfig.mode is 'ad4m' or 'dual'.

  @component
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Ad4mConnection } from './connection';
  import type { ConnectionState } from './connection';
  import { ad4mConfig } from './config';

  // Reactive connection state exported for parent components
  export let connectionState: ConnectionState = 'disconnected';
  export let agentDid: string = '';
  export let isAgentLocked: boolean = false;
  export let connected: boolean = false;

  // Local state
  let executorUrl = '';
  let token = '';
  let passphrase = '';
  let connectionError = '';
  let isConnecting = false;
  let isUnlocking = false;
  let connection: Ad4mConnection | null = null;

  // Status display helpers
  const statusColors: Record<ConnectionState, string> = {
    disconnected: 'bg-gray-500',
    connecting: 'bg-yellow-500 animate-pulse',
    connected: 'bg-green-500',
    authenticated: 'bg-green-400',
    reconnecting: 'bg-yellow-500 animate-pulse',
    error: 'bg-red-500',
  };

  const statusLabels: Record<ConnectionState, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    authenticated: 'Authenticated',
    reconnecting: 'Reconnecting...',
    error: 'Error',
  };

  // Sync from config store
  const unsubConfig = ad4mConfig.subscribe((config) => {
    executorUrl = config.executorUrl;
    token = config.token;
  });

  onDestroy(() => {
    unsubConfig();
    connection?.disconnect();
  });

  async function handleConnect() {
    isConnecting = true;
    connectionError = '';
    connectionState = 'connecting';

    try {
      // Save config
      ad4mConfig.setConfig({ executorUrl, token });

      connection = new Ad4mConnection({
        executorUrl,
        token: token || undefined,
      });

      connection.onStateChange((state, error) => {
        connectionState = state;
        if (error) connectionError = error.message;
      });

      await connection.connect();
      connectionState = connection.connectionState;
      connected = true;

      // Check agent status
      if (connection.ad4mClient) {
        try {
          const status = await connection.ad4mClient.agent.status();
          agentDid = status.did || '';
          isAgentLocked = !status.isUnlocked;

          if (status.isInitialized && status.isUnlocked) {
            connectionState = 'authenticated';
          }
        } catch (e: any) {
          console.warn('[ConnectUI] Agent status check failed:', e);
        }
      }
    } catch (error: any) {
      connectionState = 'error';
      connectionError = error.message || String(error);
      connected = false;
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    if (connection) {
      await connection.disconnect();
      connection = null;
    }
    connectionState = 'disconnected';
    connected = false;
    agentDid = '';
    isAgentLocked = false;
    connectionError = '';
  }

  async function handleUnlock() {
    if (!connection?.ad4mClient || !passphrase) return;

    isUnlocking = true;
    connectionError = '';

    try {
      await connection.ad4mClient.agent.unlock(passphrase);
      isAgentLocked = false;
      connectionState = 'authenticated';
      passphrase = '';

      // Refresh DID
      const status = await connection.ad4mClient.agent.status();
      agentDid = status.did || '';
    } catch (error: any) {
      connectionError = `Unlock failed: ${error.message || String(error)}`;
    } finally {
      isUnlocking = false;
    }
  }
</script>

<div class="space-y-4">
  <!-- Connection Status -->
  <div class="flex items-center justify-between">
    <span class="text-sm text-gray-300">Connection</span>
    <div class="flex items-center gap-2">
      <div class="w-2.5 h-2.5 rounded-full {statusColors[connectionState]}"></div>
      <span class="text-xs text-gray-400">{statusLabels[connectionState]}</span>
    </div>
  </div>

  {#if connectionError}
    <div class="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-xs text-red-400">{connectionError}</p>
    </div>
  {/if}

  {#if !connected}
    <!-- Executor URL -->
    <div class="space-y-1">
      <label for="ad4m-connect-url" class="block text-xs font-medium text-gray-400">Executor URL</label>
      <input
        id="ad4m-connect-url"
        type="text"
        bind:value={executorUrl}
        placeholder="ws://localhost:12000/graphql"
        class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
      />
    </div>

    <!-- Token -->
    <div class="space-y-1">
      <label for="ad4m-connect-token" class="block text-xs font-medium text-gray-400">Auth Token</label>
      <input
        id="ad4m-connect-token"
        type="password"
        bind:value={token}
        placeholder="JWT token (optional)"
        class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
      />
    </div>

    <!-- Quick URLs -->
    <div class="flex gap-2">
      <button
        on:click={() => { executorUrl = 'ws://localhost:12000/graphql'; }}
        class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
      >
        Local
      </button>
      <button
        on:click={() => { executorUrl = 'wss://lucksus.ad4m.dev:12001/graphql'; }}
        class="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
      >
        Remote (WWW)
      </button>
    </div>

    <!-- Connect Button -->
    <button
      on:click={handleConnect}
      disabled={isConnecting}
      class="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
    >
      {#if isConnecting}
        <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
        Connecting...
      {:else}
        🔌 Connect to AD4M
      {/if}
    </button>
  {:else}
    <!-- Connected State -->
    <div class="space-y-3 p-3 bg-gray-800/40 rounded-xl border border-gray-700/50">
      <!-- Agent DID -->
      {#if agentDid}
        <div class="space-y-1">
          <span class="text-xs font-medium text-gray-400">Agent DID</span>
          <p class="text-xs text-green-400 font-mono break-all">{agentDid}</p>
        </div>
      {/if}

      <!-- Lock Status -->
      <div class="flex items-center gap-2">
        <span class="text-xs text-gray-400">Agent Status:</span>
        {#if isAgentLocked}
          <span class="text-xs text-yellow-400">🔒 Locked</span>
        {:else}
          <span class="text-xs text-green-400">🔓 Unlocked</span>
        {/if}
      </div>

      <!-- Unlock UI (if locked) -->
      {#if isAgentLocked}
        <div class="space-y-2 pt-2 border-t border-gray-700/50">
          <label for="ad4m-passphrase" class="block text-xs font-medium text-gray-400">Passphrase</label>
          <input
            id="ad4m-passphrase"
            type="password"
            bind:value={passphrase}
            placeholder="Enter passphrase to unlock"
            class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none transition-colors"
            on:keydown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
          />
          <button
            on:click={handleUnlock}
            disabled={isUnlocking || !passphrase}
            class="w-full py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-yellow-600/50 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {#if isUnlocking}
              <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              Unlocking...
            {:else}
              🔓 Unlock Agent
            {/if}
          </button>
        </div>
      {/if}
    </div>

    <!-- Disconnect Button -->
    <button
      on:click={handleDisconnect}
      class="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-xl transition-colors"
    >
      Disconnect
    </button>
  {/if}
</div>
