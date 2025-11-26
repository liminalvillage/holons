<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import Announcements from "./Announcements.svelte";
    import type { HoloSphere } from "holosphere";
    import { fetchHolonName } from "../utils/holonNames";


    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    let holonID: string = $page.params.id;
    let unsubscribe: () => void;
    let isLoading = true;
    let connectionReady = false;

    let chatCount = 0;
    let userCount = 0;
    let completedTaskCount = 0;
    let openTaskCount = 0;
    let proposalCount = 0;
    let recentEventCount = 0;
    let shoppingItemCount = 0;
    let offerCount = 0;
    let checklistCount = 0;
    let completedChecklistCount = 0;
    let roleCount = 0;
    let unassignedRoleCount = 0;

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
                    }
                }, 100);
            }
        }
    }

    async function fetchData(retryCount = 0) {
        if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
            // Don't redirect - just return without fetching data
            return;
        }
        
        // Reset all counters to 0 before fetching new data
        chatCount = 0;
        userCount = 0;
        completedTaskCount = 0;
        openTaskCount = 0;
        proposalCount = 0;
        recentEventCount = 0;
        shoppingItemCount = 0;
        offerCount = 0;
        checklistCount = 0;
        completedChecklistCount = 0;
        roleCount = 0;
        unassignedRoleCount = 0;
        
        isLoading = true;
        
        try {
            // Fetch all data in parallel with timeouts
            const fetchWithTimeout = async (promise: Promise<any>, timeoutMs: number = 5000) => {
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeoutMs)
                );
                return Promise.race([promise, timeoutPromise]);
            };

            // Fetch all data in parallel with individual timeouts
            const [chats, users, quests, shoppingItems, checklists, roles] = await Promise.allSettled([
                fetchWithTimeout(holosphere.getAll(holonID, "chats"), 5000),
                fetchWithTimeout(holosphere.getAll(holonID, "users"), 5000),
                holosphere.getAll(holonID, "quests"),
                fetchWithTimeout(holosphere.getAll(holonID, "shopping"), 5000),
                fetchWithTimeout(holosphere.getAll(holonID, "checklists"), 5000),
                fetchWithTimeout(holosphere.getAll(holonID, "roles"), 5000),
            ]);

            // Process results safely
            const chatsData = chats.status === 'fulfilled' ? (chats.value || {}) : {};
            const usersData = users.status === 'fulfilled' ? (users.value || {}) : {};
            const questsData = quests.status === 'fulfilled' ? (quests.value || {}) : {};
            const shoppingData = shoppingItems.status === 'fulfilled' ? (shoppingItems.value || {}) : {};
            const checklistsData = checklists.status === 'fulfilled' ? (checklists.value || {}) : {};
            const rolesData = roles.status === 'fulfilled' ? (roles.value || {}) : {};

            // Calculate statistics
            chatCount = Object.keys(chatsData).length;
            userCount = Object.keys(usersData).length;
            shoppingItemCount = Object.keys(shoppingData).length;
            
            // Count offers and requests from quests lens
            const questValues = Object.values(questsData);
            const offersAndRequests = questValues.filter((item: any) => {
                const type = item.type || 'task';
                return type === 'offer' || type === 'request' || type === 'need';
            });
            offerCount = offersAndRequests.length;
            
            checklistCount = Object.keys(checklistsData).length;
            completedChecklistCount = Object.values(checklistsData).filter(
                (checklist: any) => checklist.completed === true
            ).length;

            roleCount = Object.keys(rolesData).length;
            unassignedRoleCount = Object.values(rolesData).filter(
                (role: any) => !role.participants || role.participants.length === 0
            ).length;

            // Process quests to separate tasks, proposals, and events
            proposalCount = questValues.filter((item: any) => item.type === "proposal").length;
            const questEvents = questValues.filter((item: any) => item.type === "event");
            
            const actualTasks = questValues.filter((item: any) => {
                const type = item.type || 'task';
                return type === 'task' || type === 'recurring';
            });
            completedTaskCount = actualTasks.filter((task: any) => task.status === "completed").length;
            openTaskCount = actualTasks.filter((task: any) => task.status !== "completed").length;
            
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            recentEventCount = questEvents.filter(
                (event: any) => event.when && new Date(event.when) >= oneWeekAgo
            ).length;

        } catch (error: any) {
            console.error('Error fetching dashboard data:', error);
            
            // Retry on network errors up to 3 times with exponential backoff
            if (retryCount < 3) {
                const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
                console.log(`Retrying data fetch in ${delay}ms (attempt ${retryCount + 1}/3)`);
                setTimeout(() => fetchData(retryCount + 1), delay);
                return;
            }
        } finally {
            isLoading = false;
        }
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
<div class="space-y-8">
    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <!-- Users Card -->
        <a
            href={`/${holonID}/status`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-8 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-green-500/10 to-green-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center justify-between mb-4">
                    <div class="p-3 bg-green-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-users text-2xl text-green-400"></i>
                    </div>
                    <div class="text-right">
                        <p class="text-3xl font-bold text-white">{userCount}</p>
                        <p class="text-sm text-gray-400">Active Users</p>
                    </div>
                </div>
                <h3 class="text-xl font-semibold text-white group-hover:text-green-400 transition-colors">Users</h3>
                <p class="text-gray-400 text-sm mt-1">View rankings & stats</p>
            </div>
        </a>

        <!-- Tasks Card -->
        <a
            href={`/${holonID}/tasks`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-8 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center justify-between mb-4">
                    <div class="p-3 bg-blue-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-tasks text-2xl text-blue-400"></i>
                    </div>
                    <div class="text-right">
                        <p class="text-2xl font-bold text-white">{completedTaskCount}<span class="text-lg text-gray-400">/{openTaskCount + completedTaskCount}</span></p>
                        <p class="text-sm text-gray-400">Completed</p>
                    </div>
                </div>
                <h3 class="text-xl font-semibold text-white group-hover:text-blue-400 transition-colors">Tasks</h3>
                <div class="mt-2">
                    <div class="flex justify-between text-sm text-gray-400 mb-1">
                        <span>Progress</span>
                        <span>{Math.round((completedTaskCount / (openTaskCount + completedTaskCount || 1)) * 100)}%</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-2">
                        <div class="bg-blue-500 h-2 rounded-full transition-all duration-500" style="width: {(completedTaskCount / (openTaskCount + completedTaskCount || 1)) * 100}%"></div>
                    </div>
                </div>
            </div>
        </a>

        <!-- Events Card -->
        <a
            href={`/${holonID}/schedule`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-8 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-purple-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center justify-between mb-4">
                    <div class="p-3 bg-purple-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-calendar-alt text-2xl text-purple-400"></i>
                    </div>
                    <div class="text-right">
                        <p class="text-3xl font-bold text-white">{recentEventCount}</p>
                        <p class="text-sm text-gray-400">This Week</p>
                    </div>
                </div>
                <h3 class="text-xl font-semibold text-white group-hover:text-purple-400 transition-colors">Events</h3>
                <p class="text-gray-400 text-sm mt-1">Recent activities</p>
            </div>
        </a>

        <!-- Shopping Card -->
        <a
            href={`/${holonID}/shopping`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-8 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-red-500/10 to-red-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center justify-between mb-4">
                    <div class="p-3 bg-red-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-shopping-cart text-2xl text-red-400"></i>
                    </div>
                    <div class="text-right">
                        <p class="text-3xl font-bold text-white">{shoppingItemCount}</p>
                        <p class="text-sm text-gray-400">Items</p>
                    </div>
                </div>
                <h3 class="text-xl font-semibold text-white group-hover:text-red-400 transition-colors">Shopping</h3>
                <p class="text-gray-400 text-sm mt-1">Active items</p>
            </div>
        </a>
    </div>

    <!-- Secondary Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
        <!-- Proposals Card -->
        <a
            href={`/${holonID}/proposals`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-yellow-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-lightbulb text-xl text-yellow-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-yellow-400 transition-colors">Proposals</h3>
                        <p class="text-2xl font-bold text-white">{proposalCount}</p>
                    </div>
                </div>
            </div>
        </a>

        <!-- Offers Card -->
        <a
            href={`/${holonID}/offers`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-indigo-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-gift text-xl text-indigo-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-indigo-400 transition-colors">Offers & Requests</h3>
                        <p class="text-2xl font-bold text-white">{offerCount}</p>
                    </div>
                </div>
            </div>
        </a>

        <!-- Checklists Card -->
        <a
            href={`/${holonID}/checklists`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-teal-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-teal-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-clipboard-check text-xl text-teal-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-teal-400 transition-colors">Checklists</h3>
                        <p class="text-2xl font-bold text-white">{completedChecklistCount}<span class="text-lg text-gray-400">/{checklistCount}</span></p>
                        <div class="mt-1">
                            <div class="w-full bg-gray-700 rounded-full h-1.5">
                                <div class="bg-teal-500 h-1.5 rounded-full transition-all duration-500" style="width: {(completedChecklistCount / (checklistCount || 1)) * 100}%"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </a>

        <!-- Roles Card -->
        <a
            href={`/${holonID}/roles`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-cyan-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-cyan-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-user-tag text-xl text-cyan-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-cyan-400 transition-colors">Roles</h3>
                        <p class="text-2xl font-bold text-white">{roleCount}</p>
                        <p class="text-sm text-gray-400">{unassignedRoleCount} Unassigned</p>
                    </div>
                </div>
            </div>
        </a>



        <!-- Federation Card -->
        <a
            href={`/${holonID}/federation`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-orange-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-orange-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-network-wired text-xl text-orange-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-orange-400 transition-colors">Federation</h3>
                        <p class="text-sm text-gray-400">Configure data sharing</p>
                    </div>
                </div>
            </div>
        </a>

        <!-- Settings Card -->
        <a
            href={`/${holonID}/settings`}
            class="group bg-gray-800 hover:bg-gray-750 transition-all duration-300 p-6 rounded-2xl shadow-xl hover:shadow-2xl transform hover:scale-105 relative overflow-hidden"
        >
            <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative z-10">
                <div class="flex items-center space-x-4">
                    <div class="p-3 bg-emerald-500 bg-opacity-20 rounded-xl">
                        <i class="fas fa-cog text-xl text-emerald-400"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="text-lg font-semibold text-white group-hover:text-emerald-400 transition-colors">Settings</h3>
                        <p class="text-sm text-gray-400">Configure holon</p>
                    </div>
                </div>
            </div>
        </a>
    </div>

    <!-- Announcements Section -->
    <div class="bg-gray-800 rounded-3xl shadow-xl">
        <Announcements />
    </div>
</div>
{/if}
