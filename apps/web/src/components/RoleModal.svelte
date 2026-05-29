<script lang="ts">
    // @ts-nocheck

    $: if (role && !role.participants) {
        role.participants = [];
    }

    import { createEventDispatcher } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { goto } from '$app/navigation';
    import {
        CHECKLIST_TYPES,
        createChecklistObject,
    } from '@holons/core/checklists';
    import { notifyWriteDenied } from '../lib/stores/writeNotifications';
    import { nameMap, resolvedName } from '$lib/stores/nameResolver';
    import { formatDate } from '../utils/date';
    import DisplayName from './shared/DisplayName.svelte';
    import SourceBadge from './shared/SourceBadge.svelte';
    import PublishToFederationButton from './shared/PublishToFederationButton.svelte';

    export let role: any;
    export let roleId: string;
    export let userStore: Record<string, any>;
    export let holosphere: any;
    export let holonId: string;

    let editingTitle = false;
    let editingDescription = false;
    let tempTitle = '';
    let tempDescription = '';
    let userSearchQuery = '';

    $: if (role) {
        if (!editingTitle) tempTitle = role.title || '';
        if (!editingDescription) tempDescription = role.description || '';
    }

    const dispatch = createEventDispatcher();

    // Stable Set of participant ids — drives the multi-select check state.
    $: participantIds = new Set((role?.participants || []).map((p: any) => String(p.id)));

    $: userEntries = Object.entries(userStore || {});
    $: filteredUserEntries = (() => {
        const q = userSearchQuery.trim().toLowerCase();
        if (!q) return userEntries;
        return userEntries.filter(([userId, user]) => {
            const name = resolvedName(user?.id || userId, $nameMap, user) || '';
            const handle = String(user?.username || '');
            return (
                name.toLowerCase().includes(q) ||
                handle.toLowerCase().includes(q)
            );
        });
    })();

    function focusOnMount(node: HTMLElement) {
        node.focus();
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
        if (!confirm('Are you sure you want to delete this role?')) return;
        try {
            await holosphere.delete(holonId, 'roles', roleId);
            dispatch('deleted', { roleId });
            dispatch('close');
        } catch (error: any) {
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to delete - no write permission for this holon');
            } else {
                console.error('[RoleModal.svelte] Error deleting role:', error);
            }
        }
    }

    function closeModal() {
        dispatch('close');
    }

    async function saveTitle() {
        if (tempTitle.trim() && tempTitle.trim() !== role.title) {
            await updateRole({ title: tempTitle.trim() });
        }
        editingTitle = false;
    }

    function handleTitleKeydown(event: KeyboardEvent) {
        if (event.key === 'Enter') {
            saveTitle();
        } else if (event.key === 'Escape') {
            tempTitle = role.title || '';
            editingTitle = false;
        }
    }

    async function saveDescription() {
        const next = tempDescription.trim();
        if (next !== (role.description || '')) {
            await updateRole({ description: next });
        }
        editingDescription = false;
    }

    function handleDescriptionKeydown(event: KeyboardEvent) {
        if (event.key === 'Escape') {
            tempDescription = role.description || '';
            editingDescription = false;
        }
    }

    async function removeParticipant(participantId: string) {
        const participants = (role.participants || []).filter(
            (p: { id: string }) => String(p.id) !== String(participantId)
        );
        await updateRole({ participants });
    }

    async function addParticipant(userKey: string, user: any) {
        const u = user || userStore?.[userKey];
        if (!u) return;

        const userId = u.id ?? userKey;
        const participants = [...(role.participants || [])];
        if (participants.some((p: { id: string }) => String(p.id) === String(userId))) return;

        const username = u.first_name + (u.last_name ? ' ' + u.last_name : '');
        participants.push({
            id: userId,
            username,
            isPermanent: true,
            assigned_at: new Date().toISOString(),
        });
        await updateRole({ participants });

        dispatch('permanentAssignment', {
            roleName: role.title,
            userName: username,
        });
    }

    function toggleUserParticipation(userKey: string, user: any) {
        const userId = user?.id ?? userKey;
        if (participantIds.has(String(userId))) {
            removeParticipant(String(userId));
        } else {
            addParticipant(userKey, user);
        }
    }

    function navigateToChecklist() {
        if (role?.checklistId) {
            goto(`/${holonId}/checklists?checklist=${role.checklistId}`);
        }
    }

    // Optimistic: flip the button to "View Checklist" immediately and sync to
    // HoloSphere in the background — mirrors createChecklistForTask in TaskModal.
    function createChecklistForRole() {
        if (!holosphere || !holonId || !roleId) return;
        if (role.checklistId) return;

        const newChecklist = createChecklistObject(
            `role_${roleId}_checklist`,
            CHECKLIST_TYPES.ROLE,
            {
                creator: 'Dashboard User',
                roleId,
                parentTitle: role?.title,
                holonId,
            },
        );

        const previousRole = role;
        role = { ...role, checklistId: newChecklist.id };

        Promise.all([
            holosphere.put(holonId, 'checklists', newChecklist),
            holosphere.put(holonId, 'roles', role),
        ]).catch((error: any) => {
            role = previousRole;
            if (error?.name === 'AuthorizationError') {
                notifyWriteDenied('Unable to save - no write permission for this holon');
            } else {
                console.error('[RoleModal.svelte] Error creating checklist for role:', error);
            }
        });
    }

    function handlePublished() {
        // No-op — Roles.svelte already re-subscribes via QueryManager.
    }
