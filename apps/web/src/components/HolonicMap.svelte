<script lang="ts">
    import { getContext, createEventDispatcher} from "svelte";
    import { ID } from "../dashboard/store";
    import Map from "./Map.svelte";
    import MapSidebar from "./MapSidebar.svelte";
    import type { HoloSphere } from "holosphere";

    const dispatch = createEventDispatcher();
    const holosphere = getContext('holosphere') as HoloSphere;

    type LensType = 'quests' | 'needs' | 'offers' | 'communities' | 'organizations' | 'projects' | 'currencies' | 'people' | 'holons';
    let selectedLens: LensType = 'quests';
    let hexId: string | undefined;
    
    export let id: string | undefined = undefined;

    // Initialize with provided ID if available
    $: if (id !== undefined && id !== $ID) {
        console.log(`[HolonicMap] Initializing with ID: ${id}`);
        ID.set(id);
    }

    // Listen to ID store changes
    $: if ($ID !== hexId) {
        hexId = $ID ?? undefined;
        console.log(`[HolonicMap] ID changed to: ${hexId}`);
    }

    const lensOptions: Array<{value: LensType, label: string}> = [
        { value: 'quests', label: 'Tasks' },
        { value: 'needs', label: 'Local Needs' },
        { value: 'offers', label: 'Offers' },
        { value: 'communities', label: 'Communities' },
        { value: 'organizations', label: 'Organizations' },
        { value: 'projects', label: 'Projects' },
        { value: 'currencies', label: 'Currencies' },
        { value: 'people', label: 'People' },
        { value: 'holons', label: 'Holons' }
    ];
</script>

<div class="flex flex-wrap">
    <div class="w-full lg:w-8/12 bg-gray-800 py-6 px-6 rounded-3xl map-container">
        <div class="flex justify-end text-white items-center mb-8">
            <!-- Lens Selector -->
            <div class="lens-selector">
                <label for="lens-select">Lens:</label>
                <select id="lens-select" bind:value={selectedLens}>
                    {#each lensOptions as option}
                        <option value={option.value}>{option.label}</option>
                    {/each}
                </select>
            </div>
        </div>

        <div class="view-content">
            <!-- Map Component -->
            <Map 
                {selectedLens}
                isVisible={true}
                on:holonChange
            />
        </div>
    </div>

    <MapSidebar 
        {selectedLens}
        {hexId}
    />
</div>

<style>
    .map-container {
        height: calc(100vh - 64px - 2rem);
        display: flex;
        flex-direction: column;
    }

    .view-content {
        flex: 1;
        position: relative;
        overflow: hidden;
        border-radius: 1.5rem;
    }

    .lens-selector {
        background-color: transparent;
        padding: 0;
        box-shadow: none;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .lens-selector label {
        font-size: 14px;
        font-weight: 500;
        color: white;
    }

    .lens-selector select {
        padding: 5px 10px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 9999px;
        font-size: 14px;
        background-color: rgba(255, 255, 255, 0.1);
        color: white;
        cursor: pointer;
        min-width: 120px;
    }
</style> 