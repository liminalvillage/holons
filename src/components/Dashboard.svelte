<script lang="ts">
	import { onMount, onDestroy, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import Announcements from "./Announcements.svelte";
	import TitleBar from "./shared/TitleBar.svelte";
	import StatCard from "./shared/StatCard.svelte";
	import StatGrid from "./shared/StatGrid.svelte";
	import { Users, CheckSquare, Calendar, ShoppingCart, Lightbulb, Gift, ClipboardList, UserPlus, Globe, Settings } from 'svelte-feathers';
	import type { HoloSphere } from "holosphere";
	import { fetchHolonName } from "../utils/holonNames";

	const holosphere = getContext("holosphere") as HoloSphere;

	// Holon name for title bar
	let holonName = '';

	// Helper to validate holon ID
	const isValidId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	let holonID = $page.params.id;
	let isLoading = true;
	let statsCollapsed = true; // Start collapsed on mobile

	// Data stores - accumulate items from subscriptions
	let questsMap = new Map<string, any>();
	let usersMap = new Map<string, any>();
	let shoppingMap = new Map<string, any>();
	let checklistsMap = new Map<string, any>();
	let rolesMap = new Map<string, any>();

	// Subscriptions cleanup
	let subscriptions: Array<{ unsubscribe: () => void }> = [];

	// Helper to check if item is valid
	const isValidItem = (item: any) => {
		if (!item || !item.id) return false;
		if (item._deleted) return false;
		if (item.hologram === true) return false;
		return true;
	};

	// Computed stats from maps
	$: questsArray = Array.from(questsMap.values());
	$: tasks = questsArray.filter((q: any) => !q.type || q.type === 'task' || q.type === 'recurring' || q.type === 'quest');
	$: oneWeekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d; })();

	$: statsUsers = usersMap.size;
	$: statsCompletedTasks = tasks.filter((t: any) => t.status === 'completed').length;
	$: statsTotalTasks = tasks.length;
	$: statsEvents = questsArray.filter((q: any) => q.type === 'event' && q.when && new Date(q.when) >= oneWeekAgo).length;
	$: statsShopping = shoppingMap.size;
	$: statsProposals = questsArray.filter((q: any) => q.type === 'proposal').length;
	$: statsOffers = questsArray.filter((q: any) => ['offer', 'request', 'need'].includes(q.type)).length;
	$: checklistsArray = Array.from(checklistsMap.values());
	$: statsChecklists = checklistsArray.length;
	$: statsCompletedChecklists = checklistsArray.filter((c: any) => c.completed).length;
	$: rolesArray = Array.from(rolesMap.values());
	$: statsRoles = rolesArray.length;
	$: statsUnassignedRoles = rolesArray.filter((r: any) => !r.participants?.length).length;

	// Display values
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

	async function loadData() {
		if (!isValidId(holonID) || !holosphere) return;

		// Clean up previous subscriptions
		subscriptions.forEach(s => s.unsubscribe());
		subscriptions = [];

		// Clear maps for new holon
		questsMap = new Map();
		usersMap = new Map();
		shoppingMap = new Map();
		checklistsMap = new Map();
		rolesMap = new Map();

		// Fetch holon name
		try {
			holonName = await fetchHolonName(holosphere, holonID) || `Holon ${holonID.slice(0, 8)}...`;
		} catch (e) {
			holonName = `Holon ${holonID.slice(0, 8)}...`;
		}

		// Helper to convert data to map
		const toMap = (data: any): Map<string, any> => {
			const map = new Map<string, any>();
			const items = Array.isArray(data) ? data : (data && typeof data === 'object' ? Object.values(data) : []);
			for (const item of items) {
				if (isValidItem(item)) {
					map.set(item.id, item);
				}
			}
			return map;
		};

		// Load initial data with getAll
		const [questsData, usersData, shoppingData, checklistsData, rolesData] = await Promise.all([
			holosphere.getAll(holonID, "quests").catch(() => []),
			holosphere.getAll(holonID, "users").catch(() => []),
			holosphere.getAll(holonID, "shopping").catch(() => []),
			holosphere.getAll(holonID, "checklists").catch(() => []),
			holosphere.getAll(holonID, "roles").catch(() => [])
		]);

		// Populate maps
		questsMap = toMap(questsData);
		usersMap = toMap(usersData);
		shoppingMap = toMap(shoppingData);
		checklistsMap = toMap(checklistsData);
		rolesMap = toMap(rolesData);

		// Hide loading now that we have data
		isLoading = false;

		// Set up subscriptions for live updates
		const questsSub = holosphere.subscribe(holonID, "quests", (item: any) => {
			if (isValidItem(item)) {
				questsMap.set(item.id, item);
				questsMap = questsMap;
			}
		});
		subscriptions.push(questsSub);

		const usersSub = holosphere.subscribe(holonID, "users", (item: any) => {
			if (isValidItem(item)) {
				usersMap.set(item.id, item);
				usersMap = usersMap;
			}
		});
		subscriptions.push(usersSub);

		const shoppingSub = holosphere.subscribe(holonID, "shopping", (item: any) => {
			if (isValidItem(item)) {
				shoppingMap.set(item.id, item);
				shoppingMap = shoppingMap;
			}
		});
		subscriptions.push(shoppingSub);

		const checklistsSub = holosphere.subscribe(holonID, "checklists", (item: any) => {
			if (isValidItem(item)) {
				checklistsMap.set(item.id, item);
				checklistsMap = checklistsMap;
			}
		});
		subscriptions.push(checklistsSub);

		const rolesSub = holosphere.subscribe(holonID, "roles", (item: any) => {
			if (isValidItem(item)) {
				rolesMap.set(item.id, item);
				rolesMap = rolesMap;
			}
		});
		subscriptions.push(rolesSub);
	}

	// React to holon ID changes (different holon)
	$: if ($page.params.id && $page.params.id !== holonID && isValidId($page.params.id) && holosphere) {
		holonID = $page.params.id;
		ID.set(holonID);
		isLoading = true;
		loadData();
	}

	onMount(() => {
		const newId = $page.params.id;
		if (isValidId(newId) && holosphere) {
			holonID = newId;
			ID.set(newId);
			isLoading = true;
			loadData();
		}
	});

	onDestroy(() => {
		subscriptions.forEach(s => s.unsubscribe());
		subscriptions = [];
	});
