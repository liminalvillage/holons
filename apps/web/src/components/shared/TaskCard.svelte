<script lang="ts">
	import { formatDate, formatTime } from '../../utils/date';
	import { resolveImage } from '../../utils/imageServer';
	import SourceBadge from './SourceBadge.svelte';
	import CategoryBadge from './badges/CategoryBadge.svelte';
	import RecurringBadge from './badges/RecurringBadge.svelte';
	import TaskCardShell from './TaskCardShell.svelte';

	/**
	 * Unified card body for a task / quest. Same content + same badges + same
	 * Telegram avatars across the list, kanban and canvas views — the layout
	 * reflows automatically via container queries so it adapts to whatever
	 * width the parent gives it.
	 */

	type Variant = 'list' | 'kanban' | 'canvas';

	interface Participant {
		id?: string | number;
		username?: string;
		firstName?: string;
		lastName?: string;
	}

	interface Quest {
		id?: string | number;
		title: string;
		description?: string;
		when?: string;
		ends?: string;
		created?: string;
		location?: string;
		category?: string;
		picture?: string;
		type?: string;
		status?: string;
		dependsOn?: string[];
		participants?: Participant[];
		appreciation?: unknown[];
		_hologram?: { isHologram?: boolean };
	}

	interface Props {
		quest: Quest;
		variant?: Variant;
		holonID?: string;
		showCreated?: boolean;
		extraClass?: string;
		/**
		 * Look up the title of a dependency task by id. When omitted, the
		 * dependency badges are hidden — used by the canvas variant where
		 * dependencies are drawn as arrows between cards instead.
		 */
		resolveDependencyTitle?: (id: string) => string | undefined;
		onDependencyClick?: (id: string) => void;
		onclick?: (event: MouseEvent) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		role?: string;
		tabindex?: number;
		ariaLabel?: string;
	}

	let {
		quest,
		variant = 'list',
		holonID = '',
		showCreated = false,
		extraClass = '',
		resolveDependencyTitle,
		onDependencyClick,
		onclick,
		onkeydown,
		role,
		tabindex,
		ariaLabel,
	}: Props = $props();

	const showDependencies = $derived(
		!!resolveDependencyTitle && !!quest.dependsOn && quest.dependsOn.length > 0,
	);

	const overdueDays = $derived.by(() => {
		if (!quest.when || quest.status === 'completed') return false as const;
		const due = new Date(quest.when).getTime();
		if (Number.isNaN(due)) return false as const;
		const diffMs = Date.now() - due;
		if (diffMs <= 0) return false as const;
		return diffMs / (24 * 60 * 60 * 1000);
	});

	const isOverdue = $derived(overdueDays !== false);

	const displayedParticipants = $derived(quest.participants?.slice(0, 3) ?? []);
	const extraParticipants = $derived(Math.max(0, (quest.participants?.length ?? 0) - 3));

	function participantLabel(p: Participant): string {
		return `${p.firstName || p.username || ''} ${p.lastName ? p.lastName[0] + '.' : ''}`.trim();
	}

	function participantInitial(p: Participant): string {
		return (p.firstName || p.username || '?').slice(0, 1).toUpperCase();
	}
</script>

<TaskCardShell
	item={quest}
	{variant}
	{overdueDays}
	{onclick}
	{onkeydown}
	{role}
	{tabindex}
	{ariaLabel}
	{extraClass}
