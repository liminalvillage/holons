<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import { ID } from "../dashboard/store";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolvedInitials } from '$lib/stores/nameResolver';
    import DisplayName from './shared/DisplayName.svelte';
    import { queryManager } from '$lib/holosphere/QueryManager';

    // Initialize holosphere
    const holosphere = getContext("holosphere") as HoloSphere;
    
    // Holon data state
    $: holonID = $ID;
    
    // Data structures
    interface Badge {
        id: string;
        title: string;
        description: string;
        icon: string;
        rarity: string;
        created: string;
        created_by: string;
        awarded_to: Array<{
            id: string;
            username: string;
            first_name: string;
            last_name: string;
            awarded_at: string;
            awarded_via: string;
        }>;
    }

    interface User {
        id: string;
        username: string;
        first_name: string;
        last_name?: string;
        joined_at?: string;
        last_active?: string;
    }

    interface UserWithBadges {
        user: User;
        badges: Array<{
            badge: Badge;
            awarded_at: string;
            awarded_via: string;
        }>;
    }
    
    // State
    let users: Record<string, User> = {};
    let badges: Record<string, Badge> = {};
    let badgesArray: Badge[] = [];
    let usersWithBadges: UserWithBadges[] = [];
    let isLoading = false;
    let selectedBadge: Badge | null = null;
    let showBadgeModal = false;
    
    // View toggle state
    let currentView: 'badges' | 'users' = 'users';

    let usersUnsubscribe: (() => void) | undefined;
    let badgesUnsubscribe: (() => void) | undefined;
    let subscribedHolonId: string | null = null;

    // Local-first + progressive load via queryManager.subscribe: cached
    // snapshots paint immediately, then items stream in as Gun delivers
    // them (local graph first, federated peers after). No await on
    // getAll on the render path.
    function loadData() {
        if (!holosphere || !holonID) return;
        if (subscribedHolonId === holonID) return; // already subscribed

        usersUnsubscribe?.();
        badgesUnsubscribe?.();
        subscribedHolonId = holonID;

        queryManager.init(holosphere);
        isLoading = true;

        const targetHolon = holonID;

        usersUnsubscribe = queryManager.subscribe({
            holonId: targetHolon,
            lens: 'users',
            onUpdate: (items) => {
                if (subscribedHolonId !== targetHolon) return;
                const next: Record<string, User> = {};
                for (const u of items as User[]) {
                    if (u && u.id) next[u.id] = u;
                }
                users = next;
                isLoading = false;
                processUsersWithBadges();
            },
            onError: (error) => console.error('Badges: users subscription error:', error)
        });

        badgesUnsubscribe = queryManager.subscribe({
            holonId: targetHolon,
            lens: 'badges',
            onUpdate: (items) => {
                if (subscribedHolonId !== targetHolon) return;
                const valid = (items as Badge[]).filter((b) => b && b.title);
                badges = valid.reduce<Record<string, Badge>>((acc, badge) => {
                    acc[badge.id || badge.title] = badge;
                    return acc;
                }, {});
                badgesArray = [...valid].sort((a, b) => {
                    const dateA = new Date(a.created || 0).getTime();
                    const dateB = new Date(b.created || 0).getTime();
                    return dateB - dateA;
                });
                isLoading = false;
                processUsersWithBadges();
            },
            onError: (error) => console.error('Badges: badges subscription error:', error)
        });
    }

    // Process users and their badges
    function processUsersWithBadges() {
        const userBadgeMap: Record<string, UserWithBadges> = {};

        // Initialize all users
        Object.values(users).forEach(user => {
            userBadgeMap[user.id] = {
                user,
                badges: []
            };
        });

        // Add badges to users
        Object.values(badges).forEach(badge => {
            if (badge.awarded_to && Array.isArray(badge.awarded_to)) {
                badge.awarded_to.forEach(recipient => {
                    if (userBadgeMap[recipient.id]) {
                        userBadgeMap[recipient.id].badges.push({
                            badge,
                            awarded_at: recipient.awarded_at,
                            awarded_via: recipient.awarded_via
                        });
                    } else {
                        // User not in users collection but has badges - create minimal user record
                        userBadgeMap[recipient.id] = {
                            user: {
                                id: recipient.id,
                                username: recipient.username,
                                first_name: recipient.first_name,
                                last_name: recipient.last_name
                            },
                            badges: [{
                                badge,
                                awarded_at: recipient.awarded_at,
                                awarded_via: recipient.awarded_via
                            }]
                        };
                    }
                });
            }
        });

        // Convert to array and sort
        usersWithBadges = Object.values(userBadgeMap)
            .filter(userWithBadges => userWithBadges.user)
            .sort((a, b) => {
                // Sort by badge count (descending), then by name
                const badgeCountDiff = b.badges.length - a.badges.length;
                if (badgeCountDiff !== 0) return badgeCountDiff;
                
                const nameA = a.user.first_name || a.user.username || '';
                const nameB = b.user.first_name || b.user.username || '';
                return nameA.localeCompare(nameB);
            });
    }

    // Get rarity color
    function getRarityColor(rarity: string) {
        switch (rarity?.toLowerCase()) {
            case 'legendary':
                return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
            case 'epic':
                return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
            case 'rare':
                return 'bg-green-500/20 text-green-300 border-green-500/30';
            case 'uncommon':
                return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
            case 'common':
            default:
                return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
        }
    }

    // Get rarity icon
    function getRarityIcon(rarity: string) {
        switch (rarity?.toLowerCase()) {
            case 'legendary':
                return '⭐';
            case 'epic':
                return '💎';
            case 'rare':
                return '🔮';
            case 'uncommon':
                return '✨';
            case 'common':
            default:
                return '🔰';
        }
    }

    // Format date
    function formatDate(dateString: string) {
        if (!dateString) return 'Unknown';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: currentView === 'users' ? 'short' : 'long',
                day: 'numeric',
                hour: currentView === 'badges' ? '2-digit' : undefined,
                minute: currentView === 'badges' ? '2-digit' : undefined
            });
        } catch {
            return 'Invalid date';
        }
    }

    // Show badge details modal
    function showBadgeDetails(badge: Badge) {
        selectedBadge = badge;
        showBadgeModal = true;
    }

    // Close badge modal
    function closeBadgeModal() {
        showBadgeModal = false;
        selectedBadge = null;
    }

    // Switch view function
    function switchView(view: 'badges' | 'users') {
        currentView = view;
    }


    // Watch for holon ID changes
    $: if (holonID) {
        loadData();
    }

    onMount(() => {
        if (holonID) {
            loadData();
        }
        return () => {
            usersUnsubscribe?.();
            badgesUnsubscribe?.();
        };
    });