</script>

<!-- Title Bar -->
<TitleBar {holonName} title="Dashboard" />

{#if isLoading}
	<div class="loading">
		<div class="spinner"></div>
		<p>Connecting to holosphere...</p>
	</div>
{:else}
	<div class="dashboard">
		<!-- Primary Stats using StatGrid -->
		<StatGrid
			collapsible={true}
			collapsed={statsCollapsed}
			title="Statistics"
			on:toggle={(e) => statsCollapsed = e.detail.collapsed}
		>
			<StatCard
				label="Users"
				value={statValueUsers}
				icon={Users}
				clickable
				on:click={() => window.location.href = `/${holonID}/status`}
			/>
			<StatCard
				label="Tasks"
				value={statValueTasks}
				icon={CheckSquare}
				progress={progressTasks}
				subtext="{statsCompletedTasks} completed"
				clickable
				on:click={() => window.location.href = `/${holonID}/tasks`}
			/>
			<StatCard
				label="Events"
				value={statValueEvents}
				icon={Calendar}
				subtext="This week"
				clickable
				on:click={() => window.location.href = `/${holonID}/calendar`}
			/>
			<StatCard
				label="Shopping"
				value={statValueShopping}
				icon={ShoppingCart}
				subtext="Items"
				clickable
				on:click={() => window.location.href = `/${holonID}/shopping`}
			/>
			<StatCard
				label="Proposals"
				value={statValueProposals}
				icon={Lightbulb}
				clickable
				compact
				on:click={() => window.location.href = `/${holonID}/proposals`}
			/>
			<StatCard
				label="Offers & Needs"
				value={statValueOffers}
				icon={Gift}
				clickable
				compact
				on:click={() => window.location.href = `/${holonID}/offers`}
			/>
			<StatCard
				label="Checklists"
				value={statValueChecklists}
				icon={ClipboardList}
				progress={progressChecklists}
				clickable
				compact
				on:click={() => window.location.href = `/${holonID}/checklists`}
			/>
			<StatCard
				label="Roles"
				value={statValueRoles}
				icon={UserPlus}
				subtext="{statsUnassignedRoles} unassigned"
				clickable
				compact
				on:click={() => window.location.href = `/${holonID}/roles`}
			/>
		</StatGrid>

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
		color: var(--color-text-muted, #9ca3af);
		font-size: var(--font-size-sm, 0.875rem);
	}

	.dashboard {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-6, 1.5rem);
		padding: var(--spacing-4, 1rem);
	}

	/* Announcements */
	.announcements-section {
		background: var(--color-bg-secondary, #1f2937);
		border-radius: var(--radius-xl, 1rem);
		overflow: hidden;
	}
</style>
