<script lang="ts">
    import { createEventDispatcher, getContext, onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { goto } from '$app/navigation';
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolvedInitials } from '$lib/stores/nameResolver';
    import DisplayName from './shared/DisplayName.svelte';
    import { removeParticipant as coreRemoveParticipant, toggleParticipant as coreToggleParticipant } from '@holons/core/tasks';
    // Allow either quest or role to be passed
    export let quest: any = undefined;
    export let role: any = undefined;
    export let questId: string | undefined = undefined;
    export let roleId: string | undefined = undefined;
    export let holonId: string;

    const item = quest || role;
    const itemId = questId || roleId;
    const itemType = quest ? 'quests' : 'roles';

    interface User {
        first_name: string;
        last_name?: string;
        picture?: string;
        username?: string;
        id?: string;
    }

    interface UserStore {
        [key: string]: User;
    }

    const holosphere = getContext("holosphere") as HoloSphere;
    
    let userStore: UserStore = {};
    
    // Scheduling interface variables
    let showScheduling = false;
    let tempDate: string;
    let tempTime: string;
    let tempEndTime: string;

    onMount(() => {
        document.addEventListener('click', handleClickOutside);
        
        // Initialize scheduling form with current item values
        if (item.when) {
            const date = new Date(item.when);
            tempDate = date.toISOString().split('T')[0];
            tempTime = date.toTimeString().slice(0, 5);
        } else {
            const now = new Date();
            tempDate = now.toISOString().split('T')[0];
            tempTime = now.toTimeString().slice(0, 5);
        }
        
        if (item.ends) {
            const endDate = new Date(item.ends);
            tempEndTime = endDate.toTimeString().slice(0, 5);
        } else {
            const startTime = new Date(item.when || new Date());
            startTime.setHours(startTime.getHours() + 1);
            tempEndTime = startTime.toTimeString().slice(0, 5);
        }
        
        const initializeUsers = async () => {
            if (holosphere) {
                // First, fetch all existing users
                try {
                    const initialUsers = await holosphere.getAll(holonId, "users");
                    if (initialUsers) {
                        // Convert array to object if needed
                        if (Array.isArray(initialUsers)) {
                            const userObject: UserStore = {};
                            initialUsers.forEach((user, index) => {
                                if (user && user.id) {
                                    userObject[user.id] = user;
                                }
                            });
                            userStore = userObject;
                        } else {
                            userStore = initialUsers as UserStore;
                        }
                        console.log("[ItemModal] Loaded initial users:", Object.keys(userStore).length);
                    }
                } catch (error) {
                    console.error("[ItemModal] Error fetching initial users:", error);
                }

                // Then subscribe to future updates
                holosphere.subscribe(holonId, "users", (newUser: any, key?: string) => {
                    if (key && newUser) {
                        // Use user.id as the canonical key if available
                        const canonicalKey = newUser.id || key;
                        
                        if (newUser.id && key !== newUser.id) {
                            // Remove the old key if it's different from the canonical key
                            const { [key]: _, ...rest } = userStore;
                            userStore = { ...rest, [canonicalKey]: newUser };
                        } else {
                            // Use the key directly
                            userStore = { ...userStore, [canonicalKey]: newUser };
                        }
                    } else if (key) {
                        const { [key]: _, ...rest } = userStore;
                        userStore = rest;
                    }
                });
            }
        };

        initializeUsers();

        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    });

    const dispatch = createEventDispatcher();
    let showDropdown = false;

    async function updateItem(updates: any, shouldClose = false) {
        if (!holosphere) {
            console.error(`Cannot update ${itemType}: holosphere is not available`);
            return;
        }
        
        const updatedItem = { ...item, ...updates };
        await holosphere.put(holonId, itemType, updatedItem);
        if (quest) quest = updatedItem;
        if (role) role = updatedItem;
        
        if (shouldClose) {
            dispatch('close');
        }
    }

    async function deleteItem() {
        if (!itemId || !holonId) {
            console.error(`Cannot delete ${itemType}: missing parameters`, { itemId, holonId });
            return;
        }

        if (confirm(`Are you sure you want to delete this ${itemType.slice(0, -1)}?`)) {
            try {
                await holosphere.delete(holonId, itemType, itemId);
                dispatch('close', { deleted: true, itemId });
            } catch (error) {
                console.error(`Error deleting ${itemType}:`, error);
            }
        }
    }

    function closeModal() {
        dispatch('close');
    }

    async function removeParticipant(participantId: string) {
        const target = (quest || role) as any;
        const base = { ...target, participants: target.participants || [] };
        const updated = coreRemoveParticipant(base, participantId);
        if (quest) quest.participants = updated.participants;
        if (role) role.participants = updated.participants;
        item.participants = updated.participants;
        await updateItem({ participants: updated.participants });
    }

    async function toggleParticipant(userId: string) {
        const target = (quest || role) as any;
        const base = { ...target, participants: target.participants || [] };
        const u = userStore[userId];
        // If user isn't in the store and isn't already a participant, nothing to add.
        if (!u && !base.participants.some((p: any) => String(p.id) === String(userId))) {
            showDropdown = false;
            return;
        }
        const candidate = u
            ? { id: userId, first_name: u.first_name, last_name: u.last_name, username: u.username }
            : { id: userId };
        const updated = coreToggleParticipant(base, candidate);
        if (quest) quest.participants = updated.participants;
        if (role) role.participants = updated.participants;
        item.participants = updated.participants;
        await updateItem({ participants: updated.participants });
        showDropdown = false;
    }

    function isUserParticipant(userId: string) {
        return item.participants?.some((p: any) => p.id === userId);
    }

    async function completeItem() {
        const newStatus = item.status === 'completed' ? 'ongoing' : 'completed';
        await updateItem({ status: newStatus }, true);
    }

    // Scheduling functions
    async function updateSchedule() {
        if (!tempDate || !tempTime) {
            alert('Please select both date and start time');
            return;
        }

        const newDate = new Date(`${tempDate}T${tempTime}`);
        const endDate = tempEndTime ? new Date(`${tempDate}T${tempEndTime}`) : new Date(newDate.getTime() + 60*60*1000);
        
        const updatedItem = {
            ...item,
            when: newDate.toISOString(),
            ends: endDate.toISOString()
        };

        await updateItem(updatedItem);
        showScheduling = false;
    }

    async function removeSchedule() {
        const updatedItem = {
            ...item,
            when: null,
            ends: null,
            status: 'ongoing'
        };

        await updateItem(updatedItem);
        showScheduling = false;
    }

    function toggleScheduling() {
        showScheduling = !showScheduling;
        if (showScheduling) {
            // Reset form to current values
            if (item.when) {
                const date = new Date(item.when);
                tempDate = date.toISOString().split('T')[0];
                tempTime = date.toTimeString().slice(0, 5);
            } else {
                const now = new Date();
                tempDate = now.toISOString().split('T')[0];
                tempTime = now.toTimeString().slice(0, 5);
            }
            
            if (item.ends) {
                const endDate = new Date(item.ends);
                tempEndTime = endDate.toTimeString().slice(0, 5);
            } else {
                const startTime = new Date(item.when || new Date());
                startTime.setHours(startTime.getHours() + 1);
                tempEndTime = startTime.toTimeString().slice(0, 5);
            }
        }
    }

    function handleClickOutside(event: MouseEvent) {
        const dropdown = document.querySelector('.user-dropdown');
        if (dropdown && !dropdown.contains(event.target as Node)) {
            showDropdown = false;
        }
    }

    function navigateToChecklist() {
        if (role && role.checklistId) {
            goto(`/${holonId}/checklists?checklist=${role.checklistId}`);
        }
    }
