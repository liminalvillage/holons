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
		dependencies?: string[];
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
		!!resolveDependencyTitle && !!quest.dependencies && quest.dependencies.length > 0,
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
	{#if variant === 'canvas'}
		<!-- Canvas "post-it": the title is the hero; a kiosk-style footer carries
		     the appreciation heart and the participant avatars. -->
		<div class="note">
			<h3 class="note-title"><span class="note-title-text">{quest.title}</span></h3>

			{#if quest.picture}
				<img
					class="note-thumb"
					src={resolveImage(quest.picture)}
					alt={quest.title}
					loading="lazy"
					onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
				/>
			{/if}

			{#if quest.category || quest.when}
				<div class="note-meta">
					{#if quest.category}<span class="note-tag">{quest.category}</span>{/if}
					{#if quest.when}<span class="note-when">{formatDate(quest.when)}</span>{/if}
				</div>
			{/if}

			<div class="note-foot">
				<span class="note-heart" class:on={(quest.appreciation?.length ?? 0) > 0}>
					<span class="note-heart-glyph" aria-hidden="true">♥</span>
					{#if quest.appreciation && quest.appreciation.length > 0}
						<span class="note-heart-count">{quest.appreciation.length}</span>
					{/if}
				</span>
				{#if displayedParticipants.length > 0}
					<div
						class="note-avatars"
						title={quest.participants?.map(participantLabel).join(', ') ?? ''}
					>
						{#each displayedParticipants as participant}
							<span class="note-av">
								<span class="note-av-ini">{participantInitial(participant)}</span>
								{#if participant.id}
									<img
										src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
										alt=""
										loading="lazy"
										onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
									/>
								{/if}
							</span>
						{/each}
						{#if extraParticipants > 0}
							<span class="note-av note-av--more"><span class="note-av-ini">+{extraParticipants}</span></span>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else}
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

				{#if quest.when || quest.location}
					<div class="card-title-meta">
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
					{#each quest.dependencies! as depId}
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
	{/if}
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

	/* Title row never wraps: the hologram / source badge stays glued to the
	   end of the title text, while the scheduled time + location pin to the
	   right of the same line. The title truncates with ellipsis when it has to. */
	.card-title-row {
		display: flex;
		flex-wrap: nowrap;
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
		/* Take only the title's content width (shrinking/truncating when long)
		   so the badge sits right after the text instead of being pushed to the
		   far right by a growing title box. */
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Scheduled time + location, pinned to the right edge of the title row. */
	.card-title-meta {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
		padding-left: 0.5rem;
	}

	.card-created {
		font-size: 0.6rem;
		color: var(--color-text-muted);
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
		color: var(--color-text-muted);
		cursor: default;
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
		background-color: var(--color-accent-light);
		color: var(--color-text-primary);
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
		background-color: var(--color-accent-light);
	}

	.avatar-more {
		background-color: #6b7280;
	}

	.card-appreciation {
		font-size: 0.7rem;
		color: #4b5563;
		white-space: nowrap;
	}

	/* ---- Responsive layout via container queries on TaskCardShell ---- */

	/* Narrow form factor (kanban column, mobile list rows): even more compact.
	   Layout stays horizontal so the people column stays pinned right; the
	   title keeps `white-space: nowrap` (set above) so it truncates with an
	   ellipsis and the hologram badge stays glued next to it. */
	@container (max-width: 320px) {
		.card-body {
			gap: 0.375rem;
		}
		.card-thumb {
			width: 1.75rem;
			height: 1.75rem;
		}
		.card-title {
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

	/* ---- Canvas "post-it" note: a title-led layout with a kiosk-style footer
	   (appreciation heart on the left, overlapping participant avatars on the
	   right). The shell is a square flex column, so the title fills the space
	   and the footer pins to the bottom. ---- */
	.note {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		width: 100%;
	}
	.note-title {
		flex: 1 1 auto;
		min-height: 0;
		margin: 0;
		/* Centre the title in the note, both horizontally and vertically. */
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
	}
	.note-title-text {
		max-width: 100%;
		font-size: 2rem;
		font-size: clamp(1.7rem, 13cqw, 2.8rem);
		font-weight: 800;
		line-height: 1.15;
		color: #20302f;
		overflow: hidden;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		overflow-wrap: anywhere;
	}
	.note-thumb {
		flex: 0 0 auto;
		width: 100%;
		max-height: 40%;
		object-fit: cover;
		border-radius: 10px;
		margin-top: 0.45rem;
		background: rgba(0, 0, 0, 0.06);
	}
	.note-meta {
		flex: 0 0 auto;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.note-tag {
		font-size: 0.7rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: rgba(32, 48, 47, 0.55);
	}
	.note-when {
		font-size: 0.72rem;
		font-weight: 700;
		color: #20302f;
		background: rgba(255, 255, 255, 0.55);
		border-radius: 999px;
		padding: 0.1rem 0.55rem;
	}
	.note-foot {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-top: 0.55rem;
	}
	.note-heart {
		flex: 0 0 auto;
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		line-height: 1;
		color: rgba(154, 59, 47, 0.5);
	}
	.note-heart-glyph {
		grid-area: 1 / 1;
		font-size: 1.7rem;
	}
	.note-heart-count {
		grid-area: 1 / 1;
		transform: translateY(0.1em);
		font-size: 0.6rem;
		font-weight: 800;
		color: #fff;
		text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
	}
	.note-heart.on {
		color: #d4493a;
	}
	.note-avatars {
		display: flex;
		align-items: center;
	}
	.note-av {
		flex: 0 0 auto;
		position: relative;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		overflow: hidden;
		background: #34b3a0;
		display: grid;
		place-items: center;
		margin-left: -0.45rem;
		box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.65);
	}
	.note-av:first-child {
		margin-left: 0;
	}
	.note-av-ini {
		font-size: 0.72rem;
		font-weight: 800;
		color: #fff;
	}
	.note-av img {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.note-av--more {
		background: rgba(32, 48, 47, 0.22);
	}
	.note-av--more .note-av-ini {
		color: #20302f;
	}
</style>
