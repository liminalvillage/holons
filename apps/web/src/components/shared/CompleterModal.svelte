<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	//
	// Confirm who actually took part before a completion is recorded. The
	// participant set drives the REA accounting, so every completion path in the
	// dashboard routes through here first: the people already on the task come
	// pre-ticked (untick whoever didn't show up), and the rest of the holon's
	// members are listed below so late helpers can be added.
	//
	// Mirrors the kiosk's CompleteConfirm — same rule, same result.
	import { createEventDispatcher } from 'svelte';
	import Modal from './Modal.svelte';
	import DisplayName from './DisplayName.svelte';
	import type { Quest, QuestParticipant } from '@holons/core/tasks';

	/** Open state — the parent owns it. */
	export let open: boolean = false;
	/** The task being completed; its `participants` seed the ticked rows. */
	export let quest: Quest | null = null;
	/** Holosphere instance used to read the holon's `users` lens. */
	export let holosphere: any = null;
	export let holonID: string = '';
	/**
	 * The person doing the completing. On a task nobody had joined they are
	 * pre-ticked — completing it is the claim that they did it, and requiring a
	 * join step first would be busywork. With a team already on the task they
	 * start unticked, so closing it out for others never quietly credits you.
	 */
	export let selfId: string = '';
	export let confirmLabel: string = 'Complete';

	const dispatch = createEventDispatcher<{
		confirm: { participants: QuestParticipant[] };
		cancel: void;
	}>();

	type Row = {
		key: string;
		on: boolean;
		/** Pre-existing participant records are preserved verbatim on confirm. */
		participant: QuestParticipant;
		/** True for holon members who were not on the task yet. */
		added: boolean;
	};

	let rows: Row[] = [];
	let loading = false;
	let search = '';
	/** The quest the current `rows` were built from — guards the rebuild loop. */
	let builtFor: Quest | null = null;

	$: if (open && quest && quest !== builtFor) {
		builtFor = quest;
		search = '';
		void build(quest);
	}
	$: if (!open && builtFor) builtFor = null;

	function nameOf(p: any): string {
		return `${p?.first_name || p?.firstName || ''} ${p?.last_name || p?.lastName || ''} ${p?.username || ''}`
			.trim()
			.toLowerCase();
	}

	async function build(q: Quest) {
		const list = (Array.isArray(q.participants) ? q.participants : []) as QuestParticipant[];
		rows = list.map((p, i) => ({
			key: String(p?.id ?? p?.username ?? `p${i}`),
			on: true,
			participant: p,
			added: false
		}));
		// Nobody joined yet ⇒ the completer is the doer (see `selfId`).
		const seedSelf = rows.length === 0 && !!selfId;
		if (!holosphere || !holonID) {
			if (seedSelf) rows = [{ key: selfId, on: true, added: true, participant: { id: selfId } }];
			return;
		}
		loading = true;
		try {
			// holosphere.getAll resolves to Array<T>.
			const users = (await holosphere.getAll(holonID, 'users')) ?? [];
			// Ignore a response that arrived after the modal moved on.
			if (builtFor !== q) return;
			const known = new Set(rows.map((r) => String(r.participant?.id)));
			const extra: Row[] = (users as any[])
				.filter((u) => u?.id != null && !known.has(String(u.id)))
				.map((u) => ({
					key: String(u.id),
					on: false,
					added: true,
					participant: {
						id: u.id,
						firstName: u.first_name ?? u.firstName,
						lastName: u.last_name ?? u.lastName,
						username: u.username
					}
				}))
				.sort((a, b) => nameOf(a.participant).localeCompare(nameOf(b.participant)));
			if (seedSelf) {
				const self = extra.find((r) => String(r.participant.id) === selfId);
				if (self) self.on = true;
				// Not a member of this holon's `users` lens — still offer the row.
				else extra.unshift({ key: selfId, on: true, added: true, participant: { id: selfId } });
			}
			rows = [...rows, ...extra];
		} catch (error) {
			console.error('[CompleterModal] could not load holon members:', error);
		} finally {
			loading = false;
		}
	}

	// Search filters only the unticked members below the fold — anyone who would
	// be credited stays visible, so a search can never hide a ticked row.
	$: visibleRows = (() => {
		const q = search.trim().toLowerCase();
		if (!q) return rows;
		return rows.filter((r) => !r.added || r.on || nameOf(r.participant).includes(q));
	})();

	$: selectedCount = rows.filter((r) => r.on).length;

	function toggle(key: string) {
		rows = rows.map((r) => (r.key === key ? { ...r, on: !r.on } : r));
	}

	function cancel() {
		dispatch('cancel');
	}

	function confirm() {
		dispatch('confirm', { participants: rows.filter((r) => r.on).map((r) => r.participant) });
	}
</script>

<Modal {open} title="Who took part?" size="md" on:close={cancel}>
	{#if quest}
		<p class="text-gray-300 mb-1 font-medium truncate">"{quest.title}"</p>
	{/if}
	<p class="text-gray-400 text-sm mb-3">
		Untick anyone who didn't take part — only the people left ticked get the contribution.
	</p>

	{#if rows.length > 6 || search}
		<input
			type="search"
			class="w-full mb-2 px-3 py-2 rounded-lg bg-gray-700 text-gray-100 placeholder-gray-400 text-sm border border-gray-600 focus:outline-none focus:border-indigo-500"
			placeholder="Search members…"
			bind:value={search}
			autocomplete="off"
		/>
	{/if}

	<div class="max-h-72 overflow-y-auto space-y-1 overscroll-contain">
		{#each visibleRows as row (row.key)}
			<button
				type="button"
				class="w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left touch-manipulation select-none active:scale-[0.98] min-h-[52px] {row.on
					? 'bg-green-500/20 border border-green-500/40'
					: 'bg-gray-700 hover:bg-gray-600 border border-transparent'}"
				role="switch"
				aria-checked={row.on}
				on:click={() => toggle(row.key)}
			>
				<div
					class="w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors {row.on
						? 'bg-green-500 border-green-500'
						: 'border-gray-500'}"
				>
					{#if row.on}
						<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
						</svg>
					{/if}
				</div>
				{#if row.participant?.id != null}
					<img
						src={`/api/avatar?user_id=${row.participant.id}`}
						alt=""
						class="w-9 h-9 rounded-full flex-shrink-0"
						loading="lazy"
					/>
				{/if}
				<span class="min-w-0 text-gray-100 font-medium truncate">
					<DisplayName id={String(row.participant?.id ?? '')} user={row.participant} />
				</span>
			</button>
		{/each}

		{#if loading}
			<div class="flex items-center justify-center py-4">
				<div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
				<span class="text-gray-400 text-xs ml-2">Loading members…</span>
			</div>
		{:else if visibleRows.length === 0}
			<p class="text-gray-500 text-sm py-6 text-center">
				{search ? 'No matching members' : 'No users in this holon'}
			</p>
		{/if}
	</div>

	<svelte:fragment slot="footer">
		<button type="button" class="btn btn--secondary flex-1" on:click={cancel}>Cancel</button>
		<button
			type="button"
			class="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
			disabled={selectedCount === 0}
			on:click={confirm}
		>
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
			</svg>
			{confirmLabel} ({selectedCount})
		</button>
	</svelte:fragment>
</Modal>
