<script lang="ts">
	// @ts-nocheck
    import { onMount, getContext } from "svelte";
    import { ID, walletAddress } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { ethers } from 'ethers';
    import User from "./User.svelte";
    import PieChart3D from "./PieChart3D.svelte";
    import { calculateCurrencyBalance, expenseCurrency } from "../utils/expenseCalculations";
    import { migrateEquation, type ScoreEquation } from "$lib/scoring/ContributionScoring";
    import { REAAggregator, ZERO_USER_AGGREGATES, type UserAggregates } from "@holons/core/scoring";
    import { getEventStore } from "../lib/rea/eventStore";
    import TitleBar from "./shared/TitleBar.svelte";
    import { nameMap, resolvedName, resolveName, resolvedInitials } from '$lib/stores/nameResolver';
    import { HolonsManager } from "../lib/holons/HolonsManager";
    interface User {
        id?: string;
        username?: string;
        first_name: string;
        last_name?: string;
        initiated: string[];
        completed: string[];
        sent: number;
        received: number;
        hours: number;
        collaboration: number;
        wants: string[];
        offers: string[];
    }

    type Equation = ScoreEquation;

    interface Expense {
        id: string;
        amount: number;
        currency: string;
        description: string;
        paidBy: string;
        splitWith: string[];
        date: string;
    }

    let store: Record<string, User> = {};
    let expenseStore: Record<string, Expense> = {};
    let availableCurrencies: string[] = [];
    let holonID: string;
    $: holonName = resolvedName(holonID, $nameMap, null, 'Status');
    let holosphere = getContext("holosphere") as HoloSphere;
    let valueEquationLoaded = false;
    let selectedUserId: string | null = null;
    let showUserModal = false;
    let currenciesLoaded = false;
    let expensesLoaded = false;
    let currencyBalanceCache: Record<string, number> = {};
    // REA-derived aggregates keyed by user.id. Falls back to zero while
    // the per-user query is in flight (table keeps rendering).
    let aggregatesByUser: Record<string, UserAggregates> = {};
    function userAggregates(user: User, userKey: string): UserAggregates {
        const id = String(user.id || userKey);
        return aggregatesByUser[id] ?? ZERO_USER_AGGREGATES;
    }

    // Contract share state
    let manager: HolonsManager | null = null;
    let contractShares: Record<string, { sharePercent: number; etherFormatted: string }> = {};
    let contractSharesLoaded = false;

    // Initialize equation with default values
    let equation: Equation = migrateEquation({
        initiated: 1,
        completed: 1,
        sent: 1,
        received: 1,
        collaboration: 1,
        wants: 1,
        offers: 1,
        currencies: { hour: 1 }
    });

    // Add state for editing
    let isEditingEquation = false;
    let editingEquation: Equation = { ...equation, currencies: { ...equation.currencies } };

    // Score breakdown popover state
    let breakdownUserId: string | null = null;

    // Add currency state
    let showAddCurrencyModal = false;
    let newCurrencyInput = '';

    function closeCurrencyModal() {
        showAddCurrencyModal = false;
        newCurrencyInput = '';
    }

    function openCurrencyModal() {
        showAddCurrencyModal = true;
    }

    // Coerce a raw equation field to a finite number. type="number" inputs
    // can hand back '', null, or NaN when the user clears them; without
    // this step the equation round-trips through JSON as null and the value
    // appears lost on next load.
    function toNumber(v: unknown): number {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    // Function to save equation changes
    async function saveEquation() {
        try {
            const settings = await holosphere.getAll(holonID, 'settings');
            const currentSettings = settings && settings[0] ? settings[0] : {};

            // Coerce every numeric field before migrating so a blank input
            // (which the browser hands us as null/NaN) doesn't poison the
            // saved record.
            const normalizedCurrencies: Record<string, number> = {};
            for (const [c, w] of Object.entries(editingEquation.currencies ?? {})) {
                normalizedCurrencies[c] = toNumber(w);
            }
            // Strip any legacy top-level `hours` before normalizing — the
            // canonical hour weight is at currencies.hour and we don't want
            // the deprecated field to round-trip back into settings.
            const { hours: _dropHours, ...editingNoHours } =
                editingEquation as Equation & { hours?: number };
            const normalized: Equation = {
                ...editingNoHours,
                initiated:      toNumber(editingEquation.initiated),
                completed:      toNumber(editingEquation.completed),
                sent:           toNumber(editingEquation.sent),
                received:       toNumber(editingEquation.received),
                collaboration:  toNumber(editingEquation.collaboration),
                wants:          toNumber(editingEquation.wants),
                offers:         toNumber(editingEquation.offers),
                participation:  toNumber(editingEquation.participation),
                coParticipants: toNumber(editingEquation.coParticipants),
                activity:       toNumber(editingEquation.activity),
                groupSize:      toNumber(editingEquation.groupSize),
                variance:       toNumber(editingEquation.variance),
                currencies:     normalizedCurrencies,
            };

            // Always save the migrated shape (no top-level `hours` field).
            // Stamp `id: holonID` so this record collides with the bot's
            // settings (which reads via db.get(holonId,'settings',holonId)) —
            // otherwise the two UIs can diverge into separate settings docs.
            const cleanEquation = migrateEquation(normalized);
            const updatedSettings = {
                ...currentSettings,
                id: holonID,
                valueEquation: cleanEquation
            };

            await holosphere.put(holonID, 'settings', updatedSettings);
            equation = cleanEquation;
            isEditingEquation = false;
            console.log('[Status] Value equation saved', cleanEquation);
        } catch (error) {
            console.error('Error saving value equation:', error);
        }
    }

    // Function to cancel editing
    function cancelEditing() {
        editingEquation = { ...equation, currencies: { ...equation.currencies } };
        isEditingEquation = false;
    }

    // Function to adjust value with arrows. Negative weights are allowed
    // (e.g. to penalize a metric); the equation just sums weight × count.
    function adjustValue(metric: keyof Equation, delta: number) {
        const current = Number((editingEquation as any)[metric]) || 0;
        editingEquation = { ...editingEquation, [metric]: current + delta };
    }

    // Function to adjust currency weight. Negative weights are allowed for
    // the same reason as the built-in metrics.
    function adjustCurrencyWeight(currency: string, delta: number) {
        const currentWeight = Number(editingEquation.currencies[currency]) || 0;
        editingEquation = {
            ...editingEquation,
            currencies: { ...editingEquation.currencies, [currency]: currentWeight + delta }
        };
    }

    // Function to add a new currency
    async function addNewCurrency() {
        if (!newCurrencyInput.trim()) return;

        try {
            // Get current settings first to check for existing currencies
            const settings = await holosphere.getAll(holonID, 'settings');
            const currentSettings = settings && settings[0] ? settings[0] : {};
            const existingCurrencies = Array.isArray(currentSettings.currencies) ? currentSettings.currencies : [];

            // Parse input and filter out duplicates (check against both local and saved currencies)
            const allExisting = new Set([...availableCurrencies, ...existingCurrencies].map(c => c.toLowerCase()));
            const currenciesToAdd = newCurrencyInput
                .split(/[,\s]+/)
                .map(c => c.trim().toLowerCase())
                .filter(c => c && !allExisting.has(c));

            if (currenciesToAdd.length === 0) {
                closeCurrencyModal();
                return;
            }

            // Use Set to ensure no duplicates in final array
            const uniqueCurrencies = [...new Set([...existingCurrencies, ...currenciesToAdd])];

            const updatedSettings = {
                ...currentSettings,
                id: holonID,
                currencies: uniqueCurrencies
            };

            await holosphere.put(holonID, 'settings', updatedSettings);

            // Update local state with unique currencies
            availableCurrencies = [...new Set([...availableCurrencies, ...currenciesToAdd])];

            // Initialize weights for new currencies (immutable update so the
            // equation editor re-renders the new currency cards).
            const newWeights = { ...equation.currencies };
            currenciesToAdd.forEach(currency => {
                if (!(currency in newWeights)) newWeights[currency] = 0;
            });
            equation = { ...equation, currencies: newWeights };
            editingEquation = { ...editingEquation, currencies: { ...newWeights } };

            newCurrencyInput = '';
            showAddCurrencyModal = false;
            console.log('Currencies added:', currenciesToAdd);
        } catch (error) {
            console.error('Error adding currency:', error);
        }
    }

    onMount(async () => {
        // Initialize from URL params first (priority), fallback to ID store
        const urlId = $page.params.id;
        const storeId = $ID;
        
        // Use URL parameter if available, otherwise use store value
        holonID = urlId || storeId;
        
        // If we have URL param, update the store to keep them in sync
        if (urlId && urlId !== storeId) {
            ID.set(urlId);
        }
        
        // Set up ID store subscription for future changes (skip initial value)
        let isFirstCall = true;
        const unsubscribe = ID.subscribe((value) => {
            if (isFirstCall) {
                isFirstCall = false;
                return; // Skip the initial subscription call
            }
            
            if (value && value !== holonID) {
            holonID = value;
                // Resolve holon name reactively
                resolveName(value);
                store = {}; // Reset store
                valueEquationLoaded = false;
                currenciesLoaded = false;
                expensesLoaded = false;
                contractSharesLoaded = false;
                expenseStore = {};
                availableCurrencies = [];
                contractShares = {};
                aggregatesByUser = {};
                aggregatesLoaded = false;
                reaSubscribedFor = null;
                loadEquation();
                loadContractShares();
                fetchInitialUsersAndSubscribe();
                subscribeToSettings();
                subscribeToExpenses();

                // Fallback timeout to ensure loading completes
                setTimeout(() => {
                    if (!currenciesLoaded) {
                        currenciesLoaded = true;
                    }
                    if (!expensesLoaded) {
                        expensesLoaded = true;
                    }
                }, 5000); // 5 second timeout
            }
        });

        // Watch for page parameter changes
        const pageUnsubscribe = page.subscribe((pageValue) => {
            const newId = pageValue.params.id;
            if (newId && newId !== holonID) {
                holonID = newId;
                // Update the ID store to keep it in sync
                ID.set(newId);
                store = {}; // Reset store
                valueEquationLoaded = false;
                currenciesLoaded = false;
                expensesLoaded = false;
                contractSharesLoaded = false;
                expenseStore = {};
                availableCurrencies = [];
                contractShares = {};
                aggregatesByUser = {};
                aggregatesLoaded = false;
                reaSubscribedFor = null;
                loadEquation();
                loadContractShares();
                fetchInitialUsersAndSubscribe();
                subscribeToSettings();
                subscribeToExpenses();

                // Fallback timeout to ensure loading completes
                setTimeout(() => {
                    if (!currenciesLoaded) {
                        currenciesLoaded = true;
                    }
                    if (!expensesLoaded) {
                        expensesLoaded = true;
                    }
                }, 5000); // 5 second timeout
            }
        });

        // Initial load if we have an ID
        if (holonID) {
            loadEquation();
            loadContractShares();
            fetchInitialUsersAndSubscribe();
            subscribeToSettings();
            subscribeToExpenses();

            // Fallback timeout to ensure loading completes
            setTimeout(() => {
                if (!currenciesLoaded) {
                    currenciesLoaded = true;
                }
                if (!expensesLoaded) {
                    expensesLoaded = true;
                }
            }, 5000); // 5 second timeout
        }

        // Cleanup subscriptions
        return () => {
            unsubscribe();
            pageUnsubscribe();
        };
    });

    async function loadEquation() {
        try {
            const settings = await holosphere.getAll(holonID, 'settings');
            const stored = settings && settings[0]?.valueEquation;
            if (stored && typeof stored === 'object') {
                equation = migrateEquation(stored);
                // If the stored shape was the legacy one with a top-level
                // `hours` field, persist the migrated form so we don't keep
                // re-running this on every load. Best-effort; ignore failures.
                if (typeof (stored as any).hours === 'number') {
                    holosphere.put(holonID, 'settings', {
                        ...(settings[0] || {}),
                        id: holonID,
                        valueEquation: equation
                    }).catch((e: any) => console.warn('[Status] Could not persist migrated equation:', e?.message));
                }
            } else {
                equation = migrateEquation(undefined);
            }
            valueEquationLoaded = true;
        } catch (error) {
            console.error('Error loading equation settings:', error);
            valueEquationLoaded = true;
        }
    }

    // Load contract shares for interior members
    async function loadContractShares() {
        if (!holosphere || !holonID) {
            contractSharesLoaded = true;
            return;
        }

        try {
            // Initialize manager if we have a wallet connection
            if ($walletAddress && window.ethereum) {
                const provider = new ethers.BrowserProvider(window.ethereum);
                manager = new HolonsManager(provider, holosphere);
                await manager.initialize();

                // Get interior members with their shares
                const members = await manager.getInteriorMembersWithBalances(holonID);

                // Convert to lookup by userId
                contractShares = {};
                for (const member of members) {
                    contractShares[member.userId] = {
                        sharePercent: member.sharePercent,
                        etherFormatted: member.etherFormatted
                    };
                }
            }
            contractSharesLoaded = true;
        } catch (error) {
            console.error('Error loading contract shares:', error);
            contractSharesLoaded = true;
        }
    }

    // Settings.currencies is the single source of truth for the currency
    // list. We do NOT derive currencies from expenses anymore — instead we
    // auto-merge any orphan currencies found in expenses into settings on
    // first observation (best-effort; silent if write is denied).
    let settingsAutoMerged = false;
    let currentSettingsSnapshot: any = null;

    async function subscribeToSettings() {
        if (!holosphere || !holonID) return;

        try {
            availableCurrencies = [];
            holosphere.subscribe(holonID, "settings", (settingsData: any) => {
                currentSettingsSnapshot = settingsData ?? {};
                const stored: string[] = Array.isArray(settingsData?.currencies)
                    ? settingsData.currencies.filter((c: unknown) => typeof c === 'string')
                    : [];
                applyCurrencyList(stored);
                currenciesLoaded = true;
                maybeAutoMergeOrphanCurrencies();
            });
            currenciesLoaded = true;
        } catch (error) {
            console.error('Error subscribing to settings:', error);
            availableCurrencies = [];
            currenciesLoaded = true;
        }
    }

    // Apply a settings-derived currency list, augmenting it with 'hour'
    // whenever any time-tracking expenses exist (so the hour balance shows
    // up in the table even before an admin adds it to settings).
    function applyCurrencyList(stored: string[]) {
        const set = new Set(stored.map(c => c.toLowerCase()));
        if (hasHourExpenses()) set.add('hour');
        const next = [...set];
        const changed = JSON.stringify(next.sort()) !== JSON.stringify([...availableCurrencies].sort());
        if (changed) availableCurrencies = next;
    }

    function hasHourExpenses(): boolean {
        for (const e of Object.values(expenseStore)) {
            if (expenseCurrency(e as any) === 'hour') return true;
        }
        return false;
    }

    // If expenses contain currencies that aren't in settings.currencies,
    // merge them once (best-effort write — anyone without permission will
    // just see the union, no harm).
    async function maybeAutoMergeOrphanCurrencies() {
        if (settingsAutoMerged) return;
        if (!currenciesLoaded || !expensesLoaded) return;
        if (!currentSettingsSnapshot) return;

        const stored: string[] = Array.isArray(currentSettingsSnapshot.currencies)
            ? currentSettingsSnapshot.currencies.filter((c: unknown) => typeof c === 'string')
            : [];
        const inExpenses = new Set(
            Object.values(expenseStore)
                .map(e => expenseCurrency(e as any))
                .filter(c => c && c !== '')
        );
        const orphans = [...inExpenses].filter(c => !stored.map(s => s.toLowerCase()).includes(c));
        if (orphans.length === 0) {
            settingsAutoMerged = true;
            return;
        }

        settingsAutoMerged = true;
        try {
            const merged = [...new Set([...stored, ...orphans])];
            await holosphere.put(holonID, 'settings', {
                ...currentSettingsSnapshot,
                id: holonID,
                currencies: merged
            });
            console.log('[Status] Auto-merged orphan currencies into settings:', orphans);
        } catch (e: any) {
            console.warn('[Status] Could not auto-merge currencies (likely no write permission):', e?.message);
        }
    }

    async function subscribeToExpenses() {
        if (!holosphere || !holonID) return;

        try {
            expenseStore = {};
            holosphere.subscribe(holonID, "expenses", (newExpense: any, key?: string) => {
                if (!key) return;
                if (newExpense) {
                    try {
                        const parsedExpense = typeof newExpense === 'string' ? JSON.parse(newExpense) : newExpense;
                        expenseStore[key] = parsedExpense as Expense;
                    } catch (e) {
                        console.error('Failed to parse expense:', e);
                    }
                } else {
                    delete expenseStore[key];
                }
                expenseStore = { ...expenseStore };

                // Re-apply the currency list now that hour-detection state may
                // have changed, and try the orphan-merge again.
                const stored = Array.isArray(currentSettingsSnapshot?.currencies)
                    ? currentSettingsSnapshot.currencies.filter((c: unknown) => typeof c === 'string')
                    : [];
                applyCurrencyList(stored as string[]);
                maybeAutoMergeOrphanCurrencies();
            });
            expensesLoaded = true;
        } catch (error) {
            console.error('Error subscribing to expenses:', error);
            expenseStore = {};
            expensesLoaded = true;
        }
    }

    // Debounce subscription updates to avoid excessive re-renders
    let subscriptionUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let pendingUsers = new Map<string, any>();
    
    function flushPendingUsers() {
        if (pendingUsers.size > 0) {
            const updates = Object.fromEntries(pendingUsers);
            console.log("[Status.svelte] Flushing pending user updates:", updates);
            console.log("[Status.svelte] Store before update:", Object.keys(store));
            store = { ...store, ...updates };
            console.log("[Status.svelte] Store after update:", Object.keys(store));
            pendingUsers.clear();
        }
    }

    async function subscribeToUsers() {
        if (holosphere && holonID) {
            console.log("[Status.svelte] Setting up user subscription for holon:", holonID);
            holosphere.subscribe(holonID, "users", (newUser, key) => {
                console.log("[Status.svelte] Subscription update received:", { key, newUser, hasId: !!newUser?.id });

                if (!key || key === 'undefined') {
                    console.log("[Status.svelte] Skipping update - invalid key:", key);
                    return;
                }

                // Simpler, more defensive approach
                if (newUser) {
                    // Determine the best key to use
                    let userKey = key;
                    if (newUser.id) {
                        userKey = newUser.id;
                    } else if (newUser.username) {
                        userKey = newUser.username;
                    }

                    console.log("[Status.svelte] Adding/updating user. Key:", userKey, "Original key:", key);

                    // Simple direct update - no batching for now to avoid race conditions
                    store = { ...store, [userKey]: newUser };
                    console.log("[Status.svelte] Updated store. User count:", Object.keys(store).length);

                } else {
                    // Handle deletion - only delete if user was explicitly set to null
                    console.log("[Status.svelte] Handling deletion for key:", key);
                    if (store.hasOwnProperty(key)) {
                        const { [key]: _, ...rest } = store;
                        store = rest;
                        console.log("[Status.svelte] User deleted. Remaining users:", Object.keys(store).length);
                    }

                    // Also check if we need to delete by user ID
                    const userToDelete = Object.entries(store).find(([storeKey, user]) =>
                        (user?.id === key) || (user?.username === key)
                    );
                    if (userToDelete) {
                        const [storeKey] = userToDelete;
                        const { [storeKey]: _, ...rest } = store;
                        store = rest;
                        console.log("[Status.svelte] Also deleted user by ID/username. Remaining users:", Object.keys(store).length);
                    }
                }
            });
        }
    }

    async function fetchInitialUsersAndSubscribe(retryCount = 0) {
        if (!holosphere || !holonID) {
            store = {};
            return;
        }

        try {
            console.log(`[Status.svelte] Fetching initial users for holon ${holonID} using reliable wrapper`);
            const initialUsers = await holosphere.getAll(holonID, "users");
            
            if (Array.isArray(initialUsers)) {
                let usersKeyedById: Record<string, User> = {};
                initialUsers.forEach(user => {
                    if (user && user.id) {
                        usersKeyedById[user.id] = user as User;
                    } else if (user && user.username) {
                        // Fallback to username if no id
                        usersKeyedById[user.username] = user as User;
                    }
                });
                store = usersKeyedById;
            } else if (typeof initialUsers === 'object' && initialUsers !== null) {
                // If it's already an object, normalize the keys to use ids
                let normalizedStore: Record<string, User> = {};
                Object.entries(initialUsers).forEach(([key, user]) => {
                    if (user && user.id) {
                        normalizedStore[user.id] = user as User;
                    } else if (user) {
                        // Keep original key if no id
                        normalizedStore[key] = user as User;
                    }
                });
                store = normalizedStore;
            } else {
                store = {};
            }
        } catch (error) {
            console.error("[Status.svelte] Error fetching initial users:", error);
            store = {};
        }

        // Debug logging to help diagnose user data issues
        console.log(`[Status.svelte] Loaded ${Object.keys(store).length} users for holon ${holonID}`);
        if (Object.keys(store).length > 0) {
            console.log("[Status.svelte] Sample user data:", Object.values(store)[0]);
            console.log("[Status.svelte] All user keys:", Object.keys(store));
        }
        subscribeToUsers();
    }

    // Per-user REA aggregates fetched in parallel.
    let aggregatesLoaded = false;
    async function loadAggregatesForUsers() {
        if (!holosphere || !holonID) return;
        const aggregator = new REAAggregator(getEventStore(holosphere));
        const entries = Object.entries(store);
        if (entries.length === 0) {
            aggregatesByUser = {};
            aggregatesLoaded = true;
            return;
        }
        const next: Record<string, UserAggregates> = {};
        await Promise.all(entries.map(async ([key, user]) => {
            const id = String(user.id || key);
            try {
                next[id] = await aggregator.getUserAggregates(String(holonID), id);
            } catch (err) {
                console.error("[Status.svelte] REA aggregates fetch failed for", id, err);
                next[id] = ZERO_USER_AGGREGATES;
            }
        }));
        aggregatesByUser = next;
        aggregatesLoaded = true;
    }

    $: if (store && holonID) loadAggregatesForUsers();

    // Live refresh: re-fetch aggregates whenever a rea_events write lands.
    // Debounced because a single task completion writes several events in
    // quick succession (initiator + N participants + appreciation pairs).
    let reaRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let reaSubscribedFor: string | null = null;
    function subscribeToReaEvents() {
        if (!holosphere || !holonID) return;
        if (reaSubscribedFor === holonID) return; // already wired for this holon
        reaSubscribedFor = holonID;
        try {
            holosphere.subscribe(holonID, 'rea_events', () => {
                if (reaRefreshTimer) clearTimeout(reaRefreshTimer);
                reaRefreshTimer = setTimeout(() => {
                    loadAggregatesForUsers();
                }, 250);
            });
        } catch (e: any) {
            console.warn('[Status] rea_events subscription failed:', e?.message);
        }
    }

    $: if (holosphere && holonID) subscribeToReaEvents();

    type BreakdownLine = { label: string; count: number; weight: number; points: number };

    // Per-user score breakdown — used both for the score itself and for the
    // popover that explains "why is the score that?".
    function getBreakdown(user: User, userKey: string): { lines: BreakdownLine[]; total: number } {
        const userId = user.id || userKey;
        const lines: BreakdownLine[] = [];
        // Counts come from REA aggregates, not the flat user.\* arrays.
        const agg = userAggregates(user, userKey);
        const initiatedCount = agg.initiated;
        const completedCount = agg.completed;
        const wantsCount = agg.wants;
        const offersCount = agg.offers;
        const sentCount = agg.sent;
        const receivedCount = agg.received;
        const collaborationCount = agg.collaboration;

        // Use the live edit buffer while the user is editing the equation
        // so the table, pie chart and breakdown popover all preview the
        // weights they're about to save. Cancel reverts; Save persists.
        const eq = isEditingEquation ? editingEquation : equation;

        const flat: Array<[string, number, number]> = [
            ['Tasks initiated', initiatedCount, eq.initiated],
            ['Tasks completed', completedCount, eq.completed],
            ['Appreciations sent', sentCount, eq.sent],
            ['Appreciations received', receivedCount, eq.received],
            ['Collaboration events', collaborationCount, eq.collaboration],
            ['Wants', wantsCount, eq.wants],
            ['Offers', offersCount, eq.offers],
            ['Participation (quests)', agg.participation ?? 0, eq.participation ?? 0],
            ['Co-participants', agg.coParticipants ?? 0, eq.coParticipants ?? 0],
            ['Activity (events)', agg.activity ?? 0, eq.activity ?? 0],
            ['Group size (avg)', agg.groupSize ?? 0, eq.groupSize ?? 0],
            ['Group-size variance', agg.variance ?? 0, eq.variance ?? 0],
        ];
        for (const [label, count, weight] of flat) {
            if (!weight || !count) continue;
            lines.push({ label, count, weight, points: count * weight });
        }

        for (const currency of availableCurrencies) {
            const weight = eq.currencies?.[currency] || 0;
            if (!weight) continue;
            const balance = getCurrencyBalance(userId, currency);
            if (!balance) continue;
            lines.push({
                label: `${currency.toUpperCase()} balance`,
                count: balance,
                weight,
                points: balance * weight
            });
        }

        const total = lines.reduce((s, l) => s + l.points, 0);
        return { lines, total };
    }

    function calculateScore(user: User, userKey: string): number {
        return getBreakdown(user, userKey).total;
    }

    // Compute every user's score exactly once per reactive tick. All the
    // downstream derivations (sort, totals, pie chart, table rows, footer)
    // read from this map instead of re-invoking calculateScore — which used
    // to walk the breakdown 5–6 times per user per render.
    // aggregatesByUser is in the dep list so loading REA aggregates after
    // initial render triggers a recompute (otherwise scores stay 0 even
    // after the REA query returns).
    // Compute breakdown + total per user in one reactive pass. The popover
    // reads breakdownByKey directly so it stays in sync with the live edit
    // buffer without needing its own subscription wiring.
    $: breakdownByKey = (() => {
        equation; editingEquation; isEditingEquation;
        availableCurrencies; expenseStore; store; aggregatesByUser;
        const map: Record<string, { lines: BreakdownLine[]; total: number }> = {};
        for (const [key, user] of Object.entries(store)) {
            map[key] = getBreakdown(user, key);
        }
        return map;
    })();
    $: scoreByKey = (() => {
        breakdownByKey;
        const map: Record<string, number> = {};
        for (const [key, bd] of Object.entries(breakdownByKey)) {
            map[key] = bd.total;
        }
        return map;
    })();

    $: sortedUsers = Object.entries(store).sort(
        ([keyA], [keyB]) => (scoreByKey[keyB] ?? 0) - (scoreByKey[keyA] ?? 0)
    );

    $: maxScore = sortedUsers.length > 0 ? (scoreByKey[sortedUsers[0][0]] ?? 0) : 0;
    $: totalScore = Object.values(scoreByKey).reduce((sum, v) => sum + v, 0);

    // Prepare data for the 3D pie chart
    $: pieChartData = sortedUsers.map(([userId, user]) => {
        const score = scoreByKey[userId] ?? 0;
        const percentage = totalScore > 0 ? (score / totalScore) * 100 : 0;

        const agg = userAggregates(user, userId);
        const breakdown = {
            initiated: agg.initiated,
            completed: agg.completed,
            sent: agg.sent,
            received: agg.received,
            collaboration: agg.collaboration,
            wants: agg.wants,
            offers: agg.offers,
            currencies: {} as Record<string, number>
        };

        // Add currency balances to breakdown
        for (const currency of availableCurrencies) {
            const balance = getCurrencyBalance(user.id || userId, currency);
            if (balance !== 0) {
                breakdown.currencies[currency] = balance;
            }
        }

        return {
            id: userId,
            name: `${user.first_name} ${user.last_name || ''}`.trim(),
            score,
            percentage,
            color: '',  // Will be assigned by the chart component
            breakdown,
            avatarUrl: user.id ? `https://telegram.holons.io/getavatar?user_id=${user.id}` : undefined
        };
    }).filter(user => user.percentage > 0); // Only include users with a non-zero percentage
    
    // Simple cache invalidation when data changes
    $: if (availableCurrencies || expenseStore) {
        currencyBalanceCache = {};
    }

    $: dataReady = valueEquationLoaded && currenciesLoaded && expensesLoaded;

    function calculatePercentage(score: number): number {
        if (totalScore === 0) return 0;
        return (score / totalScore) * 100;
    }

    // Wrapper function to handle caching and data conversion for the shared utility
    function getCurrencyBalance(userId: string, currency: string): number {
        if (!currency || !userId) return 0;
        
        // Create cache key
        const expenseCount = Object.keys(expenseStore).length;
        const cacheKey = `${userId}-${currency}-${expenseCount}`;
        
        if (currencyBalanceCache[cacheKey] !== undefined) {
            return currencyBalanceCache[cacheKey];
        }
        
        // Convert user data to match utility function interface
        const usersForCalculation = Object.values(store).map(user => ({
            id: user.id ? parseInt(user.id.toString()) : parseInt(Object.keys(store).find(key => store[key] === user) || '0'),
            first_name: user.first_name
        }));
        
        // Call the shared utility function
        const balance = calculateCurrencyBalance(userId, currency, expenseStore, usersForCalculation);
        
        // Cache and return the result
        currencyBalanceCache[cacheKey] = balance;
        return balance;
    }

    // Format currency amounts
    function formatCurrencyAmount(amount: number, currency: string): string {
        const currencyCode = currency.toUpperCase();
        if (['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'].includes(currencyCode)) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        } else {
            return `${amount.toFixed(2)} ${currencyCode}`;
        }
    }

    function openUserModal(userId: string) {
        selectedUserId = userId;
        showUserModal = true;
    }

    function closeUserModal() {
        showUserModal = false;
        selectedUserId = null;
    }
