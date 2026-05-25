<script lang="ts">
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import Modal from './shared/Modal.svelte';
	import DisplayName from './shared/DisplayName.svelte';
	import SourceBadge from './shared/SourceBadge.svelte';
	import { nameMap, resolvedName } from '$lib/stores/nameResolver';
	import { formatRelativeExpiry } from '$lib/util/relativeTime';
	import { ArrowUpCircle, ArrowDownCircle, UserPlus, X } from 'svelte-feathers';

	export let open: boolean = false;
	export let item: any = null;
	export let holonID: string | null = null;
	export let userStore: Record<string, any> = {};

	const dispatch = createEventDispatcher<{
		close: void;
		addParticipant: { item: any; user: any };
		removeParticipant: { item: any; user: any };
	}>();

	const TRANSACTION_TYPES = [
		{ value: 'borrow-lend', offerLabel: 'Lend', requestLabel: 'Borrow' },
		{ value: 'rent-lease', offerLabel: 'Rent', requestLabel: 'Rent' },
		{ value: 'buy-sell', offerLabel: 'Sell', requestLabel: 'Buy' },
		{ value: 'receive-donate', offerLabel: 'Donate', requestLabel: 'Receive' },
	];

	let showAddUserPicker = false;
	let userSearchQuery = '';
	$: if (!showAddUserPicker) userSearchQuery = '';

	$: side = item?.type === 'offer' ? 'offer' : 'request';
	$: availableUsers = (item && userStore)
		? Object.entries(userStore)
			.filter(([_, u]) => !item.participants?.some((p: any) => String(p.id) === String(u.id)))
			.map(([_, u]) => u)
		: [];
	$: filteredAvailableUsers = (() => {
		const q = userSearchQuery.trim().toLowerCase();
		if (!q) return availableUsers;
		return availableUsers.filter((u: any) => {
			const name = String(u?.first_name || '') + ' ' + String(u?.last_name || '');
			const handle = String(u?.username || '');
			return name.toLowerCase().includes(q) || handle.toLowerCase().includes(q) || String(u?.id || '').toLowerCase().includes(q);
		});
	})();
	$: isHologram = !!item?._hologram?.isHologram;

	function getTransactionLabel(value: string): string {
		const entry = TRANSACTION_TYPES.find(t => t.value === value);
		if (!entry) return value;
		return side === 'offer' ? entry.offerLabel : entry.requestLabel;
	}

	function handleAdd(user: any) {
		dispatch('addParticipant', { item, user });
		showAddUserPicker = false;
	}

	function handleRemove(user: any) {
		dispatch('removeParticipant', { item, user });
	}

	function handleClose() {
		showAddUserPicker = false;
		dispatch('close');
	}
</script>

