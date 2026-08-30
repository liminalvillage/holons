<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import type { HoloSphere, ResolvedHologramMeta, FederationMeta } from "holosphere";
	import { calculateCreditMatrix, expenseCurrency, normalizeCurrency } from "../utils/expenseCalculations";
	import { REAEventFactory } from "@holons/core/rea";
	import { getEventStore } from "../lib/rea/eventStore";

	// Canonical creation timestamp is `created: ISO string` across every
	// shape. Older records may carry the bot's legacy `date` (ms / numeric
	// string) or holons's legacy `timestamp` (ISO); read all three for
	// back-compat so cross-system data sorts/displays correctly.
	function expenseTimestampMs(e: any): number {
		if (typeof e?.created === 'string') {
			const t = Date.parse(e.created);
			if (!Number.isNaN(t)) return t;
		}
		if (typeof e?.date === 'number') return e.date;
		if (typeof e?.date === 'string') {
			const n = parseInt(e.date, 10);
			if (!Number.isNaN(n)) return n;
			const t = Date.parse(e.date);
			if (!Number.isNaN(t)) return t;
		}
		if (typeof e?.timestamp === 'string') {
			const t = Date.parse(e.timestamp);
			if (!Number.isNaN(t)) return t;
		}
		return 0;
	}

	import { resolveImage } from "../utils/imageServer";
	import { Plus } from 'svelte-feathers';
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import TitleBar from "./shared/TitleBar.svelte";
	import { CreditCard } from 'svelte-feathers';
	import GenericImportModal from "./shared/GenericImportModal.svelte";
	import { notifyWriteDenied } from "../lib/stores/writeNotifications";
	import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
	import { goto } from '$app/navigation';
	import { nameMap, resolveName, resolvedName, buildHologramLink, extractHolonIdFromSoul } from '$lib/stores/nameResolver';
	import { showFederated, showHolograms, showUnverified, passesLensFilters } from '$lib/stores/lensFilters';
	import SourceBadge from './shared/SourceBadge.svelte';
	import { subscribeHolonUsers } from '$lib/util/usersWithSelf';

	interface Expense {
		id: string;
		amount: number;
		currency: string;
		description: string;
		paidBy: string;
		splitWith: string[];
		/** Canonical creation timestamp (ISO). */
		created: string;
		picture?: string;
		_hologram?: ResolvedHologramMeta;
		_federation?: FederationMeta;
	}

	interface User {
		id: number | string;
		first_name: string;
	}

	const holosphere = getContext("holosphere") as HoloSphere;

	// Helper to validate ID
	const isValidId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	let holonID = '';
	let expenses: Record<string, Expense> = {};
	let store: Record<string, User> = {};
	// Federated `users` lens overlay (one-shot, federated mode only). Kept
	// separate from the live local `store` so the local subscribe doesn't wipe
	// it; merged into `realUsers` to resolve names of remote-holon participants
	// that appear in federated expenses but aren't in the local users lens.
	let fedUsers: Record<string, User> = {};
	// Currency sources, unioned reactively into `availableCurrencies` so the
	// dropdown always lists every token that appears anywhere: configured in
	// settings, declared in the REA money stream, or used by an expense.
	let settingsCurrencies: string[] = [];
	let reaCurrencies: string[] = [];
	// User ids seen in the REA stream — merged with the `users` lens so the
	// matrix and pickers include everyone who has any economic activity, even
	// members missing from the (often incomplete) users lens.
	let reaUserIds: string[] = [];
	let creditMatrix: number[][] = [];
	let isLoading = true;
	let connectionReady = false;

	// Per-feature filters (search). Federation/hologram toggles are global —
	// see $lib/stores/lensFilters.
	let filters = loadFilters('expenses', {
		searchQuery: '',
		currency: '',
	});
	$: saveFilters('expenses', filters);

	// Restore the last-used currency across reloads. The reactive selection
	// block falls back to the first available currency if this one isn't
	// configured for the current holon.
	let selectedCurrency = filters.currency || '';
	$: if (selectedCurrency && selectedCurrency !== ADD_CURRENCY_SENTINEL && filters.currency !== selectedCurrency) {
		filters.currency = selectedCurrency;
	}

	// Every participant id that appears in the loaded (possibly federated)
	// expense items themselves — the payer plus everyone in the split. This is
	// the authoritative membership for the matrix: anyone with expense activity
	// belongs, even if they're missing from the users lens and the REA stream.
	$: expenseUserIds = (() => {
		const ids = new Set<string>();
		for (const e of Object.values(expenses)) {
			if (e?.paidBy) ids.add(String(e.paidBy));
			for (const id of Array.isArray(e?.splitWith) ? e.splitWith : []) {
				if (id) ids.add(String(id));
			}
		}
		return [...ids];
	})();

	// Real users: the local `users` lens (authoritative names) first, then the
	// federated `users` lens (names for remote-holon participants), then every
	// agent seen in the REA stream and every participant in the (federated)
	// expense items. This covers the full membership even when the local users
	// lens is incomplete. Ids still without a user object resolve their name via
	// the global name map, falling back to the id.
	$: realUsers = (() => {
		const byId = new Map<string, User>();
		for (const u of Object.values(store)) byId.set(String(u.id), u);
		for (const u of Object.values(fedUsers)) {
			const id = String(u.id);
			if (!byId.has(id)) byId.set(id, u);
		}
		for (const id of [...reaUserIds, ...expenseUserIds]) {
			if (id === holonID || byId.has(id)) continue;
			byId.set(id, { id, first_name: resolvedName(id, $nameMap, null, id) });
		}
		return [...byId.values()];
	})();
	// Include "This Holon" as a virtual participant
	$: thisHolonUser = holonID ? { id: holonID as any, first_name: 'This Holon' } : null;
	$: users = thisHolonUser
		? [thisHolonUser, ...realUsers]
		: realUsers;

	// Single lookup for rendering participants as name + avatar everywhere an
	// id would otherwise leak into the UI. Passed explicitly into the helpers
	// so reactive blocks that call them re-run when the user set changes.
	$: usersById = new Map(users.map((u) => [String(u.id), u]));
	const userName = (id: unknown, byId: Map<string, User>): string =>
		byId.get(String(id))?.first_name || String(id ?? '');
	const userInitial = (id: unknown, byId: Map<string, User>): string =>
		(userName(id, byId).trim()[0] || '?').toUpperCase();
	const onAvatarError = (e: Event) => {
		const img = e.currentTarget as HTMLImageElement;
		img.style.display = 'none';
		(img.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'inline-flex');
	};

	// Distinct currencies actually used by loaded expenses.
	$: expenseCurrencyList = Array.from(
		new Set(Object.values(expenses).map((e) => expenseCurrency(e as any)).filter(Boolean)),
	);
	// Union of every currency source (normalized) so the dropdown never misses
	// a token — configured in settings, declared in REA, or used by an expense.
	$: availableCurrencies = Array.from(
		new Set(
			[
				...settingsCurrencies.map((c) => normalizeCurrency(c)),
				...reaCurrencies,
				...expenseCurrencyList,
			].filter(Boolean),
		),
	);

	// Subscription cleanup — populated by queryManager.subscribe and the
	// direct holosphere.subscribe used for the settings doc.
	let unsubscribeFunctions: (() => void)[] = [];
	let subscribedHolonId: string | null = null;
	let subscribedFedFlag: boolean | null = null;
	let expensesFedSub: { unsubscribe: () => void; setFederated: (on: boolean) => void; setLegacy: (on: boolean) => void } | undefined;

	// "Show all data" also folds in legacy Gun-relay records, live.
	let lastExpensesLegacyFlag = $showUnverified;
	$: if ($showUnverified !== lastExpensesLegacyFlag) {
		lastExpensesLegacyFlag = $showUnverified;
		expensesFedSub?.setLegacy($showUnverified);
	}
	let reaRefreshTimer: ReturnType<typeof setTimeout>;

	function cleanupSubscriptions() {
		unsubscribeFunctions.forEach(unsub => {
			try { if (typeof unsub === 'function') unsub(); } catch (e) { }
		});
		unsubscribeFunctions = [];
		subscribedHolonId = null;
		subscribedFedFlag = null;
	}

	// Local-first + progressive load via queryManager.subscribe. The cached
	// snapshot fires synchronously (next microtask) so isLoading clears
	// immediately even when the lens is empty — no more spinner waiting on
	// Gun's `.once()` that never fires on cold empty paths. Federated mode
	// adds a getFederated overlay on top of the local stream.
	function fetchData() {
		if (!isValidId(holonID) || !holosphere || !connectionReady) return;

		const targetHolon = holonID;
		const targetFed = $showFederated;
		if (subscribedHolonId === targetHolon && subscribedFedFlag === targetFed) return;

		cleanupSubscriptions();
		subscribedHolonId = targetHolon;
		subscribedFedFlag = targetFed;
		isLoading = true;
		expenses = {};
		fedUsers = {};
		reaUserIds = [];
		reaCurrencies = [];

		// Expenses stream — one live federation-aware subscription: the local
		// holon's expenses plus inbound partners (tagged `_federation`) when the
		// federation toggle is on, folded in and deduped by HoloSphere. Replaces
		// the local subscribe + one-shot getFederated overlay (and its fragile
		// row-preservation), so federated expenses are now LIVE.
		const expensesSub = holosphere.subscribeFederated(
			targetHolon,
			'expenses',
			(items: any[]) => {
				if (subscribedHolonId !== targetHolon || subscribedFedFlag !== targetFed) return;
				const next: Record<string, Expense> = {};
				for (const item of items as any[]) {
					if (!item?.id) continue;
					const key = item.key || item.id;
					next[key] = item as Expense;
				}
				expenses = next;
				isLoading = false;
			},
			{ includeFederated: targetFed, includeLegacy: $showUnverified }
		);
		expensesFedSub = expensesSub;
		unsubscribeFunctions.push(() => { expensesFedSub = undefined; expensesSub.unsubscribe(); });

		// Users stream
		const usersOff = subscribeHolonUsers({
			holonId: targetHolon,
			onUpdate: (next) => {
				if (subscribedHolonId !== targetHolon) return;
				store = next as Record<string, User>;
			},
			onError: (error) => console.error('[Expenses] users subscribe error:', error)
		});
		unsubscribeFunctions.push(usersOff);

		// REA stream → the complete participant + token sets. One-shot load now,
		// then refresh (debounced) on each rea_events write, mirroring how
		// Status.svelte keeps its REA aggregates live.
		void loadReaDerived(targetHolon);
		const reaSub = holosphere.subscribe(targetHolon, 'rea_events', () => {
			if (subscribedHolonId !== targetHolon) return;
			if (reaRefreshTimer) clearTimeout(reaRefreshTimer);
			reaRefreshTimer = setTimeout(() => void loadReaDerived(targetHolon), 250);
		}) as unknown as { unsubscribe?: () => void } | (() => void);
		if (typeof reaSub === 'function') {
			unsubscribeFunctions.push(reaSub);
		} else if (reaSub && typeof reaSub === 'object' && 'unsubscribe' in reaSub && reaSub.unsubscribe) {
			unsubscribeFunctions.push(reaSub.unsubscribe);
		}

		// Settings is a single document — keep the direct subscribe (no
		// collection-empty hang risk: a per-key subscribe either has the
		// doc or doesn't, no map().on() with no children).
		const settingsSub = holosphere.subscribe(holonID, 'settings', (settings: any) => {
			if (subscribedHolonId !== targetHolon) return;
			if (settings?.currencies && Array.isArray(settings.currencies)) {
				settingsCurrencies = settings.currencies.filter((c: unknown) => typeof c === 'string');
			}
		}) as unknown as { unsubscribe?: () => void } | (() => void);
		if (typeof settingsSub === 'function') {
			unsubscribeFunctions.push(settingsSub);
		} else if (settingsSub && typeof settingsSub === 'object' && 'unsubscribe' in settingsSub && settingsSub.unsubscribe) {
			unsubscribeFunctions.push(settingsSub.unsubscribe);
		}

		// One-shot settings read to seed availableCurrencies and try the
		// orphan-currency merge. Best-effort: if it never resolves (cold
		// node, no peers) the live subscribe above will fill it in later.
		holosphere.get(holonID, 'settings', holonID).then((settingsData: any) => {
			if (subscribedHolonId !== targetHolon) return;
			const stored: string[] = Array.isArray(settingsData?.currencies)
				? settingsData.currencies.filter((c: unknown) => typeof c === 'string')
				: [];
			settingsCurrencies = [...stored];
			void maybeAutoMergeOrphanCurrencies(settingsData || {});
		}).catch((err: unknown) => console.error('[Expenses] settings fetch error:', err));

		// Federated `users` — names for remote-holon participants that show up in
		// federated expenses but aren't in the local users lens. A live
		// partners-only stream (includeLocal:false) that folds in as they resolve;
		// empty when the toggle is off. The expenses federated rows are already
		// covered by the single expenses subscription above.
		if (targetFed) {
			const fedUsersSub = holosphere.subscribeFederated(
				targetHolon,
				'users',
				(items: any[]) => {
					if (subscribedHolonId !== targetHolon || subscribedFedFlag !== targetFed) return;
					const merged: Record<string, User> = {};
					for (const u of items as any[]) {
						if (!u || u.id == null) continue;
						merged[String(u.id)] = u as User;
					}
					fedUsers = merged;
				},
				{ includeLocal: false, includeFederated: true }
			);
			unsubscribeFunctions.push(() => fedUsersSub.unsubscribe());
		}
	}

	async function maybeAutoMergeOrphanCurrencies(currentSettings: any) {
		const stored: string[] = Array.isArray(currentSettings?.currencies)
			? currentSettings.currencies.filter((c: unknown) => typeof c === 'string')
			: [];
		const inExpenses = new Set(
			Object.values(expenses)
				.map(e => expenseCurrency(e as any))
				.filter(c => c && c !== '')
		);
		const orphans = [...inExpenses].filter(c => !stored.map(s => s.toLowerCase()).includes(c));
		if (orphans.length === 0) return;
		const merged = [...new Set([...stored, ...orphans])];
		try {
			await holosphere.put(holonID, 'settings', {
				...(currentSettings || {}),
				id: holonID,
				currencies: merged
			});
			settingsCurrencies = merged;
		} catch (e: any) {
			// No write permission — fall back to displaying the union locally
			// so this user can still operate, but settings stays as-is.
			settingsCurrencies = merged;
			console.warn('[Expenses] Could not auto-merge currencies into settings (likely no write permission):', e?.message);
		}
	}

	// Derive the full participant + token sets from the REA event stream so the
	// matrix/pickers cover everyone with economic activity and the dropdown
	// lists every money token in use — independent of the users lens / settings.
	async function loadReaDerived(targetHolon: string) {
		try {
			const events = await getEventStore(holosphere).getAll(targetHolon);
			if (subscribedHolonId !== targetHolon) return;
			const ids = new Set<string>();
			const currencies = new Set<string>();
			for (const e of events as any[]) {
				for (const agent of [e?.provider, e?.receiver]) {
					if (!agent || agent.id == null) continue;
					if (agent.type === 'holon' || agent.type === 'external') continue;
					const id = String(agent.id);
					if (id && id !== targetHolon) ids.add(id);
				}
				if (e?.resource?.type === 'money' && e?.resource?.unit) {
					const c = normalizeCurrency(String(e.resource.unit));
					if (c) currencies.add(c);
				}
			}
			reaUserIds = [...ids];
			reaCurrencies = [...currencies];
		} catch (err: any) {
			console.warn('[Expenses] REA derive failed:', err?.message ?? err);
		}
	}

	function formatAmount(amount: number): string {
		const code = selectedCurrency?.toUpperCase() || '';
		if (['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'].includes(code)) {
			return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Math.abs(amount));
		}
		return Math.abs(amount).toFixed(2);
	}

	// Reactive: always keep a valid, normalized currency selected. Prefer the
	// remembered selection when it's available; otherwise pick the first
	// available currency. Fall back to 'usd' so the toolbar and add flow are
	// usable on fresh holons with no currencies yet. The ADD sentinel is
	// transient — leave it alone so the add-new prompt can run.
	$: if (selectedCurrency !== ADD_CURRENCY_SENTINEL) {
		const cur = normalizeCurrency(selectedCurrency);
		if (availableCurrencies.length === 0) {
			if (!selectedCurrency) selectedCurrency = 'usd';
		} else if (!cur || !availableCurrencies.includes(cur)) {
			selectedCurrency = availableCurrencies[0];
		} else if (cur !== selectedCurrency) {
			selectedCurrency = cur; // normalize a remembered value to canonical form
		}
	}

	$: filteredExpenses = (() => {
		const want = normalizeCurrency(selectedCurrency || '');
		const q = filters.searchQuery.trim().toLowerCase();
		return Object.values(expenses)
			.filter(e => expenseCurrency(e as any) === want)
			.filter((e: any) => passesLensFilters(e, $showHolograms, $showFederated, $showUnverified))
			.filter((e: any) => {
				if (!q) return true;
				const split = Array.isArray(e.splitWith) ? e.splitWith : [];
				return [
					e.description ?? '',
					e.paidBy ?? '',
					userName(e.paidBy, usersById),
					...split.map((id: string) => userName(id, usersById)),
				].join(' ').toLowerCase().includes(q);
			})
			.sort((a, b) => expenseTimestampMs(b) - expenseTimestampMs(a));
	})();

	// The search box drives the whole view: with a query active, the matrix
	// (and its participant rows/columns, and the stats bar) shrink to the
	// people involved in the matching expenses; without one, full membership.
	$: visibleUsers = (() => {
		if (!filters.searchQuery.trim()) return users;
		const ids = new Set<string>();
		for (const e of filteredExpenses) {
			if (e?.paidBy) ids.add(String(e.paidBy));
			for (const id of Array.isArray(e?.splitWith) ? e.splitWith : []) {
				if (id) ids.add(String(id));
			}
		}
		return users.filter((u) => ids.has(String(u.id)));
	})();

	// Reactive: recompute the credit matrix whenever the currency, the
	// participant set, OR the filtered expenses change — the matrix reflects
	// exactly what the search/lens filters let through, like the list below it.
	$: creditMatrix =
		selectedCurrency && selectedCurrency !== ADD_CURRENCY_SENTINEL && visibleUsers.length > 0
			? calculateCreditMatrix(
					selectedCurrency,
					Object.fromEntries(filteredExpenses.map((e: any, i) => [e.key || e.id || String(i), e])),
					visibleUsers,
				)
			: [];

	$: noCurrenciesAvailable = !isLoading && availableCurrencies.length === 0;

	// Sentinel value used by the currency dropdown's "Add new…" option.
	const ADD_CURRENCY_SENTINEL = '__add_currency__';

	async function persistCurrencyToSettings(newCode: string): Promise<void> {
		if (!holosphere || !holonID) return;
		try {
			const current = (await holosphere.get(holonID, 'settings', holonID)) || {};
			const existing: string[] = Array.isArray((current as any).currencies)
				? (current as any).currencies.filter((c: unknown) => typeof c === 'string')
				: [];
			if (existing.includes(newCode)) return;
			await holosphere.put(holonID, 'settings', {
				...(current as any),
				id: holonID,
				currencies: [...existing, newCode]
			});
		} catch (err: any) {
			if (err?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save currency — no write permission for this holon');
			} else {
				console.warn('Failed to persist currency to settings:', err);
			}
		}
	}

	async function handleCurrencyChange() {
		if (selectedCurrency !== ADD_CURRENCY_SENTINEL) return;

		const previous = availableCurrencies[0] || 'usd';
		const raw = typeof window !== 'undefined' ? window.prompt('New currency code (e.g., euro, yen, btc):') : null;
		const cleaned = normalizeCurrency((raw ?? '').trim());

		if (!cleaned) {
			selectedCurrency = previous;
			return;
		}

		// `availableCurrencies` is derived; seed the new code into the settings
		// source so the union picks it up, and persist it for other clients.
		if (!settingsCurrencies.map((c) => normalizeCurrency(c)).includes(cleaned)) {
			settingsCurrencies = [...settingsCurrencies, cleaned];
			await persistCurrencyToSettings(cleaned);
		}
		selectedCurrency = cleaned;
	}

	onMount(() => {
		const urlId = $page.params.id;
		if (isValidId(urlId)) {
			holonID = urlId;
			ID.set(urlId);
		}

		const checkConnection = async () => {
			if (!holosphere) {
				setTimeout(checkConnection, 100);
				return;
			}

			connectionReady = true;

			let updateTimeout: NodeJS.Timeout;
			const unsubscribe = ID.subscribe((value) => {
				if (isValidId(value)) {
					if (updateTimeout) clearTimeout(updateTimeout);
					updateTimeout = setTimeout(() => {
						if (value !== holonID) {
							holonID = value;
							fetchData();
						}
					}, 100);
				}
			});

			if (isValidId(holonID)) fetchData();

			return () => {
				unsubscribe();
				cleanupSubscriptions();
			};
		};

		checkConnection();
		return () => cleanupSubscriptions();
	});

	let lastExpensesFedFlag = $showFederated;
	$: if (connectionReady && isValidId(holonID) && $showFederated !== lastExpensesFedFlag) {
		lastExpensesFedFlag = $showFederated;
		fetchData();
	}

	let pageUpdateTimeout: NodeJS.Timeout;
	$: {
		const newId = $page.params.id;
		if (isValidId(newId) && newId !== holonID && connectionReady) {
			if (pageUpdateTimeout) clearTimeout(pageUpdateTimeout);
			pageUpdateTimeout = setTimeout(() => {
				holonID = newId;
				ID.set(newId);
				if (holosphere) fetchData();
			}, 100);
		}
	}

	// Add expense functionality
	let showAddExpense = false;
	let newExpense = {
		amount: 0,
		description: '',
		paidBy: '',
		splitWith: [] as string[]
	};

	function openAddExpense() {
		showAddExpense = true;
		// Default to first real user as payer, include all participants in split
		newExpense = {
			amount: 0,
			description: '',
			paidBy: realUsers[0]?.id?.toString() || '',
			splitWith: users.map(u => u.id.toString())
		};
	}

	// Mirror the bot (Expenses.ts): every expense write also emits its REA
	// events (expense:paid + expense:share) so the REA stream is the complete
	// economic log both UIs and scoring read from. Stable ids keyed on
	// expense.id make this idempotent on re-save.
	async function writeExpenseEvents(expense: Expense) {
		try {
			const store = getEventStore(holosphere);
			const events = REAEventFactory.expenseEvents(holonID, expense as any);
			await Promise.all(events.map((e) => store.put(holonID, e)));
		} catch (e: any) {
			console.warn('[Expenses] Failed to write REA events for', expense.id, e?.message ?? e);
		}
	}

	async function saveExpense() {
		if (!holonID || !newExpense.description || !newExpense.amount) return;

		const expense: Expense = {
			id: `expense-${Date.now()}`,
			amount: newExpense.amount,
			currency: selectedCurrency,
			description: newExpense.description,
			paidBy: newExpense.paidBy,
			splitWith: newExpense.splitWith,
			created: new Date().toISOString()
		};

		await holosphere.put(holonID, 'expenses', expense);
		await writeExpenseEvents(expense);
		showAddExpense = false;
	}

	let showImportModal = false;

	async function handleImport(event: CustomEvent<any[]>) {
		if (!holonID) return;
		const items = event.detail;
		const fallbackPayer = realUsers[0]?.id?.toString() || '';
		const allParticipants = users.map(u => u.id.toString());
		try {
			for (let i = 0; i < items.length; i++) {
				const raw = items[i] ?? {};
				const description = String(raw.description ?? raw.title ?? raw.name ?? raw.text ?? '').trim();
				const amount = Number(raw.amount ?? raw.value ?? raw.cost ?? 0);
				if (!description || !Number.isFinite(amount) || amount <= 0) continue;
				const expense: Expense = {
					id: raw.id ?? `expense-${Date.now()}-${i}`,
					amount,
					currency: String(raw.currency ?? selectedCurrency).toLowerCase() || selectedCurrency,
					description,
					paidBy: String(raw.paidBy ?? fallbackPayer),
					splitWith: Array.isArray(raw.splitWith) && raw.splitWith.length > 0
						? raw.splitWith.map(String)
						: allParticipants,
					created: raw.created ?? raw.date ?? new Date().toISOString()
				};
				await holosphere.put(holonID, 'expenses', expense);
				await writeExpenseEvents(expense);
			}
			showImportModal = false;
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error importing expenses:', error);
			}
		}
	}
