<!--
  AD4M Neighbourhood Management UI

  Provides controls for:
  - Creating a new neighbourhood from a local perspective
  - Joining an existing neighbourhood by URL
  - Listing current neighbourhoods with shareable URLs

  Only shown when connected to an AD4M executor.

  @component
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { Ad4mConnection } from './connection';
  import type { PerspectiveProxy } from '@coasys/ad4m';

  export let connection: Ad4mConnection;

  // State
  let perspectives: PerspectiveProxy[] = [];
  let neighbourhoods: Array<{ uuid: string; name: string; url: string }> = [];
  let loading = true;
  let error = '';

  // Create neighbourhood
  let showCreate = false;
  let selectedPerspectiveUuid = '';
  let linkLanguages: Array<{ address: string; name: string }> = [];
  let selectedLinkLanguage = '';
  let isPublishing = false;
  let publishResult = '';

  // Join neighbourhood
  let showJoin = false;
  let joinUrl = '';
  let isJoining = false;
  let joinResult = '';

  // Clipboard
  let copiedUrl = '';

  onMount(async () => {
    await refresh();
  });

  async function refresh() {
    loading = true;
    error = '';
    try {
      perspectives = await connection.getAllPerspectives();
      neighbourhoods = perspectives
        .filter((p: any) => p.sharedUrl || p.neighbourhood)
        .map((p: any) => ({
          uuid: p.uuid,
          name: (p as any).name || p.uuid.slice(0, 8),
          url: p.sharedUrl || '',
        }));
    } catch (e: any) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function openCreate() {
    showCreate = true;
    showJoin = false;
    publishResult = '';
    try {
      linkLanguages = await connection.getInstalledLinkLanguages();
      if (linkLanguages.length > 0) {
        selectedLinkLanguage = linkLanguages[0].address;
      }
    } catch (e: any) {
      error = `Failed to load link languages: ${e.message}`;
    }
  }

  async function publishNeighbourhood() {
    if (!selectedPerspectiveUuid) return;
    isPublishing = true;
    publishResult = '';
    error = '';
    try {
      const url = await connection.publishNeighbourhood(
        selectedPerspectiveUuid,
        selectedLinkLanguage || undefined
      );
      publishResult = url;
      showCreate = false;
      await refresh();
    } catch (e: any) {
      error = `Publish failed: ${e.message}`;
    } finally {
      isPublishing = false;
    }
  }

  async function joinNeighbourhood() {
    if (!joinUrl.trim()) return;
    isJoining = true;
    joinResult = '';
    error = '';
    try {
      const perspective = await connection.joinNeighbourhood(joinUrl.trim());
      joinResult = `Joined! Perspective: ${perspective.uuid}`;
      joinUrl = '';
      showJoin = false;
      await refresh();
    } catch (e: any) {
      error = `Join failed: ${e.message}`;
    } finally {
      isJoining = false;
    }
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
    copiedUrl = url;
    setTimeout(() => { copiedUrl = ''; }, 2000);
  }

  // Local perspectives (not yet published)
  $: localPerspectives = perspectives.filter((p: any) => !p.sharedUrl && !p.neighbourhood);
</script>

<div class="space-y-4">
  <div class="flex items-center justify-between">
    <h4 class="text-sm font-medium text-gray-300">Neighbourhoods</h4>
    <div class="flex gap-1">
      <button
        on:click={() => { showJoin = true; showCreate = false; }}
        class="px-2 py-1 text-xs bg-green-600/20 hover:bg-green-600/30 text-green-400 rounded-lg transition-colors"
      >
        Join
      </button>
      <button
        on:click={openCreate}
        class="px-2 py-1 text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-lg transition-colors"
      >
        Create
      </button>
      <button
        on:click={refresh}
        class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-400 rounded-lg transition-colors"
        title="Refresh"
      >
        ↻
      </button>
    </div>
  </div>

  {#if error}
    <div class="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
      <p class="text-xs text-red-400">{error}</p>
    </div>
  {/if}

  {#if publishResult}
    <div class="p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
      <p class="text-xs text-green-400">Published! URL:</p>
      <p class="text-xs text-green-300 font-mono break-all mt-1">{publishResult}</p>
    </div>
  {/if}

  {#if joinResult}
    <div class="p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
      <p class="text-xs text-green-400">{joinResult}</p>
    </div>
  {/if}

  <!-- Join Neighbourhood -->
  {#if showJoin}
    <div class="p-3 bg-gray-800/40 rounded-xl border border-gray-700/50 space-y-2">
      <label for="join-url" class="block text-xs font-medium text-gray-400">Neighbourhood URL</label>
      <input
        id="join-url"
        type="text"
        bind:value={joinUrl}
        placeholder="neighbourhood://..."
        class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:border-green-500 focus:outline-none transition-colors"
      />
      <div class="flex gap-2">
        <button
          on:click={joinNeighbourhood}
          disabled={isJoining || !joinUrl.trim()}
          class="flex-1 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isJoining ? 'Joining...' : 'Join'}
        </button>
        <button
          on:click={() => { showJoin = false; }}
          class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Create Neighbourhood -->
  {#if showCreate}
    <div class="p-3 bg-gray-800/40 rounded-xl border border-gray-700/50 space-y-2">
      <label for="create-perspective" class="block text-xs font-medium text-gray-400">Select Perspective</label>
      <select
        id="create-perspective"
        bind:value={selectedPerspectiveUuid}
        class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white focus:border-blue-500 focus:outline-none transition-colors"
      >
        <option value="">Choose a perspective...</option>
        {#each localPerspectives as p}
          <option value={p.uuid}>{(p as any).name || p.uuid.slice(0, 12)}</option>
        {/each}
      </select>

      {#if linkLanguages.length > 0}
        <label for="create-linklang" class="block text-xs font-medium text-gray-400">Link Language</label>
        <select
          id="create-linklang"
          bind:value={selectedLinkLanguage}
          class="w-full px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white focus:border-blue-500 focus:outline-none transition-colors"
        >
          {#each linkLanguages as ll}
            <option value={ll.address}>{ll.name}</option>
          {/each}
        </select>
      {/if}

      <div class="flex gap-2">
        <button
          on:click={publishNeighbourhood}
          disabled={isPublishing || !selectedPerspectiveUuid}
          class="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPublishing ? 'Publishing...' : 'Publish'}
        </button>
        <button
          on:click={() => { showCreate = false; }}
          class="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  {/if}

  <!-- Neighbourhood List -->
  {#if loading}
    <p class="text-xs text-gray-500">Loading...</p>
  {:else if neighbourhoods.length === 0}
    <p class="text-xs text-gray-500">No neighbourhoods yet. Create or join one above.</p>
  {:else}
    <div class="space-y-2">
      {#each neighbourhoods as nh}
        <div class="p-2 bg-gray-800/30 rounded-lg border border-gray-700/30 flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium text-white">{nh.name}</p>
            <p class="text-[10px] text-gray-500 font-mono truncate" title={nh.url}>{nh.url || 'Local perspective'}</p>
          </div>
          {#if nh.url}
            <button
              on:click={() => copyUrl(nh.url)}
              class="px-2 py-1 text-[10px] bg-gray-700 hover:bg-gray-600 text-gray-400 rounded transition-colors flex-shrink-0"
            >
              {copiedUrl === nh.url ? '✓' : 'Copy'}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