</script>

<div 
    class="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
    on:click|self={closeModal}
    on:keydown={e => e.key === 'Escape' && closeModal()}
    role="presentation"
    transition:fade
>
    <div 
        class="bg-gray-800 rounded-xl max-w-2xl w-full shadow-xl" 
        transition:scale={{duration: 200, start: 0.95}}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
    >
        <div class="p-6">
            <div class="flex justify-between items-start mb-6">
                <h2 id="modal-title" class="text-2xl font-bold text-white">{item.title}</h2>
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
                {#if item.description}
                    <p class="text-sm">{item.description}</p>
                {/if}

                {#if role && role.checklistId}
                    <div class="bg-gray-700/50 p-4 rounded-lg">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-teal-600/20 flex items-center justify-center">
                                    <svg class="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>
                                    </svg>
                                </div>
                                <div>
                                    <h4 class="text-sm font-semibold text-white">Associated Checklist</h4>
                                    <p class="text-xs text-gray-400">This role has a linked checklist</p>
                                </div>
                            </div>
                            <button 
                                class="px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
                                on:click={navigateToChecklist}
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                                </svg>
                                View Checklist
                            </button>
                        </div>
                    </div>
                {/if}

                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold">Participants</h3>
                        <button 
                            class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm transition-colors"
                            on:click|stopPropagation={() => showDropdown = !showDropdown}
                        >
                            {showDropdown ? 'Cancel' : '+ Add Participant'}
                        </button>
                    </div>

                    <!-- Current Participants List -->
                    <div class="space-y-2">
                        {#if item.participants?.length}
                            {#each item.participants as participant}
                                <div class="flex items-center justify-between bg-gray-700 p-2 rounded-lg">
                                    <div class="flex items-center gap-2">
                                        <img
                                            src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
                                            alt={resolvedName(participant.id, $nameMap, participant)}
                                            class="w-8 h-8 rounded-full object-cover border border-gray-500"
                                            on:error={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div class="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-white text-sm font-bold border border-gray-500" style="display: none;">
                                            {resolvedInitials(participant.id, $nameMap, participant)}
                                        </div>
                                        <span><DisplayName id={participant.id} user={participant} /></span>
                                    </div>
                                    <button
                                        class="text-gray-400 hover:text-red-400 transition-colors"
                                        on:click={() => removeParticipant(participant.id)}
                                        aria-label={`Remove participant ${resolvedName(participant.id, $nameMap, participant)}`}
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

                    <!-- User Dropdown -->
                    {#if showDropdown}
                        <div class="bg-gray-700 rounded-lg overflow-hidden mt-2 user-dropdown">
                            {#each Object.entries(userStore) as [userId, user]}
                                <button
                                    class="w-full text-left px-4 py-2 hover:bg-gray-600 transition-colors flex items-center gap-2 {isUserParticipant(userId) ? 'bg-gray-600' : ''}"
                                    on:click|stopPropagation={() => toggleParticipant(userId)}
                                >
                                    <div class="flex items-center gap-2 flex-1">
                                        <img
                                            src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
                                            alt={resolvedName(user.id || userId, $nameMap, user)}
                                            class="w-6 h-6 rounded-full object-cover border border-gray-500"
                                            on:error={(e) => {
                                                e.currentTarget.style.display = 'none';
                                                e.currentTarget.nextElementSibling.style.display = 'flex';
                                            }}
                                        />
                                        <div class="w-6 h-6 rounded-full bg-gray-500 flex items-center justify-center text-white text-xs font-bold border border-gray-500" style="display: none;">
                                            {resolvedInitials(user.id || userId, $nameMap, user)}
                                        </div>
                                        <span><DisplayName id={user.id || userId} {user} /></span>
                                    </div>
                                    {#if isUserParticipant(userId)}
                                        <svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                                        </svg>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>

                {#if item.when}
                    <div class="text-sm">
                        <span class="font-semibold">When:</span> {new Date(item.when).toLocaleString()}
                        {#if item.ends}
                            - {new Date(item.ends).toLocaleTimeString()}
                        {/if}
                    </div>
                {/if}

                <!-- Scheduling Interface -->
                <div class="space-y-4">
                    <div class="flex justify-between items-center">
                        <h3 class="text-lg font-semibold">Schedule</h3>
                        <button 
                            class="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-full text-sm transition-colors"
                            on:click={toggleScheduling}
                        >
                            {showScheduling ? 'Cancel' : (item.when ? 'Edit Schedule' : '+ Add Schedule')}
                        </button>
                    </div>

                    {#if showScheduling}
                        <div class="bg-gray-700/50 p-4 rounded-lg space-y-4">
                            <div>
                                <label for="schedule-date" class="text-gray-300 text-sm font-medium block mb-2">Date</label>
                                <input 
                                    id="schedule-date"
                                    type="date" 
                                    bind:value={tempDate}
                                    class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                                >
                            </div>
                            
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label for="schedule-start-time" class="text-gray-300 text-sm font-medium block mb-2">Start Time</label>
                                    <input 
                                        id="schedule-start-time"
                                        type="time" 
                                        bind:value={tempTime}
                                        class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                                    >
                                </div>
                                
                                <div>
                                    <label for="schedule-end-time" class="text-gray-300 text-sm font-medium block mb-2">End Time</label>
                                    <input 
                                        id="schedule-end-time"
                                        type="time" 
                                        bind:value={tempEndTime}
                                        class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
                                    >
                                </div>
                            </div>
                            
                            <div class="flex gap-3 justify-end pt-2">
                                {#if item.when}
                                    <button 
                                        type="button"
                                        class="px-4 py-2 bg-gray-700 text-red-300 rounded-lg hover:bg-gray-600 border border-red-900/20 transition-colors text-sm font-medium"
                                        on:click={removeSchedule}
                                    >
                                        Remove Schedule
                                    </button>
                                {/if}
                                <button 
                                    type="button"
                                    class="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 border border-gray-600 transition-colors text-sm font-medium"
                                    on:click={() => showScheduling = false}
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="button"
                                    class="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors text-sm font-medium"
                                    on:click={updateSchedule}
                                >
                                    {item.when ? 'Update Schedule' : 'Set Schedule'}
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>

                <div class="flex justify-between pt-6">
                    <button
                        class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                        on:click={deleteItem}
                    >
                        Delete {itemType.slice(0, -1)}
                    </button>
                    
                    <div class="space-x-2">
                        <button
                            class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                            on:click={closeModal}
                        >
                            Cancel
                        </button>
                        {#if typeof item.status !== 'undefined'}
                            <button
                                class="px-4 py-2 {item.status === 'completed' ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-green-600 hover:bg-green-700'} text-white rounded-lg transition-colors"
                                on:click={completeItem}
                            >
                                {item.status === 'completed' ? 'Mark Ongoing' : 'Mark Complete'}
                            </button>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    .user-dropdown {
        max-height: 200px;
        overflow-y: auto;
    }
</style> 