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
	let isLoading = true;
	let connectionReady = false;

	// Stats - using individual variables for better Svelte 5 reactivity
	let statsUsers = 0;
	let statsCompletedTasks = 0;
	let statsTotalTasks = 0;
	let statsEvents = 0;
	let statsShopping = 0;
	let statsProposals = 0;
	let statsOffers = 0;
	let statsChecklists = 0;
	let statsCompletedChecklists = 0;
	let statsRoles = 0;
	let statsUnassignedRoles = 0;

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

	// Reactive getters using $derived-like pattern for Svelte 5
	$: statValueUsers = statsUsers;
	$: statValueTasks = `${statsCompletedTasks}/${statsTotalTasks}`;
	$: statValueEvents = statsEvents;
	$: statValueShopping = statsShopping;
	$: statValueProposals = statsProposals;
	$: statValueOffers = statsOffers;
	$: statValueChecklists = `${statsCompletedChecklists}/${statsChecklists}`;
	$: statValueRoles = statsRoles;
	$: progressTasks = statsTotalTasks > 0 ? (statsCompletedTasks / statsTotalTasks) * 100 : 0;
	$: progressChecklists = statsChecklists > 0 ? (statsCompletedChecklists / statsChecklists) * 100 : 0;

	async function fetchData(retryCount = 0) {
		if (!isValidId(holonID) || !holosphere || !connectionReady) return;

		// Reset stats
		statsUsers = 0;
		statsCompletedTasks = 0;
		statsTotalTasks = 0;
		statsEvents = 0;
		statsShopping = 0;
		statsProposals = 0;
		statsOffers = 0;
		statsChecklists = 0;
		statsCompletedChecklists = 0;
		statsRoles = 0;
		statsUnassignedRoles = 0;
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
				result.status === 'fulfilled' ? (result.value || []) : [];

			const usersData = getData(users);
			const questsData = getData(quests);
			const shoppingData = getData(shoppingItems);
			const checklistsData = getData(checklists);
			const rolesData = getData(roles);

			// Helper to convert data to array regardless of format
			// Filters out deleted items and hologram/federation metadata
			const toArray = (data: any): any[] => {
				const isValidItem = (item: any) =>
					item &&
					item.id &&
					!item._deleted &&
					!item.hologram && // Filter out hologram metadata
					!item.sourceHolon; // Filter out federation metadata

				if (Array.isArray(data)) return data.filter(isValidItem);
				if (data && typeof data === 'object') return Object.values(data).filter(isValidItem);
				return [];
			};

			const usersArray = toArray(usersData);
			const questsArray = toArray(questsData);
			const shoppingArray = toArray(shoppingData);
			const checklistsArray = toArray(checklistsData);
			const rolesArray = toArray(rolesData);

			// Handle both array and object data formats
			const questValues = questsArray;
			const tasks = questValues.filter((q: any) => !q.type || q.type === 'task' || q.type === 'recurring' || q.type === 'quest');
			const oneWeekAgo = new Date();
			oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

			// Update individual stats variables for Svelte 5 reactivity
			statsUsers = usersArray.length;
			statsCompletedTasks = tasks.filter((t: any) => t.status === 'completed').length;
			statsTotalTasks = tasks.length;
			statsEvents = questValues.filter((q: any) => q.type === 'event' && q.when && new Date(q.when) >= oneWeekAgo).length;
			statsShopping = shoppingArray.length;
			statsProposals = questValues.filter((q: any) => q.type === 'proposal').length;
			statsOffers = questValues.filter((q: any) => ['offer', 'request', 'need'].includes(q.type)).length;
			statsChecklists = checklistsArray.length;
			statsCompletedChecklists = checklistsArray.filter((c: any) => c.completed).length;
			statsRoles = rolesArray.length;
			statsUnassignedRoles = rolesArray.filter((r: any) => !r.participants?.length).length;
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

	// Single reactive block: when page ID changes and holosphere is ready, fetch data
	let currentHolonId: string | null = null;
	$: {
		const newId = $page.params.id;
		if (isValidId(newId) && holosphere && newId !== currentHolonId) {
			currentHolonId = newId;
			holonID = newId;
			ID.set(newId);
			connectionReady = true;
			fetchData();
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
			<!-- Users Card -->
			<a href={`/${holonID}/status`} class="card card-green">
				<div class="card-header">
					<div class="card-icon icon-green">
						<i class="fas fa-users"></i>
					</div>
					<div class="card-stat">
						<span class="stat-value">{statValueUsers}</span>
						<span class="stat-label">Active Users</span>
					</div>
				</div>
				<h3 class="card-title">Users</h3>
				<p class="card-sublabel">View details →</p>
			</a>

			<!-- Tasks Card -->
			<a href={`/${holonID}/tasks`} class="card card-blue">
				<div class="card-header">
					<div class="card-icon icon-blue">
						<i class="fas fa-tasks"></i>
					</div>
					<div class="card-stat">
						<span class="stat-value">{statValueTasks}</span>
						<span class="stat-label">Completed</span>
					</div>
				</div>
				<h3 class="card-title">Tasks</h3>
				<div class="progress-container">
					<div class="progress-header">
						<span>Progress</span>
						<span>{Math.round(progressTasks)}%</span>
					</div>
					<div class="progress-bar">
						<div class="progress-fill fill-blue" style="width: {progressTasks}%"></div>
					</div>
				</div>
			</a>

			<!-- Events Card -->
			<a href={`/${holonID}/schedule`} class="card card-purple">
				<div class="card-header">
					<div class="card-icon icon-purple">
						<i class="fas fa-calendar-alt"></i>
					</div>
					<div class="card-stat">
						<span class="stat-value">{statValueEvents}</span>
						<span class="stat-label">This Week</span>
					</div>
				</div>
				<h3 class="card-title">Events</h3>
				<p class="card-sublabel">View details →</p>
			</a>

			<!-- Shopping Card -->
			<a href={`/${holonID}/shopping`} class="card card-rose">
				<div class="card-header">
					<div class="card-icon icon-rose">
						<i class="fas fa-shopping-cart"></i>
					</div>
					<div class="card-stat">
						<span class="stat-value">{statValueShopping}</span>
						<span class="stat-label">Items</span>
					</div>
				</div>
				<h3 class="card-title">Shopping</h3>
				<p class="card-sublabel">View details →</p>
			</a>
		</div>

		<!-- Secondary Stats -->
		<div class="secondary-grid">
			<!-- Proposals -->
			<a href={`/${holonID}/proposals`} class="card-sm card-amber">
				<div class="card-sm-icon icon-amber">
					<i class="fas fa-lightbulb"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Proposals</h3>
					<span class="card-sm-stat">{statValueProposals}</span>
				</div>
			</a>

			<!-- Offers & Needs -->
			<a href={`/${holonID}/offers`} class="card-sm card-indigo">
				<div class="card-sm-icon icon-indigo">
					<i class="fas fa-gift"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Offers & Needs</h3>
					<span class="card-sm-stat">{statValueOffers}</span>
				</div>
			</a>

			<!-- Checklists -->
			<a href={`/${holonID}/checklists`} class="card-sm card-teal">
				<div class="card-sm-icon icon-teal">
					<i class="fas fa-clipboard-check"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Checklists</h3>
					<span class="card-sm-stat">{statValueChecklists}</span>
					<div class="progress-bar-sm">
						<div class="progress-fill fill-teal" style="width: {progressChecklists}%"></div>
					</div>
				</div>
			</a>

			<!-- Roles -->
			<a href={`/${holonID}/roles`} class="card-sm card-cyan">
				<div class="card-sm-icon icon-cyan">
					<i class="fas fa-user-tag"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Roles</h3>
					<span class="card-sm-stat">{statValueRoles}</span>
					<span class="card-sm-sublabel">{statsUnassignedRoles} unassigned</span>
				</div>
			</a>

			<!-- Federation -->
			<a href={`/${holonID}/federation`} class="card-sm card-orange">
				<div class="card-sm-icon icon-orange">
					<i class="fas fa-network-wired"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Federation</h3>
					<span class="card-sm-sublabel">Data sharing</span>
				</div>
			</a>

			<!-- Settings -->
			<a href={`/${holonID}/settings`} class="card-sm card-emerald">
				<div class="card-sm-icon icon-emerald">
					<i class="fas fa-cog"></i>
				</div>
				<div class="card-sm-content">
					<h3 class="card-sm-title">Settings</h3>
					<span class="card-sm-sublabel">Configure</span>
				</div>
			</a>
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
