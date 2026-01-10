<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { getHologramSourceName, fetchHolonName } from "../utils/holonNames";
    import TitleBar from "./shared/TitleBar.svelte";
    import { Package, Plus, Calendar } from 'svelte-feathers';

    // Library item types
    const LIBRARY_TYPES = {
        TOOL: 'tool',
        BOOK: 'book',
        EQUIPMENT: 'equipment',
        OTHER: 'other'
    };

    interface LibraryItem {
        id: string;
        type: string;
        borrowed: boolean;
        borrower: string | null;
        borrowerId: string | null;
        borrowerInitials: string | null;
        borrowedAt: string | null;
        returnBy: string | null;
        createdBy: string;
        createdByUsername: string | null;
        category: string;
        description: string;
        value: number;
        created: string;
        _deleted?: boolean;
        _hologram?: {
            isHologram: boolean;
            soul: string;
            sourceHolon: string;
            localOverrides?: string[];
        };
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    let holonID: string = '';
    let holonName: string = 'Library';
    let store: Record<string, LibraryItem> = {};
    let currentUserId: string = '';
    let currentUsername: string = '';

    $: libraryItems = Object.entries(store);
    $: filteredItems = libraryItems.filter(([_, item]: [string, any]) => {
        if (item._deleted) return false;
        if (!showHolograms && item._hologram?.isHologram) return false;

        // Apply active filter
        switch (activeFilter) {
            case 'available':
                return !item.borrowed;
            case 'borrowed':
                return item.borrowed;
            case 'mine':
                return item.createdBy === currentUserId;
            default:
                return true;
        }
    });

    // Stats
    $: totalItems = libraryItems.filter(([_, item]) => !item._deleted).length;
    $: availableItems = libraryItems.filter(([_, item]) => !item._deleted && !item.borrowed).length;
    $: borrowedItems = libraryItems.filter(([_, item]) => !item._deleted && item.borrowed).length;
    $: myItems = libraryItems.filter(([_, item]) => !item._deleted && item.createdBy === currentUserId).length;

    let showInput = false;
    let showHolograms = true;
    let activeFilter: string = 'all';
    let libraryItemsUnsubscribe: (() => void) | undefined;
    let hologramSourceNames = new Map<string, string>();

    // Add item form state
    let newItemName = "";
    let newItemValue = 0;
    let newItemType = LIBRARY_TYPES.OTHER;
    let newItemCategory = "";
    let newItemDescription = "";

    // Borrow modal state
    let showBorrowModal = false;
    let borrowingItem: LibraryItem | null = null;
    let selectedReturnDate: string = "";
    let currentMonth = new Date();

    // Item detail modal state
    let showItemDetail = false;
    let selectedItem: LibraryItem | null = null;

    async function preResolveHologramNames(items: LibraryItem[]) {
        const hologramSouls = new Set<string>();

        items.forEach(item => {
            if (item._hologram?.isHologram && item._hologram.soul) {
                if (!hologramSourceNames.has(item._hologram.soul)) {
                    hologramSouls.add(item._hologram.soul);
                }
            }
        });

        if (hologramSouls.size === 0) return;

        const promises = Array.from(hologramSouls).map(async (hologramSoul) => {
            try {
                const match = hologramSoul.match(/Holons\/([^\/]+)/);
                if (match) {
                    const holonId = match[1];
                    const realName = await fetchHolonName(holosphere, holonId);
                    hologramSourceNames.set(hologramSoul, realName);
                }
            } catch (error) {
                const match = hologramSoul.match(/Holons\/([^\/]+)/);
                if (match) {
                    hologramSourceNames.set(hologramSoul, `Holon ${match[1]}`);
                }
            }
        });

        await Promise.allSettled(promises);

        if (hologramSouls.size > 0) {
            hologramSourceNames = new Map(hologramSourceNames);
            libraryItems = [...libraryItems];
        }
    }

    async function fetchData() {
        if (!holosphere || !holonID) return;

        if (libraryItemsUnsubscribe) {
            libraryItemsUnsubscribe();
            libraryItemsUnsubscribe = undefined;
        }

        try {
            const initialData = await holosphere.getAll(holonID, "library");

            const newStore: Record<string, LibraryItem> = {};
            if (typeof initialData === 'object' && initialData !== null) {
                Object.entries(initialData).forEach(([key, item]: [string, any]) => {
                    if (item && item.id && !item._deleted && item.hologram !== true) {
                        newStore[key] = item as LibraryItem;
                    }
                });
            }
            store = newStore;

            await preResolveHologramNames(Object.values(store));

            const off = holosphere.subscribe(holonID, "library", (newItem: any, key?: string) => {
                if (newItem && key && !newItem._deleted && newItem.hologram !== true) {
                    store = { ...store, [key]: newItem as LibraryItem };
                    if (newItem._hologram?.isHologram) {
                        preResolveHologramNames([newItem]);
                    }
                } else if (!newItem && key) {
                    const { [key]: _, ...rest } = store;
                    store = rest;
                }
            });

            if (typeof off === 'function') {
                libraryItemsUnsubscribe = off as unknown as () => void;
            }
        } catch (error) {
            console.error('Error fetching library:', error);
        }
    }

    onMount(() => {
        try {
            const storedShowHolograms = localStorage.getItem("libraryShowHolograms");
            if (storedShowHolograms !== null) {
                showHolograms = storedShowHolograms === "true";
            }
            // Get current user info from localStorage or session
            currentUserId = localStorage.getItem("userId") || "";
            currentUsername = localStorage.getItem("username") || "";
        } catch (error) {
            console.error('Error loading preferences:', error);
        }

        return () => {
            if (libraryItemsUnsubscribe) libraryItemsUnsubscribe();
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
            fetchHolonName(holosphere, newId).then(name => {
                holonName = name || 'Library';
            });
        }
    }

    $: if (typeof localStorage !== 'undefined') {
        localStorage.setItem("libraryShowHolograms", showHolograms.toString());
    }

    function getHologramSource(hologramSoul: string | undefined): string {
        if (!hologramSoul) return '';

        if (hologramSourceNames.has(hologramSoul)) {
            return hologramSourceNames.get(hologramSoul)!;
        }

        const match = hologramSoul.match(/Holons\/([^\/]+)/);
        return match ? `Holon ${match[1]}` : 'External Source';
    }

    function getItemIcon(item: LibraryItem | string): string {
        if (typeof item === 'string') return '📦';
        switch (item.type) {
            case LIBRARY_TYPES.TOOL: return '🔧';
            case LIBRARY_TYPES.BOOK: return '📚';
            case LIBRARY_TYPES.EQUIPMENT: return '⚙️';
            default: return '📦';
        }
    }

    function getTypeDisplayName(type: string): string {
        switch (type) {
            case LIBRARY_TYPES.TOOL: return 'Tool';
            case LIBRARY_TYPES.BOOK: return 'Book';
            case LIBRARY_TYPES.EQUIPMENT: return 'Equipment';
            default: return 'Other';
        }
    }

    function detectItemType(itemName: string): string {
        const name = itemName.toLowerCase();
        const toolKeywords = ['hammer', 'drill', 'saw', 'screwdriver', 'wrench', 'pliers', 'shovel', 'rake', 'axe', 'knife'];
        const bookKeywords = ['book', 'manual', 'guide', 'novel', 'textbook'];
        const equipmentKeywords = ['camera', 'projector', 'speaker', 'tent', 'bicycle', 'ladder'];

        if (toolKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.TOOL;
        if (bookKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.BOOK;
        if (equipmentKeywords.some(k => name.includes(k))) return LIBRARY_TYPES.EQUIPMENT;
        return LIBRARY_TYPES.OTHER;
    }

    function showAddInput() {
        newItemName = "";
        newItemValue = 0;
        newItemType = LIBRARY_TYPES.OTHER;
        newItemCategory = "";
        newItemDescription = "";
        showInput = true;
    }

    async function handleAddItem() {
        if (!newItemName.trim() || !holonID) return;

        // Check if item already exists
        if (store[newItemName.trim()]) {
            alert(`${newItemName} already exists in the library.`);
            return;
        }

        const detectedType = newItemType === LIBRARY_TYPES.OTHER ? detectItemType(newItemName) : newItemType;

        const newItem: LibraryItem = {
            id: newItemName.trim(),
            type: detectedType,
            borrowed: false,
            borrower: null,
            borrowerId: null,
            borrowerInitials: null,
            borrowedAt: null,
            returnBy: null,
            createdBy: currentUserId,
            createdByUsername: currentUsername,
            category: newItemCategory || 'Uncategorized',
            description: newItemDescription,
            value: newItemValue,
            created: new Date().toISOString()
        };

        store = { ...store, [newItem.id]: newItem };

        holosphere.put(holonID, "library", newItem).catch(err => {
            console.error("Failed to add item", err);
            const { [newItem.id]: _, ...rest } = store;
            store = rest;
        });

        showInput = false;
    }

    function openBorrowModal(item: LibraryItem) {
        borrowingItem = item;
        selectedReturnDate = "";
        currentMonth = new Date();
        showBorrowModal = true;
    }

    async function handleBorrow() {
        if (!borrowingItem || !selectedReturnDate || !holonID) return;

        const firstName = currentUsername.charAt(0).toUpperCase();
        const initials = firstName || '?';

        const updatedItem: LibraryItem = {
            ...borrowingItem,
            borrowed: true,
            borrower: currentUsername,
            borrowerId: currentUserId,
            borrowerInitials: initials,
            borrowedAt: new Date().toISOString(),
            returnBy: selectedReturnDate
        };

        store = { ...store, [updatedItem.id]: updatedItem };

        try {
            await holosphere.put(holonID, "library", updatedItem);
        } catch (err) {
            console.error("Failed to borrow item", err);
            store = { ...store, [borrowingItem.id]: borrowingItem };
        }

        showBorrowModal = false;
        borrowingItem = null;
    }

    async function handleReturn(item: LibraryItem) {
        if (!holonID) return;

        // Check if current user is the borrower
        if (item.borrowerId !== currentUserId && item.borrower !== currentUsername) {
            alert(`Only ${item.borrower || 'the borrower'} can return this item.`);
            return;
        }

        const updatedItem: LibraryItem = {
            ...item,
            borrowed: false,
            borrower: null,
            borrowerId: null,
            borrowerInitials: null,
            borrowedAt: null,
            returnBy: null
        };

        store = { ...store, [updatedItem.id]: updatedItem };

        try {
            await holosphere.put(holonID, "library", updatedItem);
        } catch (err) {
            console.error("Failed to return item", err);
            store = { ...store, [item.id]: item };
        }

        if (showItemDetail && selectedItem?.id === item.id) {
            selectedItem = updatedItem;
        }
    }

    async function handleDelete(itemId: string) {
        if (!holonID) return;

        const item = store[itemId];
        if (!item) return;

        // Only owner can delete
        if (item.createdBy !== currentUserId) {
            alert("Only the owner can delete this item.");
            return;
        }

        if (item.borrowed) {
            alert("Cannot delete a borrowed item. Please wait for it to be returned.");
            return;
        }

        const originalStore = { ...store };

        try {
            const { [itemId]: _, ...rest } = store;
            store = rest;

            await holosphere.delete(holonID, "library", itemId);
        } catch (error) {
            console.error("Failed to delete item:", error);
            store = originalStore;
            alert("Failed to delete item. Please try again.");
        }

        showItemDetail = false;
        selectedItem = null;
    }

    function openItemDetail(item: LibraryItem) {
        selectedItem = item;
        showItemDetail = true;
    }

    // Calendar helpers
    function getDaysInMonth(date: Date): number {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }

    function getFirstDayOfMonth(date: Date): number {
        return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
    }

    function formatDate(date: Date): string {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function isDateSelectable(year: number, month: number, day: number): boolean {
        const date = new Date(year, month, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
    }

    function selectDate(year: number, month: number, day: number) {
        if (isDateSelectable(year, month, day)) {
            selectedReturnDate = formatDate(new Date(year, month, day));
        }
    }

    function prevMonth() {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    }

    function nextMonth() {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    }

    $: calendarDays = (() => {
        const days: { day: number; selectable: boolean; isToday: boolean; isSelected: boolean }[] = [];
        const daysInMonth = getDaysInMonth(currentMonth);
        const firstDay = getFirstDayOfMonth(currentMonth);
        const today = new Date();

        // Empty cells for days before first of month
        for (let i = 0; i < firstDay; i++) {
            days.push({ day: 0, selectable: false, isToday: false, isSelected: false });
        }

        // Days of the month
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
            const isToday = today.getDate() === day &&
                           today.getMonth() === currentMonth.getMonth() &&
                           today.getFullYear() === currentMonth.getFullYear();
            days.push({
                day,
                selectable: isDateSelectable(currentMonth.getFullYear(), currentMonth.getMonth(), day),
                isToday,
                isSelected: dateStr === selectedReturnDate
            });
        }

        return days;
    })();

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    function formatReturnDate(dateStr: string | null): string {
        if (!dateStr) return 'Not set';
        const date = new Date(dateStr);
        return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
    }

    function isOverdue(returnBy: string | null): boolean {
        if (!returnBy) return false;
        const returnDate = new Date(returnBy);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return returnDate < today;
    }
</script>

<div class="space-y-4">
    <!-- TitleBar -->
    <TitleBar {holonName} title="Library" icon={Package}>
        <label slot="actions" class="flex items-center cursor-pointer">
            <div class="relative">
                <input
                    type="checkbox"
                    class="sr-only"
                    bind:checked={showHolograms}
                />
                <div class="w-11 h-6 bg-gray-600 rounded-full shadow-inner border border-gray-500"></div>
                <div
                    class="dot absolute w-4 h-4 bg-white rounded-full transition-transform duration-300 ease-in-out left-1 top-1"
                    class:translate-x-5={showHolograms}
                ></div>
            </div>
            <div class="ml-3 text-sm font-medium text-white whitespace-nowrap">
                <span class="hidden sm:inline">Show Holograms</span>
                <span class="sm:hidden" aria-label="Show hologram items">🔮</span>
            </div>
        </label>
    </TitleBar>

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">
            <!-- Stats Bar -->
            <div class="stats-bar mb-4">
                <div class="stats-bar__item">
                    <span class="stats-bar__value">{availableItems}</span>
                    <span class="stats-bar__label">Available</span>
                </div>
                <div class="stats-bar__divider"></div>
                <div class="stats-bar__item stats-bar__item--warning">
                    <span class="stats-bar__value">{borrowedItems}</span>
                    <span class="stats-bar__label">Borrowed</span>
                </div>
                <div class="stats-bar__divider"></div>
                <div class="stats-bar__item stats-bar__item--info">
                    <span class="stats-bar__value">{myItems}</span>
                    <span class="stats-bar__label">Mine</span>
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
                        on:click={showAddInput}
                        class="btn btn--primary"
                        aria-label="Add new item"
                    >
                        <Plus size={16} />
                        <span class="hidden sm:inline">Add Item</span>
                    </button>
                </div>

                <div class="controls-row__center">
                    <!-- Filter Tabs -->
                    <div class="filter-tabs">
                        <button
                            on:click={() => activeFilter = 'all'}
                            class="filter-tabs__btn {activeFilter === 'all' ? 'filter-tabs__btn--active' : ''}"
                        >
                            All
                        </button>
                        <button
                            on:click={() => activeFilter = 'available'}
                            class="filter-tabs__btn {activeFilter === 'available' ? 'filter-tabs__btn--active' : ''}"
                        >
                            Available
                        </button>
                        <button
                            on:click={() => activeFilter = 'borrowed'}
                            class="filter-tabs__btn {activeFilter === 'borrowed' ? 'filter-tabs__btn--active' : ''}"
                        >
                            Borrowed
                        </button>
                        <button
                            on:click={() => activeFilter = 'mine'}
                            class="filter-tabs__btn {activeFilter === 'mine' ? 'filter-tabs__btn--active' : ''}"
                        >
                            Mine
                        </button>
                    </div>
                </div>

                <div class="controls-row__right"></div>
            </div>

            <!-- Library Items -->
            <div class="space-y-3">
                {#each filteredItems as [key, item]}
                    <div id={key} class="w-full">
                        <div
                            class="p-4 rounded-xl transition-all duration-300 border hover:shadow-md transform hover:scale-[1.005] cursor-pointer
                                {!item.borrowed ? 'bg-gray-700 hover:bg-gray-600 hover:border-gray-500' : ''}
                                {!item._hologram?.isHologram && !item.borrowed ? 'border-transparent' : ''}
                                {item.borrowed && !isOverdue(item.returnBy) ? 'bg-amber-900/30 border-amber-600/50' : ''}
                                {item.borrowed && isOverdue(item.returnBy) ? 'bg-red-900/30 border-red-600/50' : ''}
                                {item._hologram?.isHologram ? 'opacity-75 border-2' : ''}
                                {item._hologram?.isHologram && !item.borrowed ? 'border-indigo-500' : ''}"
                            style="{item._hologram?.isHologram ? 'box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), inset 0 0 20px rgba(99, 102, 241, 0.1);' : ''}"
                            on:click={() => openItemDetail(item)}
                            on:keydown={(e) => e.key === 'Enter' && openItemDetail(item)}
                            role="button"
                            tabindex="0"
                            aria-label={`View ${item.id} details`}
                        >
                            <div class="flex items-center justify-between gap-3">
                                <div class="flex items-center gap-3 flex-1 min-w-0">
                                    <!-- Item Icon -->
                                    <div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
                                        {!item.borrowed ? 'bg-black/20' : ''}
                                        {item.borrowed && !isOverdue(item.returnBy) ? 'bg-amber-600/20' : ''}
                                        {item.borrowed && isOverdue(item.returnBy) ? 'bg-red-600/20' : ''}">
                                        <span class="text-xl">{getItemIcon(item)}</span>
                                    </div>

                                    <!-- Main Content -->
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                                            <h3 class="text-base font-bold truncate text-white">
                                                {item.id}
                                            </h3>
                                            {#if item.value > 0}
                                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-600/30 text-emerald-300">
                                                    {item.value}●
                                                </span>
                                            {/if}
                                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-600/50 text-gray-300">
                                                {getTypeDisplayName(item.type)}
                                            </span>
                                            {#if item._hologram?.isHologram}
                                                <span class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300">
                                                    🔮 {getHologramSource(item._hologram.soul)}
                                                </span>
                                            {/if}
                                        </div>
                                        <div class="text-sm text-gray-400">
                                            {#if item.borrowed}
                                                <span class="flex items-center gap-2">
                                                    {#if isOverdue(item.returnBy)}
                                                        <span class="text-red-400">🔴 Overdue</span>
                                                    {:else}
                                                        <span class="text-amber-400">🔄 Borrowed</span>
                                                    {/if}
                                                    <span>by {item.borrowerInitials || item.borrower}</span>
                                                    {#if item.returnBy}
                                                        <span>• Return: {formatReturnDate(item.returnBy)}</span>
                                                    {/if}
                                                </span>
                                            {:else}
                                                <span class="text-emerald-400">✓ Available</span>
                                                {#if item.createdByUsername}
                                                    <span> • Owner: {item.createdByUsername}</span>
                                                {/if}
                                            {/if}
                                        </div>
                                    </div>
                                </div>

                                <!-- Right Side - Action Button -->
                                <div class="flex items-center gap-2 flex-shrink-0">
                                    {#if !item.borrowed}
                                        <button
                                            on:click|stopPropagation={() => openBorrowModal(item)}
                                            class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                                            aria-label="Borrow {item.id}"
                                        >
                                            Borrow
                                        </button>
                                    {:else if item.borrowerId === currentUserId || item.borrower === currentUsername}
                                        <button
                                            on:click|stopPropagation={() => handleReturn(item)}
                                            class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
                                            aria-label="Return {item.id}"
                                        >
                                            Return
                                        </button>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}

                {#if filteredItems.length === 0}
                    <div class="text-center py-12">
                        <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                            <span class="text-3xl">📦</span>
                        </div>
                        <h3 class="text-lg font-medium text-white mb-2">
                            {#if activeFilter === 'all'}
                                No items in the library
                            {:else if activeFilter === 'available'}
                                No available items
                            {:else if activeFilter === 'borrowed'}
                                No borrowed items
                            {:else}
                                You haven't added any items
                            {/if}
                        </h3>
                        <p class="text-gray-400 mb-4">
                            {#if activeFilter === 'all' || activeFilter === 'mine'}
                                Share tools, books, or equipment with your community
                            {:else if activeFilter === 'available'}
                                All items are currently borrowed
                            {:else}
                                No items are currently on loan
                            {/if}
                        </p>
                        {#if activeFilter === 'all' || activeFilter === 'mine'}
                            <button
                                on:click={showAddInput}
                                class="btn btn--primary"
                            >
                                Add Item
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

<!-- Add Item Modal -->
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
            aria-labelledby="add-item-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="add-item-title" class="text-white text-xl font-bold">Add New Item</h3>
                    <button
                        on:click={() => showInput = false}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>

                <form on:submit|preventDefault={handleAddItem} class="space-y-4">
                    <div>
                        <label for="item-name" class="block text-sm font-medium text-gray-300 mb-2">Item Name *</label>
                        <input
                            id="item-name"
                            type="text"
                            bind:value={newItemName}
                            placeholder="e.g., Hammer, Camera, Book..."
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            required
                        />
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label for="item-type" class="block text-sm font-medium text-gray-300 mb-2">Type</label>
                            <select
                                id="item-type"
                                bind:value={newItemType}
                                class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            >
                                <option value={LIBRARY_TYPES.OTHER}>Other</option>
                                <option value={LIBRARY_TYPES.TOOL}>Tool</option>
                                <option value={LIBRARY_TYPES.BOOK}>Book</option>
                                <option value={LIBRARY_TYPES.EQUIPMENT}>Equipment</option>
                            </select>
                        </div>

                        <div>
                            <label for="item-value" class="block text-sm font-medium text-gray-300 mb-2">Value (credits)</label>
                            <input
                                id="item-value"
                                type="number"
                                min="0"
                                bind:value={newItemValue}
                                placeholder="0"
                                class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            />
                        </div>
                    </div>

                    <div>
                        <label for="item-category" class="block text-sm font-medium text-gray-300 mb-2">Category</label>
                        <input
                            id="item-category"
                            type="text"
                            bind:value={newItemCategory}
                            placeholder="e.g., Garden, Kitchen, Office..."
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                        />
                    </div>

                    <div>
                        <label for="item-description" class="block text-sm font-medium text-gray-300 mb-2">Description</label>
                        <textarea
                            id="item-description"
                            bind:value={newItemDescription}
                            placeholder="Add any notes about the item..."
                            rows="2"
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors resize-none"
                        ></textarea>
                    </div>

                    <div class="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            on:click={() => showInput = false}
                            class="btn btn--secondary"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="btn btn--primary"
                            disabled={!newItemName.trim()}
                        >
                            Add Item
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<!-- Borrow Modal with Calendar -->
{#if showBorrowModal && borrowingItem}
    <div
        class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        on:click|self={() => { showBorrowModal = false; borrowingItem = null; }}
        on:keydown|self={(e) => e.key === 'Escape' && (showBorrowModal = false, borrowingItem = null)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm relative border border-gray-700"
            aria-labelledby="borrow-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="borrow-title" class="text-white text-xl font-bold flex items-center gap-2">
                        <span class="text-2xl">{getItemIcon(borrowingItem)}</span>
                        Borrow {borrowingItem.id}
                    </h3>
                    <button
                        on:click={() => { showBorrowModal = false; borrowingItem = null; }}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>

                {#if borrowingItem.value > 0}
                    <div class="mb-4 p-3 bg-emerald-900/30 border border-emerald-600/30 rounded-lg">
                        <p class="text-emerald-300 text-sm">
                            <span class="font-medium">💳 Borrowing cost:</span> {borrowingItem.value} credits
                        </p>
                    </div>
                {/if}

                <div class="mb-4">
                    <label class="block text-sm font-medium text-gray-300 mb-3">Select return date:</label>

                    <!-- Calendar -->
                    <div class="bg-gray-700/50 rounded-xl p-4">
                        <!-- Month Navigation -->
                        <div class="flex items-center justify-between mb-4">
                            <button
                                on:click={prevMonth}
                                class="p-2 hover:bg-gray-600 rounded-lg transition-colors text-gray-300 hover:text-white"
                            >
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                                </svg>
                            </button>
                            <span class="text-white font-medium">
                                {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                            </span>
                            <button
                                on:click={nextMonth}
                                class="p-2 hover:bg-gray-600 rounded-lg transition-colors text-gray-300 hover:text-white"
                            >
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                                </svg>
                            </button>
                        </div>

                        <!-- Day Names -->
                        <div class="grid grid-cols-7 gap-1 mb-2">
                            {#each dayNames as day}
                                <div class="text-center text-xs text-gray-400 font-medium py-1">{day}</div>
                            {/each}
                        </div>

                        <!-- Calendar Days -->
                        <div class="grid grid-cols-7 gap-1">
                            {#each calendarDays as { day, selectable, isToday, isSelected }}
                                {#if day === 0}
                                    <div class="h-9"></div>
                                {:else}
                                    <button
                                        type="button"
                                        disabled={!selectable}
                                        on:click={() => selectDate(currentMonth.getFullYear(), currentMonth.getMonth(), day)}
                                        class="h-9 rounded-lg text-sm font-medium transition-all duration-200
                                            {isSelected ? 'bg-indigo-600 text-white' : ''}
                                            {isToday && !isSelected ? 'bg-gray-600 text-white ring-2 ring-indigo-400' : ''}
                                            {selectable && !isSelected && !isToday ? 'hover:bg-gray-600 text-gray-200' : ''}
                                            {!selectable ? 'text-gray-600 cursor-not-allowed' : ''}"
                                    >
                                        {day}
                                    </button>
                                {/if}
                            {/each}
                        </div>
                    </div>

                    {#if selectedReturnDate}
                        <p class="mt-3 text-center text-indigo-300 font-medium">
                            Return by: {formatReturnDate(selectedReturnDate)}
                        </p>
                    {/if}
                </div>

                <div class="flex justify-end gap-3 pt-4">
                    <button
                        type="button"
                        on:click={() => { showBorrowModal = false; borrowingItem = null; }}
                        class="btn btn--secondary"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        on:click={handleBorrow}
                        class="btn btn--primary"
                        disabled={!selectedReturnDate}
                    >
                        Confirm Borrow
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}

<!-- Item Detail Modal -->
{#if showItemDetail && selectedItem}
    <div
        class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        on:click|self={() => { showItemDetail = false; selectedItem = null; }}
        on:keydown|self={(e) => e.key === 'Escape' && (showItemDetail = false, selectedItem = null)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative border border-gray-700"
            aria-labelledby="item-detail-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="item-detail-title" class="text-white text-xl font-bold flex items-center gap-2">
                        <span class="text-2xl">{getItemIcon(selectedItem)}</span>
                        {selectedItem.id}
                    </h3>
                    <button
                        on:click={() => { showItemDetail = false; selectedItem = null; }}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>

                <div class="space-y-4">
                    <!-- Status -->
                    <div class="p-4 rounded-xl {selectedItem.borrowed ? (isOverdue(selectedItem.returnBy) ? 'bg-red-900/30 border border-red-600/30' : 'bg-amber-900/30 border border-amber-600/30') : 'bg-emerald-900/30 border border-emerald-600/30'}">
                        {#if selectedItem.borrowed}
                            <div class="flex items-center gap-2 mb-2">
                                {#if isOverdue(selectedItem.returnBy)}
                                    <span class="text-red-400 font-medium">🔴 Overdue</span>
                                {:else}
                                    <span class="text-amber-400 font-medium">🔄 Currently Borrowed</span>
                                {/if}
                            </div>
                            <p class="text-gray-300 text-sm">Borrowed by: <span class="text-white">{selectedItem.borrower || selectedItem.borrowerInitials}</span></p>
                            <p class="text-gray-300 text-sm">Return by: <span class="text-white">{formatReturnDate(selectedItem.returnBy)}</span></p>
                        {:else}
                            <p class="text-emerald-400 font-medium">✓ Available for borrowing</p>
                        {/if}
                    </div>

                    <!-- Details -->
                    <div class="space-y-3">
                        <div class="flex justify-between">
                            <span class="text-gray-400">Type</span>
                            <span class="text-white">{getTypeDisplayName(selectedItem.type)}</span>
                        </div>
                        {#if selectedItem.value > 0}
                            <div class="flex justify-between">
                                <span class="text-gray-400">Value</span>
                                <span class="text-emerald-300">{selectedItem.value} credits</span>
                            </div>
                        {/if}
                        {#if selectedItem.category && selectedItem.category !== 'Uncategorized'}
                            <div class="flex justify-between">
                                <span class="text-gray-400">Category</span>
                                <span class="text-white">{selectedItem.category}</span>
                            </div>
                        {/if}
                        <div class="flex justify-between">
                            <span class="text-gray-400">Owner</span>
                            <span class="text-white">{selectedItem.createdByUsername || 'Unknown'}</span>
                        </div>
                        {#if selectedItem.description}
                            <div>
                                <span class="text-gray-400 block mb-1">Description</span>
                                <p class="text-white text-sm bg-gray-700/50 p-3 rounded-lg">{selectedItem.description}</p>
                            </div>
                        {/if}
                    </div>
                </div>

                <div class="flex justify-between gap-3 pt-6">
                    <div>
                        {#if selectedItem.createdBy === currentUserId && !selectedItem.borrowed}
                            <button
                                type="button"
                                on:click={() => handleDelete(selectedItem.id)}
                                class="px-4 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-400 text-sm font-medium transition-colors border border-red-600/30"
                            >
                                Delete
                            </button>
                        {/if}
                    </div>
                    <div class="flex gap-3">
                        <button
                            type="button"
                            on:click={() => { showItemDetail = false; selectedItem = null; }}
                            class="btn btn--secondary"
                        >
                            Close
                        </button>
                        {#if !selectedItem.borrowed}
                            <button
                                type="button"
                                on:click={() => { showItemDetail = false; openBorrowModal(selectedItem); }}
                                class="btn btn--primary"
                            >
                                Borrow
                            </button>
                        {:else if selectedItem.borrowerId === currentUserId || selectedItem.borrower === currentUsername}
                            <button
                                type="button"
                                on:click={() => handleReturn(selectedItem)}
                                class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors"
                            >
                                Return
                            </button>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    .dot {
        transition: transform 0.3s ease-in-out;
    }
</style>
