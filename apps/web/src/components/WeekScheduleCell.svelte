<script lang="ts">
	// @ts-nocheck
	import { createEventDispatcher, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { nameMap, resolvedName, resolvedInitials } from '$lib/stores/nameResolver';
	import DisplayName from './shared/DisplayName.svelte';

	export let assignedUsers: { id: string; username: string }[] = [];
	export let availableUsers: Record<string, any> = {};
	export let isToday: boolean = false;
	export let isPermanent: boolean = false;
	export let roleId: string;
	export let date: string;

	const dispatch = createEventDispatcher();

	let showDropdown = false;
	let userSearchQuery = '';
	$: if (!showDropdown) userSearchQuery = ''; // reset when dropdown closes
	let cellRef: HTMLDivElement;
	let triggerRef: HTMLButtonElement;
	let dropdownRef: HTMLDivElement;
	// Coordinates for the fixed-positioned dropdown so it escapes any
	// ancestor `overflow: auto` (e.g. the week-grid's horizontal scroller,
	// which by spec clips vertically too).
	let dropdownTop = 0;
	let dropdownLeft = 0;
	const DROPDOWN_MIN_WIDTH = 160;
	const DROPDOWN_GAP = 4;

	$: hasAssignment = assignedUsers && assignedUsers.length > 0;
	$: assignedUser = hasAssignment ? assignedUsers[0] : null;

	// Filter out already assigned users
	$: availableUsersList = Object.entries(availableUsers).filter(
		([userId, _user]) => !assignedUsers?.some(a => a.id === userId)
	);

	$: filteredAvailableUsers = (() => {
		const q = userSearchQuery.trim().toLowerCase();
		if (!q) return availableUsersList;
		return availableUsersList.filter(([uid, u]) => {
			const name = String(u?.first_name || '') + ' ' + String(u?.last_name || '');
			const handle = String(u?.username || '');
			return name.toLowerCase().includes(q) || handle.toLowerCase().includes(q) || String(uid).toLowerCase().includes(q);
		});
	})();

	function positionDropdown() {
		if (!triggerRef) return;
		const rect = triggerRef.getBoundingClientRect();
		const width = Math.max(DROPDOWN_MIN_WIDTH, dropdownRef?.offsetWidth ?? DROPDOWN_MIN_WIDTH);
		// Center horizontally on the trigger, clamp to the viewport so the
		// menu can't spill off-screen on narrow phones.
		let left = rect.left + rect.width / 2 - width / 2;
		left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
		dropdownLeft = left;
		dropdownTop = rect.bottom + DROPDOWN_GAP;
	}

	async function toggleDropdown(e: MouseEvent) {
		e.stopPropagation();
		const next = !showDropdown;
		showDropdown = next;
		if (next) {
			// Wait one tick so the dropdown is in the DOM, then anchor it.
			await tick();
			positionDropdown();
		}
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
		const target = e.target as Node;
		const inCell = cellRef?.contains(target);
		const inDropdown = dropdownRef?.contains(target);
		if (!inCell && !inDropdown) {
			showDropdown = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			showDropdown = false;
		}
	}

	// Re-anchor (or just close) when the page scrolls or resizes — a
	// fixed-positioned menu detaches from its trigger otherwise.
	function handleScrollOrResize() {
		if (!showDropdown) return;
		positionDropdown();
	}
</script>

<svelte:window
	on:click={handleClickOutside}
	on:keydown={handleKeydown}
	on:scroll={handleScrollOrResize}
	on:resize={handleScrollOrResize}
/>

<div
	class="week-cell {isToday ? 'week-cell--today' : ''} {isPermanent ? 'week-cell--permanent' : ''}"
	bind:this={cellRef}
>
	<button
		bind:this={triggerRef}
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
		<div
			class="week-cell__dropdown"
			bind:this={dropdownRef}
			style="top: {dropdownTop}px; left: {dropdownLeft}px;"
			transition:fade={{ duration: 100 }}
		>
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
			{#if availableUsersList.length > 4}
				<div class="week-cell__dropdown-search">
					<input
						type="search"
						bind:value={userSearchQuery}
						placeholder="Search users…"
						autocomplete="off"
						on:click|stopPropagation
					/>
				</div>
			{/if}
			{#if filteredAvailableUsers.length > 0}
				{#each filteredAvailableUsers as [userId, user]}
					<button
						class="week-cell__dropdown-item"
						on:click={() => selectUser(userId, user)}
					>
						<img
							class="week-cell__dropdown-avatar"
							src={`https://telegram.holons.io/getavatar?user_id=${user.id || userId}`}
							alt={resolvedName(user.id || userId, $nameMap, user)}
							on:error={(e) => {
								e.currentTarget.style.display = 'none';
								e.currentTarget.nextElementSibling.style.display = 'flex';
							}}
						/>
						<div class="week-cell__dropdown-avatar-fallback" style="display: none;">
							{resolvedInitials(user.id || userId, $nameMap, user)}
						</div>
						<span><DisplayName id={user.id || userId} {user} /></span>
					</button>
				{/each}
			{:else if availableUsersList.length > 0}
				<div class="week-cell__dropdown-empty">No matching users</div>
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
		/* Fixed so the menu escapes the week-grid's overflow:auto scroller —
		   per CSS spec, overflow-x:auto coerces overflow-y to auto too,
		   which would clip an absolutely-positioned child's bottom edge.
		   `top`/`left` are set inline from JS based on the trigger's rect. */
		position: fixed;
		z-index: 50;
		min-width: 160px;
		max-height: 200px;
		overflow-y: auto;
		background: #374151;
		border-radius: 8px;
		box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
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

	.week-cell__dropdown-search {
		padding: 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.week-cell__dropdown-search input {
		width: 100%;
		background: rgba(0, 0, 0, 0.35);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 4px;
		color: #f9fafb;
		font-size: 13px;
		padding: 4px 8px;
		outline: none;
	}

	.week-cell__dropdown-search input:focus {
		border-color: #6366f1;
	}
</style>