</script>

<div class="space-y-4">
	<TitleBar
		holonName={resolvedName(holonID, $nameMap, null, 'Expenses')}
		holonId={holonID}
		showLensFilters
		title="Expenses"
		icon={CreditCard}
	/>

	<div class="expenses-container">
	<!-- Stats Bar (sits above the toolbar like every other lens) -->
	{#if selectedCurrency && users.length > 0}
		<div class="stats-bar mb-4">
			<div class="stats-bar__item">
				<span class="stats-bar__value">{visibleUsers.length}</span>
				<span class="stats-bar__label">Participants</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--info">
				<span class="stats-bar__value">{filteredExpenses.length}</span>
				<span class="stats-bar__label">Expenses</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--warning">
				<span class="stats-bar__value">{formatAmount(filteredExpenses.reduce((sum, e) => sum + e.amount, 0))}</span>
				<span class="stats-bar__label">Total</span>
			</div>
		</div>
	{/if}

	<FeatureToolbar
		onAdd={openAddExpense}
		addLabel="Add Expense"
		onImport={() => (showImportModal = true)}
		importLabel="Import"
		bind:searchQuery={filters.searchQuery}
		searchPlaceholder="Search expenses…"
	>
		<svelte:fragment slot="filters">
			<select
				bind:value={selectedCurrency}
				onchange={handleCurrencyChange}
				class="filter-select"
				aria-label="Currency"
			>
				{#each availableCurrencies as currency}
					<option value={currency}>{currency.toUpperCase()}</option>
				{/each}
				<option disabled value="__sep__">──────────</option>
				<option value={ADD_CURRENCY_SENTINEL}>+ Add new…</option>
			</select>
		</svelte:fragment>
	</FeatureToolbar>

	{#if isLoading}
		<div class="loading">
			<div class="spinner"></div>
			<p>Loading expenses...</p>
		</div>
	{:else if noCurrenciesAvailable}
		<div class="empty-state">
			<i class="fas fa-coins"></i>
			<h3>No Expenses Yet</h3>
			<p>Start by adding some expenses to track spending and balances.</p>
		</div>
	{:else if selectedCurrency}
		{#if visibleUsers.length === 0}
			<div class="empty-state">
				<i class="fas fa-search"></i>
				<h3>No Matching Expenses</h3>
				<p>No expenses match "{filters.searchQuery}" — try a different search.</p>
			</div>
		{:else}
		<!-- Credits Table -->
		<div class="table-container">
			<table>
				<thead>
					<tr>
						<th class="corner-cell">
							<div class="corner-labels">
								<span>Owes ↓</span>
								<span>Is Owed →</span>
							</div>
						</th>
						{#each visibleUsers as user}
							<th class="user-header">
								<span>{user.first_name}</span>
							</th>
						{/each}
						<th class="balance-header">Balance</th>
					</tr>
				</thead>
				<tbody>
					{#each visibleUsers as user, rowIndex}
						{@const rowBalance = creditMatrix[rowIndex]?.reduce((sum, val) => sum + val, 0) || 0}
						<tr>
							<th class="row-header">
								<span class="user-chip">
									<img
										class="user-avatar"
										src={`/api/avatar?user_id=${user.id}`}
										alt=""
										loading="lazy"
										onerror={onAvatarError}
									/>
									<span class="user-avatar user-avatar--fallback" style="display: none">{userInitial(user.id, usersById)}</span>
									{user.first_name}
								</span>
							</th>
							{#each creditMatrix[rowIndex] || [] as credit}
								<td class="credit-cell" class:positive={credit > 0} class:negative={credit < 0}>
									{credit !== 0 ? formatAmount(credit) : '—'}
								</td>
							{/each}
							<td class="balance-cell" class:positive={rowBalance > 0} class:negative={rowBalance < 0}>
								{formatAmount(rowBalance)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Recent Expenses -->
		{#if filteredExpenses.length > 0}
			<div class="recent-expenses">
				<h3>Recent Expenses</h3>
				<div class="expense-list">
					{#each filteredExpenses as expense}
						<div class="expense-card">
							{#if expense.picture}
								<img
									src={resolveImage(expense.picture)}
									alt={expense.description}
									class="expense-thumb"
									loading="lazy"
									onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
								/>
							{/if}
							<div class="expense-info">
								<h4>
									{expense.description}
									<SourceBadge item={expense} currentHolonId={holonID} lensRoute="expenses" />
								</h4>
								<p class="paid-by">
									Paid by
									<span class="user-chip">
										<img
											class="user-avatar"
											src={`/api/avatar?user_id=${expense.paidBy}`}
											alt=""
											loading="lazy"
											onerror={onAvatarError}
										/>
										<span class="user-avatar user-avatar--fallback" style="display: none">{userInitial(expense.paidBy, usersById)}</span>
										{userName(expense.paidBy, usersById)}
									</span>
								</p>
								<p class="split-with">
									Split:
									{#each (Array.isArray(expense.splitWith) ? expense.splitWith : []) as id}
										<span class="user-chip">
											<img
												class="user-avatar user-avatar--sm"
												src={`/api/avatar?user_id=${id}`}
												alt=""
												loading="lazy"
												onerror={onAvatarError}
											/>
											<span class="user-avatar user-avatar--sm user-avatar--fallback" style="display: none">{userInitial(id, usersById)}</span>
											{userName(id, usersById)}
										</span>
									{/each}
								</p>
							</div>
							<div class="expense-amount">
								<span class="amount">{formatAmount(expense.amount)}</span>
								<span class="date">{new Date(expenseTimestampMs(expense)).toLocaleDateString()}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
		{/if}
	{/if}
	</div>
</div>

<!-- Add Expense Modal -->
{#if showAddExpense}
	<div
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={() => showAddExpense = false}
		role="button"
		tabindex="0"
		aria-label="Close modal"
		onkeydown={(e) => e.key === 'Escape' && (showAddExpense = false)}
	>
		<div
			class="bg-gray-800 rounded-2xl w-full max-w-md max-h-[90vh] flex flex-col shadow-xl"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="0"
		>
			<!-- Header with editable title -->
			<div class="p-6 border-b border-gray-700">
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<input
							type="text"
							bind:value={newExpense.description}
							placeholder="Expense title..."
							class="w-full text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-gray-600 focus:border-indigo-500 outline-none transition-colors pb-1"
						/>
						<p class="text-sm text-gray-400 mt-1">
							{selectedCurrency.toUpperCase()} • {new Date().toLocaleDateString()}
						</p>
					</div>
					<button
						class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700 transition-colors"
						onclick={() => showAddExpense = false}
						aria-label="Close"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Body -->
			<div class="p-6 overflow-y-auto flex-1 space-y-4">
				<div class="bg-gray-700/30 p-4 rounded-xl">
					<label class="text-sm font-medium text-gray-300 mb-2 block">Amount
					<div class="flex items-center gap-2">
						<span class="text-gray-400 text-lg">{selectedCurrency.toUpperCase()}</span>
						<input
							type="number"
							bind:value={newExpense.amount}
							step="0.01"
							min="0"
							placeholder="0.00"
							class="flex-1 text-2xl font-bold text-white bg-transparent border-none outline-none"
						/>
					</div>
				</label>
				</div>

				<div class="bg-gray-700/30 p-4 rounded-xl">
					<label class="text-sm font-medium text-gray-300 mb-2 block">Paid By
					<select
						bind:value={newExpense.paidBy}
						class="w-full bg-gray-700 text-white rounded-lg border border-gray-600 p-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-colors"
					>
						{#each users as user}
							<option value={user.id.toString()}>{user.first_name}</option>
						{/each}
					</select>
				</label>
				</div>

				<div class="bg-gray-700/30 p-4 rounded-xl">
					<span class="text-sm font-medium text-gray-300 mb-3 block">Split With</span>
					<div class="flex flex-wrap gap-2">
						{#each users as user}
							<label class="inline-flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors {newExpense.splitWith.includes(user.id.toString()) ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/50' : 'bg-gray-700 text-gray-300 border border-gray-600 hover:border-gray-500'}">
								<input
									type="checkbox"
									value={user.id.toString()}
									checked={newExpense.splitWith.includes(user.id.toString())}
									onchange={(e) => {
										const userId = user.id.toString();
										if ((e.target as HTMLInputElement).checked) {
											newExpense.splitWith = [...newExpense.splitWith, userId];
										} else {
											newExpense.splitWith = newExpense.splitWith.filter(id => id !== userId);
										}
									}}
									class="sr-only"
								/>
								<img
									class="w-5 h-5 rounded-full object-cover"
									src={`/api/avatar?user_id=${user.id}`}
									alt=""
									loading="lazy"
									onerror={onAvatarError}
								/>
								<span class="w-5 h-5 rounded-full bg-gray-600 text-gray-200 text-xs font-semibold items-center justify-center" style="display: none">{userInitial(user.id, usersById)}</span>
								{user.first_name}
							</label>
						{/each}
					</div>
				</div>
			</div>

			<!-- Footer -->
			<div class="p-6 border-t border-gray-700 flex justify-end gap-3">
				<button class="btn btn--secondary" onclick={() => showAddExpense = false}>Cancel</button>
				<button
					class="btn btn--primary"
					onclick={saveExpense}
					disabled={!newExpense.description || !newExpense.amount}
				>
					<Plus size="16" />
					Add Expense
				</button>
			</div>
		</div>
	</div>
{/if}

<GenericImportModal
	bind:open={showImportModal}
	title="Import Expenses"
	itemNoun="expenses"
	helpText="Paste a JSON array of expenses or one description per line. Required: description, amount."
	sampleJson={`[
  {
    "description": "Groceries",
    "amount": 42.50,
    "currency": "usd",
    "paidBy": "user-id-1",
    "splitWith": ["user-id-1", "user-id-2"],
    "date": "2026-04-30T12:00:00.000Z"
  },
  {
    "description": "Coffee run",
    "amount": 8.75
  }
]`}
	on:import={handleImport}
	on:close={() => (showImportModal = false)}
/>

<style>
	.expenses-container {
		background: var(--color-bg-secondary);
		border-radius: 1.5rem;
		padding: 1.5rem;
	}

	.loading, .empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: var(--color-text-muted);
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(59, 130, 246, 0.2);
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.empty-state i {
		font-size: 3rem;
		color: #4b5563;
		margin-bottom: 1rem;
	}

	.empty-state h3 {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.5rem;
	}

	.empty-state p {
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Table */
	.table-container {
		overflow-x: auto;
		border-radius: 0.75rem;
		border: 1px solid var(--color-bg-tertiary);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th, td {
		padding: 0.75rem;
		text-align: center;
		border-bottom: 1px solid var(--color-bg-tertiary);
	}

	thead th {
		background: var(--color-bg-primary);
		color: var(--color-text-muted);
		font-weight: 600;
		text-transform: uppercase;
		font-size: 0.75rem;
		letter-spacing: 0.05em;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.corner-cell {
		position: sticky;
		left: 0;
		z-index: 20;
		background: var(--color-bg-primary);
		min-width: 100px;
	}

	.corner-labels {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.625rem;
	}

	.user-header {
		min-width: 80px;
		vertical-align: bottom;
		height: 80px;
	}

	.user-header span {
		display: block;
		transform: rotate(-45deg);
		transform-origin: center;
		white-space: nowrap;
	}

	.balance-header {
		background: var(--color-bg-secondary);
		border-left: 2px solid var(--color-border-light);
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.row-header {
		position: sticky;
		left: 0;
		background: var(--color-bg-secondary);
		text-align: left;
		font-weight: 500;
		color: var(--color-text-primary);
		z-index: 5;
	}

	tbody tr:nth-child(even) {
		background: var(--color-bg-tertiary);
	}

	tbody tr:nth-child(even) .row-header {
		background: var(--color-bg-secondary);
	}

	tbody tr:hover {
		background: var(--color-accent-subtle);
	}

	.credit-cell {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.credit-cell.positive { color: var(--color-success); }
	.credit-cell.negative { color: var(--color-error); }

	.balance-cell {
		border-left: 2px solid var(--color-border-light);
		font-weight: 700;
		background: var(--color-bg-tertiary);
	}

	.balance-cell.positive { color: var(--color-success); }
	.balance-cell.negative { color: var(--color-error); }

	/* Recent Expenses */
	.recent-expenses {
		margin-top: 2rem;
	}

	.recent-expenses h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 1rem;
	}

	.expense-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Same surface as the shared `.list-row` (components.css) so an expense
	   reads like every other row in the dashboard. */
	.expense-card {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.7rem;
		background: var(--color-bg-secondary);
		border: 1.5px solid var(--color-border);
		box-shadow: var(--shadow-sm);
		padding: 0.6rem 0.8rem;
		border-radius: 14px;
		transition: all 0.2s ease;
	}
	.expense-card:hover {
		border-color: var(--color-border-light);
		box-shadow: var(--shadow-md);
	}

	.expense-thumb {
		width: 3rem;
		height: 3rem;
		border-radius: 0.5rem;
		object-fit: cover;
		flex-shrink: 0;
		background: rgba(0, 0, 0, 0.2);
	}

	.expense-info {
		flex: 1;
		min-width: 0;
	}

	.expense-info h4 {
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.25rem;
	}

	.paid-by {
		color: var(--color-text-secondary);
		font-size: 0.875rem;
		margin: 0 0 0.25rem;
	}

	.split-with {
		color: var(--color-text-muted);
		font-size: 0.75rem;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.5rem;
	}

	/* Participant name + avatar, used in the matrix row headers and cards */
	.user-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		white-space: nowrap;
	}

	.user-avatar {
		width: 1.375rem;
		height: 1.375rem;
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
		background: var(--color-bg-primary);
	}

	.user-avatar--sm {
		width: 1rem;
		height: 1rem;
	}

	.user-avatar--fallback {
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: 0.625rem;
		font-weight: 600;
	}

	.expense-amount {
		text-align: right;
	}

	.amount {
		display: block;
		font-size: 1.125rem;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.date {
		font-size: 0.75rem;
		color: var(--color-text-muted);
	}

	@media (max-width: 640px) {
		.expenses-container {
			padding: 1rem;
			border-radius: 1rem;
		}

		.expense-card {
			flex-direction: column;
			gap: 0.75rem;
		}

		.expense-amount {
			text-align: left;
		}
	}


</style>