</script>

<div class="min-h-screen bg-gray-900 p-6">
    <!-- View Toggle Controls -->
    <div class="flex justify-center mb-8">
        <div class="flex gap-2 bg-white/10 backdrop-blur-sm rounded-xl p-2 border border-white/20">
            <button
                class="px-6 py-3 rounded-lg font-medium transition-colors {currentView === 'users' 
                    ? 'bg-indigo-600 text-white shadow-lg' 
                    : 'text-white/70 hover:text-white hover:bg-white/10'}"
                on:click={() => switchView('users')}
            >
                👥 By Users
            </button>
            <button
                class="px-6 py-3 rounded-lg font-medium transition-colors {currentView === 'badges' 
                    ? 'bg-indigo-600 text-white shadow-lg' 
                    : 'text-white/70 hover:text-white hover:bg-white/10'}"
                on:click={() => switchView('badges')}
            >
                🏆 By Badges
            </button>
        </div>
    </div>

    <!-- Header -->
    <div class="text-center mb-8">
        <h1 id="badges-title" class="text-4xl font-bold text-white mb-2">
            {currentView === 'users' ? '👥 User Badges' : '🏆 Community Badges'}
        </h1>
        <p class="text-white/60 text-lg">
            {currentView === 'users' 
                ? 'See what badges each community member has earned' 
                : 'Celebrate achievements and contributions'}
        </p>
    </div>

    <!-- Content Grid -->
    <div class="max-w-7xl mx-auto">
        {#if isLoading}
            <div class="flex items-center justify-center h-64">
                <div class="text-center">
                    <div class="animate-spin rounded-full h-16 w-16 border-b-2 border-white/50 mx-auto mb-4"></div>
                    <p class="text-white/60 text-lg">Loading {currentView === 'users' ? 'users and badges' : 'badges'}...</p>
                </div>
            </div>
        {:else if currentView === 'users'}
            <!-- Users View -->
            {#if usersWithBadges.length === 0}
                <div class="text-center py-12">
                    <div class="text-8xl mb-6">👥</div>
                    <h3 class="text-2xl font-semibold text-white mb-3">No Users Found</h3>
                    <p class="text-white/60 text-lg max-w-md mx-auto">
                        Users will appear here once they join the community and start earning badges.
                    </p>
                </div>
            {:else}
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {#each usersWithBadges as userWithBadges}
                        <div class="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:border-white/30 transition-all duration-200">
                            <!-- User Header -->
                            <div class="flex items-center space-x-4 mb-6">
                                <div class="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                                    {resolvedInitials(userWithBadges.user.id, $nameMap, userWithBadges.user)}
                                </div>
                                <div class="flex-1">
                                    <h3 class="text-xl font-semibold text-white">
                                        <DisplayName id={userWithBadges.user.id} user={userWithBadges.user} />
                                    </h3>
                                    {#if userWithBadges.user.username}
                                        <p class="text-white/60 text-sm">@{userWithBadges.user.username}</p>
                                    {/if}
                                    <div class="flex items-center space-x-2 mt-2">
                                        <div class="text-sm text-indigo-300 font-medium">
                                            {userWithBadges.badges.length} {userWithBadges.badges.length === 1 ? 'badge' : 'badges'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- User Badges -->
                            {#if userWithBadges.badges.length > 0}
                                <div class="space-y-3">
                                    <h4 class="text-sm font-medium text-white/80 mb-3">Earned Badges:</h4>
                                    <div class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                                        {#each userWithBadges.badges as userBadge}
                                            <button
                                                class="w-full bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-white/10 hover:border-white/20 transition-all duration-200 text-left group"
                                                on:click={() => showBadgeDetails(userBadge.badge)}
                                            >
                                                <div class="flex items-center space-x-3">
                                                    <div class="text-2xl group-hover:scale-110 transition-transform">
                                                        {userBadge.badge.icon || '🏆'}
                                                    </div>
                                                    <div class="flex-1 min-w-0">
                                                        <div class="font-medium text-white group-hover:text-indigo-300 transition-colors truncate">
                                                            {userBadge.badge.title}
                                                        </div>
                                                        <div class="flex items-center space-x-2 mt-1">
                                                            <span class="text-xs {getRarityColor(userBadge.badge.rarity)} px-2 py-0.5 rounded-full border">
                                                                {getRarityIcon(userBadge.badge.rarity)} {userBadge.badge.rarity || 'common'}
                                                            </span>
                                                            <span class="text-xs text-white/50">
                                                                {formatDate(userBadge.awarded_at)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            {:else}
                                <div class="text-center py-6">
                                    <div class="text-3xl mb-2">🎯</div>
                                    <p class="text-white/60 text-sm">No badges earned yet</p>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        {:else}
            <!-- Badges View -->
            {#if badgesArray.length === 0}
                <div class="text-center py-12">
                    <div class="text-8xl mb-6">🏆</div>
                    <h3 class="text-2xl font-semibold text-white mb-3">No Badges Yet</h3>
                    <p class="text-white/60 text-lg max-w-md mx-auto">
                        Badges will appear here as community members earn them through their contributions and achievements.
                    </p>
                </div>
            {:else}
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {#each badgesArray as badge}
                        <div 
                            class="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 hover:border-white/30 transition-all duration-200 hover:bg-white/15 cursor-pointer group"
                            on:click={() => showBadgeDetails(badge)}
                            on:keydown={(e) => e.key === 'Enter' && showBadgeDetails(badge)}
                            tabindex="0"
                            role="button"
                            aria-label="View {badge.title} badge details"
                        >
                            <!-- Badge Header -->
                            <div class="text-center mb-4">
                                <div class="text-6xl mb-3 group-hover:scale-110 transition-transform duration-200">
                                    {badge.icon || '🏆'}
                                </div>
                                <h3 class="text-xl font-semibold text-white mb-2 group-hover:text-indigo-300 transition-colors">
                                    {badge.title}
                                </h3>
                                <div class="flex items-center justify-center space-x-2 mb-3">
                                    <span class="text-sm {getRarityColor(badge.rarity)} px-3 py-1 rounded-full border">
                                        {getRarityIcon(badge.rarity)} {badge.rarity || 'common'}
                                    </span>
                                </div>
                            </div>

                            <!-- Badge Description -->
                            <p class="text-white/70 text-sm text-center mb-4 line-clamp-3">
                                {badge.description || 'No description available'}
                            </p>

                            <!-- Badge Recipients -->
                            <div class="space-y-3">
                                <div class="text-center">
                                    <div class="text-lg font-bold text-indigo-300 mb-2">
                                        {badge.awarded_to?.length || 0} {badge.awarded_to?.length === 1 ? 'recipient' : 'recipients'}
                                    </div>
                                </div>
                                
                                {#if badge.awarded_to && badge.awarded_to.length > 0}
                                    <div class="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
                                        {#each badge.awarded_to.slice(0, 4) as recipient}
                                            <div class="flex items-center space-x-2 bg-white/5 rounded-lg p-2">
                                                <div class="w-6 h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                                                    {resolvedInitials(recipient.id, $nameMap, recipient)}
                                                </div>
                                                <div class="flex-1 min-w-0">
                                                    <div class="text-xs text-white font-medium truncate">
                                                        <DisplayName id={recipient.id} user={recipient} />
                                                    </div>
                                                    <div class="text-xs text-white/50">
                                                        {formatDate(recipient.awarded_at)}
                                                    </div>
                                                </div>
                                            </div>
                                        {/each}
                                        {#if badge.awarded_to.length > 4}
                                            <div class="text-center">
                                                <div class="text-xs text-white/60">
                                                    +{badge.awarded_to.length - 4} more
                                                </div>
                                            </div>
                                        {/if}
                                    </div>
                                {:else}
                                    <div class="text-center py-2">
                                        <div class="text-2xl mb-1">🎯</div>
                                        <p class="text-white/60 text-xs">No recipients yet</p>
                                    </div>
                                {/if}
                            </div>

                            <!-- Hover Effect -->
                            <div class="absolute inset-0 rounded-2xl border-2 border-transparent group-hover:border-indigo-400/30 transition-all duration-200 pointer-events-none"></div>
                        </div>
                    {/each}
                </div>
            {/if}
        {/if}
    </div>

    <!-- Footer -->
    <div class="text-center mt-8">
        <p class="text-white/40 text-sm">
            Click on any badge to see detailed information and all recipients
        </p>
    </div>
</div>

<!-- Badge Details Modal -->
{#if showBadgeModal && selectedBadge}
    <div 
        class="fixed inset-0 z-60 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        on:click|self={closeBadgeModal}
        on:keydown={(e) => e.key === 'Escape' && closeBadgeModal()}
        role="button"
        tabindex="0"
        transition:fade={{ duration: 200 }}
    >
        <div 
            class="w-full max-w-2xl bg-gray-800/95 backdrop-blur-lg rounded-2xl border border-white/20 shadow-2xl overflow-hidden"
            transition:slide={{ duration: 300, axis: 'y' }}
        >
            <!-- Modal Header -->
            <div class="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-center">
                <div class="text-6xl mb-4">{selectedBadge.icon || '🏆'}</div>
                <h2 class="text-2xl font-bold text-white mb-2">{selectedBadge.title}</h2>
                <div class="flex items-center justify-center space-x-2">
                    <span class="text-sm {getRarityColor(selectedBadge.rarity)} px-3 py-1 rounded-full border">
                        {getRarityIcon(selectedBadge.rarity)} {selectedBadge.rarity || 'common'}
                    </span>
                </div>
            </div>

            <!-- Modal Content -->
            <div class="p-6">
                <p class="text-white/80 text-center mb-6">
                    {selectedBadge.description || 'No description available'}
                </p>

                <!-- Recipients Section -->
                <div class="mb-6">
                    <h3 class="text-lg font-semibold text-white mb-4 text-center">
                        Awarded to {selectedBadge.awarded_to?.length || 0} {selectedBadge.awarded_to?.length === 1 ? 'person' : 'people'}
                    </h3>
                    
                    {#if selectedBadge.awarded_to && selectedBadge.awarded_to.length > 0}
                        <div class="space-y-3 max-h-64 overflow-y-auto custom-scrollbar">
                            {#each selectedBadge.awarded_to as recipient}
                                <div class="bg-white/10 rounded-lg p-4 border border-white/20">
                                    <div class="flex items-center justify-between">
                                        <div class="flex items-center space-x-3">
                                            <div class="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                                                {resolvedInitials(recipient.id, $nameMap, recipient)}
                                            </div>
                                            <div>
                                                <div class="font-medium text-white">
                                                    <DisplayName id={recipient.id} user={recipient} />
                                                </div>
                                                <div class="text-sm text-white/60">
                                                    @{recipient.username}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-right">
                                            <div class="text-sm text-indigo-300 font-medium">
                                                {formatDate(recipient.awarded_at)}
                                            </div>
                                            <div class="text-xs text-white/50">
                                                via {recipient.awarded_via || 'unknown'}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <div class="text-center py-8">
                            <div class="text-4xl mb-3">🎯</div>
                            <p class="text-white/60">No one has earned this badge yet. Be the first!</p>
                        </div>
                    {/if}
                </div>

                <!-- Badge Info -->
                <div class="bg-white/5 rounded-lg p-4 border border-white/10">
                    <div class="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span class="text-white/60">Created:</span>
                            <div class="text-white font-medium">{formatDate(selectedBadge.created)}</div>
                        </div>
                        <div>
                            <span class="text-white/60">Created by:</span>
                            <div class="text-white font-medium">{selectedBadge.created_by || 'Unknown'}</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer -->
            <div class="bg-gray-700/50 p-4 flex justify-end">
                <button 
                    class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                    on:click={closeBadgeModal}
                >
                    Close
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Custom scrollbar styles */
    .custom-scrollbar::-webkit-scrollbar {
        width: 6px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.1);
        border-radius: 3px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.3);
        border-radius: 3px;
    }
    
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.5);
    }

    /* Line clamp utility */
    .line-clamp-3 {
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        line-clamp: 3;
        overflow: hidden;
    }
</style>
