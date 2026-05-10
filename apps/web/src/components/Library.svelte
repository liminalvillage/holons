<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { awaitName, resolveHologramSource, nameMap, resolveName, resolvedName, extractHolonIdFromSoul, buildHologramLink } from "$lib/stores/nameResolver";
    import { goto } from "$app/navigation";
    import { showFederated, showHolograms } from "$lib/stores/lensFilters";
    import SourceBadge from "./shared/SourceBadge.svelte";
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";
    import GenericImportModal from "./shared/GenericImportModal.svelte";
    import { Package, Plus, Calendar, List } from 'svelte-feathers';
    import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
    import { telegramStore } from '$lib/stores/telegram';
    import { nostrPublicKey } from '$lib/stores/nostr';
    import CalendarComponent from './Calendar.svelte';

    // Library item types
    const LIBRARY_TYPES = {
        TOOL: 'tool',
        BOOK: 'book',
        EQUIPMENT: 'equipment',
        OTHER: 'other'
    };

    interface Booking {
        id: string;
        start: string;        // YYYY-MM-DD (or ISO; we always read .slice(0,10))
        end: string;          // YYYY-MM-DD
        borrowerId: string;
        borrower: string;     // display name
        borrowerInitials?: string | null;
        createdAt: string;
    }

    interface LibraryItem {
        id: string;
        type: string;
        bookings?: Booking[];
        // Legacy single-borrow fields, kept for read-back compat with already
        // stored items. New bookings are written to `bookings`; we still
        // mirror onto these so the rest of the codebase keeps working.
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
        _federation?: {
            origin?: string;
            sourceLens?: string;
            propagatedAt?: number;
            originalId?: string;
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
        const isHologram = item._hologram?.isHologram === true;
        const isFederated = !!item._federation;
        if (!$showHolograms && isHologram) return false;
        if (!$showFederated && (isHologram || isFederated)) return false;

        const q = filters.searchQuery.trim().toLowerCase();
        if (q) {
            const hay = `${item.id ?? ''} ${item.description ?? ''} ${item.category ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }

        switch (filters.activeFilter) {
            case 'available':
                return !isCurrentlyBooked(item);
            case 'borrowed':
                return isCurrentlyBooked(item);
            case 'mine':
                return item.createdBy === currentUserId;
            default:
                return true;
        }
    });

    // Stats
    $: totalItems = libraryItems.filter(([_, item]) => !item._deleted).length;
    $: availableItems = libraryItems.filter(([_, item]) => !item._deleted && !isCurrentlyBooked(item)).length;
    $: borrowedItems = libraryItems.filter(([_, item]) => !item._deleted && isCurrentlyBooked(item)).length;
    $: myItems = libraryItems.filter(([_, item]) => !item._deleted && item.createdBy === currentUserId).length;

    // Shape borrowed items as borrowing-session records the Calendar component
    // can render. A single borrow is expanded into one entry per day in the
    // [borrowedAt, returnBy] range so the session shows on every day the user
    // selected, regardless of which calendar view is active. Each entry is
    // anchored at 9am local for hourly views and carries the item's stable
    // colour so a borrow is easy to follow visually from start to end.
    $: borrowedAsTasks = libraryItems
        .filter(([_, item]) => !item._deleted)
        .reduce((acc, [_, item]) => {
            const color = getItemColor(item.id);
            for (const booking of getDisplayBookings(item)) {
                const borrowerSuffix = booking.borrower ? ` — ${booking.borrower}` : '';
                const startMidnight = startOfDay(new Date(`${booking.start.slice(0, 10)}T00:00:00`));
                const endMidnight = startOfDay(new Date(`${booking.end.slice(0, 10)}T00:00:00`));
                for (let day = new Date(startMidnight); day.getTime() <= endMidnight.getTime(); day.setDate(day.getDate() + 1)) {
                    const dayIso = atLocalHour(day.toISOString(), 9);
                    const sessionId = `booking-${item.id}-${booking.id}-${formatDate(day)}`;
                    acc[sessionId] = {
                        id: sessionId,
                        title: `${item.id}${borrowerSuffix}`,
                        type: 'booking-session',
                        status: 'ongoing',
                        when: dayIso,
                        ends: addHours(dayIso, 1),
                        color,
                        _libraryItemId: item.id
                    };
                }
            }
            return acc;
        }, {} as Record<string, any>);

    function startOfDay(date: Date): Date {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    function atLocalHour(iso: string, hour: number): string {
        const d = new Date(iso);
        d.setHours(hour, 0, 0, 0);
        return d.toISOString();
    }

    function addHours(iso: string, hours: number): string {
        return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
    }

    function handleCalendarTaskClick(_key: string, task: any) {
        const itemId = task?._libraryItemId;
        const item = itemId ? store[itemId] : null;
        if (item) openItemDetail(item);
    }

    let showInput = false;
    let libraryView: 'list' | 'calendar' = 'list';
    // Per-feature filters (search + active tab). The federation/hologram
    // toggles are global — see $lib/stores/lensFilters.
    let filters = loadFilters('library', {
        searchQuery: '',
        activeFilter: 'all' as 'all' | 'available' | 'borrowed' | 'mine',
    });
    $: saveFilters('library', filters);
    $: activeFilter = filters.activeFilter;
    let libraryItemsUnsubscribe: (() => void) | undefined;
    let hologramSourceNames = new Map<string, string>();

    // Add item form state
    let newItemName = "";
    let newItemValue = 0;
    let newItemType = LIBRARY_TYPES.OTHER;
    let newItemCategory = "";
    let newItemDescription = "";

    // Booking modal state.
    let showBorrowModal = false;
    let borrowingItem: LibraryItem | null = null;
    let selectedStartDate: string = "";
    let selectedReturnDate: string = "";
    let currentMonth = new Date();
    let startCalendarMonth = new Date();
    // Default = "booking now" — start date is today and the calendar is hidden.
    let borrowNow: boolean = true;

    // Resolve the active borrower. Prefers Telegram (id + username, falling back
    // to first/last name); otherwise looks up the user's holon name from their
    // Nostr public key. Async because the holon-name lookup may hit holosphere.
    async function resolveBorrowerIdentity(): Promise<{ id: string; displayName: string; initials: string }> {
        const telegramUser = telegramStore.getState().user;
        if (telegramUser) {
            const username = telegramUser.username
                ? `@${telegramUser.username}`
                : [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ').trim()
                    || `tg-${telegramUser.id}`;
            const initialsSource = telegramUser.first_name || telegramUser.username || `${telegramUser.id}`;
            return {
                id: String(telegramUser.id),
                displayName: username,
                initials: (initialsSource.charAt(0) || '?').toUpperCase()
            };
        }

        const nostrPub = $nostrPublicKey;
        if (nostrPub) {
            let holonName: string | null = null;
            try {
                holonName = await awaitName(nostrPub);
            } catch (err) {
                console.warn('Failed to resolve borrower holon name:', err);
            }
            const shortKey = `${nostrPub.slice(0, 8)}…`;
            return {
                id: nostrPub,
                displayName: holonName ? `${holonName} (${shortKey})` : shortKey,
                initials: (holonName?.charAt(0) || nostrPub.charAt(0) || '?').toUpperCase()
            };
        }

        const id = currentUserId || '';
        const displayName = currentUsername || 'Unknown';
        return {
            id,
            displayName,
            initials: (displayName.charAt(0) || '?').toUpperCase()
        };
    }

    // Read-side: collect the canonical list of bookings for an item, falling
    // back to a synthesized one from the legacy single-borrow fields so old
    // data keeps showing up. New writes always go through `item.bookings`.
    function getDisplayBookings(item: LibraryItem): Booking[] {
        const list: Booking[] = Array.isArray(item.bookings) ? [...item.bookings] : [];
        if (list.length === 0 && item.borrowed && item.borrowedAt) {
            list.push({
                id: 'legacy',
                start: (item.borrowedAt as string).slice(0, 10),
                end: item.returnBy || (item.borrowedAt as string).slice(0, 10),
                borrowerId: item.borrowerId || '',
                borrower: item.borrower || item.borrowerInitials || 'Unknown',
                borrowerInitials: item.borrowerInitials,
                createdAt: item.borrowedAt as string
            });
        }
        list.sort((a, b) => a.start.localeCompare(b.start));
        return list;
    }

    function isBookingActive(b: Booking, on: Date = new Date()): boolean {
        const today = formatDate(on);
        const start = b.start.length > 10 ? b.start.slice(0, 10) : b.start;
        const end = b.end.length > 10 ? b.end.slice(0, 10) : b.end;
        return today >= start && today <= end;
    }

    function getActiveBooking(item: LibraryItem): Booking | null {
        return getDisplayBookings(item).find(b => isBookingActive(b)) ?? null;
    }

    function isCurrentlyBooked(item: LibraryItem): boolean {
        return getActiveBooking(item) !== null;
    }

    // Stable per-item color so each library item is visually distinguishable
    // both in the list and across its borrowing-session entries on the calendar.
    function getItemColor(itemId: string): string {
        let hash = 0;
        for (let i = 0; i < itemId.length; i++) {
            hash = itemId.charCodeAt(i) + ((hash << 5) - hash);
        }
        const hue = ((hash % 360) + 360) % 360;
        return `hsl(${hue}, 65%, 55%)`;
    }

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
                    const realName = await awaitName(holonId);
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
            if ($showFederated) {
                await fetchFederatedLibrary();
            } else {
                await fetchLocalLibrary();
            }
        } catch (error) {
            console.error('Error fetching library:', error);
        }
    }

    async function fetchLocalLibrary() {
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
    }

    async function fetchFederatedLibrary() {
        const federatedData = await holosphere.getFederated(holonID, "library", {
            includeLocal: true,
            includeFederated: true,
            resolveReferences: true,
            aggregate: false
        });

        const newStore: Record<string, LibraryItem> = {};
        if (Array.isArray(federatedData)) {
            federatedData.forEach((item: any, index: number) => {
                if (item && item.id && !item._deleted && item.hologram !== true) {
                    const key = item.key || item.id || `fed_${index}`;
                    const processed: any = { ...item, id: item.id };
                    if (item._federation) processed._federation = item._federation;
                    if (item._hologram) processed._hologram = item._hologram;
                    newStore[key] = processed as LibraryItem;
                }
            });
        }
        store = newStore;

        await preResolveHologramNames(Object.values(store));
    }

    let lastLibraryFedFlag = $showFederated;
    $: if (holonID && holosphere && $showFederated !== lastLibraryFedFlag) {
        lastLibraryFedFlag = $showFederated;
        fetchData();
    }

    onMount(() => {
        try {
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
            awaitName(newId).then(name => {
                holonName = name || 'Library';
            });
        }
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
        borrowNow = true;
        selectedStartDate = formatDate(new Date());
        selectedReturnDate = "";
        currentMonth = new Date();
        startCalendarMonth = new Date();
        showBorrowModal = true;
    }

    // Keep the start date pinned to today while "borrow now" is on; the user
    // toggles it off to switch to the start-date calendar.
    $: if (borrowNow) {
        selectedStartDate = formatDate(new Date());
    }

    async function handleBorrow() {
        if (!borrowingItem || !selectedReturnDate || !selectedStartDate || !holonID) return;

        const conflict = findOverlappingBooking(borrowingItem, selectedStartDate, selectedReturnDate);
        if (conflict) {
            alert(
                `That period overlaps an existing booking by ${conflict.borrower || 'someone'} ` +
                `(${formatReturnDate(conflict.start)} → ${formatReturnDate(conflict.end)}). ` +
                `Pick a range that doesn't intersect existing bookings.`
            );
            return;
        }

        const borrower = await resolveBorrowerIdentity();

        const newBooking: Booking = {
            id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            start: selectedStartDate,
            end: selectedReturnDate,
            borrowerId: borrower.id,
            borrower: borrower.displayName,
            borrowerInitials: borrower.initials,
            createdAt: new Date().toISOString()
        };

        const existing = Array.isArray(borrowingItem.bookings) ? borrowingItem.bookings : [];
        const updatedBookings = [...existing, newBooking];

        // Mirror onto legacy single-borrow fields if this booking covers today,
        // so callers/UI that still read those fields stay in sync.
        const isActiveNow = isBookingActive(newBooking);
        const updatedItem: LibraryItem = {
            ...borrowingItem,
            bookings: updatedBookings,
            ...(isActiveNow ? {
                borrowed: true,
                borrower: borrower.displayName,
                borrowerId: borrower.id,
                borrowerInitials: borrower.initials,
                borrowedAt: new Date(`${selectedStartDate}T00:00:00`).toISOString(),
                returnBy: selectedReturnDate
            } : {})
        };

        store = { ...store, [updatedItem.id]: updatedItem };

        try {
            await holosphere.put(holonID, "library", updatedItem);
        } catch (err) {
            console.error("Failed to save booking", err);
            store = { ...store, [borrowingItem.id]: borrowingItem };
        }

        showBorrowModal = false;
        borrowingItem = null;
    }

    async function handleReturn(item: LibraryItem) {
        if (!holonID) return;

        // Active booking (today is between start and end). Without one there
        // is nothing to return.
        const active = getActiveBooking(item);
        const borrower = await resolveBorrowerIdentity();
        const activeBorrowerId = active?.borrowerId ?? item.borrowerId;
        const activeBorrowerName = active?.borrower ?? item.borrower;
        const isBorrower =
            activeBorrowerId === borrower.id ||
            activeBorrowerName === borrower.displayName ||
            activeBorrowerId === currentUserId ||
            activeBorrowerName === currentUsername;
        if (!isBorrower) {
            alert(`Only ${activeBorrowerName || 'the borrower'} can return this item.`);
            return;
        }

        const remainingBookings = (Array.isArray(item.bookings) ? item.bookings : [])
            .filter(b => b.id !== active?.id);

        const updatedItem: LibraryItem = {
            ...item,
            bookings: remainingBookings,
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
            alert("Cannot delete a booked item. Please wait for it to be returned.");
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

    // ---- Overlap detection ---------------------------------------------------
    // Bookings are stored as YYYY-MM-DD strings, so plain string comparison
    // gives the right ordering for half-open ranges.

    function dayKey(s: string): string {
        return s.length > 10 ? s.slice(0, 10) : s;
    }

    function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
        return dayKey(aStart) <= dayKey(bEnd) && dayKey(aEnd) >= dayKey(bStart);
    }

    function isDayBooked(item: LibraryItem, dateStr: string): boolean {
        const day = dayKey(dateStr);
        return getDisplayBookings(item).some(b =>
            day >= dayKey(b.start) && day <= dayKey(b.end)
        );
    }

    // Returns the next booking that starts strictly after `startDate`. Used to
    // cap the selectable return-date range so the new booking can't span an
    // existing one.
    function getNextBookingAfter(item: LibraryItem, startDate: string): Booking | null {
        const cutoff = dayKey(startDate);
        const future = getDisplayBookings(item)
            .filter(b => dayKey(b.start) > cutoff)
            .sort((a, b) => dayKey(a.start).localeCompare(dayKey(b.start)));
        return future[0] ?? null;
    }

    function findOverlappingBooking(item: LibraryItem, start: string, end: string): Booking | null {
        for (const b of getDisplayBookings(item)) {
            if (rangesOverlap(start, end, b.start, b.end)) return b;
        }
        return null;
    }

    // ---- Calendar selectability ---------------------------------------------

    function isStartDateSelectable(year: number, month: number, day: number): boolean {
        if (!borrowingItem) return true;
        const dateStr = formatDate(new Date(year, month, day));
        return !isDayBooked(borrowingItem, dateStr);
    }

    function isReturnDateSelectable(year: number, month: number, day: number): boolean {
        const date = new Date(year, month, day);
        date.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Return must be today-or-later, and never before the chosen start.
        if (date < today) return false;
        if (selectedStartDate) {
            const start = new Date(`${selectedStartDate}T00:00:00`);
            start.setHours(0, 0, 0, 0);
            if (date < start) return false;
        }

        if (!borrowingItem) return true;
        const dateStr = formatDate(date);
        // Block any day already inside another booking.
        if (isDayBooked(borrowingItem, dateStr)) return false;
        // And block return dates that would extend over the next booking.
        if (selectedStartDate) {
            const next = getNextBookingAfter(borrowingItem, selectedStartDate);
            if (next && dateStr >= dayKey(next.start)) return false;
        }
        return true;
    }

    function selectReturnDate(year: number, month: number, day: number) {
        if (isReturnDateSelectable(year, month, day)) {
            selectedReturnDate = formatDate(new Date(year, month, day));
        }
    }

    function selectStartDate(year: number, month: number, day: number) {
        if (!isStartDateSelectable(year, month, day)) return;
        selectedStartDate = formatDate(new Date(year, month, day));
        // Drop a return date that's now earlier than the new start, or that
        // would now span over a booking that comes after the new start.
        if (selectedReturnDate) {
            if (new Date(`${selectedReturnDate}T00:00:00`) < new Date(`${selectedStartDate}T00:00:00`)) {
                selectedReturnDate = "";
            } else if (borrowingItem) {
                const next = getNextBookingAfter(borrowingItem, selectedStartDate);
                if (next && selectedReturnDate >= dayKey(next.start)) {
                    selectedReturnDate = "";
                }
            }
        }
    }

    function prevMonth() {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
    }

    function nextMonth() {
        currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
    }

    function prevStartMonth() {
        startCalendarMonth = new Date(startCalendarMonth.getFullYear(), startCalendarMonth.getMonth() - 1, 1);
    }

    function nextStartMonth() {
        startCalendarMonth = new Date(startCalendarMonth.getFullYear(), startCalendarMonth.getMonth() + 1, 1);
    }

    function buildCalendarDays(
        month: Date,
        selectedDate: string,
        isSelectable: (y: number, m: number, d: number) => boolean
    ) {
        const days: { day: number; selectable: boolean; isToday: boolean; isSelected: boolean }[] = [];
        const daysInMonth = getDaysInMonth(month);
        const firstDay = getFirstDayOfMonth(month);
        const today = new Date();

        for (let i = 0; i < firstDay; i++) {
            days.push({ day: 0, selectable: false, isToday: false, isSelected: false });
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = formatDate(new Date(month.getFullYear(), month.getMonth(), day));
            const isToday = today.getDate() === day &&
                           today.getMonth() === month.getMonth() &&
                           today.getFullYear() === month.getFullYear();
            days.push({
                day,
                selectable: isSelectable(month.getFullYear(), month.getMonth(), day),
                isToday,
                isSelected: dateStr === selectedDate
            });
        }

        return days;
    }

    $: calendarDays = buildCalendarDays(currentMonth, selectedReturnDate, isReturnDateSelectable);
    $: startCalendarDays = buildCalendarDays(startCalendarMonth, selectedStartDate, isStartDateSelectable);

    // Inline conflict check shown in the booking modal. Runs reactively so the
    // user sees feedback as they pick dates, and also gates the Confirm button.
    $: bookingConflict = (() => {
        if (!borrowingItem || !selectedStartDate || !selectedReturnDate) return null;
        return findOverlappingBooking(borrowingItem, selectedStartDate, selectedReturnDate);
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

    let showImportModal = false;

    async function handleImport(event: CustomEvent<any[]>) {
        if (!holonID) return;
        const items = event.detail;
        try {
            for (const raw of items) {
                const src = raw ?? {};
                const id = String(src.id ?? src.name ?? src.title ?? src.text ?? '').trim();
                if (!id || store[id]) continue;
                const itemType = src.type && Object.values(LIBRARY_TYPES).includes(src.type)
                    ? src.type
                    : detectItemType(id);
                const newItem: LibraryItem = {
                    id,
                    type: itemType,
                    borrowed: false,
                    borrower: null,
                    borrowerId: null,
                    borrowerInitials: null,
                    borrowedAt: null,
                    returnBy: null,
                    createdBy: currentUserId,
                    createdByUsername: currentUsername,
                    category: String(src.category ?? 'Uncategorized'),
                    description: String(src.description ?? ''),
                    value: Number(src.value ?? 0) || 0,
                    created: new Date().toISOString()
                };
                store = { ...store, [newItem.id]: newItem };
                await holosphere.put(holonID, "library", newItem);
            }
            showImportModal = false;
        } catch (err) {
            console.error("Failed to import library items", err);
        }
    }
</script>

<div class="space-y-4">
    <!-- TitleBar -->
    <TitleBar {holonName} holonId={holonID} showLensFilters title="Library" icon={Package} />

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
                    <span class="stats-bar__label">Booked</span>
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

            <FeatureToolbar
                onAdd={libraryView === 'list' ? showAddInput : null}
                addLabel="Add Item"
                onImport={libraryView === 'list' ? () => (showImportModal = true) : null}
                importLabel="Import"
                bind:searchQuery={filters.searchQuery}
                searchPlaceholder="Search library…"
                viewMode={libraryView}
                viewModes={[
                    { value: 'list', label: 'List', icon: List },
                    { value: 'calendar', label: 'Calendar', icon: Calendar }
                ]}
                on:viewChange={(e) => (libraryView = e.detail as 'list' | 'calendar')}
            >
                <svelte:fragment slot="filters">
                    {#if libraryView === 'list'}
                        <div class="filter-tabs">
                            <button
                                on:click={() => (filters.activeFilter = 'all')}
                                class="filter-tabs__btn {filters.activeFilter === 'all' ? 'filter-tabs__btn--active' : ''}"
                            >All</button>
                            <button
                                on:click={() => (filters.activeFilter = 'available')}
                                class="filter-tabs__btn {filters.activeFilter === 'available' ? 'filter-tabs__btn--active' : ''}"
                            >Available</button>
                            <button
                                on:click={() => (filters.activeFilter = 'borrowed')}
                                class="filter-tabs__btn {filters.activeFilter === 'borrowed' ? 'filter-tabs__btn--active' : ''}"
                            >Booked</button>
                            <button
                                on:click={() => (filters.activeFilter = 'mine')}
                                class="filter-tabs__btn {filters.activeFilter === 'mine' ? 'filter-tabs__btn--active' : ''}"
                            >Mine</button>
                        </div>
                    {/if}
                </svelte:fragment>
            </FeatureToolbar>

            {#if libraryView === 'calendar'}
                <CalendarComponent
                    customItems={borrowedAsTasks}
                    readOnly
                    embedded
                    onTaskClick={handleCalendarTaskClick}
                />
            {/if}

            <!-- Library Items -->
            {#if libraryView === 'list'}
            <div class="space-y-3">
                {#each filteredItems as [key, item]}
                    {@const itemColor = getItemColor(item.id)}
                    {@const itemBookings = getDisplayBookings(item)}
                    {@const activeBooking = getActiveBooking(item)}
                    {@const booked = activeBooking !== null}
                    <div id={key} class="w-full">
                        <div
                            class="p-4 rounded-xl transition-all duration-300 border hover:shadow-md transform hover:scale-[1.005] cursor-pointer
                                {!booked ? 'bg-gray-700 hover:bg-gray-600 hover:border-gray-500' : ''}
                                {!item._hologram?.isHologram && !booked ? 'border-transparent' : ''}
                                {booked && !isOverdue(activeBooking?.end ?? null) ? 'bg-amber-900/30 border-amber-600/50' : ''}
                                {booked && isOverdue(activeBooking?.end ?? null) ? 'bg-red-900/30 border-red-600/50' : ''}
                                {item._hologram?.isHologram ? 'opacity-75 border-2' : ''}
                                {item._hologram?.isHologram && !booked ? 'border-indigo-500' : ''}"
                            style="border-left: 4px solid {itemColor};{item._hologram?.isHologram ? ' box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), inset 0 0 20px rgba(99, 102, 241, 0.1);' : ''}"
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
                                        {!booked ? 'bg-black/20' : ''}
                                        {booked && !isOverdue(activeBooking?.end ?? null) ? 'bg-amber-600/20' : ''}
                                        {booked && isOverdue(activeBooking?.end ?? null) ? 'bg-red-600/20' : ''}">
                                        <span class="text-xl">{getItemIcon(item)}</span>
                                    </div>

                                    <!-- Main Content -->
                                    <div class="flex-1 min-w-0">
                                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                                            <h3 class="text-base font-bold text-white break-words">
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
                                            <SourceBadge {item} currentHolonId={holonID} lensRoute="library" />
                                        </div>
                                        <div class="text-sm text-gray-400">
                                            {#if !booked}
                                                <span class="text-emerald-400">✓ Available</span>
                                                {#if item.createdByUsername}
                                                    <span> • Owner: {item.createdByUsername}</span>
                                                {/if}
                                            {/if}
                                        </div>
                                        {#if itemBookings.length > 0}
                                            <ul class="mt-2 space-y-1">
                                                {#each itemBookings as booking (booking.id)}
                                                    {@const active = isBookingActive(booking)}
                                                    {@const overdue = active && isOverdue(booking.end)}
                                                    <li class="text-xs flex items-center justify-between gap-2 px-2 py-1 rounded
                                                        {active && !overdue ? 'bg-amber-900/30 text-amber-200' : ''}
                                                        {overdue ? 'bg-red-900/30 text-red-200' : ''}
                                                        {!active ? 'bg-gray-700/40 text-gray-300' : ''}">
                                                        <span class="font-medium truncate">{booking.borrower || '—'}</span>
                                                        <span class="whitespace-nowrap text-gray-300">
                                                            {formatReturnDate(booking.start)} → {formatReturnDate(booking.end)}
                                                            {#if overdue}<span class="ml-1 text-red-300">• overdue</span>{/if}
                                                        </span>
                                                    </li>
                                                {/each}
                                            </ul>
                                        {/if}
                                    </div>
                                </div>

                                <!-- Right Side - Action Button -->
                                <div class="flex items-center gap-2 flex-shrink-0">
                                    {#if !booked}
                                        <button
                                            on:click|stopPropagation={() => openBorrowModal(item)}
                                            class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
                                            aria-label="Book {item.id}"
                                        >
                                            Book
                                        </button>
                                    {:else if activeBooking && (activeBooking.borrowerId === currentUserId || activeBooking.borrower === currentUsername)}
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
                                No booked items
                            {:else}
                                You haven't added any items
                            {/if}
                        </h3>
                        <p class="text-gray-400 mb-4">
                            {#if activeFilter === 'all' || activeFilter === 'mine'}
                                Share tools, books, or equipment with your community
                            {:else if activeFilter === 'available'}
                                All items are currently booked
                            {:else}
                                No items are currently booked
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
            {/if}
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
                        Book {borrowingItem.id}
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
                            <span class="font-medium">💳 Booking cost:</span> {borrowingItem.value} credits
                        </p>
                    </div>
                {/if}

                <div class="mb-4">
                    <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                        <input type="checkbox" bind:checked={borrowNow} class="accent-indigo-500" />
                        <span>Book starting now</span>
                    </label>
                </div>

                {#if !borrowNow}
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-300 mb-3">Select start date:</label>

                        <!-- Start-date calendar -->
                        <div class="bg-gray-700/50 rounded-xl p-4">
                            <!-- Month Navigation -->
                            <div class="flex items-center justify-between mb-4">
                                <button
                                    on:click={prevStartMonth}
                                    class="p-2 hover:bg-gray-600 rounded-lg transition-colors text-gray-300 hover:text-white"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                                    </svg>
                                </button>
                                <span class="text-white font-medium">
                                    {monthNames[startCalendarMonth.getMonth()]} {startCalendarMonth.getFullYear()}
                                </span>
                                <button
                                    on:click={nextStartMonth}
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
                                {#each startCalendarDays as { day, selectable, isToday, isSelected }}
                                    {#if day === 0}
                                        <div class="h-9"></div>
                                    {:else}
                                        <button
                                            type="button"
                                            disabled={!selectable}
                                            on:click={() => selectStartDate(startCalendarMonth.getFullYear(), startCalendarMonth.getMonth(), day)}
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

                        {#if selectedStartDate}
                            <p class="mt-3 text-center text-indigo-300 font-medium">
                                Starts: {formatReturnDate(selectedStartDate)}
                            </p>
                        {/if}
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
                                        on:click={() => selectReturnDate(currentMonth.getFullYear(), currentMonth.getMonth(), day)}
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
                        disabled={!selectedReturnDate || !selectedStartDate || !!bookingConflict}
                    >
                        Confirm Booking
                    </button>
                </div>
                {#if bookingConflict}
                    <p class="mt-3 text-sm text-red-300 bg-red-900/30 border border-red-600/40 rounded-lg p-2">
                        ⚠️ Conflicts with {bookingConflict.borrower || 'an existing booking'}
                        ({formatReturnDate(bookingConflict.start)} → {formatReturnDate(bookingConflict.end)}).
                        Pick a different period.
                    </p>
                {/if}
            </div>
        </div>
    </div>
{/if}

<!-- Item Detail Modal -->
{#if showItemDetail && selectedItem}
    {@const detailBookings = getDisplayBookings(selectedItem)}
    {@const detailActive = getActiveBooking(selectedItem)}
    {@const detailBooked = detailActive !== null}
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
                    <h3 id="item-detail-title" class="text-white text-xl font-bold flex items-center gap-2 break-words">
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
                    <div class="p-4 rounded-xl {detailBooked ? (isOverdue(detailActive?.end ?? null) ? 'bg-red-900/30 border border-red-600/30' : 'bg-amber-900/30 border border-amber-600/30') : 'bg-emerald-900/30 border border-emerald-600/30'}">
                        {#if detailBooked && detailActive}
                            <div class="flex items-center gap-2 mb-2">
                                {#if isOverdue(detailActive.end)}
                                    <span class="text-red-400 font-medium">🔴 Overdue</span>
                                {:else}
                                    <span class="text-amber-400 font-medium">🔄 Currently Booked</span>
                                {/if}
                            </div>
                            <p class="text-gray-300 text-sm">Booked by: <span class="text-white">{detailActive.borrower}</span></p>
                            <p class="text-gray-300 text-sm">From: <span class="text-white">{formatReturnDate(detailActive.start)}</span></p>
                            <p class="text-gray-300 text-sm">Until: <span class="text-white">{formatReturnDate(detailActive.end)}</span></p>
                        {:else}
                            <p class="text-emerald-400 font-medium">✓ Available for booking</p>
                        {/if}
                    </div>

                    <!-- All bookings -->
                    {#if detailBookings.length > 0}
                        <div class="p-3 rounded-xl bg-gray-700/50 border border-gray-600/40">
                            <div class="text-xs text-gray-400 font-medium uppercase mb-2">Bookings</div>
                            <ul class="space-y-1">
                                {#each detailBookings as booking (booking.id)}
                                    {@const active = isBookingActive(booking)}
                                    <li class="flex items-center justify-between gap-2 text-sm
                                        {active ? 'text-amber-200' : 'text-gray-300'}">
                                        <span class="truncate">{booking.borrower || '—'}</span>
                                        <span class="whitespace-nowrap">
                                            {formatReturnDate(booking.start)} → {formatReturnDate(booking.end)}
                                        </span>
                                    </li>
                                {/each}
                            </ul>
                        </div>
                    {/if}

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
                        {#if selectedItem.createdBy === currentUserId && detailBookings.length === 0}
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
                        <button
                            type="button"
                            on:click={() => { const it = selectedItem!; showItemDetail = false; openBorrowModal(it); }}
                            class="btn btn--primary"
                        >
                            Book
                        </button>
                        {#if detailActive && (detailActive.borrowerId === currentUserId || detailActive.borrower === currentUsername)}
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

<GenericImportModal
    bind:open={showImportModal}
    title="Import Library Items"
    itemNoun="items"
    helpText="Paste a JSON array of items or one name per line. Required: name. Type is auto-detected if omitted."
    sampleJson={`[
  {
    "name": "Cordless Drill",
    "type": "tool",
    "category": "Power Tools",
    "description": "18V, 2 batteries",
    "value": 120
  },
  {
    "name": "The Pragmatic Programmer",
    "type": "book",
    "category": "Software"
  }
]`}
    on:import={handleImport}
    on:close={() => (showImportModal = false)}
/>

