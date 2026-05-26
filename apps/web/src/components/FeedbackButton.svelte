<script lang="ts">
	// Floating feedback button. Always pinned to the bottom-right corner so
	// users can jump to the @HolonicDAO Telegram chat from anywhere in the
	// dashboard. Opens in a new tab — using rel="noopener" so the t.me page
	// can't reach back into window.opener.
	const FEEDBACK_URL = 'https://t.me/HolonicDAO';
</script>

<a
	class="feedback-button"
	href={FEEDBACK_URL}
	target="_blank"
	rel="noopener noreferrer"
	title="Send feedback — opens the @HolonicDAO Telegram chat"
	aria-label="Send feedback on Telegram"
>
	<svg
		class="feedback-button__icon"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<!-- Speech-bubble glyph. Self-contained SVG so the button works
		     without depending on FontAwesome / svelte-feathers being loaded. -->
		<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
	</svg>
	<span class="feedback-button__label">Feedback</span>
</a>

<style>
	.feedback-button {
		position: fixed;
		bottom: 1.25rem;
		right: 1.25rem;
		z-index: 9999;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 1rem;
		background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); /* blue-600 → blue-700 */
		color: #ffffff;
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 9999px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.45), 0 4px 10px rgba(37, 99, 235, 0.35);
		font-size: 0.875rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
	}

	.feedback-button:hover {
		background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%); /* blue-700 → blue-900 */
		transform: translateY(-1px);
		box-shadow: 0 14px 32px -6px rgba(0, 0, 0, 0.5), 0 6px 14px rgba(37, 99, 235, 0.45);
	}

	.feedback-button:active {
		transform: translateY(0);
	}

	.feedback-button:focus-visible {
		outline: 2px solid #93c5fd;
		outline-offset: 2px;
	}

	.feedback-button__icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	/* Collapse to icon-only on narrow viewports so the floating button
	   doesn't fight content for horizontal space. */
	@media (max-width: 640px) {
		.feedback-button {
			padding: 0.625rem;
			bottom: 1rem;
			right: 1rem;
		}

		.feedback-button__label {
			display: none;
		}
	}
</style>
