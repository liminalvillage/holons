<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import TitleBar from "./shared/TitleBar.svelte";
    import { ShoppingCart, Plus } from 'svelte-feathers';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";

    interface ShoppingItem {
        id: string;
        text: string;
        checked: boolean;
        [key: string]: any;
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    let holonID: string = '';
    let store: Record<string, ShoppingItem> = {};
    let unsubscribeFn: (() => void) | undefined;

    $: shoppingItems = Object.entries(store)
        .filter(([_, item]) => item && item.id && !item._deleted)
        .map(([key, item]) => ({ ...item, _key: key }));

    $: pendingItems = shoppingItems.filter(item => !item.checked);
    $: completedItems = shoppingItems.filter(item => item.checked);

    let showInput = false;
    let inputText = "";

    async function fetchData() {
        if (!holosphere || !holonID) return;

        if (unsubscribeFn) {
            unsubscribeFn();
            unsubscribeFn = undefined;
        }

        store = {};

        try {
            // Load initial data
            const initialData = await holosphere.getAll(holonID, "shopping");

            const newStore: Record<string, ShoppingItem> = {};
            if (Array.isArray(initialData)) {
                initialData.forEach((item: any) => {
                    if (item && item.id && !item._deleted) {
                        newStore[item.id] = item;
                    }
                });
            } else if (typeof initialData === 'object' && initialData !== null) {
                Object.entries(initialData).forEach(([key, item]: [string, any]) => {
                    if (item && item.id && !item._deleted) {
                        newStore[key] = item;
                    }
                });
            }
            store = newStore;

            // Subscribe for real-time updates
            const subscription = await holosphere.subscribe(
                holonID,
                "shopping",
                (newItem: ShoppingItem | null, key?: string) => {
                    if (!key) return;
                    if (newItem && newItem.id && !newItem._deleted) {
                        store[key] = newItem;
                        store = store;
                    } else {
                        delete store[key];
                        store = store;
                    }
                }
            );

            if (typeof subscription === 'function') {
                unsubscribeFn = subscription;
            } else if (subscription && typeof subscription === 'object' && 'unsubscribe' in subscription) {
                unsubscribeFn = (subscription as any).unsubscribe;
            }
        } catch (error) {
            console.error('Error fetching shopping list:', error);
        }
    }

    onMount(() => {
        return () => {
            if (unsubscribeFn) unsubscribeFn();
        };
    });

    let currentHolonId: string | null = null;
    $: {
        const newId = $page.params.id;
        if (newId && newId !== 'undefined' && newId !== 'null' && newId.trim() !== '' &&
            holosphere && newId !== currentHolonId) {
            currentHolonId = newId;
            holonID = newId;
            ID.set(newId);
            fetchData();
            resolveName(newId);
        }
    }

    async function toggleItemStatus(item: ShoppingItem & { _key: string }): Promise<void> {
        if (!holonID) return;

        try {
            const updated = { ...item, checked: !item.checked };
            delete (updated as any)._key;
            await holosphere.put(holonID, "shopping", updated);
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to toggle item:", error);
            }
        }
    }

    function showAddInput() {
        inputText = "";
        showInput = true;
    }

    async function handleAdd(): Promise<void> {
        if (!inputText.trim() || !holonID) return;

        try {
            const newItem: ShoppingItem = {
                id: Date.now().toString(),
                text: inputText.trim(),
                checked: false
            };

            await holosphere.put(holonID, "shopping", newItem);
            showInput = false;
            inputText = "";
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to add item:", error);
            }
        }
    }

    async function removeItem(item: ShoppingItem & { _key: string }): Promise<void> {
        if (!holonID) return;

        try {
            await holosphere.delete(holonID, "shopping", item.id);
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to remove item:", error);
            }
        }
    }

    async function removeChecked(): Promise<void> {
        if (!holonID) return;
        const checked = shoppingItems.filter(item => item.checked);
        if (checked.length === 0) return;

        try {
            for (const item of checked) {
                await holosphere.delete(holonID, "shopping", item.id);
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to remove checked items:", error);
            }
        }
    }

    async function clearAll(): Promise<void> {
        if (!holonID) return;
        const checked = shoppingItems.filter(item => item.checked);
        if (checked.length === 0) return;

        try {
            for (const item of checked) {
                const updated = { ...item, checked: false };
                delete (updated as any)._key;
                await holosphere.put(holonID, "shopping", updated);
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to clear checklist:", error);
            }
        }
    }
</script>