>
	<div class="card-body">
		{#if quest.picture}
			<img
				class="card-thumb"
				src={resolveImage(quest.picture)}
				alt={quest.title}
				loading="lazy"
				onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
			/>
		{/if}

		<div class="card-main">
			<div class="card-title-row">
				<h3 class="card-title">{quest.title}</h3>
				<SourceBadge item={quest} currentHolonId={holonID} lensRoute="tasks" />
				<RecurringBadge item={quest} />
				{#if showCreated && quest.created}
					<span class="card-created">Created {formatDate(quest.created)}</span>
				{/if}
			</div>

			{#if quest.category}
				<div class="card-category">
					<CategoryBadge category={quest.category} />
				</div>
			{/if}

			{#if quest.description}
				<p class="card-description">{quest.description}</p>
			{/if}

			{#if showDependencies}
				<div class="card-dependencies">
					<span class="dep-label" aria-hidden="true">📌</span>
					{#each quest.dependsOn! as depId}
						{@const depTitle = resolveDependencyTitle!(depId)}
						{#if depTitle}
							<button
								type="button"
								class="dep-badge"
								title={`Open dependency: ${depTitle}`}
								onclick={(e) => { e.stopPropagation(); onDependencyClick?.(depId); }}
							>
								{depTitle.length > 18 ? depTitle.slice(0, 18) + '…' : depTitle}
							</button>
						{:else}
							<span class="dep-badge dep-badge--missing">Unknown</span>
						{/if}
					{/each}
				</div>
			{/if}

			<div class="card-footer">
				<div class="card-meta">
					{#if quest.when}
						<span class="card-when" class:is-overdue={isOverdue}>
							<svg class="meta-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
								<rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke-width="2"/>
								<line x1="16" y1="2" x2="16" y2="6" stroke-width="2"/>
								<line x1="8" y1="2" x2="8" y2="6" stroke-width="2"/>
								<line x1="3" y1="10" x2="21" y2="10" stroke-width="2"/>
							</svg>
							<span>
								{formatDate(quest.when)}
								<span class="card-when-time">@ {formatTime(quest.when)}{#if quest.ends}–{formatTime(quest.ends)}{/if}</span>
							</span>
						</span>
					{/if}
					{#if quest.location}
						<span class="card-location" title={quest.location}>
							📍 {quest.location.split(',')[0]}
						</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- People column is a sibling of card-main so it pins to the right
		     edge of the card regardless of how narrow the body gets. -->
		<div class="card-people">
			{#if displayedParticipants.length > 0}
				<div
					class="avatars"
					title={quest.participants?.map(participantLabel).join(', ') ?? ''}
				>
					{#each displayedParticipants as participant}
						{#if participant.id}
							<img
								class="avatar"
								src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
								alt={participantLabel(participant)}
								onerror={(e) => {
									const img = e.currentTarget as HTMLImageElement;
									img.style.display = 'none';
									(img.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex');
								}}
							/>
							<div class="avatar avatar-fallback" style="display: none">
								{participantInitial(participant)}
							</div>
						{:else}
							<div class="avatar avatar-fallback">
								{participantInitial(participant)}
							</div>
						{/if}
					{/each}
					{#if extraParticipants > 0}
						<div class="avatar avatar-more">+{extraParticipants}</div>
					{/if}
				</div>
			{/if}

			{#if quest.appreciation && quest.appreciation.length > 0}
				<span
					class="card-appreciation"
					title={`${quest.appreciation.length} appreciations`}
				>
					👍 {quest.appreciation.length}
				</span>
			{/if}
		</div>
	</div>
</TaskCardShell>

<style>
	.card-body {
		display: flex;
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.card-main {
		flex: 1;
		min-width: 0;
	}

	.card-thumb {
		flex-shrink: 0;
		width: 2rem;
		height: 2rem;
		border-radius: 0.375rem;
		object-fit: cover;
		background-color: rgba(0, 0, 0, 0.1);
	}

	.card-title-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin-bottom: 0.125rem;
		min-width: 0;
	}

	.card-title {
		font-size: 0.85rem;
		font-weight: 700;
		color: #1f2937;
		line-height: 1.2;
		margin: 0;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-created {
		font-size: 0.6rem;
		color: #6b7280;
	}

	.card-category {
		margin: 0.125rem 0;
	}

	.card-description {
		font-size: 0.75rem;
		color: #374151;
		margin: 0.125rem 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-height: 1.3;
	}

	.card-dependencies {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		margin: 0.125rem 0 0.125rem 0.75rem; /* indent under title */
	}

	.dep-label {
		font-size: 0.65rem;
		line-height: 1;
		opacity: 0.7;
	}

	.dep-badge {
		display: inline-flex;
		align-items: center;
		padding: 0.075rem 0.375rem;
		font-size: 0.65rem;
		line-height: 1.2;
		background-color: rgba(59, 130, 246, 0.18);
		color: #1d4ed8;
		border: none;
		border-radius: 9999px;
		cursor: pointer;
		max-width: 9rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background-color 120ms ease;
	}
	.dep-badge:hover {
		background-color: rgba(59, 130, 246, 0.32);
	}
	.dep-badge--missing {
		background-color: rgba(0, 0, 0, 0.08);
		color: #6b7280;
		cursor: default;
	}

	.card-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		margin-top: 0.125rem;
	}

	.card-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
	}

	/* Pinned to the right edge of the card-body row at its natural size —
	   never wraps below the main column and never shrinks. */
	.card-people {
		flex: 0 0 auto;
		align-self: center;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		margin-left: 0.375rem;
	}

	.card-when,
	.card-location {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		font-size: 0.65rem;
		color: #4b5563;
		line-height: 1.2;
	}

	.card-when.is-overdue {
		color: #b91c1c;
		font-weight: 600;
	}

	.card-when-time {
		opacity: 0.75;
	}

	.meta-icon {
		width: 0.7rem;
		height: 0.7rem;
		flex-shrink: 0;
	}

	.avatars {
		display: flex;
		flex-direction: row-reverse;
		flex-shrink: 0;
	}

	.avatar {
		flex: 0 0 auto;          /* keep circle, never squashed by flex parent */
		width: 1.5rem;
		height: 1.5rem;
		min-width: 1.5rem;
		min-height: 1.5rem;
		max-width: 1.5rem;
		max-height: 1.5rem;
		border-radius: 50%;
		border: 2px solid white;
		margin-left: -0.375rem;
		object-fit: cover;
		background-color: #6366f1;
		color: white;
		font-size: 0.55rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}

	.avatar:last-child {
		margin-left: 0;
	}

	.avatar-fallback {
		background-color: #6366f1;
	}

	.avatar-more {
		background-color: #9ca3af;
	}

	.card-appreciation {
		font-size: 0.7rem;
		color: #4b5563;
		white-space: nowrap;
	}

	/* ---- Responsive layout via container queries on TaskCardShell ---- */

	/* Narrow form factor (kanban column, mobile list rows): even more compact.
	   Layout stays horizontal so the people column stays pinned right. */
	@container (max-width: 320px) {
		.card-body {
			gap: 0.375rem;
		}
		.card-thumb {
			width: 1.75rem;
			height: 1.75rem;
		}
		.card-title {
			white-space: normal;
			font-size: 0.8rem;
		}
		.avatar {
			width: 1.25rem;
			height: 1.25rem;
			min-width: 1.25rem;
			min-height: 1.25rem;
			max-width: 1.25rem;
			max-height: 1.25rem;
			border-width: 1.5px;
			margin-left: -0.25rem;
		}
	}

	/* Wide form factor (list rows, canvas cards): slightly larger title, but
	   still compact compared to the previous design. */
	@container (min-width: 520px) {
		.card-thumb {
			width: 2.25rem;
			height: 2.25rem;
		}
		.card-title {
			font-size: 0.9rem;
		}
	}
</style>