</script>

<div
    data-component="RoleModal"
    class="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-3"
    on:click|self={closeModal}
    on:keydown={(e) => e.key === 'Escape' && closeModal()}
    role="presentation"
    transition:fade
>
    <div
        class="bg-gray-800 rounded-xl max-w-3xl w-full max-h-[95vh] shadow-2xl relative flex flex-col border border-gray-700 mx-auto lg:mx-0"
        transition:scale={{ duration: 200, start: 0.95 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown|stopPropagation
    >
        <button
            class="absolute top-4 right-4 text-gray-400 hover:text-white z-10 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center p-2"
            on:click={closeModal}
            aria-label="Close modal"
            type="button"
        >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>

        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-gray-700">
            <div class="flex-1 mr-4">
                {#if editingTitle}
                    <input
                        type="text"
                        bind:value={tempTitle}
                        class="text-xl font-bold text-white bg-transparent border-b border-gray-500 focus:border-blue-400 px-1 py-1 w-full outline-none"
                        on:blur={saveTitle}
                        on:keydown={handleTitleKeydown}
                        use:focusOnMount
                    />
                {:else}
                    <button
                        type="button"
                        id="modal-title"
                        class="text-xl font-bold text-white hover:text-gray-300 transition-colors w-full text-left"
                        on:click={() => {
                            tempTitle = role.title || '';
                            editingTitle = true;
                        }}
                    >
                        {role.title || 'Untitled role'}
                    </button>
                {/if}

                <!-- Compact metadata -->
                <div class="flex items-center gap-2 mt-1 text-xs text-gray-400">
                    {#if role.created}
                        <span class="flex items-center gap-1">
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                            </svg>
                            {formatDate(role.created)}
                        </span>
                    {/if}
                    <SourceBadge item={role} currentHolonId={holonId} lensRoute="roles" />
                </div>
            </div>
        </div>

        <!-- Body -->
        <div class="p-4 overflow-y-auto flex-1 modal-content scrollbar-thin">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-gray-300 min-h-0">
                <!-- Left column -->
                <div class="space-y-3 min-h-0">
                    <!-- Description -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h7"/>
                            </svg>
                            Description
                        </h4>
                        {#if editingDescription}
                            <textarea
                                bind:value={tempDescription}
                                class="text-sm text-white bg-gray-800 rounded px-2 py-2 w-full resize-none border border-gray-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                rows="3"
                                placeholder="Add a description..."
                                on:blur={saveDescription}
                                on:keydown={handleDescriptionKeydown}
                                use:focusOnMount
                            ></textarea>
                        {:else if role.description}
                            <button
                                class="text-sm whitespace-pre-wrap text-left w-full hover:bg-gray-700/50 p-2 rounded transition-colors"
                                on:click={() => {
                                    tempDescription = role.description || '';
                                    editingDescription = true;
                                }}
                                type="button"
                            >
                                {role.description}
                            </button>
                        {:else}
                            <button
                                class="text-sm text-gray-400 hover:text-white p-2 rounded hover:bg-gray-700/50 w-full text-left transition-colors"
                                on:click={() => {
                                    tempDescription = '';
                                    editingDescription = true;
                                }}
                                type="button"
                            >
                                + Add description
                            </button>
                        {/if}
                    </div>

                    <!-- Permanent assignment notice -->
                    <div class="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 flex items-start gap-2 text-sm">
                        <svg class="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span class="text-amber-200/90">
                            Assignments made here are <strong>permanent</strong> and override the weekly schedule for all days.
                        </span>
                    </div>

                    <!-- Checklist quick action -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                            </svg>
                            Actions
                        </h4>
                        <div class="space-y-1">
                            {#if role.checklistId}
                                <button
                                    class="w-full px-2 py-1 bg-teal-500/20 text-teal-300 rounded text-xs hover:bg-teal-500/30 transition-colors flex items-center gap-2"
                                    on:click={navigateToChecklist}
                                    type="button"
                                >
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                                    </svg>
                                    View Checklist
                                </button>
                            {:else}
                                <button
                                    class="w-full px-2 py-1 bg-gray-600 text-gray-300 rounded text-xs hover:bg-gray-500 transition-colors flex items-center gap-2"
                                    on:click={createChecklistForRole}
                                    type="button"
                                >
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                                    </svg>
                                    Create Checklist
                                </button>
                            {/if}
                        </div>
                    </div>
                </div>

                <!-- Right column -->
                <div class="space-y-3 min-h-0">
                    <!-- Participants -->
                    <div class="bg-gray-700/30 p-3 rounded-lg">
                        <h4 class="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
                            </svg>
                            Participants
                            {#if role.participants?.length}
                                <span class="text-xs text-indigo-400">({role.participants.length} assigned)</span>
                            {/if}
                        </h4>

                        {#if Object.keys(userStore || {}).length > 4}
                            <!-- Match TaskModal: search appears once the holon has >4 users. -->
                            <div class="team-search">
                                <input
                                    type="search"
                                    class="team-search__input"
                                    placeholder="Search users…"
                                    bind:value={userSearchQuery}
                                    autocomplete="off"
                                    autocorrect="off"
                                    autocapitalize="off"
                                    spellcheck="false"
                                />
                                {#if userSearchQuery}
                                    <button
                                        type="button"
                                        class="team-search__clear"
                                        on:click|stopPropagation={() => (userSearchQuery = '')}
                                        aria-label="Clear search"
                                    >&times;</button>
                                {/if}
                            </div>
                        {/if}

                        <div class="max-h-64 overflow-y-auto space-y-1 pr-1 overscroll-contain">
                            {#if Object.keys(userStore || {}).length === 0 && holosphere}
                                <p class="text-gray-500 text-xs py-2 text-center">Loading users…</p>
                            {:else if Object.keys(userStore || {}).length === 0}
                                <p class="text-gray-500 text-xs py-2 text-center">No users in this holon</p>
                            {:else if filteredUserEntries.length === 0}
                                <p class="text-gray-500 text-xs py-2 text-center">No matching users</p>
                            {:else}
                                {#each filteredUserEntries as [userKey, user] (user.id || userKey)}
                                    {@const userId = user.id || userKey}
                                    {@const isSelected = participantIds.has(String(userId))}
                                    <div
                                        class="user-row {isSelected ? 'user-row--selected' : ''}"
                                        role="button"
                                        tabindex="0"
                                        aria-pressed={isSelected}
                                        on:click|stopPropagation={() => toggleUserParticipation(userKey, user)}
                                        on:keydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                toggleUserParticipation(userKey, user);
                                            }
                                        }}
                                    >
                                        <div class="flex items-center gap-2.5 min-w-0">
                                            <div class="user-row__check {isSelected ? 'user-row__check--on' : ''}">
                                                {#if isSelected}
                                                    <svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                                                    </svg>
                                                {/if}
                                            </div>
                                            <img
                                                src={`https://telegram.holons.io/getavatar?user_id=${userId}`}
                                                alt={resolvedName(userId, $nameMap, user)}
                                                class="w-7 h-7 rounded-full"
                                                loading="lazy"
                                            />
                                            <div class="text-left min-w-0">
                                                <div class="text-gray-200 font-medium truncate">
                                                    <DisplayName id={userId} {user} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            {/if}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="border-t border-gray-700 p-4">
            <div class="flex gap-2 justify-between">
                <button
                    class="px-3 py-2 bg-red-500/10 text-red-400 rounded hover:bg-red-500/20 border border-red-500/30 transition-colors text-sm flex items-center gap-2"
                    on:click={deleteRole}
                    type="button"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                    </svg>
                    Delete
                </button>

                <div class="flex gap-2">
                    <PublishToFederationButton
                        {holonId}
                        lens="roles"
                        item={role}
                        onPublished={handlePublished}
                    />
                    <button
                        class="px-4 py-2 bg-gray-700 text-gray-200 rounded border border-gray-600 hover:bg-gray-600 transition-colors text-sm font-medium"
                        on:click={closeModal}
                        type="button"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* Modal scrollbar — matches TaskModal */
    .modal-content::-webkit-scrollbar {
        width: 8px;
    }
    .modal-content::-webkit-scrollbar-track {
        background: var(--color-bg-tertiary);
        border-radius: 4px;
    }
    .modal-content::-webkit-scrollbar-thumb {
        background: #6b7280;
        border-radius: 4px;
    }
    .modal-content::-webkit-scrollbar-thumb:hover {
        background: #6b7280;
    }

    /* Team / participant search box */
    .team-search {
        position: relative;
        margin-bottom: 0.5rem;
    }
    .team-search__input {
        width: 100%;
        background: var(--color-bg-primary);
        border: 1px solid var(--color-bg-tertiary);
        border-radius: 0.5rem;
        color: #f9fafb;
        font-size: 0.875rem;
        padding: 0.5rem 2rem 0.5rem 0.75rem;
        line-height: 1.2;
        -webkit-appearance: none;
        appearance: none;
    }
    .team-search__input:focus {
        outline: none;
        border-color: var(--color-accent-light);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2);
    }
    .team-search__input::placeholder {
        color: var(--color-text-muted);
    }
    .team-search__clear {
        position: absolute;
        right: 0.4rem;
        top: 50%;
        transform: translateY(-50%);
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        background: transparent;
        border: none;
        color: var(--color-text-muted);
        font-size: 1.1rem;
        line-height: 1;
        cursor: pointer;
    }
    .team-search__clear:hover {
        background: var(--color-bg-tertiary);
        color: var(--color-text-primary);
    }

    /* Selectable user row */
    .user-row {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.625rem 0.625rem;
        border-radius: 0.5rem;
        background: var(--color-bg-secondary);
        border: 1px solid transparent;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
        user-select: none;
        transition: background-color 120ms ease, border-color 120ms ease;
        min-height: 48px;
    }
    .user-row:hover {
        background: var(--color-bg-tertiary);
    }
    .user-row:active {
        background: var(--color-border-light);
    }
    .user-row--selected,
    .user-row--selected:hover {
        background: rgba(99, 102, 241, 0.18);
        border-color: rgba(99, 102, 241, 0.5);
    }
    .user-row__check {
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.375rem;
        border: 2px solid #6b7280;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: background-color 120ms ease, border-color 120ms ease;
    }
    .user-row__check--on {
        background: var(--color-accent-light);
        border-color: var(--color-accent-light);
    }
</style>
