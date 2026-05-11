<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import Modal from "./shared/Modal.svelte";
    import ItemCard from "./shared/ItemCard.svelte";
    import GenericImportModal from "./shared/GenericImportModal.svelte";
    import { ShoppingCart, Trash2, RefreshCw } from 'svelte-feathers';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";
    import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
    import { showFederated, showHolograms, passesLensFilters } from "$lib/stores/lensFilters";
    import SourceBadge from "./shared/SourceBadge.svelte";

    // Storage layout matches HolonsBot: a single container document under the
    // `checklists` collection with id `shopping`, holding all items in `items[]`.
    const SHOPPING_KEY = 'shopping';
    const CHECKLISTS_COLLECTION = 'checklists';

    interface ShoppingItem {
        id: string | number;
        text: string;
        checked: boolean;
        createdBy?: number;
        _hologram?: { isHologram?: boolean; sourceHolon?: string; soul?: string };
        _federation?: { origin?: string; sourceLens?: string };
        [key: string]: any;
    }

    interface ShoppingChecklist {
        id: string;
        type: string;
        title: string;
        items: ShoppingItem[];
        createdAt: number;
        _hologram?: { isHologram?: boolean; sourceHolon?: string; soul?: string };
        _federation?: { origin?: string; sourceLens?: string };
        [key: string]: any;
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    let holonID: string = '';
    let localList: ShoppingChecklist | null = null;
    let federatedItems: ShoppingItem[] = [];
    let unsubscribeFn: (() => void) | undefined;

    let filters = loadFilters('shopping', {
        searchQuery: '',
    });
    $: saveFilters('shopping', filters);

    function emptyChecklist(): ShoppingChecklist {
        return {
            id: SHOPPING_KEY,
            type: 'shopping',
            title: 'Shopping List',
            items: [],
            createdAt: Date.now()
        };
    }

    function normalizeChecklist(data: any): ShoppingChecklist | null {
        if (!data || data._deleted) return null;
        return {
            id: SHOPPING_KEY,
            type: data.type ?? 'shopping',
            title: data.title ?? 'Shopping List',
            items: Array.isArray(data.items)
                ? data.items.filter((i: any) => i && i.id != null && !i._deleted)
                : [],
            createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
            _hologram: data._hologram,
            _federation: data._federation
        };
    }

    function isShoppingDoc(doc: any, key?: string): boolean {
        if (!doc) return false;
        if (key === SHOPPING_KEY) return true;
        return doc.id === SHOPPING_KEY || doc.type === 'shopping';
    }

    $: localItems = (localList?.items ?? []).map(item => ({ ...item, _key: String(item.id) }));
    $: shoppingItems = $showFederated
        ? [...localItems, ...federatedItems.map(item => ({ ...item, _key: `fed:${item._federation?.origin ?? ''}:${item.id}` }))]
        : localItems;

    $: visibleItems = shoppingItems.filter((item) => {
        if (!passesLensFilters(item as any, $showHolograms, $showFederated)) return false;
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

        localList = null;
        federatedItems = [];

        try {
            await fetchLocalShopping();
            if ($showFederated) {
                await fetchFederatedShopping();
            }
        } catch (error) {
            console.error('Error fetching shopping list:', error);
        }
    }

    async function fetchLocalShopping() {
        const data = await holosphere.get(holonID, CHECKLISTS_COLLECTION, SHOPPING_KEY);
        localList = normalizeChecklist(data);

        // Subscribe to the checklists collection; pluck out shopping updates only.
        // The bot writes the whole container on every mutation, so a single
        // callback per write is enough to refresh the list.
        const subscription = await holosphere.subscribe(
            holonID,
            CHECKLISTS_COLLECTION,
            (doc: any, key?: string) => {
                if (!isShoppingDoc(doc, key) && key !== SHOPPING_KEY) return;
                if (!doc || doc._deleted) {
                    if (key === SHOPPING_KEY || (doc && doc.id === SHOPPING_KEY)) {
                        localList = null;
                    }
                    return;
                }
                if (isShoppingDoc(doc, key)) {
                    localList = normalizeChecklist(doc);
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
        const federatedData = await holosphere.getFederated(holonID, CHECKLISTS_COLLECTION, {
            includeLocal: false,
            includeFederated: true,
            resolveReferences: true,
            aggregate: false
        });

        const items: ShoppingItem[] = [];
        if (Array.isArray(federatedData)) {
            for (const doc of federatedData) {
                if (!isShoppingDoc(doc)) continue;
                const docItems = Array.isArray(doc.items) ? doc.items : [];
                for (const item of docItems) {
                    if (!item || item.id == null || item._deleted) continue;
                    const tagged: ShoppingItem = { ...item };
                    if (doc._federation) tagged._federation = doc._federation;
                    if (doc._hologram) tagged._hologram = doc._hologram;
                    items.push(tagged);
                }
            }
        }
        federatedItems = items;
    }

    let lastShoppingFedFlag = $showFederated;
    $: if (holonID && holosphere && $showFederated !== lastShoppingFedFlag) {
        lastShoppingFedFlag = $showFederated;
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

    function isLocalItem(item: ShoppingItem): boolean {
        if (item._hologram?.isHologram) return false;
        const origin = item._federation?.origin;
        if (origin && origin !== holonID) return false;
        return true;
    }

    function ensureLocalList(): ShoppingChecklist {
        if (!localList) localList = emptyChecklist();
        return localList;
    }

    async function saveLocalList(): Promise<void> {
        if (!localList) return;
        await holosphere.put(holonID, CHECKLISTS_COLLECTION, localList);
    }

    function handleWriteError(error: any, fallbackMessage: string): void {
        if (error?.name === 'AuthorizationError') {
            notifyWriteDenied('Unable to save - no write permission for this holon');
        } else {
            console.error(fallbackMessage, error);
        }
    }

    async function toggleItemStatus(item: ShoppingItem & { _key: string }): Promise<void> {
        if (!holonID) return;
        if (!isLocalItem(item)) return;

        try {
            const list = ensureLocalList();
            const target = list.items.find(i => String(i.id) === String(item.id));
            if (!target) return;
            target.checked = !target.checked;
            await saveLocalList();
            localList = { ...list, items: [...list.items] };
        } catch (error) {
            handleWriteError(error, 'Failed to toggle item:');
        }
    }

    function showAddInput() {
        inputText = "";
        showAddModal = true;
    }

    async function handleAdd(): Promise<void> {
        if (!inputText.trim() || !holonID) return;

        try {
            const list = ensureLocalList();
            list.items.push({
                id: Date.now().toString(),
                text: inputText.trim(),
                checked: false
            });
            await saveLocalList();
            localList = { ...list, items: [...list.items] };
            showAddModal = false;
            inputText = "";
        } catch (error) {
            handleWriteError(error, 'Failed to add item:');
        }
    }

    async function removeItem(item: ShoppingItem & { _key: string }): Promise<void> {
        if (!holonID) return;
        if (!isLocalItem(item)) return;

        try {
            const list = ensureLocalList();
            list.items = list.items.filter(i => String(i.id) !== String(item.id));
            await saveLocalList();
            localList = { ...list };
        } catch (error) {
            handleWriteError(error, 'Failed to remove item:');
        }
    }

    async function removeChecked(): Promise<void> {
        if (!holonID || !localList) return;
        if (!localList.items.some(i => i.checked)) return;

        try {
            localList.items = localList.items.filter(i => !i.checked);
            await saveLocalList();
            localList = { ...localList };
        } catch (error) {
            handleWriteError(error, 'Failed to remove checked items:');
        }
    }

    async function clearAll(): Promise<void> {
        if (!holonID || !localList) return;
        if (!localList.items.some(i => i.checked)) return;

        try {
            localList.items = localList.items.map(i => i.checked ? { ...i, checked: false } : i);
            await saveLocalList();
            localList = { ...localList };
        } catch (error) {
            handleWriteError(error, 'Failed to clear checklist:');
        }
    }

    let showImportModal = false;

    async function handleImport(event: CustomEvent<any[]>) {
        if (!holonID) return;
        const items = event.detail;
        try {
            const list = ensureLocalList();
            for (let i = 0; i < items.length; i++) {
                const raw = items[i] ?? {};
                const text = String(raw.text ?? raw.title ?? raw.name ?? raw.description ?? '').trim();
                if (!text) continue;
                list.items.push({
                    id: raw.id ?? `${Date.now()}-${i}`,
                    text,
                    checked: Boolean(raw.checked) || false
                });
            }
            await saveLocalList();
            localList = { ...list, items: [...list.items] };
            showImportModal = false;
        } catch (error) {
            handleWriteError(error, 'Failed to import shopping items:');
        }
    }
</script>

<div class="space-y-4">
    <TitleBar holonName={resolvedName(holonID, $nameMap, null, 'Loading...')} holonId={holonID} showLensFilters title="Shopping List" icon={ShoppingCart} />

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
                    <ItemCard
                        clickable
                        completed={item.checked}
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
                                <SourceBadge {item} currentHolonId={holonID} lensRoute="shopping" />
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
