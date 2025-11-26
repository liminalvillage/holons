<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { calculateCreditMatrix } from "../utils/expenseCalculations";

    interface Expense {
        id: string;
        amount: number;
        currency: string;
        description: string;
        paidBy: string;
        splitWith: string[];
        date: string;
    }

    interface User {
        id: number;
        first_name: string;
    }

    const holosphere = getContext("holosphere") as HoloSphere;
    
    let holonID: string = '';
    let expenses: Record<string, Expense> = {};
    let store: Record<string, User> = {};
    let selectedCurrency: string = '';
    let availableCurrencies: string[] = [];
    let currenciesFromSettingsLoaded = false;
    let creditMatrix: number[][] = [];
    let dataLoaded = false; // Track if initial data loading is complete
    let isLoading = true;
    let connectionReady = false;
    
    $: users = Object.values(store);
    
    // Track current subscription state
    let currentSubscriptionHolonID: string | null = null;
    let unsubscribeFunctions: (() => void)[] = [];
    
    function cleanupSubscriptions() {
        unsubscribeFunctions.forEach(unsub => {
            if (typeof unsub === 'function') {
                try {
                    unsub();
                } catch (e) {
                    console.error('Error during cleanup:', e);
                }
            }
        });
        unsubscribeFunctions = [];
        currentSubscriptionHolonID = null;
    }

    // Add fetchData function with retry logic
    async function fetchData(retryCount = 0) {
        if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
            return;
        }
        
        isLoading = true;
        dataLoaded = false;
        
        try {
            console.log(`Fetching expenses data for holon: ${holonID}`);
            
            // Fetch data with timeout
            const fetchWithTimeout = async (promise: Promise<any>, timeoutMs: number = 5000) => {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeoutMs)
                );
                return Promise.race([promise, timeoutPromise]);
            };

            // Clean up previous subscriptions
            cleanupSubscriptions();
            
            // Set up new subscriptions
            await Promise.all([
                subscribeToExpenses(),
                subscribeToUsers(),
                subscribeToSettings()
            ]);
            
            console.log(`Successfully set up subscriptions for holon ${holonID}`);

        } catch (error: any) {
            console.error('Error fetching expenses data:', error);
            
            // Retry on network errors up to 3 times with exponential backoff
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`Retrying expenses fetch in ${delay}ms (attempt ${retryCount + 1}/3)`);
                setTimeout(() => fetchData(retryCount + 1), delay);
                return;
            }
        } finally {
            isLoading = false;
        }
    }
    
    onMount(() => {
        // Initialize with URL parameter first
        const urlId = $page.params.id;
        if (urlId && urlId !== 'undefined' && urlId !== 'null' && urlId.trim() !== '') {
            holonID = urlId;
            // Update the ID store to keep them in sync
            ID.set(urlId);
        }

        // Wait for holosphere to be ready before proceeding
        const checkConnection = async () => {
            if (!holosphere) {
                setTimeout(checkConnection, 100);
                return;
            }
            
            // Add a small delay to ensure the connection is stable
            await new Promise(resolve => setTimeout(resolve, 200));
            connectionReady = true;
            
            // Set up subscription to ID store with debouncing
            let updateTimeout: NodeJS.Timeout;
            const idUnsubscribe = ID.subscribe((value) => {
                if (value && value !== 'undefined' && value !== 'null' && value.trim() !== '') {
                    // Clear any pending update
                    if (updateTimeout) clearTimeout(updateTimeout);
                    
                    // Debounce the update to avoid rapid changes
                    updateTimeout = setTimeout(async () => {
                        if (value !== holonID) {
                            holonID = value;
                            await fetchData();
                        }
                    }, 100);
                }
            });

            // Initial fetch if we have an ID
            if (holonID && holonID !== 'undefined' && holonID !== 'null' && holonID.trim() !== '') {
                await fetchData();
            }

            return () => {
                if (idUnsubscribe) idUnsubscribe();
                cleanupSubscriptions();
            };
        };
        
        checkConnection();

        // Cleanup subscription on unmount
        return () => {
            cleanupSubscriptions();
        };
    });

    async function subscribeToExpenses(): Promise<void> {
        expenses = {};
        if (holosphere && holonID) {
            try {
                const subscription = await holosphere.subscribe(
                    holonID,
                    "expenses",
                    (newItem: any, key?: string) => {
                        if (key === undefined) return;
                        if (newItem) {
                            try {
                                const parsedExpense = typeof newItem === 'string' ? JSON.parse(newItem) : newItem;
                                expenses[key] = parsedExpense as Expense;
                            } catch (e) {
                                console.error('Failed to parse expense:', e);
                            }
                        } else {
                            delete expenses[key];
                        }
                        expenses = expenses;
                        if (!currenciesFromSettingsLoaded) {
                            deriveCurrenciesFromExpenses();
                        }
                        dataLoaded = true;
                    }
                );
                
                if (subscription && typeof subscription.unsubscribe === 'function') {
                    unsubscribeFunctions.push(subscription.unsubscribe);
                }
            } catch (error) {
                console.error('Failed to subscribe to expenses:', error);
            }
        }
    }

    async function subscribeToUsers(): Promise<void> {
        store = {};
        if (holosphere && holonID) {
            try {
                const subscription = await holosphere.subscribe(
                    holonID,
                    "users",
                    (newUser: any, key?: string) => {
                        if (key === undefined) return;
                        if (newUser) {
                            // Use user.id as the canonical key if available
                            const canonicalKey = newUser.id || key;
                            
                            if (newUser.id && key !== newUser.id) {
                                // Remove the old key if it's different from the canonical key
                                const { [key]: _, ...rest } = store;
                                store = { ...rest, [canonicalKey]: newUser as User };
                            } else {
                                // Use the key directly
                                store[key] = newUser as User;
                            }
                        } else {
                            delete store[key];
                        }
                        store = store;
                        users = Object.values(store);
                        if (!currenciesFromSettingsLoaded) {
                            deriveCurrenciesFromExpenses();
                        }
                    }
                );
                
                if (subscription && typeof subscription.unsubscribe === 'function') {
                    unsubscribeFunctions.push(subscription.unsubscribe);
                }
            } catch (error) {
                console.error('Failed to subscribe to users:', error);
            }
        }
    }

    async function subscribeToSettings(): Promise<void> {
        availableCurrencies = [];
        if (holosphere && holonID) {
            try {
                const subscription = await holosphere.subscribe(
                    holonID,
                    "settings",
                    (settingsData: any, key?: string) => {
                        if (settingsData && Array.isArray(settingsData.currencies)) {
                            availableCurrencies = settingsData.currencies.filter((c: unknown) => typeof c === 'string');
                        } else {
                            console.warn("Settings data does not contain a valid 'currencies' array:", settingsData);
                            availableCurrencies = [];
                        }
                        availableCurrencies = [...availableCurrencies];

                        if (settingsData && Array.isArray(settingsData.currencies) && availableCurrencies.length > 0) {
                            currenciesFromSettingsLoaded = true;
                        } else {
                            currenciesFromSettingsLoaded = false;
                            deriveCurrenciesFromExpenses();
                        }
                        dataLoaded = true;
                    }
                );
                
                if (subscription && typeof subscription.unsubscribe === 'function') {
                    unsubscribeFunctions.push(subscription.unsubscribe);
                }
            } catch (error) {
                console.error('Failed to subscribe to settings:', error);
            }
        }
    }

    function calculateCredits(currency: string): void {
        if (!currency || users.length === 0) {
            creditMatrix = [];
            return;
        }
        
        // Use the shared utility function
        creditMatrix = calculateCreditMatrix(currency, expenses, users);
    }

    function deriveCurrenciesFromExpenses() {
        const derived = [...new Set(Object.values(expenses)
            .map(e => e?.currency)
            .filter(c => c && typeof c === 'string' && c !== ''))] as string[];
        

        if (derived.length > 0) {
            availableCurrencies = derived;
        } else {
            availableCurrencies = []; 
        }
        availableCurrencies = [...availableCurrencies];
    }

    // Set initial currency reactively
    $: {
        if (selectedCurrency === '' && availableCurrencies.length > 0) {
            selectedCurrency = availableCurrencies[0];
        }
    }

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
                pageUpdateTimeout = setTimeout(async () => {
                    holonID = newId;
                    // Update the ID store to keep them in sync
                    ID.set(newId);
                    if (holosphere) {
                        await fetchData();
                    }
                }, 100);
            }
        }
    }

    // Check if we have finished loading and have no currencies
    $: noCurrenciesAvailable = dataLoaded && availableCurrencies.length === 0;

    // Reactive block that depends on selectedCurrency and users
    $: {
        if (selectedCurrency !== '' && users.length > 0) {
            calculateCredits(selectedCurrency);
        }
    }

    function formatAmount(amount: number): string {
        const currencyCode = selectedCurrency ? selectedCurrency.toUpperCase() : '';
        if (['EUR','USD', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'].includes(currencyCode)) {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currencyCode
            }).format(Math.abs(amount));
        } else {
            return Math.abs(amount).toFixed(2);
        }
    }
