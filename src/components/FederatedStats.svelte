<script lang="ts">
	import { onMount } from 'svelte';
	import { HoloSphere } from 'holosphere';

	// Service holosphere instance (uses the app service key, NOT the user's key)
	let serviceHolosphere: HoloSphere | null = null;
	let isLoading = true;
	let error: string | null = null;

	// Federated sources that have granted capabilities
	interface FederatedSource {
		publicKey: string;
		shortKey: string;  // Truncated for display
		holonsContributed: number;
		dataPoints: number;
	}
	let federatedSources: FederatedSource[] = [];

	// Aggregated holon statistics
	interface HolonStats {
		id: string;
		name: string;
		purpose: string;
		userCount: number;
		taskCount: number;
		completedTasks: number;
		offersCount: number;
		needsCount: number;
		shoppingCount: number;
		sourceCount: number;  // How many federated sources contributed
	}
	let holonStats: HolonStats[] = [];

	// Summary stats
	let totalHolons = 0;
	let totalUsers = 0;
	let totalTasks = 0;
	let totalOffers = 0;
	let lastUpdated: Date | null = null;

	let environmentName: string =
		import.meta.env.VITE_LOCAL_MODE === "development" ? "HolonsDebug" : "Holons";

	onMount(async () => {
		const servicePrivateKey = import.meta.env.VITE_HOLOSPHERE_PRIVATE_KEY;
		if (!servicePrivateKey) {
			error = 'No service key configured. Set VITE_HOLOSPHERE_PRIVATE_KEY in .env';
			isLoading = false;
			return;
		}

		try {
			// Create a separate holosphere instance with the service key
			serviceHolosphere = new HoloSphere({
				appName: environmentName,
				privateKey: servicePrivateKey,
				relays: ['wss://relay.holons.io'],
				enablePing: false
			});

			await loadFederatedStats();
		} catch (e) {
			error = `Failed to initialize: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			isLoading = false;
		}
	});

	async function loadFederatedStats() {
		if (!serviceHolosphere) return;

		try {
			// 1. Get all capability tokens granted to this service
			const capabilities = await serviceHolosphere.getAllGlobal('federation_capabilities');
			console.log('Found federation capabilities:', capabilities?.length || 0);

			if (!capabilities || capabilities.length === 0) {
				error = 'No federated sources found. Users need to grant capability tokens.';
				return;
			}

			// 2. For each capability, aggregate stats (counts only - privacy preserving)
			const holonStatsMap = new Map<string, HolonStats>();
			const sourcesMap = new Map<string, FederatedSource>();

			for (const cap of capabilities) {
				if (!cap || !cap.token || !cap.grantorPublicKey) continue;

				const shortKey = cap.grantorPublicKey.substring(0, 8) + '...' + cap.grantorPublicKey.substring(cap.grantorPublicKey.length - 4);

				// Initialize source tracking
				if (!sourcesMap.has(cap.grantorPublicKey)) {
					sourcesMap.set(cap.grantorPublicKey, {
						publicKey: cap.grantorPublicKey,
						shortKey,
						holonsContributed: 0,
						dataPoints: 0
					});
				}

				try {
					// Verify capability is still valid
					const isValid = await serviceHolosphere.verifyCapability(cap.token, 'read', { holonId: '*', lensName: '*' });
					if (!isValid) {
						console.log(`Capability from ${shortKey} is invalid or expired`);
						continue;
					}

					// Get holons accessible via this capability
					const holons = await serviceHolosphere.getAll(null, 'settings', null, { capability: cap.token });

					if (Array.isArray(holons)) {
						const source = sourcesMap.get(cap.grantorPublicKey)!;
						source.holonsContributed += holons.length;

						for (const holon of holons) {
							if (!holon || !holon.id) continue;

							// Extract counts from this holon (privacy-preserving - only counts)
							const counts = await extractCountsOnly(holon.id, cap.token);
							source.dataPoints += counts.totalItems;

							// Aggregate into holon stats
							if (!holonStatsMap.has(holon.id)) {
								holonStatsMap.set(holon.id, {
									id: holon.id,
									name: holon.name || 'Unnamed Holon',
									purpose: holon.purpose || '',
									userCount: 0,
									taskCount: 0,
									completedTasks: 0,
									offersCount: 0,
									needsCount: 0,
									shoppingCount: 0,
									sourceCount: 0
								});
							}

							const stats = holonStatsMap.get(holon.id)!;
							stats.userCount += counts.userCount;
							stats.taskCount += counts.taskCount;
							stats.completedTasks += counts.completedTasks;
							stats.offersCount += counts.offersCount;
							stats.needsCount += counts.needsCount;
							stats.shoppingCount += counts.shoppingCount;
							stats.sourceCount += 1;
						}
					}
				} catch (e) {
					console.error(`Error processing capability from ${shortKey}:`, e);
				}
			}

			// Convert maps to arrays
			federatedSources = Array.from(sourcesMap.values());
			holonStats = Array.from(holonStatsMap.values());

			// Calculate summary stats
			totalHolons = holonStats.length;
			totalUsers = holonStats.reduce((sum, h) => sum + h.userCount, 0);
			totalTasks = holonStats.reduce((sum, h) => sum + h.taskCount, 0);
			totalOffers = holonStats.reduce((sum, h) => sum + h.offersCount, 0);
			lastUpdated = new Date();

		} catch (e) {
			error = `Failed to load federated stats: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	// Extract ONLY counts from holon data - never store or return actual content
	async function extractCountsOnly(holonId: string, capability: string): Promise<{
		userCount: number;
		taskCount: number;
		completedTasks: number;
		offersCount: number;
		needsCount: number;
		shoppingCount: number;
		totalItems: number;
	}> {
		if (!serviceHolosphere) {
			return { userCount: 0, taskCount: 0, completedTasks: 0, offersCount: 0, needsCount: 0, shoppingCount: 0, totalItems: 0 };
		}

		try {
			const [users, tasks, offers, needs, shopping] = await Promise.allSettled([
				serviceHolosphere.getAll(holonId, 'users', null, { capability }),
				serviceHolosphere.getAll(holonId, 'quests', null, { capability }),
				serviceHolosphere.getAll(holonId, 'offers', null, { capability }),
				serviceHolosphere.getAll(holonId, 'needs', null, { capability }),
				serviceHolosphere.getAll(holonId, 'shopping', null, { capability })
			]);

			const usersArr = users.status === 'fulfilled' && Array.isArray(users.value) ? users.value : [];
			const tasksArr = tasks.status === 'fulfilled' && Array.isArray(tasks.value) ? tasks.value : [];
			const offersArr = offers.status === 'fulfilled' && Array.isArray(offers.value) ? offers.value : [];
			const needsArr = needs.status === 'fulfilled' && Array.isArray(needs.value) ? needs.value : [];
			const shoppingArr = shopping.status === 'fulfilled' && Array.isArray(shopping.value) ? shopping.value : [];

			// Extract ONLY counts - arrays are immediately discarded after counting
			const userCount = usersArr.length;
			const taskCount = tasksArr.length;
			const completedTasks = tasksArr.filter((t: any) => t?.status === 'completed').length;
			const offersCount = offersArr.length;
			const needsCount = needsArr.length;
			const shoppingCount = shoppingArr.length;

			return {
				userCount,
				taskCount,
				completedTasks,
				offersCount,
				needsCount,
				shoppingCount,
				totalItems: userCount + taskCount + offersCount + needsCount + shoppingCount
			};
		} catch (e) {
			console.error(`Error extracting counts for holon ${holonId}:`, e);
			return { userCount: 0, taskCount: 0, completedTasks: 0, offersCount: 0, needsCount: 0, shoppingCount: 0, totalItems: 0 };
		}
	}

	function refreshStats() {
		isLoading = true;
		error = null;
		loadFederatedStats().finally(() => {
			isLoading = false;
		});
	}
</script>

<div class="federated-stats">
	<!-- Header -->
	<div class="header">
		<h1>Federated Network Statistics</h1>
		<p class="subtitle">Aggregated view from {federatedSources.length} federated source{federatedSources.length !== 1 ? 's' : ''}</p>
		<div class="privacy-badge">
			<i class="fas fa-shield-alt"></i>
			Content protected - showing counts only
		</div>
		{#if lastUpdated}
			<p class="updated">Last updated: {lastUpdated.toLocaleTimeString()}</p>
		{/if}
	</div>

	{#if isLoading}
		<div class="loading">
			<i class="fas fa-spinner fa-spin"></i>
			Loading federated statistics...
		</div>
	{:else if error}
		<div class="error">
			<i class="fas fa-exclamation-triangle"></i>
			{error}
		</div>
	{:else}
		<!-- Summary Cards -->
		<div class="summary-cards">
			<div class="card">
				<div class="card-value">{totalHolons}</div>
				<div class="card-label">Total Holons</div>
			</div>
			<div class="card">
				<div class="card-value">{totalUsers}</div>
				<div class="card-label">Total Users</div>
			</div>
			<div class="card">
				<div class="card-value">{totalTasks}</div>
				<div class="card-label">Total Tasks</div>
			</div>
			<div class="card">
				<div class="card-value">{totalOffers}</div>
				<div class="card-label">Total Offers</div>
			</div>
		</div>

		<!-- Holons Table -->
		{#if holonStats.length > 0}
			<div class="table-section">
				<h2>Holon Statistics</h2>
				<table class="holons-table">
					<thead>
						<tr>
							<th>Holon</th>
							<th>Users</th>
							<th>Tasks</th>
							<th>Offers</th>
							<th>Needs</th>
							<th>Shopping</th>
							<th>Sources</th>
						</tr>
					</thead>
					<tbody>
						{#each holonStats as holon}
							<tr>
								<td>
									<div class="holon-name">{holon.name}</div>
									{#if holon.purpose}
										<div class="holon-purpose">{holon.purpose}</div>
									{/if}
								</td>
								<td>{holon.userCount}</td>
								<td>
									{holon.taskCount}
									{#if holon.completedTasks > 0}
										<span class="completed">({holon.completedTasks} done)</span>
									{/if}
								</td>
								<td>{holon.offersCount}</td>
								<td>{holon.needsCount}</td>
								<td>{holon.shoppingCount}</td>
								<td>{holon.sourceCount}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Source Breakdown -->
		{#if federatedSources.length > 0}
			<div class="sources-section">
				<h2>Federated Sources</h2>
				<p class="sources-info">Data aggregated from {federatedSources.length} federated source{federatedSources.length !== 1 ? 's' : ''}</p>
				<div class="sources-list">
					{#each federatedSources as source, i}
						<div class="source-item">
							<span class="source-number">Source #{i + 1}</span>
							<span class="source-key">{source.shortKey}</span>
							<span class="source-stats">{source.holonsContributed} holon{source.holonsContributed !== 1 ? 's' : ''}, {source.dataPoints} data points</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<button class="refresh-btn" on:click={refreshStats}>
			<i class="fas fa-sync-alt"></i>
			Refresh Statistics
		</button>
	{/if}
</div>

<style>
	.federated-stats {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.header {
		text-align: center;
		margin-bottom: 2rem;
	}

	.header h1 {
		font-size: 2rem;
		color: #1a1a2e;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		color: #666;
		font-size: 1.1rem;
		margin-bottom: 1rem;
	}

	.privacy-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: #e8f5e9;
		color: #2e7d32;
		padding: 0.5rem 1rem;
		border-radius: 20px;
		font-size: 0.9rem;
	}

	.updated {
		color: #888;
		font-size: 0.85rem;
		margin-top: 1rem;
	}

	.loading, .error {
		text-align: center;
		padding: 3rem;
		font-size: 1.1rem;
	}

	.loading {
		color: #666;
	}

	.error {
		color: #d32f2f;
		background: #ffebee;
		border-radius: 8px;
	}

	.summary-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1.5rem;
		margin-bottom: 2rem;
	}

	.card {
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		color: white;
		padding: 1.5rem;
		border-radius: 12px;
		text-align: center;
		box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
	}

	.card-value {
		font-size: 2.5rem;
		font-weight: bold;
	}

	.card-label {
		font-size: 0.9rem;
		opacity: 0.9;
		margin-top: 0.5rem;
	}

	.table-section {
		margin-bottom: 2rem;
	}

	.table-section h2 {
		font-size: 1.3rem;
		color: #333;
		margin-bottom: 1rem;
	}

	.holons-table {
		width: 100%;
		border-collapse: collapse;
		background: white;
		border-radius: 8px;
		overflow: hidden;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
	}

	.holons-table th,
	.holons-table td {
		padding: 1rem;
		text-align: left;
		border-bottom: 1px solid #eee;
	}

	.holons-table th {
		background: #f5f5f5;
		font-weight: 600;
		color: #333;
	}

	.holons-table tr:hover {
		background: #f9f9f9;
	}

	.holon-name {
		font-weight: 600;
		color: #1a1a2e;
	}

	.holon-purpose {
		font-size: 0.85rem;
		color: #666;
		margin-top: 0.25rem;
	}

	.completed {
		color: #4caf50;
		font-size: 0.85rem;
	}

	.sources-section {
		background: #f5f5f5;
		padding: 1.5rem;
		border-radius: 8px;
		margin-bottom: 2rem;
	}

	.sources-section h2 {
		font-size: 1.2rem;
		margin-bottom: 0.5rem;
	}

	.sources-info {
		color: #666;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.sources-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.source-item {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem;
		background: white;
		border-radius: 6px;
	}

	.source-number {
		font-weight: 600;
		color: #667eea;
	}

	.source-key {
		font-family: monospace;
		color: #888;
		font-size: 0.85rem;
	}

	.source-stats {
		margin-left: auto;
		color: #666;
		font-size: 0.9rem;
	}

	.refresh-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		margin: 0 auto;
		padding: 0.75rem 1.5rem;
		background: #667eea;
		color: white;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	.refresh-btn:hover {
		background: #5a6fd6;
	}
</style>
