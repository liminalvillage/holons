<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';
    import {
        type ExpirationPreset,
        EXPIRATION_OPTIONS,
        getMinExpirationDate
    } from '../lib/capabilities/lensCapability';

    const dispatch = createEventDispatcher<{
        select: { preset: ExpirationPreset; customDate?: string };
        cancel: void;
    }>();

    export let selectedPreset: ExpirationPreset = 'permanent';
    export let customDate: string = '';
    export let showModal: boolean = false;

    function selectPreset(preset: ExpirationPreset) {
        selectedPreset = preset;
        if (preset !== 'custom') {
            customDate = '';
        }
    }

    function confirm() {
        dispatch('select', {
            preset: selectedPreset,
            customDate: selectedPreset === 'custom' ? customDate : undefined
        });
    }

    function cancel() {
        dispatch('cancel');
    }

    function getPresetIcon(preset: ExpirationPreset): string {
        switch (preset) {
            case 'permanent': return '∞';
            case '30days': return '30';
            case '1year': return '1Y';
            case 'custom': return '...';
            default: return '?';
        }
    }

    $: isValid = selectedPreset !== 'custom' || (customDate && new Date(customDate) > new Date());
</script>

{#if showModal}
    <div
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        transition:fade={{ duration: 150 }}
        on:click|self={cancel}
        on:keydown={(e) => e.key === 'Escape' && cancel()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="expiration-title"
    >
        <div class="bg-gray-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl border border-gray-700">
            <h3 id="expiration-title" class="text-lg font-semibold text-white mb-4">
                Choose Expiration
            </h3>

            <div class="grid grid-cols-2 gap-3 mb-4">
                {#each EXPIRATION_OPTIONS as option}
                    <button
                        type="button"
                        on:click={() => selectPreset(option.value)}
                        class="relative px-4 py-3 rounded-lg text-sm transition-all duration-150 flex flex-col items-center justify-center gap-1 border-2"
                        class:bg-blue-600={selectedPreset === option.value}
                        class:border-blue-500={selectedPreset === option.value}
                        class:text-white={selectedPreset === option.value}
                        class:bg-gray-700={selectedPreset !== option.value}
                        class:border-gray-600={selectedPreset !== option.value}
                        class:text-gray-300={selectedPreset !== option.value}
                        class:hover:bg-gray-600={selectedPreset !== option.value}
                        class:hover:border-gray-500={selectedPreset !== option.value}
                    >
                        <span class="text-lg font-bold">{getPresetIcon(option.value)}</span>
                        <span class="font-medium">{option.label}</span>
                    </button>
                {/each}
            </div>

            {#if selectedPreset === 'custom'}
                <div class="mb-4" transition:fade={{ duration: 100 }}>
                    <label for="custom-date" class="block text-sm font-medium text-gray-300 mb-2">
                        Expiration Date
                    </label>
                    <input
                        id="custom-date"
                        type="date"
                        bind:value={customDate}
                        min={getMinExpirationDate()}
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {#if customDate && new Date(customDate) <= new Date()}
                        <p class="text-red-400 text-sm mt-1">Date must be in the future</p>
                    {/if}
                </div>
            {/if}

            <div class="flex gap-3">
                <button
                    type="button"
                    on:click={cancel}
                    class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    on:click={confirm}
                    disabled={!isValid}
                    class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Confirm
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- Inline variant (non-modal) -->
{#if !showModal}
    <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2">
            {#each EXPIRATION_OPTIONS as option}
                <button
                    type="button"
                    on:click={() => selectPreset(option.value)}
                    class="px-3 py-2 rounded-lg text-sm transition-all duration-150 flex items-center justify-center gap-2 border"
                    class:bg-blue-600={selectedPreset === option.value}
                    class:border-blue-500={selectedPreset === option.value}
                    class:text-white={selectedPreset === option.value}
                    class:bg-gray-700={selectedPreset !== option.value}
                    class:border-gray-600={selectedPreset !== option.value}
                    class:text-gray-300={selectedPreset !== option.value}
                    class:hover:bg-gray-600={selectedPreset !== option.value}
                >
                    <span class="font-bold">{getPresetIcon(option.value)}</span>
                    <span>{option.label}</span>
                </button>
            {/each}
        </div>

        {#if selectedPreset === 'custom'}
            <div transition:fade={{ duration: 100 }}>
                <input
                    type="date"
                    bind:value={customDate}
                    min={getMinExpirationDate()}
                    class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
            </div>
        {/if}
    </div>
{/if}
