<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
	import {
		sanitizeRichDescription,
		looksLikeHtml,
		extractYoutubeId
	} from '$lib/util/richContent';

	/** Raw HTML-or-text description (CDATA from KML, free-text from forms, etc.). */
	export let html: string | null | undefined = '';
	/** Optional max-height for the rendered block; useful in compact list cards. */
	export let maxHeight: string | null = null;
	/** Add an inline overflow-y:auto so long content scrolls inside `maxHeight`. */
	export let scroll: boolean = false;

	$: cleaned = sanitizeRichDescription(html);
	$: isHtml = looksLikeHtml(html);

	// Escape user-supplied strings before pasting them into the inline-player
	// template's attributes. The href that survives DOMPurify's anchor pass
	// is already URL-shaped but may contain quotes if the source author was
	// creative — better safe than sorry, since this string lands inside
	// `data-rich-popout="..."`.
	function escapeAttr(value: string): string {
		return value.replace(/[&<>"']/g, (c) =>
			({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
		);
	}

	// Build the inline-player block that replaces an anchor when its href is
	// YouTube. The toolbar gets `data-rich-popout` / `data-rich-external` /
	// `data-rich-close` so the delegated click handler can recognise them
	// without rebinding per node.
	//
	// `origin=<our origin>` is appended to the embed URL — YouTube validates
	// it against its embed allow-rules and some video configs return Error
	// 153 ("video player configuration error") without it. Even with origin,
	// videos whose uploader disabled embedding can't be played here — that's
	// what the "↗ Open on YouTube" button is for: a guaranteed escape to
	// the system browser via the original watch URL.
	function buildInlinePlayer(href: string, videoId: string): string {
		const safeHref = escapeAttr(href);
		const safeId = escapeAttr(videoId);
		const origin =
			typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
		const safeOrigin = escapeAttr(encodeURIComponent(origin));
		const originParam = origin ? `&origin=${safeOrigin}` : '';
		return `<div class="rich-inline-player" data-original-href="${safeHref}">
			<div class="rich-inline-player__bar">
				<button type="button" data-rich-external="${safeHref}" title="Open on YouTube" class="rich-inline-player__btn">↗</button>
				<button type="button" data-rich-popout="${safeHref}" title="Pop out to draggable window" class="rich-inline-player__btn">⤴</button>
				<button type="button" data-rich-close="1" title="Close player" class="rich-inline-player__btn">✕</button>
			</div>
			<div class="rich-embed">
				<iframe src="https://www.youtube.com/embed/${safeId}?autoplay=1&rel=0&modestbranding=1&playsinline=1${originParam}"
					title="YouTube video player"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowfullscreen
					loading="lazy"></iframe>
			</div>
		</div>`;
	}

	function restoreAnchor(playerEl: Element): void {
		const originalHref = playerEl.getAttribute('data-original-href');
		if (!originalHref) {
			playerEl.remove();
			return;
		}
		const anchor = playerEl.ownerDocument.createElement('a');
		anchor.setAttribute('href', originalHref);
		anchor.setAttribute('target', '_blank');
		anchor.setAttribute('rel', 'noopener noreferrer');
		anchor.textContent = originalHref;
		playerEl.replaceWith(anchor);
	}

	// Delegated click handler attached to the wrapper. Three orthogonal
	// cases: a click on the toolbar's pop-out button, a click on the
	// toolbar's close button, or a click on an anchor.
	//
	// We use stopPropagation for any anchor/toolbar click so the parent card
	// (which is itself a clickable button in MapSidebar) doesn't also open
	// the view modal.
	function handleClick(event: MouseEvent) {
		const target = event.target as HTMLElement | null;

		// 1. Pop-out button on an existing inline player.
		const popoutBtn = target?.closest('button[data-rich-popout]') as HTMLElement | null;
		if (popoutBtn) {
			event.preventDefault();
			event.stopPropagation();
			const url = popoutBtn.getAttribute('data-rich-popout');
			if (!url) return;
			// Ask the Map (or any ancestor) to take this URL into its
			// draggable window. dispatchEvent returns false when a listener
			// called preventDefault — that's our signal that the pop-out
			// was handled and we can close the inline player.
			const handled = !popoutBtn.dispatchEvent(
				new CustomEvent('open-link-in-map-window', {
					bubbles: true,
					composed: true,
					cancelable: true,
					detail: { url, title: url }
				})
			);
			if (handled) {
				const wrap = popoutBtn.closest('.rich-inline-player');
				if (wrap) restoreAnchor(wrap);
			}
			return;
		}

		// 2. "Open on YouTube" — guaranteed escape to the system browser for
		//    videos whose uploader disabled embedding (Error 153). Uses
		//    target="_blank" via window.open so the new tab isn't subject
		//    to any iframe sandbox in our ancestor chain.
		const externalBtn = target?.closest('button[data-rich-external]') as HTMLElement | null;
		if (externalBtn) {
			event.preventDefault();
			event.stopPropagation();
			const url = externalBtn.getAttribute('data-rich-external');
			if (url) window.open(url, '_blank', 'noopener,noreferrer');
			return;
		}

		// 3. Close button on an existing inline player.
		const closeBtn = target?.closest('button[data-rich-close]') as HTMLElement | null;
		if (closeBtn) {
			event.preventDefault();
			event.stopPropagation();
			const wrap = closeBtn.closest('.rich-inline-player');
			if (wrap) restoreAnchor(wrap);
			return;
		}

		// 3. Anchor click — YouTube anchors swap in place into an inline
		//    player; everything else routes to the in-map draggable browser.
		const anchor = target?.closest('a') as HTMLAnchorElement | null;
		if (!anchor) return;
		event.stopPropagation();

		const href = anchor.getAttribute('href') ?? '';
		if (!/^https?:\/\//i.test(href)) return;

		const ytId = extractYoutubeId(href);
		if (ytId) {
			event.preventDefault();
			const placeholder = anchor.ownerDocument.createElement('div');
			placeholder.innerHTML = buildInlinePlayer(href, ytId);
			const playerEl = placeholder.firstElementChild;
			if (playerEl) anchor.replaceWith(playerEl);
			return;
		}

		const opened = anchor.dispatchEvent(
			new CustomEvent('open-link-in-map-window', {
				bubbles: true,
				composed: true,
				cancelable: true,
				detail: {
					url: href,
					title: anchor.textContent?.trim() || href
				}
			})
		);
		if (!opened) event.preventDefault();
	}
</script>

<div
	class="rich-description"
	class:rich-description--scroll={scroll}
	style:max-height={maxHeight}
	on:click={handleClick}
	role="presentation"
>
	{#if cleaned}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- content is sanitized via DOMPurify in richContent.ts -->
		{@html cleaned}
	{:else if !isHtml && html}
		<p>{html}</p>
	{/if}
</div>

<style>
	.rich-description {
		color: inherit;
		font-size: 0.875rem;
		line-height: 1.4;
		word-break: break-word;
	}
	.rich-description--scroll {
		overflow-y: auto;
	}

	.rich-description :global(p) {
		margin: 0 0 0.5rem 0;
	}
	.rich-description :global(p:last-child) {
		margin-bottom: 0;
	}

	.rich-description :global(a) {
		color: #93c5fd;
		text-decoration: underline;
	}
	.rich-description :global(a:hover) {
		color: #bfdbfe;
	}

	/* Inline images cap at the card width, never overflow, and keep aspect.
	   Forced rounded corners + slight border so they read as previews. */
	.rich-description :global(img) {
		max-width: 100%;
		height: auto;
		display: inline-block;
		border-radius: 0.5rem;
		border: 1px solid rgba(255, 255, 255, 0.08);
		margin: 0.25rem 0;
	}

	/* Responsive 16:9 wrapper for any iframe that survived sanitization.
	   The wrapper is injected in sanitizeRichDescription() so callers don't
	   have to author it themselves. */
	.rich-description :global(.rich-embed) {
		position: relative;
		width: 100%;
		padding-top: 56.25%; /* 16:9 */
		margin: 0.5rem 0;
		background: #000;
		border-radius: 0.5rem;
		overflow: hidden;
	}
	.rich-description :global(.rich-embed iframe) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		border: 0;
	}

	/* Inline YouTube player block — built on the fly by handleClick when a
	   YouTube anchor is activated. Toolbar floats top-right above the iframe;
	   pointer-events:auto is implicit on the buttons. */
	.rich-description :global(.rich-inline-player) {
		position: relative;
		margin: 0.5rem 0;
	}
	.rich-description :global(.rich-inline-player .rich-embed) {
		margin: 0;
	}
	.rich-description :global(.rich-inline-player__bar) {
		position: absolute;
		top: 6px;
		right: 6px;
		z-index: 3;
		display: flex;
		gap: 2px;
		padding: 2px;
		background: rgba(0, 0, 0, 0.55);
		border-radius: 6px;
	}
	.rich-description :global(.rich-inline-player__btn) {
		background: transparent;
		border: 0;
		color: white;
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 4px;
		transition: background 0.15s ease;
	}
	.rich-description :global(.rich-inline-player__btn:hover) {
		background: rgba(255, 255, 255, 0.18);
	}
</style>