</script>

<div class="w-full bg-gray-800 p-6 rounded-3xl">
    <div class="flex justify-between text-white items-center mb-8">
        <p class="text-2xl font-bold">Expenses</p>
        {#if selectedCurrency !== ''}
        <select
            bind:value={selectedCurrency}
            class="bg-gray-700 text-white px-4 py-2 rounded-lg"
        >
            {#each availableCurrencies as currency}
                <option value={currency}>{currency.toUpperCase()}</option>
            {/each}
        </select>
        {:else if noCurrenciesAvailable}
            <span class="text-gray-500">No currencies configured</span>
        {:else}
            <span class="text-gray-500">Loading currencies...</span>
        {/if}
    </div>

    <!-- Credits Table -->
    {#if selectedCurrency !== ''}
    <div class="overflow-x-auto overflow-y-auto max-h-[70vh] rounded-lg border border-gray-700">
        <table class="w-full text-white border-collapse relative">
            <thead class="sticky top-0 z-20">
                <tr class="border-b border-gray-700">
                    <th class="sticky left-0 top-0 z-30 px-6 py-3 bg-gray-900 text-sm font-semibold uppercase tracking-wider">
                        <div class="flex flex-col items-center gap-1">
                            <span class="text-gray-400">Owes</span>
                            <span class="text-lg">↓</span>
                            <span class="text-gray-400">Is Owed</span>
                            <span class="text-lg">→</span>
                        </div>
                    </th>
                    {#each users as user}
                        <th class="sticky top-0 px-3 py-3 bg-gray-900 text-sm font-semibold uppercase tracking-wider h-32 relative">
                            <div class="absolute inset-0 flex items-center justify-center">
                                <div class="transform -rotate-90 whitespace-nowrap">{user.first_name}</div>
                            </div>
                        </th>
                    {/each}
                    <th class="sticky top-0 px-3 py-3 bg-gray-800 font-bold border-l border-gray-600 text-sm uppercase tracking-wider h-32 relative">
                        <div class="absolute inset-0 flex items-center justify-center">
                            <div class="transform -rotate-90 whitespace-nowrap">Balance</div>
                        </div>
                    </th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-700">
                {#each users as user, rowIndex}
                    <tr class="bg-gray-800 hover:bg-gray-750 transition-colors duration-150 ease-in-out {rowIndex % 2 === 0 ? 'bg-opacity-50' : 'bg-opacity-25'}">
                        <th class="sticky left-0 z-10 px-6 py-4 text-left font-medium bg-gray-800 {rowIndex % 2 === 0 ? 'bg-opacity-50' : 'bg-opacity-25'} align-middle">{user.first_name}</th>
                        {#each creditMatrix[rowIndex] as credit, colIndex}
                            <td 
                                class="px-3 py-4 text-center font-medium whitespace-nowrap align-middle {credit > 0 ? 'text-green-400' : credit < 0 ? 'text-red-400' : 'text-gray-400'}"
                            >
                                {credit !== 0 ? formatAmount(credit) : '—'}
                            </td>
                        {/each}
                        <td 
                            class="px-3 py-4 text-center font-bold whitespace-nowrap bg-gray-800 border-l border-gray-600 align-middle {creditMatrix[rowIndex].reduce((sum, val) => sum + val, 0) > 0 ? 'text-green-400' : creditMatrix[rowIndex].reduce((sum, val) => sum + val, 0) < 0 ? 'text-red-400' : 'text-gray-400'}"
                        >
                            {formatAmount(creditMatrix[rowIndex].reduce((sum, val) => sum + val, 0))}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>
    {:else if noCurrenciesAvailable}
        <div class="text-center text-gray-500 py-16">
            <div class="mb-4">
                <i class="fas fa-coins text-4xl text-gray-600 mb-4"></i>
            </div>
            <h3 class="text-xl font-semibold mb-2">No Expenses Yet</h3>
            <p class="text-gray-400 mb-4">Start by adding some expenses to track spending and balances.</p>
            <p class="text-sm text-gray-500">
                You can also configure currencies in your holon settings.
            </p>
        </div>
    {:else if isLoading}
        <div class="text-center text-gray-500 py-10">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
            <p>Loading expense data...</p>
        </div>
    {:else}
        <div class="text-center text-gray-500 py-10">
            <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
            <p>Loading expense data...</p>
        </div>
    {/if}

    <!-- Recent Expenses -->
    {#if selectedCurrency !== ''}
    <div class="mt-8">
        <h3 class="text-xl font-bold text-white mb-4">Recent Expenses</h3>
        <div class="space-y-4">
            {#each Object.values(expenses).filter(e => selectedCurrency !== '' && e.currency === selectedCurrency).sort((a, b) => new Date(parseInt(b.date)).getTime() - new Date(parseInt(a.date)).getTime()) as expense}
                <div class="bg-gray-700 rounded-lg p-4">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="text-lg font-semibold text-white">{expense.description}</h4>
                            <p class="text-gray-300">Paid by {users.find(user => user.id === parseInt(expense.paidBy))?.first_name || `ID: ${expense.paidBy}`}</p>
                            <p class="text-sm text-gray-400">Split with: {expense.splitWith.map(id => users.find(user => user.id === parseInt(id))?.first_name || `ID: ${id}`).join(', ')}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-xl font-bold text-white">{formatAmount(expense.amount)}</p>
                            <p class="text-sm text-gray-400">
                                {new Date(parseInt(expense.date)).toLocaleDateString()}<br>{new Date(parseInt(expense.date)).toLocaleTimeString()}
                            </p>
                        </div>
                    </div>
                </div>
            {/each}
        </div>
    </div>
    {/if}
</div> 