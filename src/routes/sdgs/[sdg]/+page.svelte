<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import type { HoloSphere } from "holosphere";
  import { getSdgByCode, getSdgHolonId } from '$lib/sdgs';
  import { fetchHolonName } from '../../../utils/holonNames';

  const holosphere = getContext('holosphere') as HoloSphere;

  let sdgCode: string = '';
  let sdg: ReturnType<typeof getSdgByCode>;
  let sdgHolonId = '';
  let loading = true;
  let error = '';
  let federatedHolons: Array<{ id: string; name: string }>=[];

  let showAddDialog = false;
  let newHolonId = '';
  let newHolonName = '';
  let saving = false;
  let autoRefresh: any = null;

  $: sdgCode = ($page as any).params.sdg as string;
  $: sdg = getSdgByCode(sdgCode);
  $: sdgHolonId = sdg ? getSdgHolonId(sdg) : '';

  onMount(() => {
    (async () => {
      if (!sdg || !holosphere) { loading = false; return; }
      await ensureSdgHolon();
      await loadFederated();
    })();
    // Keep the list in sync if federation changes elsewhere
    const onFocus = () => { loadFederated(); };
    window.addEventListener('focus', onFocus);
    autoRefresh = setInterval(() => { if (!loading && !saving) loadFederated(); }, 15000);
    return () => {
      window.removeEventListener('focus', onFocus);
      if (autoRefresh) clearInterval(autoRefresh);
    };
  });

  async function ensureSdgHolon() {
    try {
      await holosphere.put(sdgHolonId, 'settings', { name: `SDG ${sdg?.number}: ${sdg?.title}` });
    } catch (e) {
      // non-fatal
    }
  }

  async function loadFederated() {
    loading = true; error = '';
    try {
      // Read member holons from the 'members' lens
      const members = await holosphere.get(sdgHolonId, 'members') || [];
      const memberArray = Array.isArray(members) ? members : [];
      const ids = memberArray.map((m: any) => m.holonId || m.id).filter(Boolean);
      const unique = Array.from(new Set(ids));
      federatedHolons = await Promise.all(unique.map(async (id) => ({ id, name: await fetchHolonName(holosphere, id) })));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load member holons';
    } finally {
      loading = false;
    }
  }

  async function addFederation() {
    if (!newHolonId.trim()) return;
    saving = true; error='';
    try {
      await ensureSdgHolon();
      // Add as a member using simple data storage
      const holonId = newHolonId.trim();
      await holosphere.put(sdgHolonId, 'members', {
        id: holonId,
        holonId: holonId,
        addedAt: Date.now()
      });
      showAddDialog = false;
      newHolonName = '';
      newHolonId = '';
      await loadFederated();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to add member';
    } finally {
      saving = false;
    }
  }

  function openHolon(id: string) {
    goto(`/${id}`);
  }

  async function createHolon() {
    if (!newHolonName.trim()) return;
    const id = newHolonId.trim() || newHolonName.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,64);
    try {
      // Create the new holon with a name
      await holosphere.put(id, 'settings', { name: newHolonName.trim() });
      // Add as a member of this SDG
      await holosphere.put(sdgHolonId, 'members', {
        id: id,
        holonId: id,
        addedAt: Date.now()
      });
      showAddDialog = false; newHolonId = ''; newHolonName = '';
      await loadFederated();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to create holon';
    }
  }
</script>

{#if !sdg}
  <div class="p-6">Invalid SDG.</div>
{:else}
  <div class="p-6 space-y-8">
    <div class="flex items-center gap-4">
      <div class="w-20 h-20 rounded-xl overflow-hidden ring-1 ring-white/10 shadow-sm relative">
        <img alt={`SDG ${sdg.number}`} src={sdg.imageLocal} on:error={(e)=>{(e.currentTarget as HTMLImageElement).src=sdg.imageRemote||''}} class="absolute inset-0 w-full h-full object-cover block"/>
      </div>
      <div>
        <div class="text-xs text-gray-400 uppercase tracking-wide">Goal {sdg.number}</div>
        <h1 class="text-3xl font-semibold text-gray-100">{sdg.title}</h1>
        <div class="text-xs text-gray-400">Holon: {sdgHolonId}</div>
      </div>
    </div>

    <div class="flex items-center justify-between">
      <h2 class="text-2xl font-medium text-gray-100">Federated holons</h2>
      <div class="flex gap-2">
        <button class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm" on:click={() => showAddDialog = true}>Add / Create</button>
        <button class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-100 ring-1 ring-white/10" on:click={loadFederated} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
    </div>

    {#if error}
      <div class="p-3 rounded-lg bg-red-500/20 text-red-200 ring-1 ring-red-500/30">{error}</div>
    {/if}

    {#if loading}
      <div class="p-6 text-sm text-gray-400">Loading…</div>
    {:else if federatedHolons.length === 0}
      <div class="p-6 text-sm text-gray-400">No federated holons yet.</div>
    {:else}
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {#each federatedHolons as h}
          <button class="text-left p-4 rounded-2xl bg-gray-800 hover:bg-gray-700 transition ring-1 ring-white/10 shadow-sm" on:click={() => openHolon(h.id)}>
            <div class="text-xs text-gray-400">{h.id}</div>
            <div class="font-medium text-gray-100">{h.name}</div>
          </button>
        {/each}
      </div>
    {/if}

    {#if showAddDialog}
      <div class="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
        <div class="w-full max-w-lg rounded-2xl bg-gray-900 ring-1 ring-white/10 p-6 space-y-5 shadow-xl">
          <div class="text-lg font-semibold text-gray-100">Add or create a holon</div>
          <div class="grid gap-4">
            <div>
              <label class="block text-sm text-gray-300 mb-1" for="sdg-existing-holon">Existing holon ID</label>
              <input id="sdg-existing-holon" class="w-full rounded-lg bg-gray-800 px-3 py-2 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="e.g. my-holon" bind:value={newHolonId} />
            </div>
            <div class="text-xs text-gray-400">— or —</div>
            <div>
              <label class="block text-sm text-gray-300 mb-1" for="sdg-new-holon">New holon name</label>
              <input id="sdg-new-holon" class="w-full rounded-lg bg-gray-800 px-3 py-2 ring-1 ring-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" placeholder="Human name for a new holon" bind:value={newHolonName} />
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <button class="px-3 py-2 rounded-lg bg-gray-800 ring-1 ring-white/10 text-gray-100 hover:bg-gray-700" on:click={() => { showAddDialog = false; newHolonId=''; newHolonName=''; }} disabled={saving}>Cancel</button>
            <button class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white" on:click={addFederation} disabled={saving || (!newHolonId && !newHolonName)}>Add</button>
            {#if newHolonName}
              <button class="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white" on:click={createHolon} disabled={saving}>Create</button>
            {/if}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}


