<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolveName, resolveHologramSource, extractHolonIdFromSoul } from '$lib/stores/nameResolver';
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import Modal from "./shared/Modal.svelte";
    import ItemCard from "./shared/ItemCard.svelte";
    import GenericImportModal from "./shared/GenericImportModal.svelte";
    import { ShoppingCart, Trash2, RefreshCw } from 'svelte-feathers';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";
    import { loadFilters, saveFilters } from "$lib/util/persistedFilters";

    interface ShoppingItem {
        id: string;
        text: string;
        checked: boolean;
        _hologram?: { isHologram?: boolean; sourceHolon?: string; soul?: string };
        _federation?: { origin?: string; sourceLens?: string };
        [key: string]: any;
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    let holonID: string = '';
    let store: Record<string, ShoppingItem> = {};
    let unsubscribeFn: (() => void) | undefined;

    // Persisted toolbar state — shared across features via the same keys.
    let filters = loadFilters('shopping', {
        searchQuery: '',
        showFederated: false,
        showHolograms: true,
    });
    $: saveFilters('shopping', filters);

    $: shoppingItems = Object.entries(store)
        .filter(([_, item]) => item && item.id && !item._deleted)
        .map(([key, item]) => ({ ...item, _key: key }));

    // Toolbar filters: hide holograms when toggled off; hide federated items when
    // the federated toggle is off (federated items carry the hologram marker).
    $: visibleItems = shoppingItems.filter((item) => {
        const isHologram = item._hologram?.isHologram === true;
        if (!filters.showHolograms && isHologram) return false;
        if (!filters.showFederated && isHologram) return false;
        const q = filters.searchQuery.trim().toLowerCase();
        if (q && !(item.text ?? '').toLowerCase().includes(q)) return false;
        return true;
    });

    $: pendingItems = visibleItems.filter(item => !item.checked);
    $: completedItems = visibleItems.filter(item => item.checked);

    let showAddModal = false;
    let inputText = "";

    async function fetchData() {
        if (!holosphere || !holonID) return;

        if (unsubscribeFn) {
            unsubscribeFn();
            unsubscribeFn = undefined;
        }

        store = {};

        try {
            if (filters.showFederated) {
                await fetchFederatedShopping();
            } else {
                await fetchLocalShopping();
            }
        } catch (error) {
            console.error('Error fetching shopping list:', error);
        }
    }

    async function fetchLocalShopping() {
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
    }

    async function fetchFederatedShopping() {
        const federatedData = await holosphere.getFederated(holonID, "shopping", {
            includeLocal: true,
            includeFederated: true,
            resolveReferences: true,
            aggregate: false
        });

        const newStore: Record<string, ShoppingItem> = {};
        if (Array.isArray(federatedData)) {
            federatedData.forEach((item: any, index: number) => {
                if (item && item.id && !item._deleted) {
                    const key = item.key || item.id || `fed_${index}`;
                    const processed: any = { ...item, id: item.id };
                    if (item._federation) processed._federation = item._federation;
                    if (item._hologram) processed._hologram = item._hologram;
                    newStore[key] = processed;
                }
            });
        }
        store = newStore;
    }

    let lastShoppingFedFlag = filters.showFederated;
    $: if (holonID && holosphere && filters.showFederated !== lastShoppingFedFlag) {
        lastShoppingFedFlag = filters.showFederated;
        fetchData();
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
        showAddModal = true;
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
            showAddModal = false;
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

    function hologramSource(item: ShoppingItem): string {
        const soul = item._hologram?.soul;
        if (!soul) return item._hologram?.sourceHolon ?? '';
        resolveHologramSource(soul);
        const holonId = extractHolonIdFromSoul(soul);
        if (!holonId) return '';
        return $nameMap[holonId] ?? holonId.slice(0, 8);
    }

    function hologramHolonId(item: ShoppingItem): string {
        const soul = item._hologram?.soul;
        if (soul) {
            const id = extractHolonIdFromSoul(soul);
            if (id) return id;
        }
        return item._hologram?.sourceHolon ?? '';
    }

    function federationSource(item: ShoppingItem): string {
        const origin = item._federation?.origin;
        if (!origin) return '';
        resolveName(origin);
        return resolvedName(origin, $nameMap);
    }

    let showImportModal = false;

    async function handleImport(event: CustomEvent<any[]>) {
        if (!holonID) return;
        const items = event.detail;
        try {
            for (let i = 0; i < items.length; i++) {
                const raw = items[i] ?? {};
                const text = String(raw.text ?? raw.title ?? raw.name ?? raw.description ?? '').trim();
                if (!text) continue;
                const newItem: ShoppingItem = {
                    id: raw.id ?? `${Date.now()}-${i}`,
                    text,
                    checked: Boolean(raw.checked) || false
                };
                await holosphere.put(holonID, "shopping", newItem);
            }
            showImportModal = false;
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to import shopping items:", error);
            }
        }
    }
</script>

<div class="space-y-4">
    <TitleBar holonName={resolvedName(holonID, $nameMap, null, 'Loading...')} title="Shopping List" icon={ShoppingCart} />

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
                    <span class="stats-bar__value">{visibleItems.length}</span>
                    <span class="stats-bar__label">Total</span>
                </div>
            </div>

            <!-- Shared toolbar: Add / Search / Federated / Holograms + list-specific actions -->
            <FeatureToolbar
                onAdd={showAddInput}
                addLabel="Add Item"
                onImport={() => (showImportModal = true)}
                importLabel="Import"
                bind:searchQuery={filters.searchQuery}
                searchPlaceholder="Search items…"
                bind:showFederated={filters.showFederated}
                bind:showHolograms={filters.showHolograms}
            >
                <svelte:fragment slot="actions">
                    <button
                        type="button"
                        class="icon-btn"
                        on:click={clearAll}
                        aria-label="Uncheck all items"
                        title="Uncheck all items"
                    >
                        <RefreshCw size="14" />
                    </button>
                    <button
                        type="button"
                        class="icon-btn icon-btn--danger"
                        on:click={removeChecked}
                        aria-label="Remove checked items"
                        title="Remove checked items"
                    >
                        <Trash2 size="14" />
                    </button>
                </svelte:fragment>
            </FeatureToolbar>

            <!-- Shopping Items -->
            <div class="space-y-3 mt-4">
                {#each visibleItems as item (item.id)}
                    {@const isHolo = item._hologram?.isHologram === true}
                    {@const fedOrigin = !isHolo && item._federation?.origin && item._federation.origin !== holonID ? item._federation.origin : ''}
                    {@const holoId = isHolo ? hologramHolonId(item) : ''}
                    <ItemCard
                        clickable
                        completed={item.checked}
                        isHologram={isHolo}
                        isFederated={!isHolo && !!fedOrigin}
                        sourceHolon={isHolo ? hologramSource(item) : (fedOrigin ? federationSource(item) : '')}
                        sourceHref={isHolo && holoId ? `/${holoId}/shopping` : (fedOrigin ? `/${fedOrigin}/shopping` : '')}
                        on:click={() => toggleItemStatus(item)}
                    >
                        <div class="flex items-center justify-between gap-3 w-full">
                            <div class="flex items-center gap-3 flex-1 min-w-0">
                                <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center">
                                    <span class="text-sm">{item.checked ? '✅' : '🛒'}</span>
                                </div>
                                <h3
                                    class="text-base font-bold truncate"
                                    class:text-gray-400={item.checked}
                                    class:line-through={item.checked}
                                    class:text-white={!item.checked}
                                >
                                    {item.text}
                                </h3>
                            </div>
                            <div class="flex items-center gap-3 flex-shrink-0">
                                <input
                                    type="checkbox"
                                    checked={item.checked}
                                    readonly
                                    class="w-5 h-5 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-2 pointer-events-none"
                                />
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
                    </ItemCard>
                {/each}

                {#if visibleItems.length === 0}
                    <div class="empty-state">
                        <div class="empty-state__icon">
                            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                        </div>
                        <h3 class="empty-state__title">
                            {shoppingItems.length === 0 ? 'No items yet' : 'No items match filters'}
                        </h3>
                        <p class="empty-state__description">
                            {shoppingItems.length === 0 ? 'Get started by adding your first item' : 'Try adjusting the search or toggles above'}
                        </p>
                        {#if shoppingItems.length === 0}
                            <button on:click={showAddInput} class="btn btn--primary">Add Item</button>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<Modal bind:open={showAddModal} title="Add New Item" size="sm">
    <form on:submit|preventDefault={handleAdd} class="space-y-4">
        <div>
            <label for="item-name" class="block text-sm font-medium text-gray-300 mb-2">Item name</label>
            <input
                id="item-name"
                type="text"
                bind:value={inputText}
                placeholder="Enter item name…"
                class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                required
            />
        </div>
        <div class="flex justify-end gap-3 pt-4">
            <button type="button" on:click={() => (showAddModal = false)} class="btn btn--secondary">Cancel</button>
            <button type="submit" class="btn btn--primary" disabled={!inputText.trim()}>Add item</button>
        </div>
    </form>
</Modal>

<GenericImportModal
    bind:open={showImportModal}
    title="Import Shopping Items"
    itemNoun="items"
    helpText="Paste a JSON array, or one item per line. Required: text."
    sampleJson={`[
  { "text": "Milk" },
  { "text": "Bread", "checked": false },
  { "text": "Apples" }
]`}
    on:import={handleImport}
    on:close={() => (showImportModal = false)}
/>
