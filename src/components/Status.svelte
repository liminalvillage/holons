<script lang="ts">
	// @ts-nocheck
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import User from "./User.svelte";
    import PieChart3D from "./PieChart3D.svelte";
    import { calculateCurrencyBalance } from "../utils/expenseCalculations";
    import TitleBar from "./shared/TitleBar.svelte";
    import { fetchHolonName } from "../utils/holonNames";
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

    interface Equation {
        initiated: number;
        completed: number;
        sent: number;
        received: number;
        hours: number;
        collaboration: number;
        wants: number;
        offers: number;
        currencies: Record<string, number>;
    }

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
    let holonName: string = 'Status';
    let holosphere = getContext("holosphere") as HoloSphere;
    let valueEquationLoaded = false;
    let selectedUserId: string | null = null;
    let showUserModal = false;
    let currenciesLoaded = false;
    let expensesLoaded = false;
    let currencyBalanceCache: Record<string, number> = {};

    // Initialize equation with default values
    let equation: Equation = {
        initiated: 1,
        completed: 1,
        sent: 1,
        received: 1,
        hours: 1,
        collaboration: 1,
        wants: 1,
        offers: 1,
        currencies: {}
    };

    // Add state for editing
    let isEditingEquation = false;
    let editingEquation: Equation = { ...equation };

    // Function to save equation changes
    async function saveEquation() {
        try {
            const settings = await holosphere.getAll(holonID, 'settings');
            const currentSettings = settings && settings[0] ? settings[0] : {};
            
            const updatedSettings = {
                ...currentSettings,
                valueEquation: editingEquation
            };
            
            await holosphere.put(holonID, 'settings', updatedSettings);
            equation = { ...editingEquation };
            isEditingEquation = false;
            console.log('Value equation updated successfully');
        } catch (error) {
            console.error('Error saving value equation:', error);
        }
    }

    // Function to cancel editing
    function cancelEditing() {
        editingEquation = { ...equation };
        isEditingEquation = false;
    }

    // Function to adjust value with arrows
    function adjustValue(metric: keyof Equation, delta: number) {
        const newValue = Math.max(0, (editingEquation[metric] || 0) + delta);
        editingEquation = { ...editingEquation, [metric]: newValue };
    }

    // Function to adjust currency weight
    function adjustCurrencyWeight(currency: string, delta: number) {
        const currentWeight = editingEquation.currencies[currency] || 0;
        const newWeight = Math.max(0, currentWeight + delta);
        editingEquation.currencies = { ...editingEquation.currencies, [currency]: newWeight };
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
                // Load holon name for TitleBar
                if (holosphere) {
                    fetchHolonName(holosphere, value).then(name => {
                        holonName = name || 'Status';
                    });
                }
                store = {}; // Reset store
                valueEquationLoaded = false;
                currenciesLoaded = false;
                expensesLoaded = false;
                expenseStore = {};
                availableCurrencies = [];
                loadEquation();
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
                expenseStore = {};
                availableCurrencies = [];
                loadEquation();
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
         
            if (settings && settings[0]?.valueEquation) {
                equation = {
                    ...equation, // Keep defaults as fallback
                    ...settings[0].valueEquation  // Override with stored values
                };

                valueEquationLoaded = true;
            } 
        } catch (error) {
            console.error('Error loading equation settings:', error);
        }
    }

    async function subscribeToSettings() {
        if (!holosphere || !holonID) return;

        try {
            // Reset and use only subscription like Expenses.svelte does
            availableCurrencies = [];
            
            // Set up subscription - no getAll() needed
            holosphere.subscribe(holonID, "settings", (settingsData: any, key?: string) => {
                let newCurrencies: string[] = [];
                if (settingsData && Array.isArray(settingsData.currencies)) {
                    newCurrencies = settingsData.currencies.filter((c: unknown) => typeof c === 'string');
                } else {
                    // Fallback: derive currencies from existing expenses if available
                    if (Object.keys(expenseStore).length > 0) {
                        newCurrencies = [...new Set(Object.values(expenseStore)
                            .map(e => e?.currency)
                            .filter(c => c && typeof c === 'string' && c !== ''))] as string[];
                    } else {
                        newCurrencies = [];
                    }
                }
                
                // Only update if currencies actually changed
                const currenciesChanged = JSON.stringify(newCurrencies.sort()) !== JSON.stringify(availableCurrencies.sort());
                if (currenciesChanged) {
                    availableCurrencies = [...newCurrencies]; // Force reactivity with new array
                }
                
                currenciesLoaded = true;
            });
            
            currenciesLoaded = true; // Mark as loaded
        } catch (error) {
            console.error('Error subscribing to settings:', error);
            availableCurrencies = [];
            currenciesLoaded = true; // Mark as loaded even on error to avoid blocking
        }
    }

    async function subscribeToExpenses() {
        if (!holosphere || !holonID) return;

        try {
            // Reset and use only subscription like Expenses.svelte does
            expenseStore = {};
            
            // Set up subscription - no getAll() needed
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
                
                expenseStore = { ...expenseStore }; // Trigger reactivity
                
                // Update currencies if not loaded from settings
                if (!currenciesLoaded || (currenciesLoaded && availableCurrencies.length === 0)) {
                    const newCurrencies = [...new Set(Object.values(expenseStore)
                        .map(e => e?.currency)
                        .filter(c => c && typeof c === 'string' && c !== ''))] as string[];
                    
                    const currenciesChanged = JSON.stringify(newCurrencies.sort()) !== JSON.stringify(availableCurrencies.sort());
                    if (currenciesChanged) {
                        availableCurrencies = [...newCurrencies];
                    }
                }
            });
            
            expensesLoaded = true; // Mark as loaded
        } catch (error) {
            console.error('Error subscribing to expenses:', error);
            expenseStore = {};
            expensesLoaded = true; // Mark as loaded even on error
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

    function calculateScore(user: User): number {
        let score = 0;

        // Only include metrics with values > 0
        // Use safe property access with fallback to default values
        if (equation.initiated > 0) {
            const initiated = user.initiated || [];
            score += (Array.isArray(initiated) ? initiated.length : 0) * equation.initiated;
        }
        if (equation.completed > 0) {
            const completed = user.completed || [];
            score += (Array.isArray(completed) ? completed.length : 0) * equation.completed;
        }
        if (equation.sent > 0) {
            score += (user.sent || 0) * equation.sent;
        }
        if (equation.received > 0) {
            score += (user.received || 0) * equation.received;
        }
        if (equation.hours > 0) {
            score += (user.hours || 0) * equation.hours;
        }
        if (equation.collaboration > 0) {
            score += (user.collaboration || 0) * equation.collaboration;
        }
        if (equation.wants > 0) {
            const wants = user.wants || [];
            score += (Array.isArray(wants) ? wants.length : 0) * equation.wants;
        }
        if (equation.offers > 0) {
            const offers = user.offers || [];
            score += (Array.isArray(offers) ? offers.length : 0) * equation.offers;
        }
        
        // Add currency balances if their weights are > 0
        if (equation.currencies && availableCurrencies) {
            for (const currency of availableCurrencies) {
                const currencyWeight = equation.currencies[currency] || 0;
                if (currencyWeight > 0) {
                    const balance = getCurrencyBalance(user.id || Object.keys(store).find(key => store[key] === user) || '', currency);
                    score += balance * currencyWeight;
                }
            }
        }
        
        return score;
    }

    // Force recomputation when equation changes
    $: equationChanged = JSON.stringify(equation);
    
    $: sortedUsers = Object.entries(store).sort(([, a], [, b]) => {
        // Force dependency on equation changes
        equationChanged;
        return calculateScore(b) - calculateScore(a);
    });

    $: maxScore = sortedUsers.length > 0 ? calculateScore(sortedUsers[0][1]) : 0;
    $: totalScore = sortedUsers.reduce((sum, [, user]) => sum + calculateScore(user), 0);

    // Prepare data for the 3D pie chart
    $: pieChartData = sortedUsers.map(([userId, user]) => {
        const score = calculateScore(user);
        const percentage = totalScore > 0 ? (score / totalScore) * 100 : 0;

        // Build the breakdown object
        const breakdown = {
            initiated: (user.initiated && Array.isArray(user.initiated)) ? user.initiated.length : 0,
            completed: (user.completed && Array.isArray(user.completed)) ? user.completed.length : 0,
            sent: user.sent || 0,
            received: user.received || 0,
            hours: user.hours || 0,
            collaboration: user.collaboration || 0,
            wants: (user.wants && Array.isArray(user.wants)) ? user.wants.length : 0,
            offers: (user.offers && Array.isArray(user.offers)) ? user.offers.length : 0,
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
    <TitleBar {holonName} title="Status Rankings" />

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
                <!-- Stats Section -->
                <div class="grid grid-cols-3 gap-4 mb-8">
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{sortedUsers.length}</div>
                        <div class="text-sm text-gray-400">Total Users</div>
                    </div>
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">
                            {sortedUsers.filter(([, user]) => calculateScore(user) > 0).length}
                        </div>
                        <div class="text-sm text-gray-400">Active Users</div>
                    </div>
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{availableCurrencies.length}</div>
                        <div class="text-sm text-gray-400">Currencies</div>
                    </div>
                </div>

                <!-- 3D Pie Chart Section -->
                {#if pieChartData.length > 0}
                    <div class="bg-gray-700/30 rounded-2xl p-6 mb-8">
                        <div class="mb-4">
                            <h3 class="text-xl font-bold text-white">Share Distribution</h3>
                            <p class="text-gray-400 text-sm">Hover over slices to see detailed breakdowns</p>
                        </div>
                        <PieChart3D users={pieChartData} />
                    </div>
                {/if}

                <!-- Rankings Table -->
                <div class="bg-gray-700/30 rounded-2xl overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-white">
                            <thead>
                                <tr class="bg-gray-600/80">
                                    <th class="p-4 text-left font-semibold">Rank</th>
                                    <th class="p-4 text-left font-semibold">Name</th>
                                    <th class="p-4 text-left font-semibold">Tasks Initiated</th>
                                    <th class="p-4 text-left font-semibold">Tasks Completed</th>
                                    <th class="p-4 text-left font-semibold">Appreciation Sent</th>
                                    <th class="p-4 text-left font-semibold">Appreciation Received</th>
                                    {#each availableCurrencies as currency}
                                        <th class="p-4 text-left font-semibold">{currency.toUpperCase()}</th>
                                    {/each}
                                    <th class="p-4 text-left font-semibold">Score</th>
                                    <th class="p-4 text-left font-semibold">Percentage</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each sortedUsers as [userId, user], index}
                                    {@const score = calculateScore(user)}
                                    {@const percentage = calculatePercentage(score)}
                                    <tr class="border-b border-gray-600/50 hover:bg-gray-600/20 transition-all duration-200">
                                        <td class="p-4">
                                            <div class="flex items-center">
                                                {#if index === 0}
                                                    <span class="w-8 h-8 bg-yellow-500 text-black rounded-full flex items-center justify-center font-bold text-sm">🏆</span>
                                                {:else if index === 1}
                                                    <span class="w-8 h-8 bg-gray-400 text-white rounded-full flex items-center justify-center font-bold text-sm">🥈</span>
                                                {:else if index === 2}
                                                    <span class="w-8 h-8 bg-orange-600 text-white rounded-full flex items-center justify-center font-bold text-sm">🥉</span>
                                                {:else}
                                                    <span class="w-8 h-8 bg-gray-600 text-white rounded-full flex items-center justify-center font-bold text-sm">{index + 1}</span>
                                                {/if}
                                            </div>
                                        </td>
                                        <td class="p-4">
                                            <button 
                                                class="text-left hover:text-blue-400 transition-colors cursor-pointer underline-offset-2 hover:underline flex items-center gap-3"
                                                on:click={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    openUserModal(userId);
                                                }}
                                            >
                                                <div class="relative flex-shrink-0">
                                                    <img 
                                                        src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
                                                        alt={`${user.first_name} ${user.last_name || ''}`}
                                                        class="w-10 h-10 rounded-full object-cover border-2 border-gray-500 aspect-square flex-shrink-0"
                                                        on:error={(e) => {
                                                            e.currentTarget.style.display = 'none';
                                                            e.currentTarget.nextElementSibling.style.display = 'flex';
                                                        }}
                                                    />
                                                    <div class="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm font-bold border-2 border-gray-500 aspect-square flex-shrink-0" style="display: none;">
                                                        {user.first_name ? user.first_name[0] : '?'}{user.last_name ? user.last_name[0] : ''}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div class="font-semibold">{user.first_name} {user.last_name || ""}</div>
                                                    {#if user.username}
                                                        <div class="text-sm text-gray-400">@{user.username}</div>
                                                    {/if}
                                                </div>
                                            </button>
                                        </td>
                                        <td class="p-4">
                                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-600/20 text-blue-300">
                                                {(user.initiated && Array.isArray(user.initiated)) ? user.initiated.length : 0}
                                            </span>
                                        </td>
                                        <td class="p-4">
                                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-600/20 text-green-300">
                                                {(user.completed && Array.isArray(user.completed)) ? user.completed.length : 0}
                                            </span>
                                        </td>
                                        <td class="p-4">
                                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-600/20 text-blue-300">
                                                {user.sent || 0}
                                            </span>
                                        </td>
                                        <td class="p-4">
                                            <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-600/20 text-purple-300">
                                                {user.received || 0}
                                            </span>
                                        </td>
                                        {#each availableCurrencies as currency}
                                            {@const balance = getCurrencyBalance(user.id || userId, currency)}
                                            <td class="p-4">
                                                <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium {balance > 0 ? 'bg-green-600/20 text-green-300' : balance < 0 ? 'bg-red-600/20 text-red-300' : 'bg-gray-600/20 text-gray-300'}">
                                                    {formatCurrencyAmount(balance, currency)}
                                                </span>
                                            </td>
                                        {/each}
                                        <td class="p-4">
                                            <span class="font-bold text-lg text-white">{score.toFixed(1)}</span>
                                        </td>
                                        <td class="p-4">
                                            <div class="flex items-center gap-3">
                                                <div class="flex-1 bg-gray-600 rounded-full h-3 min-w-[100px]">
                                                    <div 
                                                        class="bg-gradient-to-r from-blue-500 to-blue-400 h-3 rounded-full transition-all duration-500"
                                                        style="width: {percentage}%"
                                                    ></div>
                                                </div>
                                                <span class="text-sm font-medium text-gray-300 min-w-[45px]">
                                                    {percentage.toFixed(1)}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                {/each}
                            </tbody>
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
                                    on:click={cancelEditing}
                                    class="inline-flex items-center gap-2 px-3 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors text-sm font-medium"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                                    </svg>
                                    Cancel
                                </button>
                                <button 
                                    on:click={saveEquation}
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
                                on:click={() => {
                                    editingEquation = { ...equation };
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
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.initiated > 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.initiated > 0 ? 'text-gray-300' : 'text-gray-400'}">Tasks Initiated</span>
                                <span class="text-xs {equation.initiated > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        on:click={() => adjustValue('initiated', -1)}
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
                                        min="0"
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-blue-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-blue-400 focus:outline-none"
                                    />
                                    <button 
                                        on:click={() => adjustValue('initiated', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase tasks initiated value"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.initiated > 0 ? 'text-blue-400' : 'text-gray-500'}">{equation.initiated}</div>
                            {/if}
                            <div class="text-xs {equation.initiated > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per initiated task</div>
                            {#if equation.initiated === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Tasks Completed -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.completed > 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.completed > 0 ? 'text-gray-300' : 'text-gray-400'}">Tasks Completed</span>
                                <span class="text-xs {equation.completed > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        on:click={() => adjustValue('completed', -1)}
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
                                        min="0"
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-green-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-green-400 focus:outline-none"
                                    />
                                    <button 
                                        on:click={() => adjustValue('completed', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase completed tasks weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.completed > 0 ? 'text-green-400' : 'text-gray-500'}">{equation.completed}</div>
                            {/if}
                            <div class="text-xs {equation.completed > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per completed task</div>
                            {#if equation.completed === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Sent -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.sent > 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.sent > 0 ? 'text-gray-300' : 'text-gray-400'}">Appreciation Sent</span>
                                <span class="text-xs {equation.sent > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        on:click={() => adjustValue('sent', -1)}
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
                                        min="0"
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-purple-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-purple-400 focus:outline-none"
                                    />
                                    <button 
                                        on:click={() => adjustValue('sent', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase appreciation sent weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.sent > 0 ? 'text-purple-400' : 'text-gray-500'}">{equation.sent}</div>
                            {/if}
                            <div class="text-xs {equation.sent > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per appreciation sent</div>
                            {#if equation.sent === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>

                        <!-- Received -->
                        <div class="bg-gray-600/50 rounded-xl p-4 {equation.received > 0 ? '' : 'opacity-50'}">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-sm font-medium {equation.received > 0 ? 'text-gray-300' : 'text-gray-400'}">Appreciation Received</span>
                                <span class="text-xs {equation.received > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                            </div>
                            {#if isEditingEquation}
                                <div class="flex items-center gap-2">
                                    <button 
                                        on:click={() => adjustValue('received', -1)}
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
                                        min="0"
                                        step="0.1"
                                        class="w-16 text-center bg-gray-700 text-orange-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-orange-400 focus:outline-none"
                                    />
                                    <button 
                                        on:click={() => adjustValue('received', 1)}
                                        class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                        aria-label="Increase appreciation received weight"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                </div>
                            {:else}
                                <div class="text-2xl font-bold {equation.received > 0 ? 'text-orange-400' : 'text-gray-500'}">{equation.received}</div>
                            {/if}
                            <div class="text-xs {equation.received > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per appreciation received</div>
                            {#if equation.received === 0}
                                <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                            {/if}
                        </div>
                    </div>

                    <!-- Currency Weights -->
                    {#if availableCurrencies.length > 0}
                        <div class="mt-6">
                            <h4 class="text-sm font-medium text-gray-400 mb-3">Currency Weights</h4>
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {#each availableCurrencies as currency}
                                    <div class="bg-gray-600/50 rounded-xl p-4 {equation.currencies[currency] > 0 ? '' : 'opacity-50'}">
                                        <div class="flex items-center justify-between mb-2">
                                            <span class="text-sm font-medium {equation.currencies[currency] > 0 ? 'text-gray-300' : 'text-gray-400'}">{currency.toUpperCase()}</span>
                                            <span class="text-xs {equation.currencies[currency] > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                        </div>
                                        {#if isEditingEquation}
                                            <div class="flex items-center gap-2">
                                                <button 
                                                    on:click={() => adjustCurrencyWeight(currency, -1)}
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
                                                    min="0"
                                                    step="0.1"
                                                    class="w-16 text-center bg-gray-700 text-emerald-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-emerald-400 focus:outline-none"
                                                />
                                                <button 
                                                    on:click={() => adjustCurrencyWeight(currency, 1)}
                                                    class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                                    aria-label="Increase {currency} weight"
                                                >
                                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                                    </svg>
                                                </button>
                                            </div>
                                        {:else}
                                            <div class="text-2xl font-bold {equation.currencies[currency] > 0 ? 'text-emerald-400' : 'text-gray-500'}">{equation.currencies[currency] || 0}</div>
                                        {/if}
                                        <div class="text-xs {equation.currencies[currency] > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per {currency} balance</div>
                                        {#if !equation.currencies[currency] || equation.currencies[currency] === 0}
                                            <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <!-- Additional Metrics -->
                    <div class="mt-6">
                        <h4 class="text-sm font-medium text-gray-400 mb-3">Additional Metrics</h4>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <!-- Hours -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.hours > 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.hours > 0 ? 'text-gray-300' : 'text-gray-400'}">Hours</span>
                                    <span class="text-xs {equation.hours > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            on:click={() => adjustValue('hours', -1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Decrease hours weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/>
                                            </svg>
                                        </button>
                                        <input 
                                            type="number" 
                                            bind:value={editingEquation.hours}
                                            min="0"
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-yellow-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-yellow-400 focus:outline-none"
                                        />
                                        <button 
                                            on:click={() => adjustValue('hours', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase hours weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                        </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.hours > 0 ? 'text-yellow-400' : 'text-gray-500'}">{equation.hours}</div>
                                {/if}
                                <div class="text-xs {equation.hours > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per hour</div>
                                {#if equation.hours === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>

                            <!-- Collaboration -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.collaboration > 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.collaboration > 0 ? 'text-gray-300' : 'text-gray-400'}">Collaboration</span>
                                    <span class="text-xs {equation.collaboration > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            on:click={() => adjustValue('collaboration', -1)}
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
                                            min="0"
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-teal-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-teal-400 focus:outline-none"
                                        />
                                        <button 
                                            on:click={() => adjustValue('collaboration', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase collaboration weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                        </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.collaboration > 0 ? 'text-teal-400' : 'text-gray-500'}">{equation.collaboration}</div>
                                {/if}
                                <div class="text-xs {equation.collaboration > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per collaboration</div>
                                {#if equation.collaboration === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>

                            <!-- Wants -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.wants > 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.wants > 0 ? 'text-gray-300' : 'text-gray-400'}">Wants</span>
                                    <span class="text-xs {equation.wants > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            on:click={() => adjustValue('wants', -1)}
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
                                            min="0"
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-pink-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-pink-400 focus:outline-none"
                                        />
                                        <button 
                                            on:click={() => adjustValue('wants', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase wants weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                            </svg>
                                        </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.wants > 0 ? 'text-pink-400' : 'text-gray-500'}">{equation.wants}</div>
                                {/if}
                                <div class="text-xs {equation.wants > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per want</div>
                                {#if equation.wants === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>

                            <!-- Offers -->
                            <div class="bg-gray-600/50 rounded-xl p-4 {equation.offers > 0 ? '' : 'opacity-50'}">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-sm font-medium {equation.offers > 0 ? 'text-gray-300' : 'text-gray-400'}">Offers</span>
                                    <span class="text-xs {equation.offers > 0 ? 'text-gray-400' : 'text-gray-500'}">Weight</span>
                                </div>
                                {#if isEditingEquation}
                                    <div class="flex items-center gap-2">
                                        <button 
                                            on:click={() => adjustValue('offers', -1)}
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
                                            min="0"
                                            step="0.1"
                                            class="w-16 text-center bg-gray-700 text-indigo-400 text-xl font-bold rounded-lg border border-gray-500 focus:border-indigo-400 focus:outline-none"
                                        />
                                        <button 
                                            on:click={() => adjustValue('offers', 1)}
                                            class="w-8 h-8 bg-gray-500 hover:bg-gray-400 text-white rounded-lg flex items-center justify-center transition-colors"
                                            aria-label="Increase offers weight"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                        </svg>
                                    </button>
                                    </div>
                                {:else}
                                    <div class="text-2xl font-bold {equation.offers > 0 ? 'text-indigo-400' : 'text-gray-500'}">{equation.offers}</div>
                                {/if}
                                <div class="text-xs {equation.offers > 0 ? 'text-gray-400' : 'text-gray-500'} mt-1">Points per offer</div>
                                {#if equation.offers === 0}
                                    <div class="text-xs text-gray-500 mt-1">⚠️ Not used in scoring</div>
                                {/if}
                            </div>
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

<!-- User Modal -->
{#if showUserModal && selectedUserId && holonID && store[selectedUserId]}
    <User 
        userId={selectedUserId} 
        holonId={holonID} 
        userData={store[selectedUserId]}
        on:close={closeUserModal} 
    />
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
</style>