<div class="space-y-4">
    <!-- TitleBar -->
    <TitleBar holonName={resolvedName(holonID, $nameMap, null, 'Loading...')} title="Shopping List" icon={ShoppingCart} />

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">
            <!-- Stats Bar -->
            <div class="stats-bar mb-4">
                <div class="stats-bar__item">
                    <span class="stats-bar__value">{pendingItems.length}</span>
                    <span class="stats-bar__label">Pending</span>
                </div>
                <div class="stats-bar__divider"></div>
                <div class="stats-bar__item stats-bar__item--success">
                    <span class="stats-bar__value">{completedItems.length}</span>
                    <span class="stats-bar__label">Done</span>
                </div>
                <div class="stats-bar__divider"></div>
                <div class="stats-bar__item">
                    <span class="stats-bar__value">{shoppingItems.length}</span>
                    <span class="stats-bar__label">Total</span>
                </div>
            </div>

            <!-- Controls Row -->
            <div class="controls-row mb-4">
                <div class="controls-row__left">
                    <button
                        on:click={showAddInput}
                        class="btn btn--primary"
                        aria-label="Add new item"
                    >
                        <Plus size={16} />
                        <span class="hidden sm:inline">Add</span>
                    </button>
                </div>

                <div class="controls-row__right">
                    <button
                        on:click={clearAll}
                        class="btn btn--secondary"
                        aria-label="Clear all checkmarks"
                        title="Uncheck all items"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                        </svg>
                        <span class="hidden sm:inline">Clear All</span>
                    </button>

                    <button
                        on:click={removeChecked}
                        class="btn btn--secondary"
                        aria-label="Remove checked items"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                        </svg>
                        <span class="hidden sm:inline">Remove Checked</span>
                    </button>
                </div>
            </div>

            <!-- Shopping Items -->
            <div class="space-y-3">
                {#each shoppingItems as item (item.id)}
                    <div class="w-full">
                        <div
                            class="p-4 rounded-xl transition-all duration-300 border hover:shadow-md cursor-pointer transform hover:scale-[1.002]"
                            class:bg-gray-800={item.checked}
                            class:border-gray-700={item.checked}
                            class:opacity-70={item.checked}
                            class:bg-gray-700={!item.checked}
                            class:border-transparent={!item.checked}
                            class:hover:bg-gray-600={!item.checked}
                            class:hover:border-gray-500={!item.checked}
                            on:click={() => toggleItemStatus(item)}
                            on:keydown={(e) => e.key === 'Enter' && toggleItemStatus(item)}
                            role="button"
                            tabindex="0"
                            aria-label={`Toggle ${item.text} - ${item.checked ? 'completed' : 'pending'}`}
                        >
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex items-center gap-3 flex-1 min-w-0">
                                    <!-- Item Icon -->
                                    <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center">
                                        <span class="text-sm">{item.checked ? '✅' : '🛒'}</span>
                                    </div>

                                    <!-- Main Content -->
                                    <div class="flex-1 min-w-0">
                                        <h3 class="text-base font-bold truncate" class:text-gray-400={item.checked} class:line-through={item.checked} class:text-white={!item.checked}>
                                            {item.text}
                                        </h3>
                                    </div>
                                </div>

                                <!-- Right Side - Actions -->
                                <div class="flex items-center gap-3 flex-shrink-0">
                                    <div class="flex items-center">
                                        <input
                                            type="checkbox"
                                            checked={item.checked}
                                            readonly
                                            class="w-5 h-5 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-2 pointer-events-none"
                                        />
                                    </div>
                                    <button
                                        on:click|stopPropagation={() => removeItem(item)}
                                        class="text-gray-300 hover:text-red-400 hover:bg-red-500/20 p-2 rounded-lg transition-all duration-200 bg-gray-600/50"
                                        aria-label="Remove item"
                                        title="Delete item"
                                    >
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}

                {#if shoppingItems.length === 0}
                    <div class="text-center py-12">
                        <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                            <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                        </div>
                        <h3 class="text-lg font-medium text-white mb-2">No items found</h3>
                        <p class="text-gray-400 mb-4">Get started by adding your first item</p>
                        <button
                            on:click={showAddInput}
                            class="btn btn--primary"
                        >
                            Add Item
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

{#if showInput}
    <div
        class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        on:click|self={() => showInput = false}
        on:keydown|self={(e) => e.key === 'Escape' && (showInput = false)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative border border-gray-700"
            aria-labelledby="item-input-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="item-input-title" class="text-white text-xl font-bold">Add New Item</h3>
                    <button
                        on:click={() => showInput = false}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close item input dialog"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>

                <form
                    on:submit|preventDefault={handleAdd}
                    class="space-y-4"
                >
                    <div>
                        <label for="item-name" class="block text-sm font-medium text-gray-300 mb-2">Item Name</label>
                        <input
                            id="item-name"
                            type="text"
                            bind:value={inputText}
                            placeholder="Enter item name..."
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            required
                        />
                    </div>
                    <div class="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            on:click={() => showInput = false}
                            class="btn btn--secondary"
                            aria-label="Cancel adding item"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="btn btn--primary"
                            disabled={!inputText.trim()}
                            aria-label="Add new item"
                        >
                            Add Item
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}
