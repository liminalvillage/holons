<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere, ResolvedHologramMeta, FederationMeta } from "holosphere";
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import Modal from "./shared/Modal.svelte";
    import ItemCard from "./shared/ItemCard.svelte";
    import GenericImportModal from "./shared/GenericImportModal.svelte";
    import ShareNeedModal from "./shared/ShareNeedModal.svelte";
    import { ShoppingCart, Trash2, RefreshCw, MapPin } from 'svelte-feathers';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";
    import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
    import { showFederated, showHolograms, showUnverified, passesLensFilters } from "$lib/stores/lensFilters";
    import SourceBadge from "./shared/SourceBadge.svelte";
    import { nostrPublicKey } from "../lib/stores/nostr";
    import { getSelfInitiator } from "$lib/util/usersWithSelf";
    import {
        toggleItem as coreToggleItem,
        removeItem as coreRemoveItem,
        removeChecked as coreRemoveChecked,
        stampNeedId,
        needIdOf,
    } from "@holons/core/shopping";
    import {
        needFromShoppingItem,
        publishNeedNearby,
        refreshPublishedNeed,
        closeNeed,
        normalizeNeed,
        NEED_RECORD_LENS,
        type CloseOutcome,
    } from "@holons/core/needs";

    // Storage layout matches HolonsBot: a single container document under the
    // `checklists` collection with id `shopping`, holding all items in `items[]`.
    const SHOPPING_KEY = 'shopping';
    const CHECKLISTS_COLLECTION = 'checklists';

    interface ShoppingItem {
        id: string | number;
        text: string;
        checked: boolean;
        createdBy?: number;
        /** Id of the published need this item was shared as (see @holons/core/needs). */
        needId?: string;
        _hologram?: ResolvedHologramMeta;
        _federation?: FederationMeta;
        [key: string]: any;
    }

    interface ShoppingChecklist {
        id: string;
        type: string;
        title: string;
        items: ShoppingItem[];
        /** Canonical creation timestamp (ISO). */
        created: string;
        _hologram?: ResolvedHologramMeta;
        _federation?: FederationMeta;
        [key: string]: any;
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    let holonID: string = '';
    let localList: ShoppingChecklist | null = null;
    let federatedItems: ShoppingItem[] = [];
    // One live federation-aware subscription over the checklists collection. The
    // shopping doc shares one key across the holon and every partner, so we keep
    // dedupe OFF and split by `_federation`: the untagged doc is ours, tagged
    // docs are partners' (flattened into `federatedItems`). `setFederated` folds
    // partners in/out live. Replaces the local subscribe + one-shot getFederated.
    let shoppingSub:
        | { unsubscribe: () => void; setFederated: (on: boolean) => void; setLegacy: (on: boolean) => void }
        | undefined;

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
            created: new Date().toISOString()
        };
    }

    function normalizeChecklist(data: any): ShoppingChecklist | null {
        if (!data || data._deleted) return null;
        // Promote legacy `createdAt` (ms) to canonical `created` (ISO).
        const created = typeof data.created === 'string'
            ? data.created
            : (typeof data.createdAt === 'number' ? new Date(data.createdAt).toISOString() : new Date().toISOString());
        return {
            id: SHOPPING_KEY,
            type: data.type ?? 'shopping',
            title: data.title ?? 'Shopping List',
            items: Array.isArray(data.items)
                ? data.items.filter((i: any) => i && i.id != null && !i._deleted)
                : [],
            created,
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
        if (!passesLensFilters(item as any, $showHolograms, $showFederated, $showUnverified)) return false;
        const q = filters.searchQuery.trim().toLowerCase();
        if (q && !(item.text ?? '').toLowerCase().includes(q)) return false;
        return true;
    });

    $: pendingItems = visibleItems.filter(item => !item.checked);
    $: completedItems = visibleItems.filter(item => item.checked);

    let showAddModal = false;
    let inputText = "";

    function fetchData() {
        if (!holosphere || !holonID) return;

        if (shoppingSub) {
            shoppingSub.unsubscribe();
            shoppingSub = undefined;
        }

        localList = null;
        federatedItems = [];

        try {
            // One live stream over the checklists collection across the holon and
            // its inbound partners. The shopping doc shares a single key, so dedupe
            // is off; we sort each emit into the untagged local doc vs. tagged
            // partner docs (flattened into federatedItems). The bot writes the
            // whole container per mutation, so one callback per write refreshes it.
            const lensHolon = holonID;
            shoppingSub = holosphere.subscribeFederated(
                lensHolon,
                CHECKLISTS_COLLECTION,
                (docs: any[]) => {
                    if (holonID !== lensHolon) return; // stale subscription
                    let local: ShoppingChecklist | null = null;
                    const fedItems: ShoppingItem[] = [];
                    for (const doc of docs) {
                        if (!isShoppingDoc(doc)) continue;
                        if (doc._federation) {
                            const docItems = Array.isArray(doc.items) ? doc.items : [];
                            for (const item of docItems) {
                                if (!item || item.id == null || item._deleted) continue;
                                const tagged: ShoppingItem = { ...item, _federation: doc._federation };
                                if (doc._hologram) tagged._hologram = doc._hologram;
                                fedItems.push(tagged);
                            }
                        } else {
                            local = normalizeChecklist(doc);
                        }
                    }
                    localList = local;
                    federatedItems = fedItems;
                },
                { includeFederated: $showFederated, includeLegacy: $showUnverified, dedupe: false },
            );
        } catch (error) {
            console.error('Error fetching shopping list:', error);
        }
    }

    let lastShoppingFedFlag = $showFederated;
    $: if (holonID && holosphere && $showFederated !== lastShoppingFedFlag) {
        lastShoppingFedFlag = $showFederated;
        shoppingSub?.setFederated($showFederated);
    }

    // "Show all data" also folds in legacy Gun-relay records, live.
    let lastShoppingLegacyFlag = $showUnverified;
    $: if (holonID && holosphere && $showUnverified !== lastShoppingLegacyFlag) {
        lastShoppingLegacyFlag = $showUnverified;
        shoppingSub?.setLegacy($showUnverified);
    }

    onMount(() => {
        return () => {
            if (shoppingSub) shoppingSub.unsubscribe();
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
            // Core owns the toggle rule; cast at the boundary (it preserves
            // our extra fields via spread).
            const updated = coreToggleItem(ensureLocalList() as any, item.id) as ShoppingChecklist | null;
            if (!updated) return;
            localList = updated;
            await saveLocalList();
            // Checking off an item that was shared as a need fulfills it.
            if (!item.checked && needIdOf(item)) {
                await closePublishedNeed(needIdOf(item)!, 'fulfilled');
            }
        } catch (error) {
            handleWriteError(error, 'Failed to toggle item:');
        }
    }

    // ── Share-as-need (geolocated needs network, @holons/core/needs) ──

    let showShareModal = false;
    let shareTarget: (ShoppingItem & { _key: string }) | null = null;
    let shareBusy = false;
    let shareStatus = '';

    function openShareModal(item: ShoppingItem & { _key: string }): void {
        shareTarget = item;
        shareStatus = '';
        showShareModal = true;
    }

    async function handleShare(event: CustomEvent<{ toPartners: boolean; toHex: boolean }>): Promise<void> {
        const item = shareTarget;
        if (!item || !holonID) return;
        shareBusy = true;
        shareStatus = 'Publishing…';
        try {
            const need = needFromShoppingItem(item as any, {
                holonId: holonID,
                initiator: getSelfInitiator() ?? { id: holonID },
            });
            const outcome = await publishNeedNearby(holosphere, holonID, need, {
                toPartners: event.detail.toPartners,
                toHex: event.detail.toHex,
                federationSourceId: $nostrPublicKey || holonID,
                onWriteDenied: ({ message }) => notifyWriteDenied(message),
            });
            const stamped = stampNeedId(ensureLocalList() as any, item.id, String(need.id)) as ShoppingChecklist | null;
            if (stamped) {
                localList = stamped;
                await saveLocalList();
            }
            if (outcome.errors.length > 0) {
                shareStatus = outcome.errors.join(' · ');
                shareBusy = false;
                return;
            }
            showShareModal = false;
            shareTarget = null;
        } catch (error) {
            handleWriteError(error, 'Failed to publish need:');
            shareStatus = 'Publish failed — see console';
        } finally {
            shareBusy = false;
        }
    }

    /** Close the published need behind a shopping item (checked → fulfilled, removed → cancelled). */
    async function closePublishedNeed(needId: string, outcome: CloseOutcome): Promise<void> {
        try {
            const raw = await holosphere.get(holonID, NEED_RECORD_LENS, needId);
            const need = normalizeNeed(raw);
            if (!need) return;
            const closed = closeNeed(need, outcome);
            if (!closed.ok) return;
            await refreshPublishedNeed(holosphere, holonID, closed.need, {
                federationSourceId: $nostrPublicKey || holonID,
                onWriteDenied: ({ message }) => notifyWriteDenied(message),
            });
        } catch (error) {
            console.error('Failed to close published need:', error);
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
            const updated = coreRemoveItem(ensureLocalList() as any, item.id) as ShoppingChecklist | null;
            if (!updated) return;
            localList = updated;
            await saveLocalList();
            // Removing a shared item retracts the need.
            if (needIdOf(item)) {
                await closePublishedNeed(needIdOf(item)!, 'cancelled');
            }
        } catch (error) {
            handleWriteError(error, 'Failed to remove item:');
        }
    }

    async function removeChecked(): Promise<void> {
        if (!holonID || !localList) return;
        if (!localList.items.some(i => i.checked)) return;

        try {
            const updated = coreRemoveChecked(localList as any) as ShoppingChecklist | null;
            if (!updated) return;
            localList = updated;
            await saveLocalList();
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
                                <span class="list-row__icon">{item.checked ? '✅' : '🛒'}</span>
                                <h3
                                    class="list-row__title"
                                    class:text-gray-400={item.checked}
                                    class:line-through={item.checked}
                                >
                                    {item.text}
                                </h3>
                                <SourceBadge {item} currentHolonId={holonID} lensRoute="shopping" />
                                {#if item.needId}
                                    <span
                                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 flex-shrink-0"
                                        title="Shared as a need nearby"
                                    >
                                        <MapPin size="10" />
                                        <span>Need</span>
                                    </span>
                                {/if}
                            </div>
                            <div class="list-row__actions gap-3">
                                {#if isLocalItem(item) && !item.checked && !item.needId}
                                    <button
                                        on:click|stopPropagation={() => openShareModal(item)}
                                        class="text-gray-300 hover:text-emerald-300 hover:bg-emerald-500/20 p-2 rounded-lg transition-all duration-200 bg-gray-600/50"
                                        aria-label="Share as need nearby"
                                        title="Share as need nearby"
                                    >
                                        <MapPin size="18" />
                                    </button>
                                {/if}
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

<ShareNeedModal
    open={showShareModal}
    holonId={holonID}
    itemText={shareTarget?.text ?? ''}
    busy={shareBusy}
    status={shareStatus}
    on:share={handleShare}
    on:close={() => { showShareModal = false; shareTarget = null; }}
/>

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
