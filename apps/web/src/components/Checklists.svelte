<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import { replaceState, goto } from "$app/navigation";
    import Schedule from "./ScheduleWidget.svelte";
    import type { HoloSphere } from "holosphere";
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import GenericImportModal from "./shared/GenericImportModal.svelte";
    import { nameMap, resolvedName, resolveName, buildHologramLink, extractHolonIdFromSoul } from '$lib/stores/nameResolver';
    import { showFederated, showHolograms, showUnverified, passesLensFilters } from '$lib/stores/lensFilters';
    import SourceBadge from './shared/SourceBadge.svelte';
    import { CheckSquare, Plus } from 'svelte-feathers';
    import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";
    import { queryManager } from '$lib/holosphere/QueryManager';
    import {
        CHECKLIST_TYPES,
        appendItems,
        clearChecklist as coreClearChecklist,
        createChecklist,
        createChecklistObject,
        deleteChecklist as coreDeleteChecklist,
        removeItemAt,
        toggleItem,
        type Checklist,
        type ChecklistItem,
        type ChecklistStore,
    } from "@holons/core/checklists";
    import { recordKey, sourceRef } from "@holons/core/holosphere";

    const holosphere = getContext("holosphere") as HoloSphere;
    let holonID: string = $page.params.id;
    $: holonName = resolvedName(holonID, $nameMap, null, 'Checklists');
    let unsubscribe: () => void;
    let checklistsUnsubscribe: (() => void) | undefined;
    let isLoading = true;
    let connectionReady = false;

    let checklists: Record<string, Checklist> = {};
    let selectedChecklist: string | null = null;
    let roles: Record<string, any> = {};
    let quests: Record<string, any> = {};
    // Keyed by `recordKey`, NOT by the bare checklist id: a checklist's id is
    // its name, and `agenda`/`shopping` exist under that same id in every
    // holon — keying on the id would collapse every partner's list into ours.
    // The record's own `id` is still what a write targets (see `writeRef`).
    let allChecklists: Record<string, Checklist> = {};

    // Per-feature filters (search + active tab). Federation/hologram toggles
    // are global — see $lib/stores/lensFilters.
    let filters = loadFilters('checklists', {
        searchQuery: '',
        activeFilter: 'all' as 'all' | 'standalone' | 'roles' | 'quests',
    });
    $: saveFilters('checklists', filters);
    $: activeFilter = filters.activeFilter;

    $: checklistEntries = Object.entries(checklists);
    $: selectedChecklistData = selectedChecklist ? checklists[selectedChecklist] : null;
    $: completedItems = selectedChecklistData ? (selectedChecklistData.items || []).filter(item => item.checked).length : 0;
    $: totalItems = selectedChecklistData ? (selectedChecklistData.items || []).length : 0;
    $: pendingItems = totalItems - completedItems;

    // Filter checklists by active tab + search query + hologram flag.
    $: filteredChecklists = (() => {
        const q = filters.searchQuery.trim().toLowerCase();
        let entries = Object.entries(allChecklists);

        entries = entries.filter(([_, checklist]) =>
            passesLensFilters(checklist as any, $showHolograms, $showFederated, $showUnverified)
        );

        switch (filters.activeFilter) {
            case 'standalone':
                entries = entries.filter(([_, checklist]) => !checklist.questId && !checklist.roleId);
                break;
            case 'roles':
                entries = entries.filter(([_, checklist]) => checklist.roleId);
                break;
            case 'quests':
                entries = entries.filter(([_, checklist]) => checklist.questId);
                break;
        }

        if (q) {
            entries = entries.filter(([key, checklist]) =>
                `${key} ${(checklist as any)?.title ?? ''}`.toLowerCase().includes(q)
            );
        }

        return entries;
    })();

    // Update checklists based on filtered results
    $: checklists = Object.fromEntries(filteredChecklists);

    let showInput = false;
    let inputText = "";
    let isAddingChecklist = false;
    let dialogElement: HTMLDialogElement;

    onMount(() => {
        // Initialize with URL parameter first
        const urlId = $page.params.id;
        if (urlId && urlId !== 'undefined' && urlId !== 'null' && urlId.trim() !== '') {
            holonID = urlId;
            // Update the ID store to keep them in sync
            ID.set(urlId);
        }

        // Check for checklist parameter in URL
        const urlParams = new URLSearchParams(window.location.search);
        const checklistParam = urlParams.get('checklist');
        if (checklistParam) {
            selectedChecklist = checklistParam;
        }

        // Wait for holosphere to be ready before proceeding
        const checkConnection = async () => {
            if (!holosphere) {
                setTimeout(checkConnection, 100);
                return;
            }

            connectionReady = true;
            
            // Set up subscription to ID store with debouncing
            let updateTimeout: NodeJS.Timeout;
            unsubscribe = ID.subscribe((value) => {
                if (value && value !== 'undefined' && value !== 'null' && value.trim() !== '') {
                    // Clear any pending update
                    if (updateTimeout) clearTimeout(updateTimeout);
                    
                    // Debounce the update to avoid rapid changes
                    updateTimeout = setTimeout(() => {
                        if (value !== holonID) {
                            holonID = value;
                            fetchData();
                        }
                    }, 100);
                }
            });

            // Initial fetch if we have an ID
            if (holonID && holonID !== 'undefined' && holonID !== 'null' && holonID.trim() !== '') {
                fetchData();
            }
        };
        
        checkConnection();

        // Cleanup subscription on unmount
        return () => {
            if (unsubscribe) unsubscribe();
            checklistsUnsubscribe?.();
            rolesUnsubscribe?.();
            questsUnsubscribe?.();
        };
    });

    // Watch for page ID changes with debouncing
    let lastChecklistsFedFlag = $showFederated;
    $: if (connectionReady && holonID && holosphere && $showFederated !== lastChecklistsFedFlag) {
        lastChecklistsFedFlag = $showFederated;
        fetchData();
    }

    let pageUpdateTimeout: NodeJS.Timeout;
    $: {
        const newId = $page.params.id;
        if (newId && newId !== holonID && connectionReady) {
            // Check if the new ID is valid
            if (newId !== 'undefined' && newId !== 'null' && newId.trim() !== '') {
                // Clear any pending update
                if (pageUpdateTimeout) clearTimeout(pageUpdateTimeout);
                
                // Debounce the update to avoid rapid changes
                pageUpdateTimeout = setTimeout(() => {
                    holonID = newId;
                    // Update the ID store to keep them in sync
                    ID.set(newId);
                    if (holosphere) {
                        fetchData();
                        // Resolve holon name reactively
                        resolveName(newId);
                    }
                }, 100);
            }
        }
    }

    let rolesUnsubscribe: (() => void) | undefined;
    let questsUnsubscribe: (() => void) | undefined;
    let subscribedHolonId: string | null = null;
    let subscribedFedFlag: boolean | null = null;

    // Local-first + progressive load via queryManager.subscribe.
    // - Cached snapshot paints immediately (no waiting on peers).
    // - Items stream in as Gun delivers them: local graph first, federated
    //   peers after, populating the UI as info arrives.
    // - Federated mode still routes through holosphere.getFederated (which
    //   reads the full federated set) because subscribe is per-holon and
    //   doesn't transparently include partner holons.
    function fetchData(_retryCount = 0) {
        if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
            return;
        }

        const targetHolon = holonID;
        const targetFed = $showFederated;
        if (subscribedHolonId === targetHolon && subscribedFedFlag === targetFed) return;

        checklistsUnsubscribe?.();
        rolesUnsubscribe?.();
        questsUnsubscribe?.();
        subscribedHolonId = targetHolon;
        subscribedFedFlag = targetFed;
        queryManager.init(holosphere);

        isLoading = true;

        // Checklists: one live federation-aware stream. subscribeFederated emits
        // the local holon's checklists immediately and folds in inbound partners
        // (tagged `_federation`) when `includeFederated` is on — so federated mode
        // is now LIVE, not a one-shot getFederated snapshot.
        allChecklists = {};
        const checklistSub = holosphere.subscribeFederated(
            targetHolon,
            'checklists',
            (items: any[]) => {
                if (subscribedHolonId !== targetHolon || subscribedFedFlag !== targetFed) return;
                const next: Record<string, Checklist> = {};
                for (const item of items as Checklist[]) {
                    if (item && item.id) next[recordKey(item, String(item.id))] = item;
                }
                allChecklists = next;
                isLoading = false;
            },
            // Checklist ids are only holon-unique — keep each holon's copy
            // instead of letting ours shadow the partners' same-named lists.
            { includeFederated: targetFed, dedupeAcrossSpaces: false }
        );
        checklistsUnsubscribe = () => checklistSub.unsubscribe();

        rolesUnsubscribe = queryManager.subscribe({
            holonId: targetHolon,
            lens: 'roles',
            onUpdate: (items) => {
                if (subscribedHolonId !== targetHolon) return;
                const next: Record<string, any> = {};
                for (const r of items as any[]) {
                    if (r && r.id) next[r.id] = r;
                }
                roles = next;
            },
            onError: (error) => console.error('Checklists: roles subscription error:', error)
        });

        questsUnsubscribe = queryManager.subscribe({
            holonId: targetHolon,
            lens: 'quests',
            onUpdate: (items) => {
                if (subscribedHolonId !== targetHolon) return;
                const next: Record<string, any> = {};
                for (const q of items as any[]) {
                    if (q && q.id) next[q.id] = q;
                }
                quests = next;
            },
            onError: (error) => console.error('Checklists: quests subscription error:', error)
        });
    }

    /**
     * Where a write on the card `key` must land. A list mirrored in from a
     * partner lives in THAT holon — writing it here would fork a stray local
     * copy that unlinks from the original (`sourceRef` owns the rule).
     */
    function writeRef(key: string): { holon: string; key: string } | null {
        const raw = allChecklists[key];
        if (!raw?.id || !holonID) return null;
        const id = String(raw.id);
        return sourceRef(raw, id) ?? { holon: holonID, key: id };
    }

    async function toggleItemStatus(checklistId: string, itemIndex: number): Promise<void> {
        const ref = writeRef(checklistId);
        if (!ref) return;

        try {
            const updated = await toggleItem(
                holosphere as unknown as ChecklistStore,
                ref.holon,
                ref.key,
                itemIndex,
            );
            if (updated) {
                allChecklists[checklistId] = updated;
                allChecklists = allChecklists;
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to toggle checklist item:", error);
            }
        }
    }

    function selectChecklist(checklistId: string): void {
        // Special case: our OWN shopping list redirects to the dedicated
        // shopping page. A partner's does not — that page reads this holon's
        // `shopping` lens, so it would silently show the wrong list.
        if (opensShoppingPage(allChecklists[checklistId])) {
            goto(`/${holonID}/shopping`);
            return;
        }

        selectedChecklist = checklistId;
        // Update URL with checklist parameter
        const url = new URL(window.location.href);
        url.searchParams.set('checklist', checklistId);
        replaceState(url.toString(), { replaceState: true });
    }

    async function clearChecklist(checklistId: string | null): Promise<void> {
        const ref = checklistId ? writeRef(checklistId) : null;
        if (!checklistId || !ref) return;

        try {
            const result = await coreClearChecklist(
                holosphere as unknown as ChecklistStore,
                ref.holon,
                ref.key,
            );
            if (result.ok) {
                allChecklists[checklistId] = result.checklist;
                allChecklists = allChecklists;
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to clear checklist:", error);
            }
        }
    }

    function showAddInput(forChecklist: boolean) {
        isAddingChecklist = forChecklist;
        inputText = "";
        showInput = true;
    }

    let showImportModal = false;

    async function handleImport(event: CustomEvent<any[]>) {
        if (!holonID) return;
        const items = event.detail;
        try {
            const store = holosphere as unknown as ChecklistStore;
            for (const raw of items) {
                const src = raw ?? {};
                const id = String(src.id ?? src.title ?? src.name ?? src.text ?? '').trim();
                if (!id) continue;

                const rawItems = Array.isArray(src.items) ? src.items : [];
                const checklistItems: ChecklistItem[] = rawItems
                    .map((it: any) => {
                        if (typeof it === 'string') return { text: it, checked: false };
                        if (it && typeof it === 'object') {
                            const text = String(it.text ?? it.title ?? it.name ?? '').trim();
                            if (!text) return null;
                            return { text, checked: Boolean(it.checked) };
                        }
                        return null;
                    })
                    .filter(Boolean) as ChecklistItem[];

                await appendItems(store, holonID, id, checklistItems, {
                    creator: "Dashboard User",
                    type: CHECKLIST_TYPES.CHECKLIST,
                });
            }
            showImportModal = false;
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to import checklists:", error);
            }
        }
    }

    async function handleAdd(): Promise<void> {
        if (!inputText.trim() || !holonID) return;

        try {
            const store = holosphere as unknown as ChecklistStore;
            if (isAddingChecklist) {
                const result = await createChecklist(
                    store,
                    holonID,
                    inputText.trim(),
                    { creator: "Dashboard User" },
                );
                if (!result.ok && result.reason === 'invalid_name') {
                    console.warn(`Invalid checklist name: ${inputText.trim()}`);
                }
            } else if (selectedChecklist) {
                const ref = writeRef(selectedChecklist);
                if (ref) {
                    await appendItems(
                        store,
                        ref.holon,
                        ref.key,
                        [{ text: inputText.trim(), checked: false }],
                    );
                }
            }

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

    // Add function to create checklist for a specific task
    async function createChecklistForTask(taskId: string, taskTitle: string): Promise<void> {
        if (!holonID || !holosphere) return;

        try {
            const newChecklistId = `task_${taskId}_checklist`;
            const newChecklist = createChecklistObject(
                newChecklistId,
                CHECKLIST_TYPES.QUEST,
                {
                    creator: "Dashboard User",
                    questId: taskId,
                    parentTitle: taskTitle,
                    holonId: holonID,
                },
            );
            await holosphere.put(holonID, "checklists", newChecklist);

            // Update the task to include the checklist ID
            const task = await holosphere.get(holonID, "quests", taskId);
            if (task) {
                await holosphere.put(holonID, "quests", {
                    ...task,
                    checklistId: newChecklistId
                });
            }

            console.log(`Created checklist for task ${taskId}: ${newChecklistId}`);
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Error creating checklist for task:", error);
            }
        }
    }

    async function deleteChecklist(checklistId: string): Promise<void> {
        const ref = writeRef(checklistId);
        if (!ref) return;

        try {
            const result = await coreDeleteChecklist(
                holosphere as unknown as ChecklistStore,
                ref.holon,
                ref.key,
            );
            if (!result.ok && result.reason === 'special') {
                console.warn(`Cannot delete special checklist: ${ref.key}`);
                return;
            }
            delete allChecklists[checklistId];
            allChecklists = allChecklists;
            if (selectedChecklist === checklistId) {
                selectedChecklist = null;
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to delete - no write permission for this holon');
            } else {
                console.error("Failed to delete checklist:", error);
            }
        }
    }

    async function removeItem(checklistId: string, itemIndex: number): Promise<void> {
        const ref = checklistId ? writeRef(checklistId) : null;
        if (!ref) {
            console.log('removeItem early return - missing data', { checklistId, itemIndex, holonID });
            return;
        }

        try {
            const result = await removeItemAt(
                holosphere as unknown as ChecklistStore,
                ref.holon,
                ref.key,
                itemIndex,
            );
            if (result) {
                allChecklists[checklistId] = result.checklist;
                allChecklists = allChecklists;
                console.log('removeItem: put succeeded');
            } else {
                console.log('removeItem: item not found at index', itemIndex);
            }
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to remove item:", error);
            }
        }
    }

    function getChecklistDisplayTitle(checklist: Checklist): string {
        // If checklist is associated with a role, use the role title
        if (checklist.roleId && roles[checklist.roleId]) {
            return roles[checklist.roleId].title || checklist.id;
        }

        // If checklist is associated with a quest, use the quest title
        if (checklist.questId && quests[checklist.questId]) {
            return quests[checklist.questId].title || checklist.id;
        }

        // Fallback to checklist ID
        return checklist.id;
    }

    // Takes the RECORD, not the view key: the key is origin-prefixed for a
    // federated list, and the partner's holon id must not feed the match.
    function isShoppingChecklist(checklist: Checklist | null | undefined): boolean {
        const id = String(checklist?.id ?? '').toLowerCase();
        if (!id) return false;
        const shoppingKeywords = ['shopping', 'shopping list', 'groceries', 'grocery'];
        return shoppingKeywords.some(keyword => id.includes(keyword));
    }

    /**
     * True only for OUR shopping list. The dedicated shopping page reads this
     * holon's `shopping` lens, so a partner's list opens inline instead.
     */
    function opensShoppingPage(checklist: Checklist | null | undefined): boolean {
        if (!checklist || !isShoppingChecklist(checklist)) return false;
        return !sourceRef(checklist, String(checklist.id ?? ''));
    }
