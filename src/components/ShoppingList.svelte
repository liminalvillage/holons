<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { formatDate, formatTime } from "../utils/date";
    import type { HoloSphere } from "holosphere";
    import { getHologramSourceName } from "../utils/holonNames";

    interface ShoppingItem {
        id: string;
        quantity: number;
        done: boolean;
        from: string;
        addedOn: string;
        _hologram?: {
            isHologram: boolean;
            soul: string;
            sourceHolon: string;
            localOverrides?: string[];
        };
    }

    const holosphere = getContext("holosphere") as HoloSphere;

    $: holonID = $ID;
    let store: Record<string, ShoppingItem> = {};
    let newItemText = "";
    $: shoppingItems = Object.entries(store);
    $: filteredItems = shoppingItems.filter(([_, item]) => {
        // Filter holograms if showHolograms is false
        if (!showHolograms && item._hologram?.isHologram) {
            return false;
        }
        return true;
    });

    let showInput = false;
    let inputText = "";
    let showHolograms = true;
    let shoppingItemsUnsubscribe: (() => void) | undefined;
	let subscriptionState = {
		currentHolonID: null as string | null
	};
    let hologramSourceNames = new Map<string, string>();

    async function preResolveHologramNames(items: ShoppingItem[]) {
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
					const { fetchHolonName } = await import('../utils/holonNames');
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
            shoppingItems = [...shoppingItems]; // trigger update
		}
	}

    async function subscribe() {
		if (!holosphere || !holonID) return;
		
		if (subscriptionState.currentHolonID === holonID && shoppingItemsUnsubscribe) return;
		
		if (shoppingItemsUnsubscribe) {
			shoppingItemsUnsubscribe();
			shoppingItemsUnsubscribe = undefined;
		}
		
		store = {};
		
		try {
			subscriptionState.currentHolonID = holonID;
			
			const initialData = await holosphere.getAll(holonID, "shopping");
			
			if (typeof initialData === 'object' && initialData !== null && !Array.isArray(initialData)) {
				store = initialData as Record<string, ShoppingItem>;
			}
			
			await preResolveHologramNames(Object.values(store));

			const off = holosphere.subscribe(holonID, "shopping", (newItem: ShoppingItem | null, key?: string) => {
				if (newItem && key) {
					store = { ...store, [key]: newItem };
				} else if (key) {
					const { [key]: _, ...rest } = store;
					store = rest;
				}
                if (newItem?._hologram?.isHologram) {
                    preResolveHologramNames([newItem]);
                }
			});

			if (typeof off === 'function') {
				shoppingItemsUnsubscribe = off as unknown as () => void;
			}

		} catch (error) {
			console.error('Error setting up shopping list subscription:', error);
			subscriptionState.currentHolonID = null;
			shoppingItemsUnsubscribe = undefined;
		}
	}

    onMount(() => {
		let mounted = true;
		
		const idSubscription = ID.subscribe(async (value) => {
			if (!mounted || !value ) return;
			holonID = value;
			await subscribe();
		});

        // Load preferences
        try {
            const storedShowHolograms = localStorage.getItem("shoppingShowHolograms");
            if (storedShowHolograms !== null) {
                showHolograms = storedShowHolograms === "true";
            }
        } catch (error) {
            console.error('Error loading preferences:', error);
        }

        return () => {
			mounted = false;
			if (idSubscription) idSubscription();
			if (shoppingItemsUnsubscribe) shoppingItemsUnsubscribe();
		};
    });

    // Save showHolograms preference to localStorage
    $: if (typeof localStorage !== 'undefined') {
        localStorage.setItem("shoppingShowHolograms", showHolograms.toString());
    }

    // Function to get hologram source name using centralized service
    function getHologramSource(hologramSoul: string | undefined): string {
        if (!hologramSoul) return '';
        
        if (hologramSourceNames.has(hologramSoul)) {
            return hologramSourceNames.get(hologramSoul)!;
        }
        
        const match = hologramSoul.match(/Holons\/([^\/]+)/);
        return match ? `Holon ${match[1]}` : 'External Source';
    }

    function toggleItemStatus(key: string): void {
        if (store[key] && holonID) {
            const item = { ...store[key], done: !store[key].done };

            holosphere.put(
                holonID,
                "shopping",
                item
            );
        }
    }

    function showAddInput() {
        inputText = "";
        showInput = true;
    }

    function handleAdd() {
        if (!inputText.trim() || !holonID) return;
        
        const newItem: ShoppingItem = {
            id: inputText.trim(),
            quantity: 1,
            done: false,
            from: 'Dashboard User',
            addedOn: new Date().toISOString()
        };

        store = { ...store, [newItem.id]: newItem };

        holosphere.put(
            holonID,
            "shopping",
            newItem
        ).catch(err => {
            console.error("Failed to add item", err);
            const {[newItem.id]: _, ...rest} = store;
            store = rest;
        });;
        
        showInput = false;
        inputText = "";
    }

    async function removeChecked(holonId: string): Promise<void> {
        if (!holonId) return;
        const checkedItemsKeys = Object.entries(store)
            .filter(([_, item]) => item.done)
            .map(([key]) => key);

        if (checkedItemsKeys.length === 0) return;

        // Store original state in case we need to revert
        const originalStore = { ...store };

        try {
            // Update local store optimistically
            const newStore = { ...store };
            checkedItemsKeys.forEach(key => {
                delete newStore[key];
            });
            store = newStore;

            // Delete from backend - wait for all deletions to complete
            const deletePromises = checkedItemsKeys.map(key => 
                holosphere.delete(holonId, "shopping", key)
            );
            
            await Promise.all(deletePromises);
            
        } catch (error) {
            console.error("Failed to remove checked items:", error);
            // Revert local changes if backend deletion failed
            store = originalStore;
            
            // Optional: Show user-friendly error notification
            alert("Failed to remove items. Please try again.");
        }
    }
