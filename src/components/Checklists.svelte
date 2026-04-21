<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import { replaceState, goto } from "$app/navigation";
    import Schedule from "./ScheduleWidget.svelte";
    import type { HoloSphere } from "holosphere";
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
    import { CheckSquareIcon as CheckSquare } from 'svelte-feather-icons';
    import { Plus } from 'svelte-feathers';
    import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
    import { notifyWriteDenied } from "../lib/stores/writeNotifications";

    interface ChecklistItem {
        text: string;
        checked: boolean;
    }

    interface Checklist {
        id: string;
        items: ChecklistItem[];
        creator?: string;
        created?: Date;
        questId?: string; // Optional property to indicate if checklist is attached to a quest
        roleId?: string; // Optional property to indicate if checklist is attached to a role
    }

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
    let allChecklists: Record<string, Checklist> = {};

    // Shared toolbar state — activeFilter maps to the existing tab values.
    let filters = loadFilters('checklists', {
        searchQuery: '',
        showFederated: false,
        showHolograms: true,
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

        entries = entries.filter(([_, checklist]) => {
            const isHologram = (checklist as any)?._hologram?.isHologram === true;
            if (!filters.showHolograms && isHologram) return false;
            if (!filters.showFederated && isHologram) return false;
            return true;
        });

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
            if (checklistsUnsubscribe) checklistsUnsubscribe();
        };
    });

    // Watch for page ID changes with debouncing
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

    async function fetchData(retryCount = 0) {
        if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
            return;
        }
        
        isLoading = true;
        
        try {
            console.log(`Fetching checklists for holon: ${holonID}`);
            
            // Fetch checklists data with timeout
            const fetchWithTimeout = async (promise: Promise<any>, timeoutMs: number = 5000) => {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeoutMs)
                );
                return Promise.race([promise, timeoutPromise]);
            };

            // Fetch checklists, roles, and quests in parallel
            const [checklistsResult, rolesResult, questsResult] = await Promise.all([
                fetchWithTimeout(holosphere.getAll(holonID, "checklists"), 5000),
                fetchWithTimeout(holosphere.getAll(holonID, "roles"), 5000),
                holosphere.getAll(holonID, "quests")
            ]);
            
            // Process results safely - store all checklists
            const checklistsData = checklistsResult || {};
            allChecklists = checklistsData;
            roles = rolesResult || {};
            quests = questsResult || {};

            console.log(`Successfully fetched checklists for holon ${holonID}:`, Object.keys(filteredChecklists).length, 'checklists (filtered from', Object.keys(checklistsData).length, 'total)');

            // Set up subscription after successful fetch
            await subscribeToChecklists();

        } catch (error: any) {
            console.error('Error fetching checklists data:', error);
            
            // Retry on network errors up to 3 times with exponential backoff
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`Retrying checklists fetch in ${delay}ms (attempt ${retryCount + 1}/3)`);
                setTimeout(() => fetchData(retryCount + 1), delay);
                return;
            }
        } finally {
            isLoading = false;
        }
    }

    async function subscribeToChecklists(): Promise<void> {
        // Clear existing subscription
        if (checklistsUnsubscribe) {
            checklistsUnsubscribe();
            checklistsUnsubscribe = undefined;
        }

        // Don't reset allChecklists - data already loaded by fetchData()

        if (holosphere && holonID && holonID !== 'undefined' && holonID !== 'null' && holonID.trim() !== '') {
            const subscription = await holosphere.subscribe(
                holonID,
                "checklists",
                (newItem: Checklist | null, key?: string) => {
                    if (key) {
                        if (newItem) {
                            // Add all checklists to allChecklists
                            allChecklists[key] = newItem;
                        } else {
                            delete allChecklists[key];
                        }
                        allChecklists = allChecklists;
                    }
                }
            );
            checklistsUnsubscribe = subscription.unsubscribe;

            // Also subscribe to roles and quests updates to keep titles current
            holosphere.subscribe(holonID, "roles", (newRole: any, key?: string) => {
                if (key && newRole) {
                    roles[key] = newRole;
                    roles = roles;
                } else if (key) {
                    const { [key]: _, ...rest } = roles;
                    roles = rest;
                }
            });

            holosphere.subscribe(holonID, "quests", (newQuest: any, key?: string) => {
                if (key && newQuest) {
                    quests[key] = newQuest;
                    quests = quests;
                } else if (key) {
                    const { [key]: _, ...rest } = quests;
                    quests = rest;
                }
            });
        }
    }

    async function toggleItemStatus(checklistId: string, itemIndex: number): Promise<void> {
        if (!allChecklists[checklistId] || !holonID) return;

        try {
            const checklist = { ...allChecklists[checklistId] };
            checklist.items = [...checklist.items];
            checklist.items[itemIndex] = {
                ...checklist.items[itemIndex],
                checked: !checklist.items[itemIndex].checked,
            };

            await holosphere.put(holonID, "checklists", checklist);
            allChecklists[checklistId] = checklist;
            allChecklists = allChecklists;
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error("Failed to toggle checklist item:", error);
            }
        }
    }

    function selectChecklist(checklistId: string): void {
        // Special case: redirect "shopping" checklist to dedicated shopping page
        const shoppingKeywords = ['shopping', 'shopping list', 'groceries', 'grocery'];
        if (shoppingKeywords.some(keyword => checklistId.toLowerCase().includes(keyword))) {
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
        if (!checklistId || !allChecklists[checklistId] || !holonID) return;

        try {
            const checklist = { ...allChecklists[checklistId] };
            checklist.items = (checklist.items || []).map((item) => ({
                ...item,
                checked: false,
            }));

            await holosphere.put(holonID, "checklists", checklist);
            allChecklists[checklistId] = checklist;
            allChecklists = allChecklists;
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

    async function handleAdd(): Promise<void> {
        if (!inputText.trim() || !holonID) return;

        try {
            if (isAddingChecklist) {
                const newChecklistId = inputText.trim();
                const newChecklist = {
                    id: newChecklistId,
                    items: [],
                    creator: "Dashboard User",
                    created: new Date().toISOString(),
                };
                await holosphere.put(holonID, "checklists", newChecklist);
            } else if (selectedChecklist && allChecklists[selectedChecklist]) {
                const checklist = { ...allChecklists[selectedChecklist] };
                checklist.items = [
                    ...checklist.items,
                    {
                        text: inputText.trim(),
                        checked: false,
                    },
                ];
                await holosphere.put(holonID, "checklists", checklist);
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
            const newChecklist = {
                id: newChecklistId,
                items: [],
                creator: "Dashboard User",
                created: new Date().toISOString(),
                questId: taskId // Link to the specific task
            };

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
        if (!holonID) return;

        try {
            await holosphere.delete(holonID, "checklists", checklistId);
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
        console.log('removeItem called:', { checklistId, itemIndex, holonID, hasChecklist: !!allChecklists[checklistId] });
        if (!checklistId || !allChecklists[checklistId] || !holonID) {
            console.log('removeItem early return - missing data');
            return;
        }

        try {
            const checklist = { ...allChecklists[checklistId] };
            const originalLength = (checklist.items || []).length;
            checklist.items = (checklist.items || []).filter(
                (_, index) => index !== itemIndex
            );
            console.log('Items before:', originalLength, 'after:', checklist.items.length);

            await holosphere.put(holonID, "checklists", checklist);
            allChecklists[checklistId] = checklist;
            allChecklists = allChecklists;
            console.log('removeItem: put succeeded');
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

    function isShoppingChecklist(checklistId: string): boolean {
        const shoppingKeywords = ['shopping', 'shopping list', 'groceries', 'grocery'];
        return shoppingKeywords.some(keyword => checklistId.toLowerCase().includes(keyword));
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
                                <div
                                    class="p-4 rounded-xl transition-all duration-300 border hover:shadow-md cursor-pointer transform hover:scale-[1.002]"
                                    class:bg-gray-800={item.checked}
                                    class:border-gray-700={item.checked}
                                    class:opacity-70={item.checked}
                                    class:bg-gray-700={!item.checked}
                                    class:border-transparent={!item.checked}
                                    class:hover:bg-gray-600={!item.checked}
                                    class:hover:border-gray-500={!item.checked}
                                    on:click={() => selectedChecklist && toggleItemStatus(selectedChecklist, index)}
                                    on:keydown={(e) => e.key === 'Enter' && selectedChecklist && toggleItemStatus(selectedChecklist, index)}
                                    role="button"
                                    tabindex="0"
                                    aria-label={`Toggle ${item.text} - ${item.checked ? 'completed' : 'pending'}`}
                                >
                                    <div class="flex items-center justify-between gap-3">
                                        <div class="flex items-center gap-3 flex-1 min-w-0">
                                            <!-- Item Icon -->
                                            <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center">
                                                <span class="text-sm">{item.checked ? '✅' : '📝'}</span>
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
                        addLabel="New"
                        bind:searchQuery={filters.searchQuery}
                        searchPlaceholder="Search checklists…"
                        bind:showFederated={filters.showFederated}
                        bind:showHolograms={filters.showHolograms}
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
                                <div 
                                    class="p-4 rounded-xl transition-all duration-300 border border-transparent bg-gray-700 hover:bg-gray-600 hover:border-gray-500 hover:shadow-md transform hover:scale-[1.005] cursor-pointer"
                                    on:click={() => selectChecklist(key)}
                                    on:keydown={(e) => e.key === 'Enter' && selectChecklist(key)}
                                    role="button"
                                    tabindex="0"
                                    aria-label={`Open checklist: ${getChecklistDisplayTitle(checklist)}`}
                                >
                                    <div class="flex items-center justify-between gap-3">
                                        <div class="flex items-center gap-3 flex-1 min-w-0">
                                            <!-- Checklist Icon -->
                                            {#if isShoppingChecklist(key)}
                                                <div class="flex-shrink-0 w-10 h-10 rounded-lg bg-emerald-600/20 flex items-center justify-center">
                                                    <svg class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/>
                                                    </svg>
                                                </div>
                                            {:else}
                                                <div class="flex-shrink-0 w-10 h-10 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                                                    <svg class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
                                                    </svg>
                                                </div>
                                            {/if}

                                            <!-- Main Content -->
                                            <div class="flex-1 min-w-0">
                                                <div class="flex items-center gap-2 mb-1">
                                                    <h3 class="text-base font-bold text-white truncate">
                                                        {getChecklistDisplayTitle(checklist)}
                                                    </h3>
                                                    {#if isShoppingChecklist(key)}
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
                                                </div>
                                                <p class="text-sm text-gray-400">
                                                    {#if isShoppingChecklist(key)}
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