</script>

{#if isLoading && !connectionReady}
<div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
        <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
        <p class="text-gray-400">Connecting to holosphere...</p>
    </div>
</div>
{:else}
<div class="flex gap-4">
    <!-- Main Checklist Content -->
    <div class="flex-1 space-y-4">
        <!-- TitleBar -->
        <TitleBar
            {holonName}
            holonId={holonID}
            showLensFilters
            title={selectedChecklist && checklists[selectedChecklist] ? getChecklistDisplayTitle(checklists[selectedChecklist]) : 'Checklists'}
            icon={CheckSquare}
        />

        <!-- Main Content Container -->
        <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
            <div class="p-8">
                {#if selectedChecklistData}
                    <!-- Stats Bar for Selected Checklist -->
                    <div class="stats-bar mb-4">
                        <div class="stats-bar__item">
                            <span class="stats-bar__value">{pendingItems}</span>
                            <span class="stats-bar__label">Pending</span>
                        </div>
                        <div class="stats-bar__divider"></div>
                        <div class="stats-bar__item stats-bar__item--success">
                            <span class="stats-bar__value">{completedItems}</span>
                            <span class="stats-bar__label">Done</span>
                        </div>
                        <div class="stats-bar__divider"></div>
                        <div class="stats-bar__item">
                            <span class="stats-bar__value">{totalItems}</span>
                            <span class="stats-bar__label">Total</span>
                        </div>
                    </div>

                    <!-- Controls Row -->
                    <div class="controls-row mb-4">
                        <div class="controls-row__left">
                            <button
                                on:click={() => {
                                    selectedChecklist = null;
                                    // Clear the checklist parameter from URL
                                    const url = new URL(window.location.href);
                                    url.searchParams.delete('checklist');
                                    replaceState(url.toString(), { replaceState: true });
                                }}
                                class="btn btn--secondary"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
                                </svg>
                                <span class="hidden sm:inline">Back</span>
                            </button>
                        </div>

                        <div class="controls-row__right">
                            <button
                                on:click={() => clearChecklist(selectedChecklist)}
                                class="btn btn--secondary"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                                </svg>
                                <span class="hidden sm:inline">Clear All</span>
                            </button>

                            <button
                                on:click={() => showAddInput(false)}
                                class="btn btn--primary"
                            >
                                <Plus size="16" />
                                <span class="hidden sm:inline">Add Item</span>
                            </button>
                        </div>
                    </div>

                    <!-- Checklist Items -->
                    <div class="space-y-3">
                        {#each selectedChecklistData.items as item, index}
                            <div class="w-full">
                                <!-- The shared list-row shape (see components.css). -->
                                <div
                                    class="list-row"
                                    class:list-row--completed={item.checked}
                                    on:click={() => selectedChecklist && toggleItemStatus(selectedChecklist, index)}
                                    on:keydown={(e) => e.key === 'Enter' && selectedChecklist && toggleItemStatus(selectedChecklist, index)}
                                    role="button"
                                    tabindex="0"
                                    aria-label={`Toggle ${item.text} - ${item.checked ? 'completed' : 'pending'}`}
                                >
                                    <span class="list-row__icon">{item.checked ? '✅' : '📝'}</span>

                                    <div class="flex items-center justify-between gap-3 flex-1 min-w-0">
                                        <div class="flex items-center gap-3 flex-1 min-w-0">
                                            <!-- Main Content -->
                                            <div class="list-row__body">
                                                <h3 class="list-row__title">
                                                    {item.text}
                                                </h3>
                                            </div>
                                        </div>

                                                                <!-- Right Side - Actions -->
                        <div class="list-row__actions gap-3">
                            <div class="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={item.checked}
                                    readonly
                                    class="w-5 h-5 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-2 pointer-events-none"
                                />
                            </div>
                            <button
                                on:click|stopPropagation={() => selectedChecklist && removeItem(selectedChecklist, index)}
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

                        {#if (selectedChecklistData.items || []).length === 0}
                            <div class="text-center py-12">
                                <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                                    <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                    </svg>
                                </div>
                                <h3 class="text-lg font-medium text-white mb-2">No items in this checklist</h3>
                                <p class="text-gray-400 mb-4">Add your first item to get started</p>
                                <button
                                    on:click={() => showAddInput(false)}
                                    class="btn btn--primary"
                                >
                                    Add Item
                                </button>
                            </div>
                        {/if}
                    </div>
                {:else}
                    <!-- Checklists Overview - Stats Bar -->
                    <div class="stats-bar mb-4">
                        <div class="stats-bar__item">
                            <span class="stats-bar__value">{Object.keys(allChecklists).length}</span>
                            <span class="stats-bar__label">Total</span>
                        </div>
                        <div class="stats-bar__divider"></div>
                        <div class="stats-bar__item">
                            <span class="stats-bar__value">{Object.entries(allChecklists).filter(([_, checklist]) => !checklist.questId && !checklist.roleId).length}</span>
                            <span class="stats-bar__label">Standalone</span>
                        </div>
                        <div class="stats-bar__divider"></div>
                        <div class="stats-bar__item stats-bar__item--info">
                            <span class="stats-bar__value">{Object.entries(allChecklists).filter(([_, checklist]) => checklist.roleId).length}</span>
                            <span class="stats-bar__label">Roles</span>
                        </div>
                        <div class="stats-bar__divider"></div>
                        <div class="stats-bar__item stats-bar__item--warning">
                            <span class="stats-bar__value">{Object.entries(allChecklists).filter(([_, checklist]) => checklist.questId).length}</span>
                            <span class="stats-bar__label">Tasks</span>
                        </div>
                    </div>

                    <FeatureToolbar
                        onAdd={(filters.activeFilter === 'all' || filters.activeFilter === 'standalone') ? (() => showAddInput(true)) : null}
                        addLabel="Add Checklist"
                        onImport={(filters.activeFilter === 'all' || filters.activeFilter === 'standalone') ? (() => (showImportModal = true)) : null}
                        importLabel="Import"
                        bind:searchQuery={filters.searchQuery}
                        searchPlaceholder="Search checklists…"
                    >
                        <svelte:fragment slot="filters">
                            <div class="filter-tabs">
                                <button
                                    on:click={() => (filters.activeFilter = 'all')}
                                    class="filter-tabs__btn {filters.activeFilter === 'all' ? 'filter-tabs__btn--active' : ''}"
                                >All</button>
                                <button
                                    on:click={() => (filters.activeFilter = 'standalone')}
                                    class="filter-tabs__btn {filters.activeFilter === 'standalone' ? 'filter-tabs__btn--active' : ''}"
                                >Lists</button>
                                <button
                                    on:click={() => (filters.activeFilter = 'roles')}
                                    class="filter-tabs__btn {filters.activeFilter === 'roles' ? 'filter-tabs__btn--active' : ''}"
                                >Roles</button>
                                <button
                                    on:click={() => (filters.activeFilter = 'quests')}
                                    class="filter-tabs__btn {filters.activeFilter === 'quests' ? 'filter-tabs__btn--active' : ''}"
                                >Tasks</button>
                            </div>
                        </svelte:fragment>
                    </FeatureToolbar>

                    {#if activeFilter === 'quests'}
                        <div class="flex justify-center mb-6">
                            <div class="text-center">
                                <p class="text-gray-400 text-sm mb-3">Task-attached checklists are created from tasks</p>
                                <button
                                    on:click={() => goto(`/${holonID}/tasks`)}
                                    class="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition-colors shadow-lg transform hover:scale-105 mx-auto"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                    </svg>
                                    Go to Tasks
                                </button>
                            </div>
                        </div>
                    {/if}

                    <!-- Checklists Grid -->
                    <div class="space-y-3">
                        {#each checklistEntries as [key, checklist]}
                            <div id={key} class="w-full relative">
                                <!-- The shared list-row shape (see components.css). -->
                                <div
                                    class="list-row"
                                    on:click={() => selectChecklist(key)}
                                    on:keydown={(e) => e.key === 'Enter' && selectChecklist(key)}
                                    role="button"
                                    tabindex="0"
                                    aria-label={`Open checklist: ${getChecklistDisplayTitle(checklist)}`}
                                >
                                    <div class="flex items-center justify-between gap-3 flex-1 min-w-0">
                                        <div class="flex items-center gap-3 flex-1 min-w-0">
                                            <!-- Checklist Icon -->
                                            {#if isShoppingChecklist(checklist)}
                                                <div class="list-row__icon bg-emerald-600/20">
                                                    <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
                                                    </svg>
                                                </div>
                                            {:else}
                                                <div class="list-row__icon bg-indigo-600/20">
                                                    <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
                                                    </svg>
                                                </div>
                                            {/if}

                                            <!-- Main Content -->
                                            <div class="list-row__body">
                                                <div class="list-row__title-line">
                                                    <h3 class="list-row__title">
                                                        {getChecklistDisplayTitle(checklist)}
                                                    </h3>
                                                    {#if isShoppingChecklist(checklist)}
                                                        <span class="px-2 py-1 bg-emerald-600 text-white text-xs rounded-full flex items-center gap-1">
                                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                                            </svg>
                                                            Shopping
                                                        </span>
                                                    {/if}
                                                    {#if checklist.roleId}
                                                        <span class="px-2 py-1 bg-cyan-600 text-white text-xs rounded-full">Role</span>
                                                    {/if}
                                                    {#if checklist.questId}
                                                        <span class="px-2 py-1 bg-purple-600 text-white text-xs rounded-full">Task</span>
                                                    {/if}
                                                    <SourceBadge item={checklist} currentHolonId={holonID} lensRoute="checklists" />
                                                </div>
                                                <p class="list-row__meta">
                                                    {#if opensShoppingPage(checklist)}
                                                        Opens dedicated shopping list
                                                    {:else}
                                                        {(checklist.items || []).filter(item => item.checked).length}/{(checklist.items || []).length} completed
                                                    {/if}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <button
                                    on:click|stopPropagation={() => deleteChecklist(key)}
                                    class="absolute top-2 right-2 text-gray-600 hover:text-red-600 p-2 rounded-lg hover:bg-gray-600/50 transition-colors z-10"
                                    aria-label="Delete checklist"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                    </svg>
                                </button>
                            </div>
                        {/each}

                        {#if checklistEntries.length === 0}
                            <div class="text-center py-12">
                                <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                                    <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                    </svg>
                                </div>
                                <h3 class="text-lg font-medium text-white mb-2">
                                    {activeFilter === 'all' ? 'No checklists found' :
                                     activeFilter === 'standalone' ? 'No standalone checklists' :
                                     activeFilter === 'roles' ? 'No role checklists' :
                                     'No task checklists'}
                                </h3>
                                <p class="text-gray-400 mb-4">
                                    {activeFilter === 'all' ? 'Create your first checklist to get organized' :
                                     activeFilter === 'standalone' ? 'Standalone checklists are created independently' :
                                     activeFilter === 'roles' ? 'Role checklists are created from roles' :
                                     'Task checklists are created from tasks'}
                                </p>
                                {#if activeFilter === 'all' || activeFilter === 'standalone'}
                                    <button
                                        on:click={() => showAddInput(true)}
                                        class="btn btn--primary"
                                    >
                                        Create Checklist
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <!-- Side Schedule (only show on larger screens) -->
    {#if holonID}
        <div class="hidden xl:block w-80 flex-shrink-0">
            <Schedule />
        </div>
    {/if}
</div>
{/if}

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
            aria-labelledby="input-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="input-title" class="text-white text-xl font-bold">
                        {isAddingChecklist ? "Create New Checklist" : "Add New Item"}
                    </h3>
                    <button
                        on:click={() => showInput = false}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close dialog"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
                
                <form 
                    on:submit|preventDefault={handleAdd}
                    class="space-y-4"
                >
                    <div>
                        <label for="input-field" class="block text-sm font-medium text-gray-300 mb-2">
                            {isAddingChecklist ? "Checklist Name" : "Item Text"}
                        </label>
                        <input
                            id="input-field"
                            type="text"
                            bind:value={inputText}
                            placeholder={isAddingChecklist ? "Enter checklist name..." : "Enter item text..."}
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            required
                        />
                    </div>
                    <div class="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            on:click={() => showInput = false}
                            class="px-6 py-2.5 text-sm font-medium rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="btn btn--primary"
                            disabled={!inputText.trim()}
                        >
                            {isAddingChecklist ? "Create Checklist" : "Add Item"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<GenericImportModal
    bind:open={showImportModal}
    title="Import Checklists"
    itemNoun="checklists"
    helpText="Paste a JSON array of checklists or one list name per line. Required: id (becomes the list title). Items can be plain strings or objects with text and checked."
    sampleJson={`[
  {
    "id": "Morning Routine",
    "items": [
      "Make bed",
      "Drink water",
      { "text": "Stretch", "checked": false }
    ]
  },
  {
    "id": "Travel Packing",
    "items": ["Passport", "Charger", "Toothbrush"]
  }
]`}
    on:import={handleImport}
    on:close={() => (showImportModal = false)}
/>


