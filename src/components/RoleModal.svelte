<script lang="ts">
    // @ts-nocheck

    $: if (role && !role.participants) {
        console.log("[RoleModal.svelte] Initializing role.participants as [] because it was falsy.");
        role.participants = [];
    }

    import { createEventDispatcher, onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { notifyWriteDenied } from '../lib/stores/writeNotifications';

    export let role: any;
    export let roleId: string;
    export let userStore: Record<string, any>;
    export let holosphere: any;
    export let holonId: string;

    let tempTitle = '';
    let tempDescription = '';

    // Initialize temp values when role changes
    $: if (role) {
        tempTitle = role.title || '';
        tempDescription = role.description || '';
    }

    console.log("[RoleModal.svelte] Script run/init. Role ID:", roleId);
    console.log("[RoleModal.svelte] Initial role prop:", JSON.parse(JSON.stringify(role || {})));
    console.log("[RoleModal.svelte] Initial userStore prop:", JSON.parse(JSON.stringify(userStore || {})));

    onMount(() => {
        console.log("[RoleModal.svelte] Mounted. Role ID:", roleId);
        console.log("[RoleModal.svelte] role prop onMount:", JSON.parse(JSON.stringify(role || {})));
        console.log("[RoleModal.svelte] userStore prop onMount:", JSON.parse(JSON.stringify(userStore || {})));
    });

    const dispatch = createEventDispatcher();
    let showAddParticipants = false;

    // Reactive statement to calculate available users
    $: availableUsersToList = (() => {
        if (!userStore || Object.keys(userStore).length === 0) {
            console.log(`[RoleModal.svelte] No userStore or empty userStore`);
            return [];
        }
        
        console.log(`[RoleModal.svelte] userStore keys:`, Object.keys(userStore));
        console.log(`[RoleModal.svelte] role.participants:`, role?.participants);
        
        if (!role?.participants) {
            // If no participants yet, show all users
            const allUsers = Object.entries(userStore);
            console.log(`[RoleModal.svelte] No participants yet, showing all users:`, allUsers.map(([key, user]) => ({ key, id: user.id, name: user.first_name })));
            return allUsers;
        }
        
        // Filter out users who are already participants
        const availableUsers = Object.entries(userStore).filter(([userId, _user]) => !isUserParticipant(userId));
        console.log(`[RoleModal.svelte] Filtered available users:`, availableUsers.map(([key, user]) => ({ key, id: user.id, name: user.first_name })));
        return availableUsers;
    })();

    // Debug logging when dropdown is shown
    $: if (showAddParticipants) {
        console.log("[RoleModal.svelte] Add Participants dropdown opened");
        console.log("[RoleModal.svelte] userStore keys:", Object.keys(userStore || {}));
        console.log("[RoleModal.svelte] role.participants:", role?.participants || []);
        console.log("[RoleModal.svelte] availableUsersToList count:", availableUsersToList.length);
    }

    async function updateRole(updates: any) {
        const updatedRole = { ...role, ...updates };
        try {
            await holosphere.put(holonId, 'roles', updatedRole);
            role = updatedRole;
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error('[RoleModal.svelte] Error updating role:', error);
            }
        }
    }

    async function deleteRole() {
        if (confirm('Are you sure you want to delete this role?')) {
            try {
                await holosphere.delete(holonId, 'roles', roleId);
                dispatch('deleted', { roleId: roleId });
                dispatch('close');
            } catch (error: any) {
                if (error?.name === 'AuthorizationError') {
                    notifyWriteDenied('Unable to delete - no write permission for this holon');
                } else {
                    console.error('[RoleModal.svelte] Error deleting role:', error);
                }
            }
        }
    }

    function closeModal() {
        dispatch('close');
    }

    async function saveTitle() {
        if (tempTitle.trim() !== role.title) {
            await updateRole({ title: tempTitle.trim() });
        }
    }

    async function saveDescription() {
        if (tempDescription.trim() !== (role.description || '')) {
            await updateRole({ description: tempDescription.trim() });
        }
    }

    async function removeParticipant(participantId: string) {
        const participants = (role.participants || []).filter((p: { id: string }) => p.id !== participantId);
        await updateRole({ participants });
    }

    async function addParticipant(userId: string) {
        console.log(`[RoleModal.svelte] addParticipant called with userId: '${userId}'`);
        console.log(`[RoleModal.svelte] userStore keys:`, Object.keys(userStore || {}));
        console.log(`[RoleModal.svelte] Looking for user with key: '${userId}'`);

        const user = userStore[userId];
        console.log(`[RoleModal.svelte] Found user:`, user);

        if (!user) {
            console.error(`[RoleModal.svelte] User not found in userStore with key '${userId}'`);
            return;
        }

        const participants = [...(role.participants || [])];

        if (!participants.some((p: { id: string }) => p.id === userId)) {
            const username = user.first_name + (user.last_name ? ' ' + user.last_name : '');
            const newParticipant = {
                id: userId,
                username,
                isPermanent: true,
                assigned_at: new Date().toISOString()
            };
            console.log(`[RoleModal.svelte] Adding new participant as permanent:`, newParticipant);

            participants.push(newParticipant);
            await updateRole({ participants });

            // Dispatch event to show notification about permanent assignment
            dispatch('permanentAssignment', {
                roleName: role.title,
                userName: username
            });
        } else {
            console.log(`[RoleModal.svelte] User '${userId}' is already a participant`);
        }
        showAddParticipants = false;
    }

    function isUserParticipant(userId: string) {
        const isParticipant = role.participants?.some((p: { id: string }) => p.id === userId);
        console.log(`[RoleModal.svelte] isUserParticipant('${userId}'): ${isParticipant}`);
        if (role.participants) {
            console.log(`[RoleModal.svelte] Current participants:`, role.participants.map(p => ({ id: p.id, username: p.username })));
        }
        return isParticipant;
    }
