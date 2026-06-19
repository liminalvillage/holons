<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getColorFromCategory } from '@holons/core/categories';

	/**
	 * Shared visual chrome for every task / quest card. Owns the rules for:
	 *
	 *   • background color derived from category/type
	 *   • completed dim + line-through
	 *   • overdue red hue, intensity scaled by `overdueDays`
	 *   • hologram cyan border + glow
	 *
	 * The shell itself defines a `container` so TaskCard (the content layout)
	 * can use container queries to adapt to whatever width the parent gives it.
	 * Form-factor variants only tweak base radius/padding.
	 */

	type Variant = 'list' | 'kanban' | 'canvas';

	interface CardItem {
		status?: string;
		category?: string;
		type?: string;
		_hologram?: { isHologram?: boolean };
	}

	interface Props {
		item: CardItem;
		variant?: Variant;
		/**
		 * `false` (default) → no overdue treatment.
		 * `number` → days the item is overdue; tints the card red, capped at 7 days.
		 */
		overdueDays?: number | false;
		children: Snippet;
		onclick?: (event: MouseEvent) => void;
		onkeydown?: (event: KeyboardEvent) => void;
		role?: string;
		tabindex?: number;
		ariaLabel?: string;
		extraClass?: string;
	}

	let {
		item,
		variant = 'list',
		overdueDays = false,
		children,
		onclick,
		onkeydown,
		role,
		tabindex,
		ariaLabel,
		extraClass = '',
	}: Props = $props();

	const completed = $derived(item.status === 'completed');
	const hologram = $derived(!!item._hologram?.isHologram);
	const isCanvas = $derived(variant === 'canvas');

	// Card colour follows the item's category in every view. On the canvas a
	// completed note turns green to match the minimap dot.
	const baseBg = $derived(
		completed
			? isCanvas ? '#10b981' : '#374151'
			: getColorFromCategory(item.category, item.type),
	);
	// Red overlay intensity ramps from 0 at "just due" to ~0.55 once a task is
	// a week overdue. Capped so the title stays readable.
	const overdueAlpha = $derived(
		typeof overdueDays === 'number' && overdueDays > 0 && !completed
			? Math.min(0.55, 0.12 + overdueDays * 0.06)
			: 0,
	);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="task-card-shell task-card-shell--{variant} {extraClass}"
	class:is-completed={completed}
	class:is-hologram={hologram}
	style="--card-bg: {baseBg}; --card-overdue-alpha: {overdueAlpha};"
	{onclick}
	{onkeydown}
	{role}
	{tabindex}
	aria-label={ariaLabel}
>
	{@render children()}
</div>

<style>
	.task-card-shell {
		/* Composite the overdue red overlay on top of the category bg so the
		   hologram cyan border (set below) and the base color stay visible. */
		background-color: var(--card-bg);
		background-image: linear-gradient(
			rgba(239, 68, 68, var(--card-overdue-alpha, 0)),
			rgba(239, 68, 68, var(--card-overdue-alpha, 0))
		);
		border: 1px solid transparent;
		border-radius: var(--card-radius);
		padding: var(--card-padding);
		transition: all 0.2s ease;
		cursor: pointer;
		box-sizing: border-box;
		/* Let nested TaskCard use container queries for responsive layout. */
		container-type: inline-size;
	}

	.task-card-shell:hover {
		border-color: rgba(0, 0, 0, 0.12);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		transform: translateY(-1px);
	}

	.task-card-shell--list {
		--card-padding: 0.375rem;
		--card-radius: 0.5rem;
	}
	@media (min-width: 640px) {
		.task-card-shell--list {
			--card-padding: 0.5rem;
			--card-radius: 0.5rem;
		}
	}
	.task-card-shell--kanban {
		--card-padding: 0.5rem;
		--card-radius: 0.5rem;
	}
	.task-card-shell--canvas {
		/* Square "post-it" note (kiosk look & feel). A flex column lets the
		   title fill the card and the footer pin to the bottom; the fixed
		   aspect-ratio keeps the card a constant size whatever its content,
		   which also keeps the dependency arrows (anchored to the card box)
		   aligned when a task is completed. */
		aspect-ratio: 1;
		display: flex;
		flex-direction: column;
		--card-padding: 0.8rem 0.85rem;
		--card-radius: 4px 16px 16px 16px;
		box-shadow:
			1px 6px 10px -3px rgba(28, 48, 46, 0.28),
			0 2px 4px rgba(28, 48, 46, 0.12);
	}
	.task-card-shell--canvas:hover {
		transform: translateY(-2px);
		box-shadow:
			2px 12px 22px -4px rgba(28, 48, 46, 0.34),
			0 3px 6px rgba(28, 48, 46, 0.16);
	}

	.task-card-shell.is-completed {
		opacity: 0.65;
	}
	.task-card-shell.is-completed :global(.card-title),
	.task-card-shell.is-completed :global(h3),
	.task-card-shell.is-completed :global(h4) {
		text-decoration: line-through;
	}

	/* On the canvas, a completed card reads as green (baseBg above, matching the
	   minimap dot) rather than the default dimmed grey, and stays a touch more
	   opaque than other views so the green is obvious once "show completed" is on. */
	.task-card-shell--canvas.is-completed {
		opacity: 0.85;
	}

	.task-card-shell.is-hologram {
		opacity: 0.78;
		border: 2px solid #00bfff;
		box-shadow:
			0 0 20px rgba(0, 191, 255, 0.4),
			inset 0 0 20px rgba(0, 191, 255, 0.1);
	}
	.task-card-shell.is-hologram.is-completed {
		opacity: 0.6;
	}
</style>
