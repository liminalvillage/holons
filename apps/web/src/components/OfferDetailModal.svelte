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
	/** The logged-in user's id — drives claim/handoff affordances. */
	export let selfId: string | null = null;
	/** Folded handoff-confirm records for the quests lens (core needs). */
	export let handoffConfirmations: Record<string, { requesterAt?: string; providerAt?: string }> = {};
	/** Feedback from the parent's last claim/handoff attempt (e.g. bad code). */
	export let handoffNotice: string = '';

	const dispatch = createEventDispatcher<{
		close: void;
		addParticipant: { item: any; user: any };
		removeParticipant: { item: any; user: any };
		respond: { item: any; message: string; price: number | null };
		claim: { item: any; responseId: string };
		handoffConfirm: { item: any; party: 'requester' | 'provider'; code?: string };
	}>();

	// Needs-network state (see @holons/core/needs): needs carry a lifecycle
	// status and embedded provider responses.
	const NEED_STATUS_LABELS: Record<string, string> = {
		requested: 'Requested',
		offered: 'Offers received',
		claimed: 'Claimed',
		fulfilled: 'Fulfilled',
		cancelled: 'Cancelled',
	};
	let showRespondForm = false;
	let respondMessage = '';
	let respondPrice = '';
	$: isNeed = item?.type === 'need';
	$: needStatus = isNeed && typeof item?.status === 'string' && NEED_STATUS_LABELS[item.status]
		? item.status
		: null;
	$: needOpen = isNeed && (needStatus === 'requested' || needStatus === 'offered' || !needStatus);
	$: needResponses = isNeed && Array.isArray(item?.responses) ? item.responses : [];
	// Claim + two-sided handoff (see @holons/core/needs). "Mine" is decided by
	// the initiator, not by where the record was found — a need reached through
	// federation still belongs to its initiator.
	$: isMineNeed = isNeed && selfId != null && String(item?.initiator?.id ?? '') === String(selfId);
	$: acceptedNeedResponse = isNeed
		? needResponses.find((r: any) => r.id === item?.claimedResponseId)
		: null;
	$: iAmNeedProvider = Boolean(
		acceptedNeedResponse && selfId != null &&
		String(acceptedNeedResponse.responder?.id ?? '') === String(selfId)
	);
	$: needConfirms = handoffConfirmations[String(item?.id ?? '')] ?? {};
	$: requesterConfirmed = Boolean(needConfirms.requesterAt || item?.handoff?.requesterAt);
	$: providerConfirmed = Boolean(needConfirms.providerAt || item?.handoff?.providerAt);
	let handoffCodeInput = '';
	$: if (handoffCodeInput) handoffNotice = '';

	function submitResponse() {
		// bind:value on a number input yields a number (or undefined when empty).
		const raw = String(respondPrice ?? '').trim();
		const price = raw === '' ? null : Number(raw);
		dispatch('respond', {
			item,
			message: respondMessage.trim(),
			price: price != null && !Number.isNaN(price) ? price : null,
		});
		showRespondForm = false;
		respondMessage = '';
		respondPrice = '';
	}

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
		showRespondForm = false;
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
							src={`/api/avatar?user_id=${item.initiator.id}`}
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

			{#if needStatus}
				<div class="detail__meta">
					<span class="detail__pill detail__pill--status detail__pill--status-{needStatus}">
						{NEED_STATUS_LABELS[needStatus]}
					</span>
					{#if item.hex}
						<span class="detail__pill detail__pill--neutral" title="Published on the public map at this hex">
							📍 {String(item.hex).slice(0, 10)}…
						</span>
					{/if}
				</div>
			{/if}

			{#if isNeed}
				<div class="detail__section">
					<div class="detail__section-header">
						<h3 class="detail__section-title">
							Responses
							<span class="detail__section-count">({needResponses.length})</span>
						</h3>
						{#if needOpen}
							<button
								type="button"
								class="detail__add-btn"
								on:click={() => (showRespondForm = !showRespondForm)}
							>
								<svelte:component this={UserPlus} size="14" />
								<span>Respond</span>
							</button>
						{/if}
					</div>

					{#if showRespondForm}
						<form class="detail__respond-form" on:submit|preventDefault={submitResponse}>
							<textarea
								bind:value={respondMessage}
								placeholder="What can you provide, and when?"
								rows="2"
								class="detail__respond-input"
							></textarea>
							<div class="detail__respond-row">
								<input
									type="number"
									step="any"
									min="0"
									bind:value={respondPrice}
									placeholder="Price (optional, market price)"
									class="detail__respond-input detail__respond-price"
								/>
								<button type="submit" class="btn btn--primary" disabled={!respondMessage.trim() && String(respondPrice ?? '').trim() === ''}>
									Send response
								</button>
							</div>
						</form>
					{/if}

					{#if needResponses.length > 0}
						<ul class="detail__participants">
							{#each needResponses as response (response.id)}
								<li class="detail__participant detail__response">
									<img
										class="detail__user-avatar"
										src={`/api/avatar?user_id=${response.responder?.id}`}
										alt={response.responder?.name || 'Responder'}
									/>
									<div class="detail__response-body">
										<span class="detail__user-name">
											{response.responder?.name || resolvedName(response.responder?.id, $nameMap, null, 'Provider')}
										</span>
										{#if response.message}
											<span class="detail__response-message">{response.message}</span>
										{/if}
									</div>
									{#if response.price != null}
										<span class="detail__pill detail__pill--accent">
											{response.price}{response.currency ? ` ${response.currency}` : ''}
										</span>
									{/if}
									{#if item.claimedResponseId === response.id}
										<span class="detail__pill detail__pill--status-fulfilled">accepted</span>
									{:else if isMineNeed && needStatus === 'offered'}
										<button
											type="button"
											class="btn btn--primary detail__accept-btn"
											on:click={() => dispatch('claim', { item, responseId: response.id })}
										>
											Accept
										</button>
									{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="detail__empty">No responses yet — nearby providers will see this need.</p>
					{/if}
				</div>

				{#if needStatus === 'claimed' && (isMineNeed || iAmNeedProvider)}
					<div class="detail__section">
						<h3 class="detail__section-title">Handoff</h3>
						{#if isMineNeed}
							<p class="detail__handoff-hint">
								Show this code at the handoff — the provider types it in on their side.
								Hours move once both of you have confirmed.
							</p>
							<div class="detail__handoff-code">{item.handoff?.code ?? '····'}</div>
							{#if requesterConfirmed}
								<p class="detail__empty">
									Your confirmation is recorded{providerConfirmed ? '.' : ' — waiting for the provider.'}
								</p>
							{:else}
								<button
									type="button"
									class="btn btn--primary"
									on:click={() => dispatch('handoffConfirm', { item, party: 'requester' })}
								>
									Confirm the handoff
								</button>
							{/if}
						{:else}
							{#if providerConfirmed}
								<p class="detail__empty">Code accepted — the hours move when the requester confirms.</p>
							{:else}
								<p class="detail__handoff-hint">
									Type in the short code on the requester's screen — that's your side of the confirmation.
								</p>
								<form
									class="detail__respond-row"
									on:submit|preventDefault={() =>
										dispatch('handoffConfirm', { item, party: 'provider', code: handoffCodeInput })}
								>
									<input
										bind:value={handoffCodeInput}
										maxlength="4"
										placeholder="Code"
										autocapitalize="characters"
										class="detail__respond-input detail__handoff-input"
									/>
									<button
										type="submit"
										class="btn btn--primary"
										disabled={handoffCodeInput.trim().length < 3}
									>
										Confirm handoff
									</button>
								</form>
							{/if}
						{/if}
						{#if handoffNotice}
							<p class="detail__handoff-notice">{handoffNotice}</p>
						{/if}
						<p class="detail__empty">
							Requester {requesterConfirmed ? '✓' : 'pending'} · Provider {providerConfirmed ? '✓' : 'pending'}
						</p>
					</div>
				{/if}
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
									src={`/api/avatar?user_id=${user.id}`}
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
									src={`/api/avatar?user_id=${p.id}`}
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
		color: var(--color-text-primary);
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail__sub {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-text-muted);
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
		border: 1px solid var(--color-border-light);
		flex-shrink: 0;
	}

	.detail__initiator-text {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.detail__initiator-label {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.detail__initiator-name {
		font-size: 0.9rem;
		color: var(--color-text-secondary);
		font-weight: 500;
	}

	.detail__description {
		white-space: pre-wrap;
		color: var(--color-text-secondary);
		font-size: 0.9rem;
		line-height: 1.55;
		margin: 0;
	}

	.detail__description--empty {
		color: var(--color-text-muted);
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
		color: var(--color-text-secondary);
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
		border-top: 1px solid var(--color-bg-tertiary);
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
		color: var(--color-text-primary);
		margin: 0;
	}

	.detail__section-count {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.detail__add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.4rem 0.75rem;
		border-radius: 0.5rem;
		background: var(--color-accent-light);
		color: var(--color-text-primary);
		font-size: 0.8rem;
		font-weight: 500;
		border: none;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.detail__add-btn:hover:not(:disabled) {
		background: var(--color-accent);
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
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
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
		color: var(--color-text-secondary);
		text-align: left;
		font-size: 0.875rem;
		cursor: pointer;
		transition: background-color 150ms ease;
	}

	.detail__user-row:hover {
		background: var(--color-bg-secondary);
	}

	.detail__user-avatar {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		border: 1px solid var(--color-border-light);
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
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.375rem;
		color: #f9fafb;
		font-size: 0.875rem;
		padding: 0.375rem 0.5rem;
		outline: none;
		margin-bottom: 0.25rem;
	}

	.detail__user-search:focus {
		border-color: var(--color-accent-light);
		box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
	}

	.detail__user-empty {
		padding: 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-muted);
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
		background: var(--color-bg-primary);
		color: var(--color-text-secondary);
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
		color: var(--color-text-muted);
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
		color: var(--color-text-muted);
		font-style: italic;
		font-size: 0.85rem;
		margin: 0;
	}

	/* Needs-network additions */
	.detail__pill--status {
		background: rgba(75, 85, 99, 0.4);
		color: var(--color-text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.7rem;
	}
	.detail__pill--status-requested {
		background: rgba(99, 102, 241, 0.25);
		color: #c7d2fe;
	}
	.detail__pill--status-offered {
		background: rgba(245, 158, 11, 0.25);
		color: #fcd34d;
	}
	.detail__pill--status-fulfilled {
		background: rgba(16, 185, 129, 0.25);
		color: #6ee7b7;
	}
	.detail__pill--status-cancelled {
		background: rgba(239, 68, 68, 0.2);
		color: #fca5a5;
	}

	.detail__respond-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.detail__respond-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.detail__respond-input {
		width: 100%;
		background: var(--color-bg-primary);
		border: 1px solid var(--color-bg-tertiary);
		border-radius: 0.5rem;
		color: var(--color-text-primary);
		font-size: 0.875rem;
		padding: 0.5rem 0.625rem;
		outline: none;
		resize: vertical;
	}

	.detail__respond-input:focus {
		border-color: var(--color-accent-light);
	}

	.detail__respond-price {
		flex: 1;
	}

	.detail__response {
		align-items: flex-start;
	}

	.detail__response-body {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1;
		min-width: 0;
	}

	.detail__response-message {
		font-size: 0.8rem;
		color: var(--color-text-muted);
		white-space: pre-wrap;
	}

	.detail__accept-btn {
		flex-shrink: 0;
		font-size: 0.8rem;
		padding: 0.35rem 0.75rem;
	}

	.detail__handoff-hint {
		font-size: 0.85rem;
		color: var(--color-text-secondary);
		margin: 0;
	}

	.detail__handoff-code {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: 0.35em;
		text-align: center;
		padding: 0.5rem 0;
		color: #fcd34d;
		background: rgba(245, 158, 11, 0.12);
		border-radius: 0.5rem;
	}

	.detail__handoff-input {
		max-width: 8rem;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.25em;
		font-weight: 700;
	}

	.detail__handoff-notice {
		font-size: 0.8rem;
		color: #fca5a5;
		margin: 0;
	}
</style>
