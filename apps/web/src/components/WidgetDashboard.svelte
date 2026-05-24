<script lang="ts">
    import { onMount, onDestroy, getContext } from "svelte";
import { fade, slide } from "svelte/transition";
import { ID } from "../dashboard/store";
import type { HoloSphere } from "holosphere";
import MyHolonsIcon from "../dashboard/sidebar/icons/MyHolonsIcon.svelte";
import { goto } from "$app/navigation";
import { nameMap, resolvedName, resolveName } from '$lib/stores/nameResolver';
import RoleModal from "./RoleModal.svelte";
import TaskModal from "./TaskModal.svelte";
import ItemModal from "./ItemModal.svelte";

    // Props
    export let isVisible = false;

    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    
    // Current time state
    let currentTime = new Date();
    let timeInterval: ReturnType<typeof setInterval>;
    
    // Track current date to detect midnight transitions
    let currentDate = new Date().toDateString();
    
    // Holon data state
    $: holonID = $ID;
    
    // Holon name state (reactive via nameResolver)
    $: holonName = resolvedName(holonID, $nameMap, null, '');
    let isLoadingHolonName = false;
    
    // Roles and users data state
    let roles: Array<{
        id: string;
        title: string;
        description?: string;
        participants: Array<{
            id: string;
            username: string;
            first_name?: string;
            last_name?: string;
        }>;
        created?: string;
        status?: string;
    }> = [];
    let users: Record<string, any> = {};
    let isLoadingRoles = false;
    let isLoadingUsers = false;

    // Events data state
    let upcomingEvents: Array<{
        id: string;
        title: string;
        time: string;
        date: string;
        sortTime: number;
        type: string;
        icon: string;
        description?: string;
        participants?: Array<{id: string}>;
        priority?: string;
        status?: string;
    }> = [];
    let isLoadingEvents = false;

    // Tasks data state
    let topTasks: Array<{
        id: string;
        title: string;
        priority?: string;
        dueDate?: string;
        status: string;
        participants?: Array<{id: string}>;
    }> = [];
    let isLoadingTasks = false;

    // Badges data state
    let badges: Array<{
        id: string;
        title: string;
        description?: string;
        recipients?: Array<{id: string}>;
    }> = [];
    let isLoadingBadges = false;



    // Subscription cleanup functions
    let rolesUnsubscribe: (() => void) | null = null;
    let usersUnsubscribe: (() => void) | null = null;
    let eventsUnsubscribe: (() => void) | null = null;
    let tasksUnsubscribe: (() => void) | null = null;
    let badgesUnsubscribe: (() => void) | null = null;
    let holonNameUnsubscribe: (() => void) | null = null;

    // Debounce timers for batch updates
    let rolesUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let usersUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let eventsUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let tasksUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
    let badgesUpdateTimeout: ReturnType<typeof setTimeout> | null = null;

    // Modal states
    let showRoleModal = false;
    let showTaskModal = false;
    let showEventModal = false;
    let showBadgeModal = false;
    let selectedItem: any = null;



    // Time formatting
    function formatTime(date: Date) {
        return date.toLocaleTimeString('en-US', {
            hour12: true,
            hour: 'numeric',
            minute: '2-digit'
        });
    }

    function formatDate(date: Date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function formatDay(date: Date) {
        return date.toLocaleDateString('en-US', {
            weekday: 'long'
        });
    }

    function formatDateShort(date: Date) {
        return date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }

    // Cleanup existing subscriptions
    function cleanupSubscriptions() {
        if (rolesUnsubscribe) {
            rolesUnsubscribe();
            rolesUnsubscribe = null;
        }
        if (usersUnsubscribe) {
            usersUnsubscribe();
            usersUnsubscribe = null;
        }
        if (eventsUnsubscribe) {
            eventsUnsubscribe();
            eventsUnsubscribe = null;
        }
        if (tasksUnsubscribe) {
            tasksUnsubscribe();
            tasksUnsubscribe = null;
        }
        if (badgesUnsubscribe) {
            badgesUnsubscribe();
            badgesUnsubscribe = null;
        }
        if (holonNameUnsubscribe) {
            holonNameUnsubscribe();
            holonNameUnsubscribe = null;
        }
        
        // Clear timeouts
        [rolesUpdateTimeout, usersUpdateTimeout, eventsUpdateTimeout, 
         tasksUpdateTimeout, badgesUpdateTimeout].forEach(timeout => {
            if (timeout) clearTimeout(timeout);
        });
    }

    // Debounced update functions
    function debounceRolesUpdate(updateFn: () => void) {
        if (rolesUpdateTimeout) clearTimeout(rolesUpdateTimeout);
        rolesUpdateTimeout = setTimeout(updateFn, 50);
    }

    function debounceUsersUpdate(updateFn: () => void) {
        if (usersUpdateTimeout) clearTimeout(usersUpdateTimeout);
        usersUpdateTimeout = setTimeout(updateFn, 50);
    }

    function debounceEventsUpdate(updateFn: () => void) {
        if (eventsUpdateTimeout) clearTimeout(eventsUpdateTimeout);
        eventsUpdateTimeout = setTimeout(updateFn, 50);
    }

    function debounceTasksUpdate(updateFn: () => void) {
        if (tasksUpdateTimeout) clearTimeout(tasksUpdateTimeout);
        tasksUpdateTimeout = setTimeout(updateFn, 50);
    }

    function debounceBadgesUpdate(updateFn: () => void) {
        if (badgesUpdateTimeout) clearTimeout(badgesUpdateTimeout);
        badgesUpdateTimeout = setTimeout(updateFn, 50);
    }

    // Subscribe to roles data with real-time updates
    async function subscribeToRoles() {
        if (!holosphere || !holonID) return;
        
        // Cleanup existing subscription
        if (rolesUnsubscribe) {
            rolesUnsubscribe();
            rolesUnsubscribe = null;
        }
        
        isLoadingRoles = true;
        try {
            // Load initial data — holosphere.getAll resolves to Array<T>.
            const rolesData = await holosphere.getAll(holonID, "roles");
            const rolesStore: Record<string, any> = {};
            (rolesData ?? []).forEach((role: any, index: number) => {
                const key = role.id || role.title || index.toString();
                rolesStore[key] = role;
            });
            
            // Process and normalize roles from store
            const updateRolesFromStore = () => {
                roles = Object.entries(rolesStore).map(([storeKey, role]: [string, any]) => ({
                    id: role.id || storeKey,
                    title: role.title || 'Untitled Role',
                    description: role.description,
                    participants: role.participants || [],
                    created: role.created,
                    status: role.status || 'active'
                }));
            };
            
            updateRolesFromStore();
            
            // Set up real-time subscription
            const subscription = await holosphere.subscribe(holonID, "roles", (newRole: any, key?: string) => {
                debounceRolesUpdate(() => {
                    if (newRole && key) {
                        rolesStore[key] = newRole;
                    } else if (key) {
                        delete rolesStore[key];
                    }
                    updateRolesFromStore();
                });
            });
            
            if (typeof subscription === 'function') {
                rolesUnsubscribe = subscription;
            } else if (subscription && typeof subscription.unsubscribe === 'function') {
                rolesUnsubscribe = subscription.unsubscribe;
            }
            
        } catch (error) {
            console.error("OverlayDashboard: Error subscribing to roles:", error);
        } finally {
            isLoadingRoles = false;
        }
    }

    // Subscribe to users data with real-time updates
    async function subscribeToUsers() {
        if (!holosphere || !holonID) return;
        
        // Cleanup existing subscription
        if (usersUnsubscribe) {
            usersUnsubscribe();
            usersUnsubscribe = null;
        }
        
        isLoadingUsers = true;
        try {
            // Load initial data — holosphere.getAll resolves to Array<T>.
            const usersData = await holosphere.getAll(holonID, "users");
            const usersStore: Record<string, any> = {};
            for (const user of usersData ?? []) {
                if (user?.id) usersStore[user.id] = user;
            }
            users = usersStore;
            
            // Set up real-time subscription
            const subscription = await holosphere.subscribe(holonID, "users", (newUser: any, key?: string) => {
                debounceUsersUpdate(() => {
                    if (newUser && key) {
                        // Use user.id as canonical key if available
                        const canonicalKey = newUser.id || key;
                        if (newUser.id && key !== newUser.id) {
                            // Remove old key if different
                            delete usersStore[key];
                        }
                        usersStore[canonicalKey] = newUser;
                    } else if (key) {
                        delete usersStore[key];
                    }
                    users = { ...usersStore };
                });
            });
            
            if (typeof subscription === 'function') {
                usersUnsubscribe = subscription;
            } else if (subscription && typeof subscription.unsubscribe === 'function') {
                usersUnsubscribe = subscription.unsubscribe;
            }
            
        } catch (error) {
            console.error("OverlayDashboard: Error subscribing to users:", error);
        } finally {
            isLoadingUsers = false;
        }
    }

    // Shared quest store for both events and tasks
    let questsStore: Record<string, any> = {};

    // Subscribe to quests data with real-time updates (handles both events and tasks)
    async function subscribeToQuests() {
        if (!holosphere || !holonID) return;
        
        // Cleanup existing subscription
        if (eventsUnsubscribe) {
            eventsUnsubscribe();
            eventsUnsubscribe = null;
        }
        
        isLoadingEvents = true;
        isLoadingTasks = true;
        try {
            // Load initial data — holosphere.getAll resolves to Array<T>.
            const questsData = await holosphere.getAll(holonID, "quests");
            questsStore = {};
            (questsData ?? []).forEach((quest: any, index: number) => {
                const key = quest.id || index.toString();
                questsStore[key] = quest;
            });
            
            // Process events to filter for upcoming scheduled items (from today onwards)
            const updateEventsFromStore = () => {
                const quests = Object.entries(questsStore);
                const today = new Date();
                const todayStr = today.toISOString().split('T')[0];

                upcomingEvents = quests.filter(([storeKey, quest]: [string, any]) => {
                    // Include any item that has a 'when' field (is scheduled), regardless of type
                    if (!quest.when || quest.status === 'completed' || quest.status === 'cancelled') return false;
                    const whenDate = new Date(quest.when);
                    const eventDateStr = whenDate.toISOString().split('T')[0];
                    // Include events from today onwards (not just today)
                    return eventDateStr >= todayStr;
                }).map(([storeKey, quest]: [string, any]) => {
                    const whenDate = new Date(quest.when);
                    return {
                        id: quest.id || storeKey,
                        title: quest.title || quest.name || 'Untitled Event',
                        time: whenDate.toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                        }),
                        date: whenDate.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric'
                        }),
                        sortTime: whenDate.getTime(),
                        type: quest.type || 'event',
                        icon: quest.type === 'task' ? '✓' : quest.type === 'quest' ? '⚔️' : quest.type === 'recurring' ? '🔄' : '📅',
                        participants: quest.participants || [],
                        priority: quest.priority,
                        status: quest.status
                    };
                }).sort((a, b) => a.sortTime - b.sortTime);
            };

            // Process tasks to filter active ones
            const updateTasksFromStore = () => {
                const quests = Object.entries(questsStore);

                topTasks = quests.filter(([storeKey, quest]: [string, any]) =>
                    quest.status !== 'completed' && quest.status !== 'cancelled'
                ).map(([storeKey, quest]: [string, any]) => ({
                    id: quest.id || storeKey,
                    title: quest.title || quest.name || 'Untitled Task',
                    priority: quest.priority,
                    dueDate: quest.dueDate,
                    status: quest.status || 'pending',
                    participants: quest.participants || []
                }));
            };
            
            // Combined update function for both events and tasks
            const updateFromStore = () => {
                updateEventsFromStore();
                updateTasksFromStore();
            };
            
            updateFromStore();
            
            // Set up real-time subscription
            const subscription = await holosphere.subscribe(holonID, "quests", (newQuest: any, key?: string) => {
                // Debounce both events and tasks updates together
                if (eventsUpdateTimeout) clearTimeout(eventsUpdateTimeout);
                if (tasksUpdateTimeout) clearTimeout(tasksUpdateTimeout);
                
                eventsUpdateTimeout = setTimeout(() => {
                    if (newQuest && key) {
                        questsStore[key] = newQuest;
                    } else if (key) {
                        delete questsStore[key];
                    }
                    updateFromStore();
                }, 50);
            });
            
            if (typeof subscription === 'function') {
                eventsUnsubscribe = subscription;
            } else if (subscription && typeof subscription.unsubscribe === 'function') {
                eventsUnsubscribe = subscription.unsubscribe;
            }
            
        } catch (error) {
            console.error("OverlayDashboard: Error subscribing to quests:", error);
        } finally {
            isLoadingEvents = false;
            isLoadingTasks = false;
        }
    }

    // Subscribe to holon name with real-time updates
    async function subscribeToHolonName() {
        if (!holonID) return;

        // Cleanup existing subscription
        if (holonNameUnsubscribe) {
            holonNameUnsubscribe();
            holonNameUnsubscribe = null;
        }

        isLoadingHolonName = true;
        resolveName(holonID);
        isLoadingHolonName = false;
    }

    // Subscribe to badges data with real-time updates
    async function subscribeToBadges() {
        if (!holosphere || !holonID) return;
        
        // Cleanup existing subscription
        if (badgesUnsubscribe) {
            badgesUnsubscribe();
            badgesUnsubscribe = null;
        }
        
        isLoadingBadges = true;
        try {
            // Load initial data — holosphere.getAll resolves to Array<T>.
            const badgesData = await holosphere.getAll(holonID, "badges");
            const badgesStore: Record<string, any> = {};
            (badgesData ?? []).forEach((badge: any, index: number) => {
                const key = badge.id || index.toString();
                badgesStore[key] = badge;
            });
            
            // Process badges from store
            const updateBadgesFromStore = () => {
                badges = Object.entries(badgesStore).map(([storeKey, badge]: [string, any]) => ({
                    id: badge.id || storeKey,
                    title: badge.title || badge.name || 'Untitled Badge',
                    description: badge.description || badge.details,
                    recipients: badge.recipients || badge.owners || []
                }));
            };
            
            updateBadgesFromStore();
            
            // Set up real-time subscription
            const subscription = await holosphere.subscribe(holonID, "badges", (newBadge: any, key?: string) => {
                debounceBadgesUpdate(() => {
                    if (newBadge && key) {
                        badgesStore[key] = newBadge;
                    } else if (key) {
                        delete badgesStore[key];
                    }
                    updateBadgesFromStore();
                });
            });
            
            if (typeof subscription === 'function') {
                badgesUnsubscribe = subscription;
            } else if (subscription && typeof subscription.unsubscribe === 'function') {
                badgesUnsubscribe = subscription.unsubscribe;
            }
            
        } catch (error) {
            console.error("OverlayDashboard: Error subscribing to badges:", error);
        } finally {
            isLoadingBadges = false;
        }
    }

    // Navigate to roles component
    function navigateToRoles() {
        if (holonID) {
            goto(`/${holonID}/roles`);
            // Close the Zeitcamp Dashboard
            isVisible = false;
        }
    }

    // Handle item clicks to show modals
    function handleRoleClick(role: any, event?: MouseEvent) {
        selectedItem = role;
        showRoleModal = true;
    }

    function handleTaskClick(task: any, event?: MouseEvent) {
        selectedItem = task;
        showTaskModal = true;
    }

    function handleEventClick(eventItem: any, event?: MouseEvent) {
        selectedItem = eventItem;
        showEventModal = true;
    }

    function handleBadgeClick(badge: any, event?: MouseEvent) {
        selectedItem = badge;
        showBadgeModal = true;
    }

    // Close all modals
    function closeAllModals() {
        showRoleModal = false;
        showTaskModal = false;
        showEventModal = false;
        showBadgeModal = false;
        selectedItem = null;
    }

    // Get user display name using nameResolver
    function getUserDisplayName(userId: string): string {
        const user = users[userId];
        return resolvedName(userId, $nameMap, user ? { first_name: user.first_name, last_name: user.last_name, username: user.username } : null);
    }

    // Get role statistics
    $: totalRoles = roles.length;
    $: assignedRoles = roles.filter(role => role.participants && role.participants.length > 0).length;
    $: unassignedRoles = totalRoles - assignedRoles;
    $: totalParticipants = roles.reduce((sum, role) => sum + (role.participants?.length || 0), 0);

    // Compute which sections have content
    $: hasRoles = !isLoadingRoles && roles.length > 0;
    $: hasEvents = !isLoadingEvents && upcomingEvents.length > 0;
    $: hasTasks = !isLoadingTasks && topTasks.length > 0;
    $: hasBadges = !isLoadingBadges && badges.length > 0;

    // Count visible sections to determine grid layout
    $: visibleSectionsCount = [hasRoles, hasEvents, hasTasks, hasBadges].filter(Boolean).length;

    // Compute grid class based on number of visible sections
    $: gridClass = visibleSectionsCount === 1 ? 'grid-cols-1' :
                   visibleSectionsCount === 2 ? 'grid-cols-1 lg:grid-cols-2' :
                   visibleSectionsCount === 3 ? 'grid-cols-1 lg:grid-cols-3' :
                   'grid-cols-1 lg:grid-cols-2'; // default for 4 or 0 sections



    // Watch for holon ID changes and set up real-time subscriptions
    $: if (holonID && isVisible) {
        // Cleanup previous subscriptions for this holon
        cleanupSubscriptions();
        
        // Set up new subscriptions
        subscribeToHolonName();
        subscribeToRoles();
        subscribeToUsers();
        subscribeToQuests(); // Handles both events and tasks
        subscribeToBadges();
    }

    onMount(() => {
        // Update time every second and check for date changes
        timeInterval = setInterval(() => {
            const newTime = new Date();
            const newDate = newTime.toDateString();
            
            // Check if date changed (midnight transition)
            if (newDate !== currentDate) {
                currentDate = newDate;
                // Refresh events for the new day if we have quest data
                if (questsStore && Object.keys(questsStore).length > 0) {
                    const updateEventsFromStore = () => {
                        const quests = Object.entries(questsStore);
                        const today = new Date();
                        const todayStr = today.toISOString().split('T')[0];

                        upcomingEvents = quests.filter(([storeKey, quest]: [string, any]) => {
                            if (!quest.when || quest.status === 'completed' || quest.status === 'cancelled') return false;
                            const whenDate = new Date(quest.when);
                            const eventDateStr = whenDate.toISOString().split('T')[0];
                            // Include events from today onwards (not just today)
                            return eventDateStr >= todayStr;
                        }).map(([storeKey, quest]: [string, any]) => {
                            const whenDate = new Date(quest.when);
                            return {
                                id: quest.id || storeKey,
                                title: quest.title || quest.name || 'Untitled Event',
                                time: whenDate.toLocaleTimeString('en-US', {
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    hour12: true
                                }),
                                date: whenDate.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric'
                                }),
                                sortTime: whenDate.getTime(),
                                type: quest.type || 'event',
                                icon: quest.type === 'task' ? '✓' : quest.type === 'quest' ? '⚔️' : quest.type === 'recurring' ? '🔄' : '📅',
                                participants: quest.participants || [],
                                priority: quest.priority,
                                status: quest.status
                            };
                        }).sort((a, b) => a.sortTime - b.sortTime);
                    };
                    updateEventsFromStore();
                }
            }
            
            currentTime = newTime;
        }, 1000);

        // Set up initial subscriptions if visible and holon is available
        if (isVisible && holonID) {
            subscribeToHolonName();
            subscribeToRoles();
            subscribeToUsers();
            subscribeToQuests(); // Handles both events and tasks
            subscribeToBadges();
        }
    });

    onDestroy(() => {
        // Clean up timers
        if (timeInterval) {
            clearInterval(timeInterval);
        }

        // Clean up all subscriptions
        cleanupSubscriptions();
    });

    // Close overlay on escape key
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            isVisible = false;
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isVisible}
    <div
        class="fixed inset-0 z-50 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-hidden"
        on:click|self={() => isVisible = false}
        on:keydown={handleKeydown}
        transition:fade={{ duration: 200 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-dashboard-title"
        tabindex="0"
    >

        <div
            class="w-full max-w-6xl h-full max-h-[95vh] bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl overflow-hidden relative z-40"
        >
            <!-- Top Header: Date, Logo, Clock, and Close Button -->
            <div class="absolute top-6 left-6 right-6 z-50 flex justify-between items-center">
                <!-- Date Section -->
                <div class="text-left">
                    <div class="text-2xl font-light text-white/70 mb-1">
                        {formatDay(currentTime)}
                    </div>
                    <div class="text-sm text-white/50 font-light">
                        {formatDateShort(currentTime)}
                    </div>
                </div>

                <!-- Holons Logo and Name - Centered (hidden on small screens) -->
                <div class="hidden md:flex items-center space-x-3">
                    <div class="w-12 h-12">
                        <MyHolonsIcon />
                    </div>
                    {#if isLoadingHolonName}
                        <div class="text-white/60 text-sm animate-pulse">Loading...</div>
                    {:else if holonName}
                        <div class="text-white/80 text-lg font-medium truncate max-w-48">
                            {holonName}
                        </div>
                    {:else}
                        <div class="text-white/40 text-sm">Unknown Holon</div>
                    {/if}
                </div>

                <!-- Clock and Close Button -->
                <div class="flex items-center space-x-4">
                    <!-- Clock -->
                    <div class="text-right text-white/70">
                        <div class="text-3xl font-light">
                            {formatTime(currentTime)}
                        </div>
                    </div>
                    
                    <!-- Close Button -->
                    <button
                        class="text-white/60 hover:text-white transition-colors duration-200 p-2 rounded-lg hover:bg-white/10"
                        on:click={() => isVisible = false}
                        aria-label="Close widget dashboard"
                    >
                        <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <!-- Main Dashboard Content -->
            <div class="h-full flex flex-col overflow-hidden">
                <!-- Center Section: Four Main Sections -->
                <div class="flex-1 overflow-hidden px-6 pb-12 pt-24">
                    <!-- Four Main Sections Grid - Dynamic layout based on visible sections -->
                    <div class="w-full h-full max-w-7xl mx-auto grid {gridClass} gap-4">
                        {#if hasRoles}
                        <!-- Ruoli (Roles) Section -->
                        <div class="bg-slate-800/40 backdrop-blur-md rounded-xl p-6 border border-slate-700/50 flex flex-col shadow-lg hover:border-slate-600/70 transition-colors duration-200 h-full relative overflow-hidden">

                            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                                <h3 class="text-xl font-semibold text-white/90 flex items-center">
                                    <svg class="w-6 h-6 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                    </svg>
                                    Roles
                                </h3>
                                <button
                                    class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
                                    on:click={navigateToRoles}
                                >
                                    View All
                                </button>
                            </div>
                            
                            {#if isLoadingRoles}
                                <div class="flex items-center justify-center py-8">
                                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white/50 mr-2"></div>
                                    <span class="text-white/60 text-sm">Loading...</span>
                                </div>
                            {:else if roles.length > 0}
                                <div class="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                                    {#each roles as role (role.id)}
                                        <div
                                            class="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 cursor-pointer transition-colors duration-150"
                                            on:click={(e) => handleRoleClick(role, e)}
                                            on:keydown={(e) => e.key === 'Enter' && handleRoleClick(role)}
                                            role="button"
                                            tabindex="0"
                                            aria-label="View role details for {role.title}"
                                        >
                                            <div class="flex-1 min-w-0">
                                                <h4 class="font-medium text-white text-sm truncate">
                                                    {role.title}
                                                </h4>
                                            </div>
                                            <div class="flex items-center space-x-2 ml-3">
                                                {#if role.participants && role.participants.length > 0}
                                                    <div class="flex -space-x-1">
                                                        {#each role.participants.slice(0, 3) as participant}
                                                            <div class="w-6 h-6 rounded-full bg-slate-600/30 border border-white/20 flex items-center justify-center text-white text-xs font-medium overflow-hidden" title={getUserDisplayName(participant.id)}>
                                                                <img 
                                                                    src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                                                    alt={getUserDisplayName(participant.id)}
                                                                    class="w-full h-full object-cover rounded-full"
                                                                    on:error={(e) => {
                                                                        e.currentTarget.style.display = 'none';
                                                                        e.currentTarget.nextElementSibling.style.display = 'flex';
                                                                    }}
                                                                />
                                                                <div class="w-full h-full bg-slate-600/30 flex items-center justify-center text-white text-xs font-medium rounded-full" style="display: none;">
                                                                    {getUserDisplayName(participant.id).charAt(0).toUpperCase()}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                        {#if role.participants.length > 3}
                                                            <div class="w-6 h-6 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white text-xs font-medium">
                                                                +{role.participants.length - 3}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                    <!-- Show first names below the avatars -->
                                                    <div class="text-xs text-white/70 ml-2">
                                                        {role.participants.slice(0, 2).map(p => users[p.id]?.first_name || getUserDisplayName(p.id).split(' ')[0]).join(', ')}
                                                        {#if role.participants.length > 2}
                                                            <span class="text-white/50"> +{role.participants.length - 2} more</span>
                                                        {/if}
                                                    </div>
                                                {:else}
                                                    <span class="text-white/40 text-xs">Unassigned</span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}

                                </div>
                            {:else}
                                <div class="text-center py-8 flex-1 flex items-center justify-center">
                                    <span class="text-white/50 text-sm">No roles defined</span>
                                </div>
                            {/if}
                        </div>
                        {/if}

                        {#if hasEvents}
                        <!-- Eventi (Events) Section -->
                        <div class="bg-slate-800/40 backdrop-blur-md rounded-xl p-6 border border-slate-700/50 flex flex-col shadow-lg hover:border-slate-600/70 transition-colors duration-200 h-full relative overflow-hidden">

                            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                                <h3 class="text-xl font-semibold text-white/90 flex items-center">
                                    <svg class="w-6 h-6 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    Upcoming Events
                                </h3>
                                <button
                                    class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
                                    on:click={() => {
                                        if (holonID) {
                                            goto(`/${holonID}/calendar`);
                                            isVisible = false;
                                        }
                                    }}
                                >
                                    View All
                                </button>
                            </div>
                            
                            {#if isLoadingEvents}
                                <div class="flex items-center justify-center py-8">
                                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white/50 mr-2"></div>
                                    <span class="text-white/60 text-sm">Loading...</span>
                                </div>
                            {:else if upcomingEvents.length > 0}
                                <div class="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                                    {#each upcomingEvents as event}
                                        <div 
                                            class="flex items-center p-2 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                                            on:click={() => handleEventClick(event)}
                                            on:keydown={(e) => e.key === 'Enter' && handleEventClick(event)}
                                            role="button"
                                            tabindex="0"
                                            aria-label="View event details for {event.title}"
                                        >
                                            <!-- Time -->
                                            <div class="flex-shrink-0 w-16 text-center mr-3">
                                                <div class="text-xs font-medium text-green-400">
                                                    {event.time}
                                                </div>
                                            </div>
                                            
                                            <!-- Event info -->
                                            <div class="flex-1 min-w-0">
                                                <h4 class="font-medium text-white text-sm truncate mb-1">
                                                    {event.title}
                                                </h4>
                                                
                                                <!-- Participants -->
                                                {#if event.participants && event.participants.length > 0}
                                                    <div class="flex items-center">
                                                        <div class="flex -space-x-1 mr-2">
                                                            {#each event.participants.slice(0, 3) as participant}
                                                                <div class="w-4 h-4 rounded-full bg-slate-600/30 border border-white/20 flex items-center justify-center text-white text-xs font-medium overflow-hidden" title={getUserDisplayName(participant.id)}>
                                                                    <img 
                                                                        src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                                                        alt={getUserDisplayName(participant.id)}
                                                                        class="w-full h-full object-cover rounded-full"
                                                                        on:error={(e) => {
                                                                            e.currentTarget.style.display = 'none';
                                                                            e.currentTarget.nextElementSibling.style.display = 'flex';
                                                                        }}
                                                                    />
                                                                    <div class="w-full h-full bg-slate-600/30 flex items-center justify-center text-white text-xs font-medium rounded-full" style="display: none;">
                                                                        {getUserDisplayName(participant.id).charAt(0).toUpperCase()}
                                                                    </div>
                                                                </div>
                                                            {/each}
                                                            {#if event.participants.length > 3}
                                                                <div class="w-4 h-4 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white text-xs font-medium">
                                                                    +{event.participants.length - 3}
                                                                </div>
                                                            {/if}
                                                        </div>
                                                        <div class="text-xs text-white/60">
                                                            {event.participants.slice(0, 2).map(p => users[p.id]?.first_name || getUserDisplayName(p.id).split(' ')[0]).join(', ')}
                                                            {#if event.participants.length > 2}
                                                                <span class="text-white/40"> +{event.participants.length - 2} more</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                {:else}
                                                    <div class="text-xs text-white/40">No participants</div>
                                                {/if}
                                            </div>
                                            
                                            <!-- Priority indicator -->
                                            {#if event.priority && event.priority !== 'normal'}
                                                <div class="ml-2 flex-shrink-0">
                                                    <span class="text-xs px-2 py-0.5 rounded-full {
                                                        event.priority === 'high' ? 'bg-red-500/20 text-red-300' :
                                                        event.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-300' :
                                                        'bg-gray-500/20 text-gray-300'
                                                    }">
                                                        {event.priority}
                                                    </span>
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                    
                                    {#if upcomingEvents.length === 0}
                                        <div class="text-center py-4">
                                            <div class="text-white/40 text-sm">No upcoming scheduled items</div>
                                        </div>
                                    {/if}
                                </div>
                            {:else}
                                <div class="text-center py-8 flex-1 flex items-center justify-center">
                                    <span class="text-white/50 text-sm">No upcoming scheduled items</span>
                                </div>
                            {/if}
                        </div>
                        {/if}

                        {#if hasTasks}
                        <!-- Compiti (Tasks) Section -->
                        <div class="bg-slate-800/40 backdrop-blur-md rounded-xl p-6 border border-slate-700/50 flex flex-col shadow-lg hover:border-slate-600/70 transition-colors duration-200 h-full relative overflow-hidden">

                            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                                <h3 class="text-xl font-semibold text-white/90 flex items-center">
                                    <svg class="w-6 h-6 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                    </svg>
                                    Tasks
                                </h3>
                                <button
                                    class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
                                    on:click={() => {
                                        if (holonID) {
                                            goto(`/${holonID}/tasks`);
                                            isVisible = false;
                                        }
                                    }}
                                >
                                    View All
                                </button>
                            </div>
                            
                            {#if isLoadingTasks}
                                <div class="flex items-center justify-center py-8">
                                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white/50 mr-2"></div>
                                    <span class="text-white/60 text-sm">Loading...</span>
                                </div>
                            {:else if topTasks.length > 0}
                                <div class="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                                    {#each topTasks as task}
                                        <div 
                                            class="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                                            on:click={() => handleTaskClick(task)}
                                            on:keydown={(e) => e.key === 'Enter' && handleTaskClick(task)}
                                            role="button"
                                            tabindex="0"
                                            aria-label="View task details for {task.title}"
                                        >
                                            <div class="flex-1 min-w-0">
                                                <h4 class="font-medium text-white text-sm truncate">
                                                    {task.title}
                                                </h4>
                                                {#if task.dueDate}
                                                    <p class="text-white/60 text-xs">Due: {new Date(task.dueDate).toLocaleDateString()}</p>
                                                {/if}
                                            </div>
                                            <div class="flex items-center space-x-2 ml-3">
                                                {#if task.participants && task.participants.length > 0}
                                                    <div class="flex -space-x-1">
                                                        {#each task.participants.slice(0, 3) as participant}
                                                            <div class="w-6 h-6 rounded-full bg-slate-600/30 border border-white/20 flex items-center justify-center text-white text-xs font-medium overflow-hidden" title={getUserDisplayName(participant.id)}>
                                                                <img 
                                                                    src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                                                    alt={getUserDisplayName(participant.id)}
                                                                    class="w-full h-full object-cover rounded-full"
                                                                    on:error={(e) => {
                                                                        e.currentTarget.style.display = 'none';
                                                                        e.currentTarget.nextElementSibling.style.display = 'flex';
                                                                    }}
                                                                />
                                                                <div class="w-full h-full bg-slate-600/30 flex items-center justify-center text-white text-xs font-medium rounded-full" style="display: none;">
                                                                    {getUserDisplayName(participant.id).charAt(0).toUpperCase()}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                        {#if task.participants.length > 3}
                                                            <div class="w-6 h-6 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white text-xs font-medium">
                                                                +{task.participants.length - 3}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                    <!-- Show first names below the avatars -->
                                                    <div class="text-xs text-white/70 ml-2">
                                                        {task.participants.slice(0, 2).map(p => users[p.id]?.first_name || getUserDisplayName(p.id).split(' ')[0]).join(', ')}
                                                        {#if task.participants.length > 2}
                                                            <span class="text-white/50"> +{task.participants.length - 2} more</span>
                                                        {/if}
                                                    </div>
                                                {:else}
                                                    <span class="text-white/40 text-xs">Unassigned</span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}

                                </div>
                            {:else}
                                <div class="text-center py-8 flex-1 flex items-center justify-center">
                                    <span class="text-white/50 text-sm">No active tasks</span>
                                </div>
                            {/if}
                        </div>
                        {/if}

                        {#if hasBadges}
                        <!-- Medaglie (Badges) Section -->
                        <div class="bg-slate-800/40 backdrop-blur-md rounded-xl p-6 border border-slate-700/50 flex flex-col shadow-lg hover:border-slate-600/70 transition-colors duration-200 h-full relative overflow-hidden">

                            <div class="flex justify-between items-center mb-4 flex-shrink-0">
                                <h3 class="text-xl font-semibold text-white/90 flex items-center">
                                    <svg class="w-6 h-6 mr-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.857 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.857 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.857.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.857-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.857 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.857 3.42 3.42 0 013.138-3.138z" />
                                    </svg>
                                    Badges
                                </h3>
                                <button
                                    class="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors duration-200 text-sm font-medium"
                                    on:click={() => {
                                        if (holonID) {
                                            goto(`/${holonID}/badges`);
                                            isVisible = false;
                                        }
                                    }}
                                >
                                    View All
                                </button>
                            </div>
                            
                            {#if isLoadingBadges}
                                <div class="flex items-center justify-center py-8">
                                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-white/50 mr-2"></div>
                                    <span class="text-white/60 text-sm">Loading...</span>
                                </div>
                            {:else if badges.length > 0}
                                <div class="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                                    {#each badges as badge}
                                        <div 
                                            class="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 cursor-pointer transition-colors"
                                            on:click={() => handleBadgeClick(badge)}
                                            on:keydown={(e) => e.key === 'Enter' && handleBadgeClick(badge)}
                                            role="button"
                                            tabindex="0"
                                            aria-label="View badge details for {badge.title}"
                                        >
                                            <div class="flex-1 min-w-0">
                                                <h4 class="font-medium text-white text-sm truncate">
                                                    {badge.title}
                                                </h4>
                                                {#if badge.description}
                                                    <p class="text-white/60 text-xs truncate">{badge.description}</p>
                                                {/if}
                                            </div>
                                            <div class="flex items-center space-x-2 ml-3">
                                                {#if badge.recipients && badge.recipients.length > 0}
                                                    <div class="flex -space-x-1">
                                                        {#each badge.recipients.slice(0, 3) as recipient}
                                                            <div class="w-6 h-6 rounded-full bg-slate-600/30 border border-white/20 flex items-center justify-center text-white text-xs font-medium overflow-hidden" title={getUserDisplayName(recipient.id)}>
                                                                <img 
                                                                    src={`https://telegram.holons.io/getavatar?user_id=${recipient.id}`}
                                                                    alt={getUserDisplayName(recipient.id)}
                                                                    class="w-full h-full object-cover rounded-full"
                                                                    on:error={(e) => {
                                                                        e.currentTarget.style.display = 'none';
                                                                        e.currentTarget.nextElementSibling.style.display = 'flex';
                                                                    }}
                                                                />
                                                                <div class="w-full h-full bg-slate-600/30 flex items-center justify-center text-white text-xs font-medium rounded-full" style="display: none;">
                                                                    {getUserDisplayName(recipient.id).charAt(0).toUpperCase()}
                                                                </div>
                                                            </div>
                                                        {/each}
                                                        {#if badge.recipients.length > 3}
                                                            <div class="w-6 h-6 rounded-full bg-white/20 border border-white/20 flex items-center justify-center text-white text-xs font-medium">
                                                                +{badge.recipients.length - 3}
                                                            </div>
                                                        {/if}
                                                    </div>
                                                    <!-- Show first names below the avatars -->
                                                    <div class="text-xs text-white/70 ml-2">
                                                        {badge.recipients.slice(0, 2).map(p => users[p.id]?.first_name || getUserDisplayName(p.id).split(' ')[0]).join(', ')}
                                                        {#if badge.recipients.length > 2}
                                                            <span class="text-white/50"> +{badge.recipients.length - 2} more</span>
                                                        {/if}
                                                    </div>
                                                {:else}
                                                    <span class="text-white/40 text-xs">No recipients</span>
                                                {/if}
                                            </div>
                                        </div>
                                    {/each}

                                </div>
                            {:else}
                                <div class="text-center py-8 flex-1 flex items-center justify-center">
                                    <span class="text-white/50 text-sm">No badges available</span>
                                </div>
                            {/if}
                        </div>
                        {/if}
                    </div>
                </div>

                <!-- Bottom Right: ESC hint -->
                <div class="absolute bottom-6 right-6">
                    <p class="text-white/40 text-sm flex items-center">
                        Press <kbd class="mx-2 px-2 py-1 bg-white/10 rounded text-xs border border-white/20">Esc</kbd> to close
                    </p>
                </div>

                
            </div>
        </div>
    </div>

    <!-- Role Modal -->
    {#if showRoleModal && selectedItem && holonID}
        <RoleModal 
            role={selectedItem}
            roleId={selectedItem.id}
            userStore={users}
            holosphere={holosphere}
            holonId={holonID}
            on:close={() => closeAllModals()}
            on:deleted={() => closeAllModals()}
        />
    {/if}

    <!-- Task Modal -->
    {#if showTaskModal && selectedItem && holonID}
        <TaskModal 
            quest={selectedItem}
            questId={selectedItem.id}
            holonId={holonID}
            on:close={() => closeAllModals()}
        />
    {/if}

    <!-- Event Modal (using ItemModal) -->
    {#if showEventModal && selectedItem && holonID}
        <ItemModal 
            quest={selectedItem}
            questId={selectedItem.id}
            holonId={holonID}
            on:close={() => closeAllModals()}
        />
    {/if}

{/if}

<style>
    kbd {
        box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.1);
    }


    
    /* Custom scrollbar styles */
    .custom-scrollbar::-webkit-scrollbar {
        width: 4px;
    }

    .custom-scrollbar::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 2px;
    }

    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.3);
        border-radius: 2px;
    }

    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(148, 163, 184, 0.5);
    }

    /* Firefox scrollbar */
    .custom-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: rgba(148, 163, 184, 0.3) rgba(255, 255, 255, 0.05);
    }











</style>