{#if item}
	<Modal
		{open}
		size="lg"
		on:close={handleClose}
	>
		<svelte:fragment slot="header">
			<div class="detail__header">
				<div class="detail__title-row">
					{#if item.type === 'offer'}
						<span class="detail__type-icon detail__type-icon--offer" title="Offer">
							<svelte:component this={ArrowUpCircle} size="18" />
						</span>
					{:else}
						<span class="detail__type-icon detail__type-icon--request" title="Request">
							<svelte:component this={ArrowDownCircle} size="18" />
						</span>
					{/if}
					<h2 class="detail__title">{item.title}</h2>
				</div>
				<div class="detail__sub">
					<span class="detail__kind">{item.type === 'offer' ? 'Offer' : 'Request'}</span>
					<SourceBadge {item} currentHolonId={holonID} lensRoute="offers" />
				</div>
			</div>
		</svelte:fragment>

		<div class="detail__body">
			{#if item.initiator?.firstName || item.initiator?.username}
				<div class="detail__initiator">
					{#if item.initiator?.id}
						<img
							class="detail__avatar"
							src={`https://telegram.holons.io/getavatar?user_id=${item.initiator.id}`}
							alt={item.initiator.firstName || item.initiator.username || 'User'}
						/>
					{/if}
					<div class="detail__initiator-text">
						<span class="detail__initiator-label">
							{item.type === 'offer' ? 'Offered by' : 'Requested by'}
						</span>
						<span class="detail__initiator-name">
							{item.initiator.firstName || item.initiator.username}
						</span>
					</div>
				</div>
			{/if}

			{#if item.description}
				<p class="detail__description">{item.description}</p>
			{:else}
				<p class="detail__description detail__description--empty">No description.</p>
			{/if}

			{#if item.item_type || (item.transaction_type && item.transaction_type.length > 0) || (item.tags && item.tags.length > 0) || item.expires_at}
				<div class="detail__meta">
					{#if item.item_type}
						<span class="detail__pill detail__pill--neutral">
							{item.item_type === 'good' ? '📦 Good' : '🛠️ Service'}
						</span>
					{/if}
					{#if item.transaction_type}
						{#each item.transaction_type as tx}
							<span class="detail__pill detail__pill--accent">{getTransactionLabel(tx)}</span>
						{/each}
					{/if}
					{#if item.tags}
						{#each item.tags as tag}
							<span class="detail__pill detail__pill--tag">#{tag}</span>
						{/each}
					{/if}
					{#if item.expires_at}
						<span class="detail__pill detail__pill--expiry">
							Expires {formatRelativeExpiry(item.expires_at, Date.now())}
						</span>
					{/if}
				</div>
			{/if}

			<div class="detail__section">
				<div class="detail__section-header">
					<h3 class="detail__section-title">
						Participants
						<span class="detail__section-count">({item.participants?.length || 0})</span>
					</h3>
					{#if !isHologram}
						<button
							type="button"
							class="detail__add-btn"
							on:click={() => (showAddUserPicker = !showAddUserPicker)}
							disabled={availableUsers.length === 0}
							title={availableUsers.length === 0 ? 'All users already participating' : 'Add participant'}
						>
							<svelte:component this={UserPlus} size="14" />
							<span>{item.type === 'offer' ? 'Accept' : 'Fulfill'}</span>
						</button>
					{/if}
				</div>

				{#if showAddUserPicker && availableUsers.length > 0}
					<div class="detail__user-picker">
						{#if availableUsers.length > 4}
							<input
								type="search"
								bind:value={userSearchQuery}
								placeholder="Search users…"
								class="detail__user-search"
								autocomplete="off"
							/>
						{/if}
						{#each filteredAvailableUsers as user}
							<button
								type="button"
								class="detail__user-row"
								on:click={() => handleAdd(user)}
							>
								<img
									class="detail__user-avatar"
									src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
									alt={resolvedName(user.id, $nameMap, user)}
								/>
								<span class="detail__user-name">
									<DisplayName id={user.id} {user} />
								</span>
							</button>
						{/each}
						{#if filteredAvailableUsers.length === 0}
							<div class="detail__user-empty">No matching users</div>
						{/if}
					</div>
				{/if}

				{#if item.participants?.length > 0}
					<ul class="detail__participants">
						{#each item.participants as p}
							<li class="detail__participant">
								<img
									class="detail__user-avatar"
									src={`https://telegram.holons.io/getavatar?user_id=${p.id}`}
									alt={resolvedName(p.id, $nameMap, { first_name: p.firstName, last_name: p.lastName, username: p.username })}
								/>
								<span class="detail__user-name">
									{resolvedName(p.id, $nameMap, { first_name: p.firstName, last_name: p.lastName, username: p.username })}
								</span>
								{#if !isHologram}
									<button
										type="button"
										class="detail__remove-btn"
										on:click={() => handleRemove(p)}
										aria-label="Remove participant"
										title="Remove participant"
									>
										<svelte:component this={X} size="14" />
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="detail__empty">No participants yet.</p>
				{/if}
			</div>
		</div>

		<svelte:fragment slot="footer">
			<button class="btn btn--secondary" on:click={handleClose}>Close</button>
		</svelte:fragment>
	</Modal>
{/if}

<style>
	.detail__header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
		flex: 1;
	}

	.detail__title-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.detail__type-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		flex-shrink: 0;
	}
	.detail__type-icon--offer {
		background: rgba(16, 185, 129, 0.2);
		color: #6ee7b7;
	}
	.detail__type-icon--request {
		background: rgba(99, 102, 241, 0.2);
		color: #a5b4fc;
	}

	.detail__title {
		font-size: 1.05rem;
		font-weight: 600;
		color: #fff;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail__sub {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #9ca3af;
		font-size: 0.75rem;
		padding-left: 2.25rem;
	}

	.detail__kind {
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	.detail__body {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.detail__initiator {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.detail__avatar {
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 9999px;
		border: 1px solid #4b5563;
		flex-shrink: 0;
	}

	.detail__initiator-text {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.detail__initiator-label {
		font-size: 0.7rem;
		color: #9ca3af;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail__initiator-name {
		font-size: 0.9rem;
		color: #e5e7eb;
		font-weight: 500;
	}

	.detail__description {
		white-space: pre-wrap;
		color: #d1d5db;
		font-size: 0.9rem;
		line-height: 1.55;
		margin: 0;
	}

	.detail__description--empty {
		color: #6b7280;
		font-style: italic;
	}

	.detail__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.detail__pill {
		display: inline-flex;
		align-items: center;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
	}
	.detail__pill--neutral {
		background: rgba(75, 85, 99, 0.4);
		color: #e5e7eb;
	}
	.detail__pill--accent {
		background: rgba(99, 102, 241, 0.25);
		color: #c7d2fe;
	}
	.detail__pill--tag {
		background: rgba(16, 185, 129, 0.2);
		color: #6ee7b7;
	}
	.detail__pill--expiry {
		background: rgba(245, 158, 11, 0.2);
		color: #fcd34d;
	}

	.detail__section {
		border-top: 1px solid #374151;
		padding-top: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
	}

	.detail__section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.detail__section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: #fff;
		margin: 0;
	}

	.detail__section-count {
		color: #9ca3af;
		font-weight: 500;
	}

	.detail__add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 0.75rem;
		border-radius: 0.5rem;
		background: #6366f1;
		color: #fff;
		font-size: 0.8rem;
		font-weight: 500;
		border: none;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.detail__add-btn:hover:not(:disabled) {
		background: #4f46e5;
	}

	.detail__add-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.detail__user-picker {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 14rem;
		overflow-y: auto;
		background: #111827;
		border: 1px solid #374151;
		border-radius: 0.5rem;
		padding: 0.375rem;
	}

	.detail__user-row {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		background: transparent;
		border: none;
		color: #e5e7eb;
		text-align: left;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.detail__user-row:hover {
		background: #1f2937;
	}

	.detail__user-avatar {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		border: 1px solid #4b5563;
		flex-shrink: 0;
	}

	.detail__user-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail__user-search {
		width: 100%;
		background: #0b0f17;
		border: 1px solid #374151;
		border-radius: 0.375rem;
		color: #f9fafb;
		font-size: 0.875rem;
		padding: 0.375rem 0.5rem;
		outline: none;
		margin-bottom: 0.25rem;
	}

	.detail__user-search:focus {
		border-color: #6366f1;
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.detail__user-empty {
		padding: 0.5rem;
		font-size: 0.75rem;
		color: #9ca3af;
		text-align: center;
	}

	.detail__participants {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.detail__participant {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.375rem 0.5rem;
		border-radius: 0.375rem;
		background: #111827;
		color: #e5e7eb;
		font-size: 0.875rem;
	}

	.detail__remove-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		border-radius: 0.375rem;
		background: transparent;
		color: #9ca3af;
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition: background-color 150ms ease, color 150ms ease;
	}

	.detail__remove-btn:hover {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
	}

	.detail__empty {
		color: #6b7280;
		font-style: italic;
		font-size: 0.85rem;
		margin: 0;
	}
</style>