</script>

<div
    class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    on:click|self={closeModal}
    on:keydown={e => e.key === 'Escape' && closeModal()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
    tabindex="-1"
    transition:fade
>
    <div 
        class="bg-gray-800 rounded-xl max-w-2xl w-full shadow-xl" 
        transition:scale={{duration: 200, start: 0.95}}
    >
        <div class="p-6">
            <div class="flex justify-between items-start mb-6">
                <div class="flex-1 mr-4">
                    <input
                        type="text"
                        bind:value={tempTitle}
                        on:blur={saveTitle}
                        on:keydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        placeholder="Role title..."
                        class="w-full text-2xl font-bold text-white bg-transparent border-b border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none transition-colors pb-1"
                        aria-label="Role title"
                        id="modal-title"
                    />
                </div>
                <button
                    class="text-gray-400 hover:text-white"
                    on:click={closeModal}
                    aria-label="Close modal"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div class="space-y-6 text-gray-300">
                <div>
                    <textarea
                        bind:value={tempDescription}
                        on:blur={saveDescription}
                        placeholder="Add a description for this role..."
                        rows="2"
                        class="w-full text-sm text-gray-300 bg-gray-700/50 rounded-lg p-3 border border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none transition-colors resize-none"
                        aria-label="Role description"
                    ></textarea>
                </div>

                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold">Participants</h3>
                        <button
                            class="btn btn--sm {showAddParticipants ? 'btn--secondary' : 'btn--primary'}"
                            on:click={() => showAddParticipants = !showAddParticipants}
                            disabled={Object.keys(userStore || {}).length === 0 && !showAddParticipants && holosphere}
                        >
                            {#if Object.keys(userStore || {}).length === 0 && !showAddParticipants && holosphere}
                                Loading Users...
                            {:else if showAddParticipants}
                                Cancel
                            {:else}
                                + Add Participant
                            {/if}
                        </button>
                    </div>

                    <!-- Permanent assignment notice -->
                    <div class="flex items-start gap-2 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg text-sm">
                        <svg class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span class="text-amber-200/90">Assignments made here are <strong>permanent</strong> and will override the weekly schedule for all days.</span>
                    </div>

                    <!-- Current Participants List -->
                    <div class="space-y-2">
                        {#if role.participants?.length}
                            {#each role.participants as participant}
                                <div class="flex items-center justify-between bg-gray-700 p-2 rounded-lg">
                                    <div class="flex items-center gap-2">
                                            <img 
                                            src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                                alt={participant.username}
                                            class="w-8 h-8 rounded-full object-cover border border-gray-500"
                                            on:error={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div class="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-white text-sm font-bold border border-gray-500" style="display: none;">
                                            {participant.username ? participant.username[0] : '?'}
                                        </div>
                                        <span>{participant.username}</span>
                                    </div>
                                    <button 
                                        class="text-red-400 hover:text-red-300"
                                        on:click={() => removeParticipant(participant.id)}
                                        aria-label="Remove participant"
                                    >
                                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                        {:else}
                            <p class="text-gray-500 text-sm">No participants yet</p>
                        {/if}
                    </div>

                    <!-- Add Participants Dropdown -->
                    {#if showAddParticipants}
                        <div class="bg-gray-700 rounded-lg overflow-hidden mt-2">
                            {#if Object.keys(userStore || {}).length === 0 && holosphere}
                                <p class="p-3 text-sm text-gray-400">Loading users or no users found in this holon.</p>
                            {:else if availableUsersToList.length === 0 && Object.keys(userStore || {}).length > 0}
                                <p class="p-3 text-sm text-gray-400">All available users are already participants or no other users to add.</p>
                            {:else}
                                {#each availableUsersToList as [userId, user]}
                                    <button
                                        class="w-full text-left px-4 py-2 hover:bg-gray-600 transition-colors flex items-center gap-2 text-gray-200"
                                        on:click={() => addParticipant(userId)}
                                    >
                                            <img 
                                            src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
                                                alt={user.first_name}
                                            class="w-6 h-6 rounded-full object-cover border border-gray-500"
                                            on:error={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div class="w-6 h-6 rounded-full bg-gray-500 flex items-center justify-center text-xs text-white border border-gray-500" style="display: none;">
                                            {user.first_name ? user.first_name[0] : '?'}{user.last_name ? user.last_name[0] : ''}
                                            </div>
                                        <span>{user.first_name} {user.last_name || ''}</span>
                                    </button>
                                {/each}
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="flex justify-between pt-6">
                    <button
                        class="btn btn--danger"
                        on:click={deleteRole}
                    >
                        Delete Role
                    </button>

                    <button
                        class="btn btn--secondary"
                        on:click={closeModal}
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    </div>
</div> 