</script>

<div class="space-y-4">
    <!-- TitleBar -->
    <TitleBar {holonName} holonId={holonID} title="Status Rankings" />

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">
            {#if !dataReady}
                <div class="flex items-center justify-center py-12 text-gray-400">
                    <svg class="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    <span>Loading data...</span>
                </div>
            {:else}
                <!-- Stats Bar -->
                <div class="stats-bar mb-6">
                    <div class="stats-bar__item stats-bar__item--info">
                        <span class="stats-bar__value">{sortedUsers.length}</span>
                        <span class="stats-bar__label">Users</span>
                    </div>
                    <div class="stats-bar__divider"></div>
                    <div class="stats-bar__item stats-bar__item--success">
                        <span class="stats-bar__value">{sortedUsers.filter(([key]) => (scoreByKey[key] ?? 0) > 0).length}</span>
                        <span class="stats-bar__label">Active</span>
                    </div>
                    <div class="stats-bar__divider"></div>
                    <div class="stats-bar__item stats-bar__item--warning">
                        <span class="stats-bar__value">{availableCurrencies.length}</span>
                        <span class="stats-bar__label">Currencies</span>
                    </div>
                </div>

                <!-- 3D Pie Chart Section -->
                <div class="bg-gray-700/30 rounded-2xl p-6 mb-8">
                    <div class="mb-4">
                        <h3 class="text-xl font-bold text-white">Share Distribution</h3>
                        <p class="text-gray-400 text-sm">Tap or hover over slices to see detailed breakdowns</p>
                    </div>
                    {#if pieChartData.length > 0}
                        <PieChart3D users={pieChartData} />
                    {:else if !aggregatesLoaded}
                        <div class="flex items-center justify-center py-8 text-gray-400 text-sm">
                            <svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                            </svg>
                            Loading contributions…
                        </div>
                    {:else}
                        <div class="text-center py-8 text-gray-400 text-sm">
                            <p class="mb-1">No scored activity yet.</p>
                            <p class="text-gray-500 text-xs">Complete a task or change the value equation weights below to see the share distribution.</p>
                        </div>
                    {/if}
                </div>

                <!-- Rankings Table -->
                <div class="bg-gray-700/30 rounded-2xl overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-white">
                            <thead>
                                <tr class="bg-gray-600/80">
                                    <th class="p-2 text-center font-semibold text-xs">#</th>
                                    <th class="p-2 text-left font-semibold text-xs">Name</th>
                                    <th class="p-2 font-semibold vertical-header"><span>Initiated</span></th>
                                    <th class="p-2 font-semibold vertical-header"><span>Completed</span></th>
                                    <th class="p-2 font-semibold vertical-header"><span>Sent</span></th>
                                    <th class="p-2 font-semibold vertical-header"><span>Received</span></th>
                                    {#each availableCurrencies as currency}
                                        <th class="p-2 font-semibold vertical-header"><span>{currency.toUpperCase()}</span></th>
                                    {/each}
                                    <th class="p-2 font-semibold vertical-header"><span>Score</span></th>
                                    <th class="p-2 font-semibold vertical-header"><span>%</span></th>
                                    <th class="p-2 font-semibold vertical-header"><span>Share</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each sortedUsers as [userId, user], index}
                                    {@const score = scoreByKey[userId] ?? 0}
                                    {@const percentage = calculatePercentage(score)}
                                    <tr class="border-b border-gray-600/50 hover:bg-gray-600/20 transition-all duration-200">
                                        <td class="p-2 text-center">
                                            {#if index === 0}
                                                <span class="text-lg">🏆</span>
                                            {:else if index === 1}
                                                <span class="text-lg">🥈</span>
                                            {:else if index === 2}
                                                <span class="text-lg">🥉</span>
                                            {:else}
                                                <span class="text-gray-400 text-sm">{index + 1}</span>
                                            {/if}
                                        </td>
                                        <td class="p-2">
                                            <button
                                                class="text-left hover:text-blue-400 transition-colors cursor-pointer underline-offset-2 hover:underline flex items-center gap-2"
                                                onclick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    openUserModal(userId);
                                                }}
                                            >
                                                <div class="relative flex-shrink-0">
                                                    <img
                                                        src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
                                                        alt={resolvedName(user.id || userId, $nameMap, user)}
                                                        class="w-8 h-8 rounded-full object-cover border border-gray-500 aspect-square flex-shrink-0"
                                                        onerror={(e) => {
                                                            e.currentTarget.style.display = 'none';
                                                            e.currentTarget.nextElementSibling.style.display = 'flex';
                                                        }}
                                                    />
                                                    <div class="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-white text-xs font-bold border border-gray-500 aspect-square flex-shrink-0" style="display: none;">
                                                        {resolvedInitials(user.id || userId, $nameMap, user)}
                                                    </div>
                                                </div>
                                                <div class="text-sm">
                                                    <div class="font-medium">{resolvedName(user.id || userId, $nameMap, user)}</div>
                                                </div>
                                            </button>
                                        </td>
                                        <td class="p-2 text-center">
                                            <span class="text-xs text-blue-300">
                                                {userAggregates(user, userId).initiated}
                                            </span>
                                        </td>
                                        <td class="p-2 text-center">
                                            <span class="text-xs text-green-300">
                                                {userAggregates(user, userId).completed}
                                            </span>
                                        </td>
                                        <td class="p-2 text-center">
                                            <span class="text-xs text-blue-300">
                                                {userAggregates(user, userId).sent}
                                            </span>
                                        </td>
                                        <td class="p-2 text-center">
                                            <span class="text-xs text-purple-300">
                                                {userAggregates(user, userId).received}
                                            </span>
                                        </td>
                                        {#each availableCurrencies as currency}
                                            {@const balance = getCurrencyBalance(user.id || userId, currency)}
                                            <td class="p-2 text-center">
                                                <span class="text-xs {balance > 0 ? 'text-green-300' : balance < 0 ? 'text-red-300' : 'text-gray-400'}">
                                                    {formatCurrencyAmount(balance, currency)}
                                                </span>
                                            </td>
                                        {/each}
                                        <td class="p-2 text-center">
                                            <button
                                                type="button"
                                                class="font-bold text-sm text-white hover:text-blue-400 transition-colors underline-offset-2 hover:underline"
                                                title="Show score breakdown"
                                                onclick={(e) => { e.stopPropagation(); breakdownUserId = breakdownUserId === userId ? null : userId; }}
                                            >{score.toFixed(1)}</button>
                                        </td>
                                        <td class="p-2">
                                            <div class="flex items-center gap-2">
                                                <div class="flex-1 bg-gray-600 rounded-full h-2 min-w-[60px]">
                                                    <div
                                                        class="bg-gradient-to-r from-blue-500 to-blue-400 h-2 rounded-full transition-all duration-500"
                                                        style="width: {percentage}%"
                                                    ></div>
                                                </div>
                                                <span class="text-xs font-medium text-gray-300 min-w-[35px]">
                                                    {percentage.toFixed(1)}%
                                                </span>
                                            </div>
                                        </td>
                                        <td class="p-2 text-center">
                                            {#if contractShares[userId] || contractShares[user.id]}
                                                {@const share = contractShares[userId] || contractShares[user.id]}
                                                <div class="flex flex-col">
                                                    <span class="text-green-400 text-xs font-semibold">{share.sharePercent.toFixed(1)}%</span>
                                                    <span class="text-[10px] text-gray-400">{share.etherFormatted}</span>
                                                </div>
                                            {:else}
                                                <span class="text-gray-500 text-xs">--</span>
                                            {/if}
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
                            {#if sortedUsers.length > 0 && availableCurrencies.length > 0}
                                {@const totals = availableCurrencies.map(c => ({
                                    currency: c,
                                    total: sortedUsers.reduce((sum, [k, u]) => sum + getCurrencyBalance(u.id || k, c), 0)
                                }))}
                                <tfoot>
                                    <tr class="bg-gray-600/40 border-t-2 border-gray-500">
                                        <td class="p-2"></td>
                                        <td class="p-2 text-right text-xs font-semibold text-gray-300">
                                            Currency totals
                                        </td>
                                        <td class="p-2"></td>
                                        <td class="p-2"></td>
                                        <td class="p-2"></td>
                                        <td class="p-2"></td>
                                        {#each totals as { currency, total }}
                                            <td class="p-2 text-center">
                                                <span class="text-xs font-semibold {Math.abs(total) < 0.005 ? 'text-gray-400' : 'text-amber-300'}" title={Math.abs(total) < 0.005 ? 'Ledger is balanced' : 'Sum of balances should be 0 for an internally consistent ledger'}>
                                                    {formatCurrencyAmount(total, currency)}
                                                </span>
                                            </td>
                                        {/each}
                                        <td class="p-2"></td>
                                        <td class="p-2"></td>
                                        <td class="p-2"></td>
                                    </tr>
                                </tfoot>
                            {/if}
                        </table>
                    </div>
                </div>

                {#if sortedUsers.length === 0}
                    <div class="text-center py-12">
                        <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                            <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                            </svg>
                        </div>
                        <h3 class="text-lg font-medium text-white mb-2">No users found</h3>
                        <p class="text-gray-400">Users will appear here once they start participating</p>
                    </div>
                {/if}

                <!-- Value Equation Section -->
                <div class="mt-8 bg-gray-700/30 rounded-2xl p-6">
                    <div class="flex items-center justify-between mb-6">
                        <div>
                            <h3 class="text-xl font-bold text-white mb-2">Value Equation</h3>
                            <p class="text-gray-400 text-sm">Current scoring weights used to calculate user rankings</p>
                        </div>
                        {#if isEditingEquation}
                            <div class="flex items-center gap-2">
                                <button 
                                    onclick={cancelEditing}
                                    class="inline-flex items-center gap-2 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors text-sm font-medium"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                    </svg>
                                    Cancel
                                </button>
                                <button 
                                    onclick={saveEquation}
                                    class="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors text-sm font-medium"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                                    </svg>
                                    Save
                                </button>
                            </div>
                        {:else}
                            <button
                                onclick={() => {
                                    // Deep-copy currencies and seed every
                                    // availableCurrency so bind:value can
                                    // write to keys that didn't exist on
                                    // the loaded equation (currency added
                                    // after equation last saved).
                                    const seeded: Record<string, number> = { ...equation.currencies };
                                    for (const c of availableCurrencies) {
                                        if (!(c in seeded)) seeded[c] = 0;
                                    }
                                    editingEquation = { ...equation, currencies: seeded };
                                    isEditingEquation = true;
                                }}
                                class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors text-sm font-medium"
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                                </svg>
                                Edit Equation
                            </button>
                        {/if}
                    </div>

                    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <!-- Tasks Initiated -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.initiated !== 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.initiated !== 0 ? 'text-gray-300' : 'text-gray-400'}">Tasks Initiated</span>
                                <span class="text-xs {equation.initiated !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        onclick={() => adjustValue('initiated', -1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Decrease tasks initiated value"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                        </svg>
                                    </button>
                                    <input 
                                        type="number" 
                                        bind:value={editingEquation.initiated}
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-blue-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-blue-400 focus:outline-none"
                                    />
                                    <button 
                                        onclick={() => adjustValue('initiated', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase tasks initiated value"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.initiated !== 0 ? 'text-blue-400' : 'text-gray-500'}">{equation.initiated}</div>
                            {/if}
                            <div class="text-xs {equation.initiated !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per initiated task</div>
                            {#if equation.initiated === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Tasks Completed -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.completed !== 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.completed !== 0 ? 'text-gray-300' : 'text-gray-400'}">Tasks Completed</span>
                                <span class="text-xs {equation.completed !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        onclick={() => adjustValue('completed', -1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Decrease completed tasks weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                        </svg>
                                    </button>
                                    <input 
                                        type="number" 
                                        bind:value={editingEquation.completed}
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-green-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-green-400 focus:outline-none"
                                    />
                                    <button 
                                        onclick={() => adjustValue('completed', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase completed tasks weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.completed !== 0 ? 'text-green-400' : 'text-gray-500'}">{equation.completed}</div>
                            {/if}
                            <div class="text-xs {equation.completed !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per completed task</div>
                            {#if equation.completed === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Sent -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.sent !== 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.sent !== 0 ? 'text-gray-300' : 'text-gray-400'}">Appreciation Sent</span>
                                <span class="text-xs {equation.sent !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        onclick={() => adjustValue('sent', -1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Decrease appreciation sent weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                        </svg>
                                    </button>
                                    <input 
                                        type="number" 
                                        bind:value={editingEquation.sent}
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-purple-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-purple-400 focus:outline-none"
                                    />
                                    <button 
                                        onclick={() => adjustValue('sent', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase appreciation sent weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.sent !== 0 ? 'text-purple-400' : 'text-gray-500'}">{equation.sent}</div>
                            {/if}
                            <div class="text-xs {equation.sent !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per appreciation sent</div>
                            {#if equation.sent === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Received -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.received !== 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.received !== 0 ? 'text-gray-300' : 'text-gray-400'}">Appreciation Received</span>
                                <span class="text-xs {equation.received !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        onclick={() => adjustValue('received', -1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Decrease appreciation received weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                        </svg>
                                    </button>
                                    <input 
                                        type="number" 
                                        bind:value={editingEquation.received}
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-orange-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-orange-400 focus:outline-none"
                                    />
                                    <button 
                                        onclick={() => adjustValue('received', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase appreciation received weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.received !== 0 ? 'text-orange-400' : 'text-gray-500'}">{equation.received}</div>
                            {/if}
                            <div class="text-xs {equation.received !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per appreciation received</div>
                            {#if equation.received === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>
                    </div>

                    <!-- Currency Weights -->
                    <div class="mt-6">
                        <div class="flex items-center justify-between mb-3">
                            <h4 class="text-sm font-medium text-gray-400">Currency Weights</h4>
                            <button
                                onclick={() => showAddCurrencyModal = true}
                                class="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-xs font-medium"
                                aria-label="Add new currency"
                            >
                                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                </svg>
                                Add Currency
                            </button>
                        </div>
                        {#if availableCurrencies.length > 0}
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {#each availableCurrencies as currency}
                                    <div class="bg-gray-600/50 rounded-xl p-4 {equation.currencies[currency] !== 0 ? '' : 'opacity-50'}">
                                        <div class="flex items-center justify-between mb-2">
                                            <span class="text-sm font-medium {equation.currencies[currency] !== 0 ? 'text-gray-300' : 'text-gray-400'}">{currency.toUpperCase()}</span>
                                            <span class="text-xs {equation.currencies[currency] !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                        </div>
                                        {#if isEditingEquation}
                                            <div class="flex items-center gap-2">
                                                <button 
                                                    onclick={() => adjustCurrencyWeight(currency, -1)}
                                                    class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                                    aria-label="Decrease {currency} weight"
                                                >
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                                    </svg>
                                                </button>
                                                <input 
                                                    type="number" 
                                                    bind:value={editingEquation.currencies[currency]}
                                                    step="0.1"
                                                    class="w-16 text-center bg-gray-700 text-emerald-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-emerald-400 focus:outline-none"
                                                />
                                                <button 
                                                    onclick={() => adjustCurrencyWeight(currency, 1)}
                                                    class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                                    aria-label="Increase {currency} weight"
                                                >
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        {:else}
                                            <div class="text-2xl font-bold {equation.currencies[currency] !== 0 ? 'text-emerald-400' : 'text-gray-500'}">{equation.currencies[currency] || 0}</div>
                                        {/if}
                                        <div class="text-xs {equation.currencies[currency] !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per {currency} balance</div>
                                        {#if !equation.currencies[currency] || equation.currencies[currency] === 0}
                                            <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {:else}
                            <div class="text-center py-6 bg-gray-600/30 rounded-xl">
                                <p class="text-gray-400 text-sm mb-2">No currencies configured yet</p>
                                <p class="text-gray-500 text-xs">Click "Add Currency" to add currencies for tracking</p>
                            </div>
                        {/if}
                    </div>

                    <!-- Additional Metrics -->
                    <div class="mt-6">
                        <h4 class="text-sm font-medium text-gray-400 mb-3">Additional Metrics</h4>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <!-- Collaboration -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.collaboration !== 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.collaboration !== 0 ? 'text-gray-300' : 'text-gray-400'}">Collaboration</span>
                                    <span class="text-xs {equation.collaboration !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            onclick={() => adjustValue('collaboration', -1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Decrease collaboration weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                            </svg>
                                        </button>
                                        <input 
                                            type="number" 
                                            bind:value={editingEquation.collaboration}
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-teal-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-teal-400 focus:outline-none"
                                        />
                                        <button 
                                            onclick={() => adjustValue('collaboration', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase collaboration weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                        </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.collaboration !== 0 ? 'text-teal-400' : 'text-gray-500'}">{equation.collaboration}</div>
                                {/if}
                                <div class="text-xs {equation.collaboration !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per collaboration</div>
                                {#if equation.collaboration === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>

                            <!-- Wants -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.wants !== 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.wants !== 0 ? 'text-gray-300' : 'text-gray-400'}">Wants</span>
                                    <span class="text-xs {equation.wants !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            onclick={() => adjustValue('wants', -1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Decrease wants weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                            </svg>
                                        </button>
                                        <input 
                                            type="number" 
                                            bind:value={editingEquation.wants}
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-pink-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-pink-400 focus:outline-none"
                                        />
                                        <button 
                                            onclick={() => adjustValue('wants', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase wants weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                        </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.wants !== 0 ? 'text-pink-400' : 'text-gray-500'}">{equation.wants}</div>
                                {/if}
                                <div class="text-xs {equation.wants !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per want</div>
                                {#if equation.wants === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>

                            <!-- Offers -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.offers !== 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.offers !== 0 ? 'text-gray-300' : 'text-gray-400'}">Offers</span>
                                    <span class="text-xs {equation.offers !== 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            onclick={() => adjustValue('offers', -1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Decrease offers weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                            </svg>
                                        </button>
                                        <input 
                                            type="number" 
                                            bind:value={editingEquation.offers}
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-indigo-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-indigo-400 focus:outline-none"
                                        />
                                        <button 
                                            onclick={() => adjustValue('offers', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase offers weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.offers !== 0 ? 'text-indigo-400' : 'text-gray-500'}">{equation.offers}</div>
                                {/if}
                                <div class="text-xs {equation.offers !== 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per offer</div>
                                {#if equation.offers === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <!-- Collaboration Signals (REA-derived) -->
                    <div class="mt-6">
                        <h4 class="text-sm font-medium text-gray-400 mb-1">Collaboration Signals</h4>
                        <p class="text-xs text-gray-500 mb-3">Derived from REA event groupings. Reward teamwork, network size, activity volume, and team-size diversity.</p>
                        <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <!--
                                Tailwind's JIT scans for literal class names; dynamic
                                template-string classes (e.g. text-${color}-400) don't
                                survive, so each row spells its colour classes out.
                            -->
                            {#each [
                                { key: 'participation',  label: 'Participation',   textOn: 'text-cyan-400',    focus: 'focus:border-cyan-400',    desc: 'Per distinct quest touched' },
                                { key: 'coParticipants', label: 'Co-Participants', textOn: 'text-fuchsia-400', focus: 'focus:border-fuchsia-400', desc: 'Per distinct collaborator' },
                                { key: 'activity',       label: 'Activity',        textOn: 'text-amber-400',   focus: 'focus:border-amber-400',   desc: 'Per recorded event' },
                                { key: 'groupSize',      label: 'Group Size',      textOn: 'text-lime-400',    focus: 'focus:border-lime-400',    desc: 'Points × mean group size' },
                                { key: 'variance',       label: 'Variance',        textOn: 'text-violet-400',  focus: 'focus:border-violet-400',  desc: 'Points × group-size variance' },
                            ] as field}
                                {@const weight = (equation as any)[field.key] ?? 0}
                                {@const active = weight !== 0}
                                <div class="bg-gray-600/50 rounded-xl p-4 {active ? '' : 'opacity-50'}">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="text-sm font-medium {active ? 'text-gray-300' : 'text-gray-400'}">{field.label}</span>
                                        <span class="text-xs {active ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                    </div>
                                    {#if isEditingEquation}
                                        <div class="flex items-center gap-2">
                                            <button
                                                onclick={() => adjustValue(field.key as keyof Equation, -1)}
                                                class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                                aria-label={`Decrease ${field.label} weight`}
                                            >
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>
                                            </button>
                                            <input
                                                type="number"
                                                bind:value={(editingEquation as any)[field.key]}
                                                step="0.1"
                                                class="w-16 text-center bg-gray-700 {field.textOn} text-xl font-bold rounded-lg border border-gray-500 {field.focus} focus:outline-none"
                                            />
                                            <button
                                                onclick={() => adjustValue(field.key as keyof Equation, 1)}
                                                class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                                aria-label={`Increase ${field.label} weight`}
                                            >
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                                            </button>
                                        </div>
                                    {:else}
                                        <div class="text-2xl font-bold {active ? field.textOn : 'text-gray-500'}">{weight}</div>
                                    {/if}
                                    <div class="text-xs {active ? 'text-gray-400' : 'text-gray-500'} mt-1">{field.desc}</div>
                                    {#if weight === 0}
                                        <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                    {/if}
                                </div>
                            {/each}
                        </div>
                    </div>

                    <div class="mt-4 text-xs text-gray-500">
                        <p>💡 <strong>Tip:</strong> {#if isEditingEquation}Click the arrows or type directly to adjust weights. Higher weights give more importance to that metric.{:else}Click "Edit Equation" to adjust these weights and change how user scores are calculated.{/if}</p>
                    </div>
                </div>
            {/if}
        </div>
    </div>
</div>

<!-- Add Currency Modal -->
{#if showAddCurrencyModal}
    <div
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        onclick={(e) => { if (e.target === e.currentTarget) showAddCurrencyModal = false; }}
        onkeydown={(e) => e.key === 'Escape' && (showAddCurrencyModal = false)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-700"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="add-currency-title"
            tabindex="-1"
        >
            <div class="flex items-center justify-between mb-4">
                <h3 id="add-currency-title" class="text-lg font-bold text-white flex items-center gap-2">
                    <span class="text-emerald-400">💱</span> Add Currency
                </h3>
                <button
                    type="button"
                    onclick={() => { showAddCurrencyModal = false; }}
                    class="text-gray-400 hover:text-white transition-colors p-2"
                    aria-label="Close"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>

            <p class="text-gray-400 text-sm mb-4">
                Enter currency names (singular form) separated by commas or spaces.
            </p>

            <div class="space-y-4">
                <input
                    type="text"
                    bind:value={newCurrencyInput}
                    placeholder="e.g., euro, dollar, token"
                    class="w-full px-4 py-3 bg-gray-700 text-white rounded-xl border border-gray-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none placeholder-gray-500"
                    onkeydown={(e) => e.key === 'Enter' && addNewCurrency()}
                />

                <div class="flex gap-3">
                    <button
                        type="button"
                        onclick={() => { showAddCurrencyModal = false; }}
                        class="flex-1 px-4 py-2.5 bg-gray-600 hover:bg-gray-500 text-white rounded-xl transition-colors font-medium"
                    >
                        Cancel
                    </button>
                    <button
                        onclick={addNewCurrency}
                        class="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition-colors font-medium"
                    >
                        Add Currency
                    </button>
                </div>
            </div>

            {#if availableCurrencies.length > 0}
                <div class="mt-4 pt-4 border-t border-gray-700">
                    <p class="text-xs text-gray-500 mb-2">Current currencies:</p>
                    <div class="flex flex-wrap gap-2">
                        {#each availableCurrencies as currency}
                            <span class="px-2 py-1 bg-gray-700 text-gray-300 rounded-lg text-xs">{currency}</span>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}

<!-- User Modal -->
{#if showUserModal && selectedUserId && holonID && store[selectedUserId]}
    <User
        userId={selectedUserId}
        holonId={holonID}
        userData={store[selectedUserId]}
        on:close={closeUserModal}
    />
{/if}

<!-- Score breakdown popover — explains exactly how a user's score is built. -->
{#if breakdownUserId && store[breakdownUserId]}
    {@const u = store[breakdownUserId]}
    {@const bd = breakdownByKey[breakdownUserId] ?? { lines: [], total: 0 }}
    <div
        class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onclick={(e) => { if (e.target === e.currentTarget) breakdownUserId = null; }}
        onkeydown={(e) => e.key === 'Escape' && (breakdownUserId = null)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
    >
        <div
            class="bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-700"
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            role="dialog"
            tabindex="-1"
        >
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-white">
                    Score breakdown — {resolvedName(u.id || breakdownUserId, $nameMap, u)}
                </h3>
                <button
                    type="button"
                    onclick={() => breakdownUserId = null}
                    class="text-gray-400 hover:text-white p-2"
                    aria-label="Close"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            {#if bd.lines.length === 0}
                <p class="text-gray-400 text-sm">No scoring contributions yet. Either the user has no aggregates, or every applicable weight is set to 0 in the value equation.</p>
            {:else}
                <table class="w-full text-sm">
                    <thead>
                        <tr class="text-gray-400 text-xs">
                            <th class="text-left py-1 font-medium">Component</th>
                            <th class="text-right py-1 font-medium">Count</th>
                            <th class="text-right py-1 font-medium">×&nbsp;Weight</th>
                            <th class="text-right py-1 font-medium">=&nbsp;Points</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each bd.lines as line}
                            <tr class="border-t border-gray-700">
                                <td class="py-1.5 text-gray-200">{line.label}</td>
                                <td class="py-1.5 text-right text-gray-300">{line.count.toFixed(2).replace(/\.00$/, '')}</td>
                                <td class="py-1.5 text-right text-gray-300">×&nbsp;{line.weight}</td>
                                <td class="py-1.5 text-right font-mono text-emerald-300">{line.points.toFixed(2)}</td>
                            </tr>
                        {/each}
                        <tr class="border-t-2 border-gray-500">
                            <td class="py-2 font-semibold text-white" colspan="3">Total</td>
                            <td class="py-2 text-right font-bold text-white">{bd.total.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="text-xs text-gray-500 mt-3">Editing the value equation below the table updates this breakdown immediately.</p>
            {/if}
        </div>
    </div>
{/if}

<style>
    th,
    td {
        text-align: left;
    }

    tr:hover {
        transition-property: color, background-color;
        transition-duration: 200ms;
    }

    .vertical-header {
        height: 80px;
        white-space: nowrap;
        vertical-align: bottom;
        text-align: center;
    }

    .vertical-header span {
        writing-mode: vertical-rl;
        text-orientation: mixed;
        transform: rotate(180deg);
        display: inline-block;
        font-size: 0.7rem;
        color: #9ca3af;
    }
</style>

