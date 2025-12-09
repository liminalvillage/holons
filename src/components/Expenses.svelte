<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import type { HoloSphere } from "holosphere";
	import { calculateCreditMatrix } from "../utils/expenseCalculations";

	interface Expense {
		id: string;
		amount: number;
		currency: string;
		description: string;
		paidBy: string;
		splitWith: string[];
		date: string;
	}

	interface User {
		id: number;
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

	$: users = Object.values(store);

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
				holosphere.read(holonID, "settings")
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

	// Reactive: set initial currency
	$: if (!selectedCurrency && availableCurrencies.length > 0) {
		selectedCurrency = availableCurrencies[0];
	}

	// Reactive: calculate credits when currency or users change
	$: if (selectedCurrency && users.length > 0) {
		calculateCredits(selectedCurrency);
	}

	$: filteredExpenses = Object.values(expenses)
		.filter(e => e.currency === selectedCurrency)
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
</script>

<div class="expenses-container">
	<div class="header">
		<h2>Expenses</h2>
		{#if selectedCurrency}
			<select bind:value={selectedCurrency} class="currency-select">
				{#each availableCurrencies as currency}
					<option value={currency}>{currency.toUpperCase()}</option>
				{/each}
			</select>
		{:else if noCurrenciesAvailable}
			<span class="text-muted">No currencies configured</span>
		{:else}
			<span class="text-muted">Loading...</span>
		{/if}
	</div>

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
							<div class="expense-info">
								<h4>{expense.description}</h4>
								<p class="paid-by">Paid by {users.find(u => u.id === parseInt(expense.paidBy))?.first_name || expense.paidBy}</p>
								<p class="split-with">Split: {expense.splitWith.map(id => users.find(u => u.id === parseInt(id))?.first_name || id).join(', ')}</p>
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

	.currency-select {
		background: #374151;
		color: white;
		padding: 0.5rem 1rem;
		border-radius: 0.5rem;
		border: 1px solid #4b5563;
		cursor: pointer;
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
		background: #374151;
		padding: 1rem;
		border-radius: 0.75rem;
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
</style>
