<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// Text-input agent widget for the dashboard — the kiosk voice widget's
	// input-only sibling. Probes the local @holons/voice-ui server and renders
	// nothing unless one is reachable; when it is, a floating ⌨ button opens a
	// panel where a request (or a pasted transcript) is typed and run through
	// the same agent pipeline (LLM + Holons MCP tools). No microphone and no
	// audio playback — TTS frames from the server are ignored.
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { ID } from '../dashboard/store';

	const WS_URL = (import.meta.env.VITE_VOICE_WS_URL as string | undefined) ?? 'ws://localhost:8787';
	/** Views the agent may navigate to (each is a /[id]/<view> route). */
	const NAV_VIEWS = [
		'dashboard',
		'tasks',
		'calendar',
		'checklists',
		'shopping',
		'library',
		'roles',
		'expenses',
		'events',
		'map',
		'schedule',
		'settings'
	];
	/** How often to re-probe for a server while none is reachable. */
	const RETRY_MS = 30_000;
	/** How long the reply bubble lingers after the agent answers. */
	const BUBBLE_LINGER_MS = 12_000;

	let available = $state(false);
	let panelOpen = $state(false);
	let thinking = $state(false);
	let typed = $state('');
	let youSaid = $state('');
	let agentSaid = $state('');
	let activeTool = $state<string | null>(null);
	let bubbleOpen = $state(false);

	let ws: WebSocket | null = null;
	let retryTimer: ReturnType<typeof setTimeout> | null = null;
	let bubbleTimer: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	function showBubble() {
		bubbleOpen = true;
		if (bubbleTimer) clearTimeout(bubbleTimer);
		bubbleTimer = null;
	}
	function armBubbleFade() {
		if (bubbleTimer) clearTimeout(bubbleTimer);
		bubbleTimer = setTimeout(() => {
			bubbleOpen = false;
			bubbleTimer = null;
		}, BUBBLE_LINGER_MS);
	}

	function uiContext(): Record<string, string> {
		const ctx: Record<string, string> = { app: 'holons' };
		const holon = $ID;
		if (holon) ctx.holon = holon;
		// Route id like "/[id]/tasks" → view "tasks" ("dashboard" at the root).
		const route = $page.route.id ?? '';
		const view = route.split('/').filter((s) => s && !s.startsWith('[')).pop();
		ctx.view = view || 'dashboard';
		// Advertise where the agent may send us — the server validates
		// ui_navigate calls against this list.
		if (holon) ctx.views = NAV_VIEWS.join(',');
		try {
			ctx.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		} catch {
			/* leave unset — server falls back to its own zone */
		}
		return ctx;
	}

	function connect() {
		if (destroyed || ws) return;
		let sock: WebSocket;
		try {
			sock = new WebSocket(WS_URL);
		} catch {
			scheduleRetry();
			return;
		}
		sock.onmessage = onServerMessage;
		sock.onopen = () => {
			ws = sock;
		};
		sock.onclose = () => {
			if (ws === sock) ws = null;
			available = false;
			thinking = false;
			scheduleRetry();
		};
	}
	function scheduleRetry() {
		if (destroyed || retryTimer) return;
		retryTimer = setTimeout(() => {
			retryTimer = null;
			connect();
		}, RETRY_MS);
	}

	function onServerMessage(ev: MessageEvent) {
		let msg: Record<string, unknown>;
		try {
			msg = JSON.parse(ev.data as string);
		} catch {
			return;
		}
		switch (msg.type) {
			case 'ready':
				available = true;
				// Announce where we are so the server pre-warms this holon's data.
				ws?.send(JSON.stringify({ type: 'context', context: uiContext() }));
				// Text-only widget: tell the server not to synthesize TTS at all.
				ws?.send(JSON.stringify({ type: 'mute', muted: true }));
				break;
			case 'tool':
				activeTool = String(msg.name);
				showBubble();
				break;
			case 'assistant':
				activeTool = null;
				thinking = false;
				agentSaid = String(msg.text);
				showBubble();
				armBubbleFade();
				break;
			case 'navigate': {
				// Agent-driven view switch (the ui_navigate tool). Server already
				// validated against NAV_VIEWS; re-check anyway before routing.
				const view = String(msg.view ?? '');
				const holon = $ID;
				if (holon && NAV_VIEWS.includes(view)) void goto(`/${holon}/${view}`);
				break;
			}
			case 'error':
				activeTool = null;
				thinking = false;
				agentSaid = `⚠ ${String(msg.message)}`;
				showBubble();
				armBubbleFade();
				break;
			// 'transcript', 'tts_start', 'tts', 'tts_end': voice-only — ignored.
		}
	}

	function send() {
		const text = typed.trim();
		if (!text || !ws || !available) return;
		ws.send(JSON.stringify({ type: 'text', text, context: uiContext() }));
		typed = '';
		youSaid = text;
		agentSaid = '';
		thinking = true;
		showBubble();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	onMount(() => {
		connect();
	});
	onDestroy(() => {
		destroyed = true;
		if (retryTimer) clearTimeout(retryTimer);
		if (bubbleTimer) clearTimeout(bubbleTimer);
		ws?.close();
		ws = null;
	});
</script>

{#if available && $ID}
	<div class="assistant">
		{#if bubbleOpen && (youSaid || agentSaid || activeTool || thinking)}
			<div class="bubble" role="status">
				{#if youSaid}<p class="you">“{youSaid}”</p>{/if}
				{#if thinking}
					<p class="tool">
						{activeTool ? `⚙ ${activeTool}` : 'working'}
						<span class="dots"><i></i><i></i><i></i></span>
					</p>
				{/if}
				{#if agentSaid}<p class="agent">{agentSaid}</p>{/if}
			</div>
		{/if}
		{#if panelOpen}
			<div class="panel">
				<textarea
					bind:value={typed}
					rows="4"
					placeholder="Ask or paste a transcript… (Enter to send)"
					onkeydown={onKeydown}
				></textarea>
				<div class="actions">
					<button class="send" onclick={send} disabled={!typed.trim() || thinking}>
						{thinking ? 'Working…' : 'Send'}
					</button>
					<button class="cancel" onclick={() => (panelOpen = false)}>Close</button>
				</div>
			</div>
		{/if}
		<button
			class="toggle"
			class:open={panelOpen}
			aria-label="Ask the Holons agent"
			title="Ask the Holons agent"
			onclick={() => (panelOpen = !panelOpen)}
		>
			⌨
		</button>
	</div>
{/if}

<style>
	.assistant {
		position: fixed;
		right: 1.3rem;
		bottom: 1.3rem;
		z-index: 80;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.6rem;
	}

	.toggle {
		width: 3.4rem;
		height: 3.4rem;
		border-radius: 50%;
		border: 0;
		font-size: 1.5rem;
		line-height: 1;
		color: var(--color-text-primary, #fff);
		background: var(--color-accent, #4f46e5);
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.45);
		display: grid;
		place-items: center;
		cursor: pointer;
		transition:
			transform 0.12s ease,
			background 0.15s ease;
	}
	.toggle:active {
		transform: scale(0.92);
	}
	.toggle.open,
	.toggle:hover {
		background: var(--color-accent-hover, #4338ca);
	}

	.bubble,
	.panel {
		width: min(24rem, calc(100vw - 3rem));
		background: var(--color-surface, #1f2937);
		color: var(--color-text-primary, #fff);
		border: 1px solid var(--color-border, #374151);
		border-radius: 14px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
		padding: 0.8rem 0.95rem;
		font-size: 0.95rem;
		line-height: 1.45;
	}
	.bubble p {
		margin: 0;
	}
	.bubble p + p {
		margin-top: 0.35rem;
	}
	.bubble .you {
		color: var(--color-text-secondary, #9ca3af);
		font-style: italic;
	}
	.bubble .tool {
		color: var(--color-text-secondary, #9ca3af);
		font-size: 0.85rem;
	}
	.bubble .agent {
		font-weight: 600;
	}
	.dots {
		display: inline-flex;
		gap: 3px;
		margin-left: 4px;
		vertical-align: baseline;
	}
	.dots i {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--color-text-secondary, #9ca3af);
		animation: agent-dot 1.1s ease-in-out infinite;
	}
	.dots i:nth-child(2) {
		animation-delay: 0.18s;
	}
	.dots i:nth-child(3) {
		animation-delay: 0.36s;
	}
	@keyframes agent-dot {
		0%,
		60%,
		100% {
			transform: translateY(0);
			opacity: 0.4;
		}
		30% {
			transform: translateY(-4px);
			opacity: 1;
		}
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.panel textarea {
		width: 100%;
		resize: vertical;
		border: 1px solid var(--color-border, #374151);
		border-radius: 10px;
		padding: 0.6rem 0.7rem;
		font: inherit;
		font-size: 0.95rem;
		color: var(--color-text-primary, #fff);
		background: var(--color-background, #111827);
	}
	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}
	.actions button {
		min-height: 38px;
		padding: 0 1.1rem;
		border-radius: 10px;
		border: 0;
		font-weight: 700;
		cursor: pointer;
	}
	.actions .send {
		background: var(--color-accent, #4f46e5);
		color: var(--color-text-primary, #fff);
	}
	.actions .send:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.actions .cancel {
		background: var(--color-border, #374151);
		color: var(--color-text-primary, #fff);
	}
</style>
