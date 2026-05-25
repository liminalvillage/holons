<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  In-map draggable browser window.

  Opens any URL passed in `url` inside an iframe overlayed on the map. The
  Map component owns this and wires it to the `open-link-in-map-window`
  CustomEvent dispatched by RichDescription, so clicking a link in the
  sidebar (or anywhere else inside the map subtree) opens it here instead
  of in a new tab.

  Two important caveats this UI surfaces explicitly:
    - Most sites set `X-Frame-Options: DENY` or `Content-Security-Policy:
      frame-ancestors` and simply refuse to load in iframes. We can't detect
      this client-side (the load events fire even for blocked content) — so
      the header always carries an "Open externally" button that escapes
      to the system browser.
    - YouTube watch URLs aren't framable, but `/embed/` URLs are. The Map
      component passes its URL through `toEmbeddableUrl()` before binding
      it here, so YouTube links play inline.
-->
<script lang="ts">
	import DraggableWindow from './DraggableWindow.svelte';
	import { ExternalLink } from 'svelte-feathers';

	/** URL to load. Setting to null (or '') hides the window. */
	export let url: string | null = null;
	/** Display title shown in the window header. Falls back to the URL. */
	export let title: string = '';

	$: visible = !!url;
	$: displayTitle = title || url || '';

	function close() {
		url = null;
		title = '';
	}

	function openExternally() {
		if (!url) return;
		window.open(url, '_blank', 'noopener,noreferrer');
	}

	// Default the window roughly into the top-right of the viewport so it
	// doesn't cover the map's centre controls. Mounted only once visible,
	// so this resolves at open-time rather than module-load.
	function initialPosition() {
		if (typeof window === 'undefined') return { x: 100, y: 100 };
		return {
			x: Math.max(40, window.innerWidth - 720),
			y: 96
		};
	}
	$: pos = visible ? initialPosition() : { x: 100, y: 100 };
</script>

{#if visible}
	<DraggableWindow
		title={displayTitle}
		width={680}
		height={500}
		minWidth={360}
		minHeight={280}
		initialX={pos.x}
		initialY={pos.y}
		on:close={close}
	>
		<div class="map-browser">
			<div class="map-browser__bar">
				<span class="map-browser__url" title={url ?? ''}>{url}</span>
				<button
					type="button"
					class="map-browser__external"
					title="Open in system browser"
					on:click={openExternally}
				>
					<ExternalLink size="14" />
					<span>Open externally</span>
				</button>
			</div>
			<iframe
				class="map-browser__frame"
				src={url ?? ''}
				title={displayTitle}
				sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation allow-top-navigation-by-user-activation"
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowfullscreen
			></iframe>
			<noscript>
				<p class="map-browser__noscript">
					Enable JavaScript to load this page inside the window, or use
					"Open externally".
				</p>
			</noscript>
		</div>
	</DraggableWindow>
{/if}

<style>
	.map-browser {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		background: #0b0f17;
	}

	.map-browser__bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 0.6rem;
		background: rgba(20, 26, 36, 0.95);
		border-bottom: 1px solid rgba(255, 255, 255, 0.08);
		font-size: 12px;
		color: #cbd5e1;
		flex-shrink: 0;
	}

	.map-browser__url {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		color: #93c5fd;
	}

	.map-browser__external {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: rgba(96, 165, 250, 0.15);
		color: #93c5fd;
		border: 1px solid rgba(96, 165, 250, 0.25);
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 11px;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.15s ease;
	}
	.map-browser__external:hover {
		background: rgba(96, 165, 250, 0.25);
	}

	.map-browser__frame {
		flex: 1;
		width: 100%;
		border: 0;
		background: #fff;
	}

	.map-browser__noscript {
		padding: 1rem;
		color: #f87171;
		font-size: 12px;
	}
</style>
