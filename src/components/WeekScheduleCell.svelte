<script lang="ts">
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import { fade } from 'svelte/transition';

	export let assignedUsers: { id: string; username: string }[] = [];
	export let availableUsers: Record<string, any> = {};
	export let isToday: boolean = false;
	export let isPermanent: boolean = false;
	export let roleId: string;
	export let date: string;

	const dispatch = createEventDispatcher();

	let showDropdown = false;
	let dropdownRef: HTMLDivElement;

	$: hasAssignment = assignedUsers && assignedUsers.length > 0;
	$: assignedUser = hasAssignment ? assignedUsers[0] : null;

	// Filter out already assigned users
	$: availableUsersList = Object.entries(availableUsers).filter(
		([userId, _user]) => !assignedUsers?.some(a => a.id === userId)
	);

	function toggleDropdown(e: MouseEvent) {
		e.stopPropagation();
		showDropdown = !showDropdown;
	}

	function selectUser(userId: string, user: any) {
		const username = user.first_name + (user.last_name ? ' ' + user.last_name : '');
		dispatch('assign', { roleId, date, userId, username });
		showDropdown = false;
	}

	function clearAssignment(e: MouseEvent) {
		e.stopPropagation();
		dispatch('unassign', { roleId, date });
		showDropdown = false;
	}

	function handleClickOutside(e: MouseEvent) {
		if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
			showDropdown = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showDropdown = false;
		}
	}
</script>

<svelte:window on:click={handleClickOutside} on:keydown={handleKeydown} />

<div
	class="week-cell {isToday ? 'week-cell--today' : ''} {isPermanent ? 'week-cell--permanent' : ''}"
	bind:this={dropdownRef}
>
	<button
		class="week-cell__content"
		on:click={toggleDropdown}
		aria-haspopup="listbox"
		aria-expanded={showDropdown}
	>
		{#if hasAssignment && assignedUser}
			<div class="week-cell__user">
				<img
					class="week-cell__avatar"
					src={`https://telegram.holons.io/getavatar?user_id=${assignedUser.id}`}
					alt={assignedUser.username}
					on:error={(e) => {
						e.currentTarget.style.display = 'none';
						e.currentTarget.nextElementSibling.style.display = 'flex';
					}}
				/>
				<div class="week-cell__avatar-fallback" style="display: none;">
					{assignedUser.username ? assignedUser.username[0].toUpperCase() : '?'}
				</div>
				{#if isPermanent}
					<svg class="week-cell__lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
						<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
					</svg>
				{/if}
			</div>
			<span class="week-cell__name">{assignedUser.username?.split(' ')[0] || '?'}</span>
		{:else}
			<div class="week-cell__empty">
				<svg class="week-cell__plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
			</div>
		{/if}
	</button>

	{#if showDropdown}
		<div class="week-cell__dropdown" transition:fade={{ duration: 100 }}>
			{#if hasAssignment}
				<button class="week-cell__dropdown-item week-cell__dropdown-item--clear" on:click={clearAssignment}>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"></line>
						<line x1="6" y1="6" x2="18" y2="18"></line>
					</svg>
					<span>Clear assignment</span>
				</button>
				<div class="week-cell__dropdown-divider"></div>
			{/if}
			{#if availableUsersList.length > 0}
				{#each availableUsersList as [userId, user]}
					<button
						class="week-cell__dropdown-item"
						on:click={() => selectUser(userId, user)}
					>
						<img
							class="week-cell__dropdown-avatar"
							src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
							alt={user.first_name}
							on:error={(e) => {
								e.currentTarget.style.display = 'none';
								e.currentTarget.nextElementSibling.style.display = 'flex';
							}}
						/>
						<div class="week-cell__dropdown-avatar-fallback" style="display: none;">
							{user.first_name ? user.first_name[0] : '?'}
						</div>
						<span>{user.first_name} {user.last_name || ''}</span>
					</button>
				{/each}
			{:else if !hasAssignment}
				<div class="week-cell__dropdown-empty">No users available</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.week-cell {
		position: relative;
		min-height: 60px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.2);
		transition: all 0.2s ease;
	}

	.week-cell:hover {
		border-color: rgba(255, 255, 255, 0.2);
		background: rgba(0, 0, 0, 0.3);
	}

	.week-cell--today {
		border-color: rgba(99, 102, 241, 0.5);
		background: rgba(99, 102, 241, 0.1);
	}

	.week-cell--today:hover {
		border-color: rgba(99, 102, 241, 0.7);
		background: rgba(99, 102, 241, 0.15);
	}

	.week-cell--permanent {
		background: rgba(245, 158, 11, 0.1);
	}

	.week-cell__content {
		width: 100%;
		height: 100%;
		min-height: 60px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		color: inherit;
	}

	.week-cell__user {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.week-cell__avatar {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid rgba(255, 255, 255, 0.2);
	}

	.week-cell__avatar-fallback {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 14px;
		font-weight: bold;
		color: white;
		border: 2px solid rgba(255, 255, 255, 0.2);
	}

	.week-cell__lock {
		position: absolute;
		bottom: -4px;
		right: -4px;
		width: 14px;
		height: 14px;
		background: #f59e0b;
		border-radius: 50%;
		padding: 2px;
		color: white;
	}

	.week-cell__name {
		font-size: 11px;
		color: rgba(255, 255, 255, 0.8);
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.week-cell__empty {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.week-cell__plus {
		width: 20px;
		height: 20px;
		color: rgba(255, 255, 255, 0.3);
		transition: color 0.2s ease;
	}

	.week-cell:hover .week-cell__plus {
		color: rgba(255, 255, 255, 0.5);
	}

	.week-cell__dropdown {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		min-width: 160px;
		max-height: 200px;
		overflow-y: auto;
		background: #374151;
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
		margin-top: 4px;
	}

	.week-cell__dropdown-item {
		width: 100%;
		padding: 8px 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		border: none;
		color: rgba(255, 255, 255, 0.9);
		cursor: pointer;
		font-size: 13px;
		text-align: left;
		transition: background 0.15s ease;
	}

	.week-cell__dropdown-item:hover {
		background: rgba(255, 255, 255, 0.1);
	}

	.week-cell__dropdown-item--clear {
		color: #f87171;
	}

	.week-cell__dropdown-item--clear:hover {
		background: rgba(248, 113, 113, 0.1);
	}

	.week-cell__dropdown-divider {
		height: 1px;
		background: rgba(255, 255, 255, 0.1);
		margin: 4px 0;
	}

	.week-cell__dropdown-avatar {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		object-fit: cover;
	}

	.week-cell__dropdown-avatar-fallback {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		font-weight: bold;
		color: white;
	}

	.week-cell__dropdown-empty {
		padding: 12px;
		text-align: center;
		color: rgba(255, 255, 255, 0.5);
		font-size: 13px;
	}
</style>
