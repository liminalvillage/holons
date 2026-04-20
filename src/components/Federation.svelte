<script lang="ts">
    import { onMount, onDestroy, getContext } from "svelte";
    import { goto } from "$app/navigation";
    import type { HoloSphere } from "holosphere";
    import { ID } from "../dashboard/store";
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import TitleBar from "./shared/TitleBar.svelte";

    const holosphere = getContext("holosphere") as HoloSphere;

    $: holonName = resolvedName($ID, $nameMap, null, 'Federation');

    interface FederatedEntry {
        id: string;
        name: string;
        addedAt: string;
    }

    let federatedHolons: FederatedEntry[] = [];
    let loading = true;
    let newHolonId = '';
    let error = '';

    let idUnsubscribe: (() => void) | undefined;

    onMount(() => {
        idUnsubscribe = ID.subscribe(async (newId) => {
            if (newId) {
                await loadFederation();
            }
        });
    });

    onDestroy(() => {
        idUnsubscribe?.();
    });

    async function loadFederation() {
        loading = true;
        error = '';
        try {
            const data = await holosphere.get($ID, 'settings', 'federation');
            if (data && data.holons) {
                federatedHolons = data.holons;
                // Resolve names for all federated holons
                federatedHolons.forEach(h => resolveName(h.id));
            } else {
                federatedHolons = [];
            }
        } catch (e) {
            console.error('Error loading federation:', e);
            federatedHolons = [];
        }
        loading = false;
    }

    async function addHolon() {
        const id = newHolonId.trim();
        if (!id) return;
        if (federatedHolons.some(h => h.id === id)) {
            error = 'Already federated';
            return;
        }

        error = '';
        const entry: FederatedEntry = {
            id,
            name: '',
            addedAt: new Date().toISOString()
        };

        federatedHolons = [...federatedHolons, entry];
        newHolonId = '';

        // Resolve name
        resolveName(id);

        // Save to HoloSphere
        await saveFederation();
    }

    async function removeHolon(id: string) {
        federatedHolons = federatedHolons.filter(h => h.id !== id);
        await saveFederation();
    }

    async function saveFederation() {
        try {
            await holosphere.put($ID, 'settings', {
                id: 'federation',
                holons: federatedHolons
            });
        } catch (e) {
            console.error('Error saving federation:', e);
            error = 'Failed to save';
        }
    }

    function browseHolon(id: string) {
        goto(`/${id}/calendar`);
    }
</script>

<TitleBar title={holonName} />

<div class="p-4 max-w-2xl mx-auto">
    <h2 class="text-xl font-bold text-white mb-4">Federation</h2>
    <p class="text-gray-400 text-sm mb-6">Add holons to browse their data. No handshake required.</p>

    <!-- Add holon -->
    <div class="flex gap-2 mb-6">
        <input
            type="text"
            bind:value={newHolonId}
            placeholder="Holon ID (e.g. -1002352632800)"
            class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm focus:outline-none focus:border-indigo-500"
            onkeydown={(e) => e.key === 'Enter' && addHolon()}
        />
        <button
            class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors text-sm font-medium"
            onclick={addHolon}
        >
            Add
        </button>
    </div>

    {#if error}
        <div class="text-red-400 text-sm mb-4">{error}</div>
    {/if}

    <!-- List -->
    {#if loading}
        <div class="text-gray-400 text-center py-8">Loading...</div>
    {:else if federatedHolons.length === 0}
        <div class="text-gray-500 text-center py-8">No federated holons yet. Add one above.</div>
    {:else}
        <div class="space-y-2">
            {#each federatedHolons as holon (holon.id)}
                <div class="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg p-3">
                    <div class="flex-1 min-w-0">
                        <div class="text-white font-medium truncate">
                            {$nameMap[holon.id] || holon.name || holon.id}
                        </div>
                        <div class="text-gray-500 text-xs truncate">{holon.id}</div>
                    </div>
                    <div class="flex gap-2 ml-2">
                        <button
                            class="px-3 py-1 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors text-xs"
                            onclick={() => browseHolon(holon.id)}
                        >
                            Browse
                        </button>
                        <button
                            class="px-3 py-1 bg-red-900 text-red-300 rounded hover:bg-red-800 transition-colors text-xs"
                            onclick={() => removeHolon(holon.id)}
                        >
                            Remove
                        </button>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
