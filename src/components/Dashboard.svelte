<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import Announcements from "./Announcements.svelte";
	import type { HoloSphere } from "holosphere";

	const holosphere = getContext("holosphere") as HoloSphere;

	// Helper to validate holon ID
	const isValidId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	let holonID = $page.params.id;
	let unsubscribe: () => void;
	let isLoading = true;
	let connectionReady = false;

	// Stats
	let stats = {
		users: 0,
		completedTasks: 0,
		totalTasks: 0,
		events: 0,
		shopping: 0,
		proposals: 0,
		offers: 0,
		checklists: 0,
		completedChecklists: 0,
		roles: 0,
		unassignedRoles: 0
	};

	// Card definitions for cleaner rendering
	const primaryCards = [
		{ key: 'users', label: 'Users', sublabel: 'Active Users', icon: 'fa-users', color: 'green', href: 'status', showProgress: false },
		{ key: 'tasks', label: 'Tasks', sublabel: 'Completed', icon: 'fa-tasks', color: 'blue', href: 'tasks', showProgress: true },
		{ key: 'events', label: 'Events', sublabel: 'This Week', icon: 'fa-calendar-alt', color: 'purple', href: 'schedule', showProgress: false },
		{ key: 'shopping', label: 'Shopping', sublabel: 'Items', icon: 'fa-shopping-cart', color: 'rose', href: 'shopping', showProgress: false }
	];

	const secondaryCards = [
		{ key: 'proposals', label: 'Proposals', icon: 'fa-lightbulb', color: 'amber', href: 'proposals' },
		{ key: 'offers', label: 'Offers & Needs', icon: 'fa-gift', color: 'indigo', href: 'offers' },
		{ key: 'checklists', label: 'Checklists', icon: 'fa-clipboard-check', color: 'teal', href: 'checklists', showProgress: true },
		{ key: 'roles', label: 'Roles', icon: 'fa-user-tag', color: 'cyan', href: 'roles', showSublabel: true },
		{ key: 'federation', label: 'Federation', icon: 'fa-network-wired', color: 'orange', href: 'federation', sublabel: 'Data sharing' },
		{ key: 'settings', label: 'Settings', icon: 'fa-cog', color: 'emerald', href: 'settings', sublabel: 'Configure' }
	];

	function getStatValue(key: string): number | string {
		switch (key) {
			case 'users': return stats.users;
			case 'tasks': return `${stats.completedTasks}/${stats.totalTasks}`;
			case 'events': return stats.events;
			case 'shopping': return stats.shopping;
			case 'proposals': return stats.proposals;
			case 'offers': return stats.offers;
			case 'checklists': return `${stats.completedChecklists}/${stats.checklists}`;
			case 'roles': return stats.roles;
			default: return 0;
		}
	}

	function getProgress(key: string): number {
		switch (key) {
			case 'tasks': return stats.totalTasks > 0 ? (stats.completedTasks / stats.totalTasks) * 100 : 0;
			case 'checklists': return stats.checklists > 0 ? (stats.completedChecklists / stats.checklists) * 100 : 0;
			default: return 0;
		}
	}

	async function fetchData(retryCount = 0) {
		if (!isValidId(holonID) || !holosphere || !connectionReady) return;

		// Reset stats
		stats = { users: 0, completedTasks: 0, totalTasks: 0, events: 0, shopping: 0, proposals: 0, offers: 0, checklists: 0, completedChecklists: 0, roles: 0, unassignedRoles: 0 };
		isLoading = true;

		try {
			const [chats, users, quests, shoppingItems, checklists, roles] = await Promise.allSettled([
				holosphere.getAll(holonID, "chats"),
				holosphere.getAll(holonID, "users"),
				holosphere.getAll(holonID, "quests"),
				holosphere.getAll(holonID, "shopping"),
				holosphere.getAll(holonID, "checklists"),
				holosphere.getAll(holonID, "roles")
			]);

			const getData = (result: PromiseSettledResult<any>) =>
				result.status === 'fulfilled' ? (result.value || {}) : {};

			const usersData = getData(users);
			const questsData = getData(quests);
			const shoppingData = getData(shoppingItems);
			const checklistsData = getData(checklists);
			const rolesData = getData(roles);

			const questValues = Object.values(questsData) as any[];
			const tasks = questValues.filter((q: any) => !q.type || q.type === 'task' || q.type === 'recurring');
			const oneWeekAgo = new Date();
			oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

			stats = {
				users: Object.keys(usersData).length,
				completedTasks: tasks.filter((t: any) => t.status === 'completed').length,
				totalTasks: tasks.length,
				events: questValues.filter((q: any) => q.type === 'event' && q.when && new Date(q.when) >= oneWeekAgo).length,
				shopping: Object.keys(shoppingData).length,
				proposals: questValues.filter((q: any) => q.type === 'proposal').length,
				offers: questValues.filter((q: any) => ['offer', 'request', 'need'].includes(q.type)).length,
				checklists: Object.keys(checklistsData).length,
				completedChecklists: Object.values(checklistsData).filter((c: any) => c.completed).length,
				roles: Object.keys(rolesData).length,
				unassignedRoles: Object.values(rolesData).filter((r: any) => !r.participants?.length).length
			};
		} catch (error) {
			console.error('Error fetching dashboard data:', error);
			if (retryCount < 2) {
				setTimeout(() => fetchData(retryCount + 1), 1000 * (retryCount + 1));
				return;
			}
		} finally {
			isLoading = false;
		}
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
			unsubscribe = ID.subscribe((value) => {
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
		};

		checkConnection();
		return () => { if (unsubscribe) unsubscribe(); };
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

{#if isLoading && !connectionReady}
	<div class="loading">
		<div class="spinner"></div>
		<p>Connecting to holosphere...</p>
	</div>
{:else}
	<div class="dashboard">
		<!-- Primary Stats -->
		<div class="primary-grid">
			{#each primaryCards as card}
				<a href={`/${holonID}/${card.href}`} class="card card-{card.color}">
					<div class="card-header">
						<div class="card-icon icon-{card.color}">
							<i class="fas {card.icon}"></i>
						</div>
						<div class="card-stat">
							<span class="stat-value">{getStatValue(card.key)}</span>
							<span class="stat-label">{card.sublabel}</span>
						</div>
					</div>
					<h3 class="card-title">{card.label}</h3>
					{#if card.showProgress}
						<div class="progress-container">
							<div class="progress-header">
								<span>Progress</span>
								<span>{Math.round(getProgress(card.key))}%</span>
							</div>
							<div class="progress-bar">
								<div class="progress-fill fill-{card.color}" style="width: {getProgress(card.key)}%"></div>
							</div>
						</div>
					{:else}
						<p class="card-sublabel">View details →</p>
					{/if}
				</a>
			{/each}
		</div>

		<!-- Secondary Stats -->
		<div class="secondary-grid">
			{#each secondaryCards as card}
				<a href={`/${holonID}/${card.href}`} class="card-sm card-{card.color}">
					<div class="card-sm-icon icon-{card.color}">
						<i class="fas {card.icon}"></i>
					</div>
					<div class="card-sm-content">
						<h3 class="card-sm-title">{card.label}</h3>
						{#if card.showProgress}
							<span class="card-sm-stat">{getStatValue(card.key)}</span>
							<div class="progress-bar-sm">
								<div class="progress-fill fill-{card.color}" style="width: {getProgress(card.key)}%"></div>
							</div>
						{:else if card.showSublabel}
							<span class="card-sm-stat">{getStatValue(card.key)}</span>
							<span class="card-sm-sublabel">{stats.unassignedRoles} unassigned</span>
						{:else if card.sublabel}
							<span class="card-sm-sublabel">{card.sublabel}</span>
						{:else}
							<span class="card-sm-stat">{getStatValue(card.key)}</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>

		<!-- Announcements -->
		<div class="announcements-section">
			<Announcements />
		</div>
	</div>
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		gap: 1rem;
	}

	.spinner {
		width: 48px;
		height: 48px;
		border: 3px solid rgba(59, 130, 246, 0.2);
		border-top-color: #3b82f6;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.loading p {
		color: #9ca3af;
		font-size: 0.875rem;
	}

	.dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	/* Primary Grid */
	.primary-grid {
		display: grid;
		grid-template-columns: repeat(1, 1fr);
		gap: 1rem;
	}

	@media (min-width: 640px) {
		.primary-grid { grid-template-columns: repeat(2, 1fr); }
	}

	@media (min-width: 1280px) {
		.primary-grid { grid-template-columns: repeat(4, 1fr); }
	}

	/* Card Styles */
	.card {
		display: flex;
		flex-direction: column;
		padding: 1.25rem;
		background: #1f2937;
		border-radius: 1rem;
		border: 1px solid rgba(75, 85, 99, 0.3);
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.card:hover {
		transform: translateY(-2px);
		border-color: rgba(75, 85, 99, 0.5);
		box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.4);
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}

	.card-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		border-radius: 0.75rem;
		font-size: 1.25rem;
	}

	.card-stat {
		text-align: right;
	}

	.stat-value {
		display: block;
		font-size: 1.5rem;
		font-weight: 700;
		color: white;
		line-height: 1.2;
	}

	.stat-label {
		font-size: 0.75rem;
		color: #9ca3af;
	}

	.card-title {
		font-size: 1.125rem;
		font-weight: 600;
		color: white;
		margin-bottom: 0.5rem;
		transition: color 0.2s ease;
	}

	.card-sublabel {
		font-size: 0.8125rem;
		color: #6b7280;
	}

	/* Progress */
	.progress-container {
		margin-top: auto;
	}

	.progress-header {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
		color: #9ca3af;
		margin-bottom: 0.375rem;
	}

	.progress-bar {
		height: 6px;
		background: #374151;
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-bar-sm {
		height: 4px;
		background: #374151;
		border-radius: 2px;
		overflow: hidden;
		margin-top: 0.375rem;
	}

	.progress-fill {
		height: 100%;
		border-radius: inherit;
		transition: width 0.5s ease;
	}

	/* Secondary Grid */
	.secondary-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.75rem;
	}

	@media (min-width: 768px) {
		.secondary-grid { grid-template-columns: repeat(3, 1fr); }
	}

	@media (min-width: 1280px) {
		.secondary-grid { grid-template-columns: repeat(6, 1fr); }
	}

	.card-sm {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
		background: #1f2937;
		border-radius: 0.875rem;
		border: 1px solid rgba(75, 85, 99, 0.3);
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.card-sm:hover {
		transform: translateY(-1px);
		border-color: rgba(75, 85, 99, 0.5);
	}

	.card-sm-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 0.625rem;
		font-size: 1rem;
		flex-shrink: 0;
	}

	.card-sm-content {
		flex: 1;
		min-width: 0;
	}

	.card-sm-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: white;
		transition: color 0.2s ease;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-sm-stat {
		display: block;
		font-size: 1.25rem;
		font-weight: 700;
		color: white;
		line-height: 1.3;
	}

	.card-sm-sublabel {
		font-size: 0.6875rem;
		color: #6b7280;
	}

	/* Announcements */
	.announcements-section {
		background: #1f2937;
		border-radius: 1.25rem;
		overflow: hidden;
	}

	/* Color variants */
	.icon-green { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
	.icon-blue { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
	.icon-purple { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
	.icon-rose { background: rgba(244, 63, 94, 0.15); color: #fb7185; }
	.icon-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
	.icon-indigo { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
	.icon-teal { background: rgba(20, 184, 166, 0.15); color: #2dd4bf; }
	.icon-cyan { background: rgba(6, 182, 212, 0.15); color: #22d3ee; }
	.icon-orange { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
	.icon-emerald { background: rgba(16, 185, 129, 0.15); color: #34d399; }

	.fill-green { background: #22c55e; }
	.fill-blue { background: #3b82f6; }
	.fill-purple { background: #a855f7; }
	.fill-teal { background: #14b8a6; }

	.card-green:hover .card-title, .card-green:hover .card-sm-title { color: #4ade80; }
	.card-blue:hover .card-title, .card-blue:hover .card-sm-title { color: #60a5fa; }
	.card-purple:hover .card-title, .card-purple:hover .card-sm-title { color: #c084fc; }
	.card-rose:hover .card-title, .card-rose:hover .card-sm-title { color: #fb7185; }
	.card-amber:hover .card-title, .card-amber:hover .card-sm-title { color: #fbbf24; }
	.card-indigo:hover .card-title, .card-indigo:hover .card-sm-title { color: #818cf8; }
	.card-teal:hover .card-title, .card-teal:hover .card-sm-title { color: #2dd4bf; }
	.card-cyan:hover .card-title, .card-cyan:hover .card-sm-title { color: #22d3ee; }
	.card-orange:hover .card-title, .card-orange:hover .card-sm-title { color: #fb923c; }
	.card-emerald:hover .card-title, .card-emerald:hover .card-sm-title { color: #34d399; }
</style>
