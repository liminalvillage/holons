<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import type { HoloSphere } from "holosphere";
	import { calculateCreditMatrix } from "../utils/expenseCalculations";
	import { resolveImage } from "../utils/imageServer";
	import { Plus } from 'svelte-feathers';
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import { loadFilters, saveFilters } from '$lib/util/persistedFilters';

	interface Expense {
		id: string;
		amount: number;
		currency: string;
		description: string;
		paidBy: string;
		splitWith: string[];
		date: string;
		picture?: string;
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
	let selectedCurrency = '';
	let availableCurrencies: string[] = [];
	let creditMatrix: number[][] = [];
	let isLoading = true;
	let connectionReady = false;

	// Shared toolbar state — search + federated + hologram toggles mirror the
	// other features; the currency dropdown still lives in the filters slot.
	let filters = loadFilters('expenses', {
		searchQuery: '',
		showFederated: false,
		showHolograms: true,
	});
	$: saveFilters('expenses', filters);

	// Real users from store (excluding the holon)
	$: realUsers = Object.values(store);
	// Include "This Holon" as a virtual participant
	$: thisHolonUser = holonID ? { id: holonID as any, first_name: 'This Holon' } : null;
	$: users = thisHolonUser
		? [thisHolonUser, ...realUsers]
		: realUsers;

	// Subscription cleanup
	let unsubscribeFunctions: (() => void)[] = [];

	function cleanupSubscriptions() {
		unsubscribeFunctions.forEach(unsub => {
			try { if (typeof unsub === 'function') unsub(); } catch (e) { }
		});
		unsubscribeFunctions = [];
	}

	// Main data fetch - gets initial data then sets up subscriptions
	async function fetchData() {
		if (!isValidId(holonID) || !holosphere || !connectionReady) return;

		isLoading = true;
		cleanupSubscriptions();

		try {
			// Fetch all data in parallel first
			const [expensesData, usersData, settingsData] = await Promise.allSettled([
				holosphere.getAll(holonID, "expenses"),
				holosphere.getAll(holonID, "users"),
				holosphere.get(holonID, "settings", holonID)
			]);

			// Process expenses
			if (expensesData.status === 'fulfilled' && expensesData.value) {
				const data = expensesData.value;
				expenses = {};
				if (Array.isArray(data)) {
					data.forEach((item: any) => {
						if (item?.id) expenses[item.id] = item;
					});
				} else if (typeof data === 'object') {
					Object.entries(data).forEach(([key, value]: [string, any]) => {
						if (value) expenses[key] = value;
					});
				}
			}

			// Process users
			if (usersData.status === 'fulfilled' && usersData.value) {
				const data = usersData.value;
				store = {};
				if (Array.isArray(data)) {
					data.forEach((item: any) => {
						if (item?.id) store[item.id] = item;
					});
				} else if (typeof data === 'object') {
					Object.entries(data).forEach(([key, value]: [string, any]) => {
						if (value) store[value.id || key] = value;
					});
				}
			}

			// Process settings for currencies
			if (settingsData.status === 'fulfilled' && settingsData.value?.currencies) {
				availableCurrencies = settingsData.value.currencies.filter((c: unknown) => typeof c === 'string');
			} else {
				// Derive from expenses
				deriveCurrenciesFromExpenses();
			}

			// Set up subscriptions for real-time updates (don't await)
			setupSubscriptions();

		} catch (error) {
			console.error('Error fetching expenses data:', error);
		} finally {
			isLoading = false;
		}
	}

	// Set up subscriptions for real-time updates
	function setupSubscriptions() {
		if (!holosphere || !isValidId(holonID)) return;

		// Expenses subscription
		holosphere.subscribe(holonID, "expenses", (newItem: any, key?: string) => {
			if (typeof key !== 'string') return;
			if (newItem && !newItem._deleted) {
				expenses[key] = newItem;
			} else {
				delete expenses[key];
			}
			expenses = { ...expenses };
			deriveCurrenciesFromExpenses();
		});

		// Users subscription
		holosphere.subscribe(holonID, "users", (newUser: any, key?: string) => {
			if (typeof key !== 'string') return;
			if (newUser && !newUser._deleted) {
				store[newUser.id || key] = newUser;
			} else {
				delete store[key];
			}
			store = { ...store };
		});

		// Settings subscription
		holosphere.subscribe(holonID, "settings", (settings: any) => {
			if (settings?.currencies && Array.isArray(settings.currencies)) {
				availableCurrencies = settings.currencies.filter((c: unknown) => typeof c === 'string');
			}
		});
	}

	function deriveCurrenciesFromExpenses() {
		const derived = [...new Set(
			Object.values(expenses)
				.map(e => e?.currency)
				.filter((c): c is string => typeof c === 'string' && c !== '')
		)];
		if (derived.length > 0 && availableCurrencies.length === 0) {
			availableCurrencies = derived;
		}
	}

	function calculateCredits(currency: string) {
		if (!currency || users.length === 0) {
			creditMatrix = [];
			return;
		}
		creditMatrix = calculateCreditMatrix(currency, expenses, users);
	}

	function formatAmount(amount: number): string {
		const code = selectedCurrency?.toUpperCase() || '';
		if (['EUR', 'USD', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'].includes(code)) {
			return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(Math.abs(amount));
		}
		return Math.abs(amount).toFixed(2);
	}

	// Reactive: set initial currency. Fall back to USD so the toolbar and add
	// flow are usable on fresh holons that don't have currencies configured yet.
	$: if (!selectedCurrency) {
		if (availableCurrencies.length > 0) {
			selectedCurrency = availableCurrencies[0];
		} else {
			selectedCurrency = 'USD';
			availableCurrencies = ['USD'];
		}
	}

	// Reactive: calculate credits when currency or users change
	$: if (selectedCurrency && users.length > 0) {
		calculateCredits(selectedCurrency);
	}

	$: filteredExpenses = Object.values(expenses)
		.filter(e => e.currency === selectedCurrency)
		.filter((e: any) => {
			const isHologram = e?._hologram?.isHologram === true;
			if (!filters.showHolograms && isHologram) return false;
			if (!filters.showFederated && isHologram) return false;
			const q = filters.searchQuery.trim().toLowerCase();
			if (!q) return true;
			return `${e.description ?? ''} ${e.paidBy ?? ''}`.toLowerCase().includes(q);
		})
		.sort((a, b) => parseInt(b.date) - parseInt(a.date));

	$: noCurrenciesAvailable = !isLoading && availableCurrencies.length === 0;

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

	async function saveExpense() {
		if (!holonID || !newExpense.description || !newExpense.amount) return;

		const expense: Expense = {
			id: `expense-${Date.now()}`,
			amount: newExpense.amount,
			currency: selectedCurrency,
			description: newExpense.description,
			paidBy: newExpense.paidBy,
			splitWith: newExpense.splitWith,
			date: new Date().toISOString()
		};

		await holosphere.put(holonID, 'expenses', expense);
		showAddExpense = false;
	}
</script>

<div class="expenses-container">
	<div class="header">
		<h2>Expenses</h2>
	</div>

	<FeatureToolbar
		onAdd={openAddExpense}
		addLabel="Add Expense"
		bind:searchQuery={filters.searchQuery}
		searchPlaceholder="Search expenses…"
		bind:showFederated={filters.showFederated}
		bind:showHolograms={filters.showHolograms}
	>
		<svelte:fragment slot="filters">
			{#if availableCurrencies.length > 1}
				<select bind:value={selectedCurrency} class="filter-select" aria-label="Currency">
					{#each availableCurrencies as currency}
						<option value={currency}>{currency.toUpperCase()}</option>
					{/each}
				</select>
			{/if}
		</svelte:fragment>
	</FeatureToolbar>

	<!-- Stats Bar -->
	{#if selectedCurrency && users.length > 0}
		<div class="stats-bar mb-4">
			<div class="stats-bar__item">
				<span class="stats-bar__value">{users.length}</span>
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
						{#each users as user}
							<th class="user-header">
								<span>{user.first_name}</span>
							</th>
						{/each}
						<th class="balance-header">Balance</th>
					</tr>
				</thead>
				<tbody>
					{#each users as user, rowIndex}
						{@const rowBalance = creditMatrix[rowIndex]?.reduce((sum, val) => sum + val, 0) || 0}
						<tr>
							<th class="row-header">{user.first_name}</th>
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
								<h4>{expense.description}</h4>
								<p class="paid-by">Paid by {users.find(u => String(u.id) === String(expense.paidBy))?.first_name || expense.paidBy}</p>
								<p class="split-with">Split: {(Array.isArray(expense.splitWith) ? expense.splitWith : []).map(id => users.find(u => String(u.id) === String(id))?.first_name || id).join(', ')}</p>
							</div>
							<div class="expense-amount">
								<span class="amount">{formatAmount(expense.amount)}</span>
								<span class="date">{new Date(parseInt(expense.date)).toLocaleDateString()}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
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

<style>
	.expenses-container {
		background: #1f2937;
		border-radius: 1.5rem;
		padding: 1.5rem;
	}

	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.header h2 {
		font-size: 1.5rem;
		font-weight: 700;
		color: white;
		margin: 0;
	}

	.text-muted {
		color: #6b7280;
		font-size: 0.875rem;
	}

	.loading, .empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
		text-align: center;
		color: #9ca3af;
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
		color: white;
		margin: 0 0 0.5rem;
	}

	.empty-state p {
		color: #6b7280;
		margin: 0;
	}

	/* Table */
	.table-container {
		overflow-x: auto;
		border-radius: 0.75rem;
		border: 1px solid #374151;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th, td {
		padding: 0.75rem;
		text-align: center;
		border-bottom: 1px solid #374151;
	}

	thead th {
		background: #111827;
		color: #9ca3af;
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
		background: #111827;
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
		background: #1f2937;
		border-left: 2px solid #4b5563;
		font-weight: 700;
		color: white;
	}

	.row-header {
		position: sticky;
		left: 0;
		background: #1f2937;
		text-align: left;
		font-weight: 500;
		color: white;
		z-index: 5;
	}

	tbody tr:nth-child(even) {
		background: rgba(55, 65, 81, 0.3);
	}

	tbody tr:nth-child(even) .row-header {
		background: #283141;
	}

	tbody tr:hover {
		background: rgba(55, 65, 81, 0.5);
	}

	.credit-cell {
		color: #6b7280;
		font-weight: 500;
	}

	.credit-cell.positive { color: #4ade80; }
	.credit-cell.negative { color: #f87171; }

	.balance-cell {
		border-left: 2px solid #4b5563;
		font-weight: 700;
		background: rgba(31, 41, 55, 0.5);
	}

	.balance-cell.positive { color: #4ade80; }
	.balance-cell.negative { color: #f87171; }

	/* Recent Expenses */
	.recent-expenses {
		margin-top: 2rem;
	}

	.recent-expenses h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: white;
		margin: 0 0 1rem;
	}

	.expense-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.expense-card {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		background: #374151;
		padding: 1rem;
		border-radius: 0.75rem;
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
		color: white;
		margin: 0 0 0.25rem;
	}

	.paid-by {
		color: #d1d5db;
		font-size: 0.875rem;
		margin: 0 0 0.25rem;
	}

	.split-with {
		color: #9ca3af;
		font-size: 0.75rem;
		margin: 0;
	}

	.expense-amount {
		text-align: right;
	}

	.amount {
		display: block;
		font-size: 1.125rem;
		font-weight: 700;
		color: white;
	}

	.date {
		font-size: 0.75rem;
		color: #6b7280;
	}

	@media (max-width: 640px) {
		.expenses-container {
			padding: 1rem;
			border-radius: 1rem;
		}

		.header h2 {
			font-size: 1.25rem;
		}

		.expense-card {
			flex-direction: column;
			gap: 0.75rem;
		}

		.expense-amount {
			text-align: left;
		}
	}

	/* Header actions */
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
</style>