</script>

<div class="space-y-8">
    <!-- Header Section -->
    <div class="bg-gradient-to-r from-gray-800 to-gray-700 py-8 px-8 rounded-3xl shadow-2xl">
        <div class="flex flex-col md:flex-row justify-between items-center">
            <div class="text-center md:text-left mb-4 md:mb-0">
                <h1 class="text-4xl font-bold text-white mb-2">Shopping List</h1>
                <p class="text-gray-300 text-lg">{new Date().toDateString()}</p>
            </div>
            <!-- Show Holograms Toggle -->
            <label class="flex items-center cursor-pointer">
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
        </div>
    </div>

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">
            <!-- Stats Section -->
            <div class="grid grid-cols-3 gap-4 mb-8">
                <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                    <div class="text-2xl font-bold text-white mb-1">
                        {filteredItems.filter(([_, item]) => !item.done).length}
                    </div>
                    <div class="text-sm text-gray-400">Pending</div>
                </div>
                <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                    <div class="text-2xl font-bold text-white mb-1">
                        {filteredItems.filter(([_, item]) => item.done).length}
                    </div>
                    <div class="text-sm text-gray-400">Completed</div>
                </div>
                <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                    <div class="text-2xl font-bold text-white mb-1">{filteredItems.length}</div>
                    <div class="text-sm text-gray-400">Total Items</div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="flex justify-center items-center gap-4 mb-6">
                <button
                    on:click={showAddInput}
                    class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors shadow-lg transform hover:scale-105"
                    aria-label="Add new item"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                    <span>Add New Item</span>
                </button>

                <button 
                    on:click={async () => {
                        if (holonID) {
                            await removeChecked(holonID);
                        }
                    }}
                    class="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors shadow-lg transform hover:scale-105"
                    aria-label="Remove checked items"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    <span>Remove Checked</span>
                </button>
            </div>

            <!-- Shopping Items -->
            <div class="space-y-3">
                {#each filteredItems as [key, item]}
                    <div id={key} class="w-full">
                        <button
                            class="w-full text-left group relative"
                            on:click={() => toggleItemStatus(item.id)}
                            aria-label={`Toggle ${item.id} - ${item.done ? 'completed' : 'pending'}`}
                        >
                            <div
                                class="p-4 rounded-xl transition-all duration-300 border hover:shadow-md transform hover:scale-[1.005]"
                                class:bg-gray-800={item.done}
                                class:border-gray-700={item.done}
                                class:opacity-70={item.done}
                                class:bg-gray-700={!item.done}
                                class:border-transparent={!item._hologram?.isHologram}
                                class:hover:bg-gray-600={!item.done}
                                class:hover:border-gray-500={!item.done}
                                class:opacity-75={!item.done && item._hologram?.isHologram}
                                class:border-2={item._hologram?.isHologram}
                                class:border-indigo-500={item._hologram?.isHologram}
                                style="{item._hologram?.isHologram ? 'box-shadow: 0 0 20px rgba(99, 102, 241, 0.4), inset 0 0 20px rgba(99, 102, 241, 0.1);' : ''}"
                            >
                                <div class="flex items-center justify-between gap-3">
                                    <div class="flex items-center gap-3 flex-1 min-w-0">
                                        <!-- Item Icon -->
                                        <div class="flex-shrink-0 w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center">
                                            <span class="text-sm">{item.done ? '✅' : '🛒'}</span>
                                        </div>

                                        <!-- Main Content -->
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2 mb-1">
                                                {#if item.quantity && item.quantity > 1}
                                                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-black/10 {item.done ? 'text-gray-400' : 'text-gray-200'} flex-shrink-0">
                                                        {item.quantity}×
                                                    </span>
                                                {/if}
                                                <h3 class="text-base font-bold truncate" class:text-gray-400={item.done} class:line-through={item.done} class:text-white={!item.done}>
                                                    {item.id}
                                                </h3>
                                                {#if item._hologram?.isHologram}
                                                    <div 
                                                        class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/20 text-indigo-300 flex-shrink-0 hover:bg-indigo-500/30 transition-colors cursor-pointer" 
                                                        title="Navigate to source holon: {getHologramSource(item._hologram.soul)}"
                                                        on:click|stopPropagation={() => {
                                                            const match = item._hologram?.soul?.match(/Holons\/([^\/]+)/);
                                                            if (match) {
                                                                window.location.href = `/${match[1]}/shopping`;
                                                            }
                                                        }}
                                                        role="button"
                                                        tabindex="0"
                                                        on:keydown|stopPropagation={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                const match = item._hologram?.soul?.match(/Holons\/([^\/]+)/);
                                                                if (match) {
                                                                    window.location.href = `/${match[1]}/shopping`;
                                                                }
                                                            }
                                                        }}
                                                    >
                                                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                                                        </svg>
                                                        {getHologramSource(item._hologram.soul)}
                                                        <svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                                        </svg>
                                                    </div>
                                                {/if}
                                            </div>
                                            <p class="text-sm" class:text-gray-500={item.done} class:text-gray-400={!item.done}>
                                                Added by: {item.from}
                                            </p>
                                        </div>
                                    </div>

                                    <!-- Right Side - Checkbox -->
                                    <div class="flex items-center gap-3 flex-shrink-0">
                                        <div class="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={item.done}
                                                on:click|stopPropagation
                                                on:change={() => toggleItemStatus(item.id)}
                                                class="w-5 h-5 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500 focus:ring-2"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </button>
                    </div>
                {/each}

                {#if filteredItems.length === 0}
                    <div class="text-center py-12">
                        <div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
                            <svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                            </svg>
                        </div>
                        <h3 class="text-lg font-medium text-white mb-2">No items found</h3>
                        <p class="text-gray-400 mb-4">Get started by adding your first item</p>
                        <button
                            on:click={showAddInput}
                            class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors"
                        >
                            Add Item
                        </button>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</div>

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
            aria-labelledby="item-input-title"
        >
            <div class="p-6">
                <div class="flex items-center justify-between mb-6">
                    <h3 id="item-input-title" class="text-white text-xl font-bold">Add New Item</h3>
                    <button
                        on:click={() => showInput = false}
                        class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
                        aria-label="Close item input dialog"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
                
                <form 
                    on:submit|preventDefault={async (e) => {
                        handleAdd();
                    }}
                    class="space-y-4"
                >
                    <div>
                        <label for="item-name" class="block text-sm font-medium text-gray-300 mb-2">Item Name</label>
                        <input
                            id="item-name"
                            type="text"
                            bind:value={inputText}
                            placeholder="Enter item name..."
                            class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none transition-colors"
                            required
                        />
                    </div>
                    <div class="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            on:click={() => showInput = false}
                            class="px-6 py-2.5 text-sm font-medium rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
                            aria-label="Cancel adding item"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="px-6 py-2.5 text-sm font-medium rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
                            disabled={!inputText.trim()}
                            aria-label="Add new item"
                        >
                            Add Item
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Toggle switch styling */
    .dot {
        transition: transform 0.3s ease-in-out;
    }
</style>
