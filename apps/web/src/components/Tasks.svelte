<script lang="ts">

	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import { replaceState, goto } from "$app/navigation";
	import { fade, slide } from "svelte/transition";
	import type { HoloSphere, ResolvedHologramMeta, FederationMeta } from "holosphere";
	import Schedule from "./ScheduleWidget.svelte";
	import TaskModal from "./TaskModal.svelte";
	import CanvasView from "./CanvasView.svelte";
	import KanbanView from "./kanban/KanbanView.svelte";
	import Fireworks from "./Fireworks.svelte";
	import Confetti from "./Confetti.svelte";
	import { nameMap, resolvedName, resolveName, resolveHologramSource, extractHolonIdFromSoul, awaitName, buildHologramLink } from '$lib/stores/nameResolver';
	import { taskSortStore, updateTaskSort, sortTasks, type SortCriteria } from "../dashboard/store";
	// Add new imports for quest library
	import QuestImportModal from "./QuestImportModal.svelte";
	// Import shared components
	import TitleBar from "./shared/TitleBar.svelte";
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import ToggleChip from "./shared/ToggleChip.svelte";
	import { CheckSquare, Calendar as CalendarIcon, Plus, List, Grid, Columns } from 'svelte-feathers';
	import {
		type ScoreEquation,
		DEFAULT_EQUATION,
		loadEquation
	} from "../lib/scoring/ContributionScoring";
	import {
		applyTaskCompletion,
		planTaskCompletion,
		executeCompletionPlan
	} from "@holons/core/tasks";
	import { getEventStore } from "../lib/rea/eventStore";
	import { getColorFromCategory } from "@holons/core/categories";
	import {
		getCachedEquation,
		preloadHolon,
		subscribeToHolon,
		unsubscribeFromHolon
	} from "../lib/holonCache";
	import { nostrPublicKey } from "../lib/stores/nostr";
	import { telegramStore } from "../lib/stores/telegram";
	import { notifyWriteDenied } from "../lib/stores/writeNotifications";
	import { queryManager } from "$lib/holosphere/QueryManager";
	import { dndzone } from "svelte-dnd-action";
	import { flip } from "svelte/animate";
	import { showFederated, showHolograms, passesLensFilters } from "$lib/stores/lensFilters";
	import { loadFilters, saveFilters } from "$lib/util/persistedFilters";
	import TaskCard from "./shared/TaskCard.svelte";
	import PublishToFederationButton from "./shared/PublishToFederationButton.svelte";
	import type { PublishOutcome } from "$lib/holosphere/publish";

	// State for quick completion
	let showCompleterModal = $state(false);
	let taskToComplete: { key: string; quest: Quest } | null = $state(null);
	let availableCompleters: Array<{ id: string; firstName: string; lastName?: string; username: string }> = $state([]);
	let completersLoading = $state(false);
	let equation: ScoreEquation = $state(DEFAULT_EQUATION);
	let selectedCompleters: Set<string> = $state(new Set()); // Multi-select for completers

	// Add filterType prop to allow filtering by quest type
	let { filterType = 'all' }: { filterType?: 'task' | 'event' | 'all' } = $props();

	interface Quest {
		id: string;
		title: string;
		description?: string;
		date?: string;
		when?: string;
		status: 'ongoing' | 'completed' | 'recurring' | 'repeating';
		category?: string;
		participants: Array<{ 
			id: string; 
			username: string;
			firstName?: string;
			lastName?: string;
		}>;
		appreciation: string[];
		location?: string;
		ends?: string;
		picture?: string;
		type?: 'task' | 'quest' | 'event' | 'recurring';
		orderIndex?: number;
		position?: { x: number; y: number };
		dependsOn?: string[];
		initiator?: {
			id: string;
			username: string;
			firstName?: string;
			lastName?: string;
		};
		created?: string;
		// Envelope shapes exported by holosphere — single source of truth.
		_hologram?: ResolvedHologramMeta;
		_federation?: FederationMeta;
		_deleted?: boolean;
		// Map of userId -> hours logged against this quest. Written by
		// TaskModal / Tasks completion flows; consumed by the hour-expense
		// builder when the quest is closed out.
		timeTracking?: Record<string, number>;
	}

	interface Store {
		[key: string]: Quest;
	}


	let holosphere = getContext("holosphere") as HoloSphere;

	let holonID = $state(''); // Start empty so reactive block triggers on first valid ID
	let holonName = $derived(resolvedName(holonID, $nameMap, null, 'Tasks'));
	let store: Store = $state({});
	let quests = $derived(Object.entries(store));

	// Helper function to check if a quest matches the current filterType
	function matchesFilterType(quest: Quest, currentFilterType: string): boolean {
		if (currentFilterType !== 'all') {
			if (currentFilterType === 'event') {
				const type = quest.type || 'task';
				const isScheduled = !!(quest.when && quest.when.trim() !== '');
				return type === 'event' || isScheduled;
			} else {
				const type = quest.type || 'task';
				return type === currentFilterType;
			}
		}
		// filterType === 'all': accept task, recurring, quest, event types
		const type = quest.type || 'task';
		return !quest.type || type === "task" || type === "recurring" || type === "quest" || type === "event";
	}

	// Stats - computed reactively from store
	let statsUnassigned = $derived.by(() => {
		let count = 0;
		for (const quest of Object.values(store)) {
			if (quest._deleted) continue;
			if (!matchesFilterType(quest, filterType)) continue;
			if (!quest.participants?.length && quest.status !== "completed") count++;
		}
		return count;
	});

	let statsOpenItems = $derived.by(() => {
		let count = 0;
		for (const quest of Object.values(store)) {
			if (quest._deleted) continue;
			if (!matchesFilterType(quest, filterType)) continue;
			if (quest.status !== "completed") count++;
		}
		return count;
	});

	let statsRecurring = $derived.by(() => {
		let count = 0;
		for (const quest of Object.values(store)) {
			if (quest._deleted) continue;
			if (!matchesFilterType(quest, filterType)) continue;
			if (quest.status === "recurring" || quest.status === "repeating") count++;
		}
		return count;
	});

	let statsCompleted = $derived.by(() => {
		let count = 0;
		for (const quest of Object.values(store)) {
			if (quest._deleted) continue;
			if (!matchesFilterType(quest, filterType)) continue;
			if (quest.status === "completed") count++;
		}
		return count;
	});

	let statsFilterSpecific = $derived.by(() => {
		let count = 0;
		for (const quest of Object.values(store)) {
			if (quest._deleted) continue;
			if (!matchesFilterType(quest, filterType)) continue;

			// Count items matching current filter type
			const type = quest.type || 'task';
			if (filterType === 'event') {
				// For events, count type='event' or scheduled items
				const isScheduled = !!(quest.when && quest.when.trim() !== '');
				if (type === 'event' || isScheduled) count++;
			} else if (filterType === 'task' && type === 'task') count++;
			else if (filterType === 'all') count++;
		}
		return count;
	});

	// Legacy updateStats function for backwards compatibility (called after fetch/subscribe)
	function updateStats() {
		// Stats are now computed reactively via $derived, this function is a no-op
		// but kept for backwards compatibility with existing calls
	}

	// Initialize with safe defaults
	let viewMode: 'list' | 'canvas' | 'kanban' = $state('list');
	let showCompleted = $state(false);
	let sortedQuests: [string, Quest][] = [];

	// Federation/hologram toggles are centralized in $lib/stores/lensFilters
	// so the same choice carries across every lens view.
	let loadingFederated = $state(false);
	// filteredQuests is now defined as a $derived value below

	// Initialize preferences with default values
	let showTaskInput = $state(false);
	// Wrap in a function so the filterType read doesn't trip Svelte 5's
	// state_referenced_locally check — we want the snapshot at construction time,
	// not a reactive binding.
	function buildBlankNewTask(): Quest {
		return {
			id: generateId(),
			title: '',
			description: '',
			category: '',
			status: 'ongoing',
			type: filterType === 'all' ? 'task' : filterType,
			participants: [],
			appreciation: []
		};
	}
	let newTask: Quest = $state(buildBlankNewTask());

	let questsUnsubscribe: (() => void) | undefined;

	// Add initialization state tracking
	let isLoading = $state(true);
	let connectionReady = false;
	let currentHolonId: string | null = null;

	// Helper to validate holon ID (declared up here so fetchData can use it).
	const isValidHolonId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	// Add state for animations
	let showFireworks = $state(false);
	let showConfetti = $state(false);

	// Subscribe to the shared sort state
	let sortCriteria = $derived($taskSortStore.criteria);
	let sortDirection = $derived($taskSortStore.direction);

	// SVG Paths for sort icons
	const calendarIconPath = "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"; // Calendar icon
	const orderIndexIconPath = "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"; // Heroicons bars-3
	const directionalSortIconPath = "M12 5v14M19 12l-7 7-7-7"; // Current arrow

	// Sort chip icon + rotation derive from the shared sort state, so any
	// change (button cycle, auto-switch on drag, programmatic) updates the
	// chip without anyone touching the setters by hand.
	let currentIconPath = $derived(
		sortCriteria === 'orderIndex' ? orderIndexIconPath
		: (sortCriteria === 'positionX' || sortCriteria === 'positionY') ? directionalSortIconPath
		: calendarIconPath
	);
	let sortButtonIconRotation = $derived.by(() => {
		switch (sortCriteria) {
			case 'created':   return sortDirection === 'asc' ? 180 : 0;       // calendar: rotated for oldest-first
			case 'orderIndex': return 0;                                       // bars: no rotation
			case 'positionX':  return sortDirection === 'asc' ? 270 : 90;      // arrow left for asc, right for desc
			case 'positionY':  return sortDirection === 'asc' ? 0 : 180;       // arrow down for asc, up for desc
			default:           return 0;
		}
	});

	// Add these variables after the existing let declarations
	let selectedCategory = $state("all");
	let selectedUserId = $state("all");
	let searchQuery = $state(loadFilters('tasks', { searchQuery: '' }).searchQuery);
	$effect(() => { saveFilters('tasks', { searchQuery }); });
	
	// Compute unique categories from quests
	let categories = $derived([
		"all",
		...new Set(
			Object.values(store)
				.filter((quest: any) => quest.category)
				.map((quest: any) => quest.category)
		),
	]);

	// Compute unique users from quests, including current logged-in user
	let allUsers = $derived.by(() => {
		const users = new Map<string, { id: string; name: string }>();

		// Add current logged-in user first
		const telegramState = telegramStore.getState();
		const telegramUser = telegramState.user;
		const pubKey = $nostrPublicKey;

		if (telegramUser) {
			const telegramId = String(telegramUser.id);
			const name = `${telegramUser.first_name} ${telegramUser.last_name || ''}`.trim();
			if (name) {
				users.set(telegramId, { id: telegramId, name: name });
			}
		} else if (pubKey) {
			// Name resolution is automatic via resolvedName()
			users.set(pubKey, { id: pubKey, name: resolvedName(pubKey, $nameMap) });
		}

		// Add users from quest participants. Normalize id to string — participant
		// rows can arrive with id as number (Telegram) or string (MCP writes).
		Object.values(store).forEach(quest => {
			if (quest.participants) {
				quest.participants.forEach(p => {
					if (p.id == null) return;
					const idKey = String(p.id);
					if (!users.has(idKey)) {
						const name = (p.firstName ? `${p.firstName} ${p.lastName || ''}` : p.username || '').trim();
						if (name) { // Only add users with a name
							users.set(idKey, {
								id: idKey,
								name: name
							});
						}
					}
				});
			}
		});

		const userArray = Array.from(users.values()).sort((a, b) => a.name.localeCompare(b.name));

		return [
			{ id: 'all', name: 'All Users' },
			{ id: 'unassigned', name: 'Unassigned' },
			...userArray
		];
	});
		
	// Add this variable to track the selected task
	let selectedTask: any = $state(null);
	let selectedTaskId: string | null = null; // For URL parameter support

	// Add these near the top of the script section, after the interface definitions
	// let sortField: 'x' | 'y' = 'x'; // Removed
	// let sortDirection: 'asc' | 'desc' = 'desc'; // Removed

	// Compute filtered and sorted quests
	let filteredQuests = $derived.by(() => {
		let currentFilteredQuests = quests.filter(([_, quest]) => {
			// Skip deleted items
			if (quest._deleted) return false;

			if (selectedCategory !== "all" && quest.category !== selectedCategory) {
				return false;
			}

			// Add user filtering logic
			if (selectedUserId !== "all") {
				if (selectedUserId === "unassigned") {
					if (quest.participants && quest.participants.length > 0) {
						return false;
					}
				} else {
					if (!quest.participants || !quest.participants.some(p => String(p.id) === String(selectedUserId))) {
						return false;
					}
				}
			}

			// Apply type filtering based on filterType prop
			if (filterType !== 'all') {
				if (filterType === 'event') {
					// For events filter, include both type='event' and any item with a 'when' field (scheduled items)
					const type = quest.type || 'task';
					const isScheduled = quest.when && quest.when.trim() !== '';
					if (type !== 'event' && !isScheduled) {
						return false;
					}
				} else {
					const type = quest.type || 'task';
					if (type !== filterType) {
						return false;
					}
				}
			} else {
				// Show all quest types when filterType is 'all' (default to 'task' if type is missing)
				const type = quest.type || 'task';
				if (type !== 'task' && type !== 'recurring' && type !== 'quest' && type !== 'event') {
					return false;
				}
			}

			// Default to 'ongoing' if status is missing.
			const status = quest.status || 'ongoing';
			if (status === "completed" && !showCompleted) {
				return false;
			}

			if (!passesLensFilters(quest as any, $showHolograms, $showFederated)) {
				return false;
			}

			const q = searchQuery.trim().toLowerCase();
			if (q) {
				const tagsText = Array.isArray((quest as any).tags) ? (quest as any).tags.join(' ') : '';
				const haystack = `${quest.title ?? ''} ${quest.description ?? ''} ${quest.category ?? ''} ${tagsText}`.toLowerCase();
				if (!haystack.includes(q)) return false;
			}

			return true; // Quest passes all filters
		});

		// Only sort when not in canvas view, as canvas uses absolute positioning
		if (viewMode !== 'canvas') {
			// Use the shared sorting logic
			currentFilteredQuests = sortTasks(currentFilteredQuests, $taskSortStore);
		}

		return currentFilteredQuests;
	});

	// Updated sort button handler to use shared store
	function handleSortButtonClick() {
		// Cycle: created desc → created asc → orderIndex → positionX asc → positionX desc → positionY asc → positionY desc → back to created desc.
		// Icon + rotation are derived from the store (see currentIconPath /
		// sortButtonIconRotation $derived above), so we only need to update
		// the criteria/direction here.
		let newCriteria: SortCriteria;
		let newDirection: 'asc' | 'desc';

		if (sortCriteria === 'created' && sortDirection === 'desc') {
			newCriteria = 'created';
			newDirection = 'asc';
		} else if (sortCriteria === 'created' && sortDirection === 'asc') {
			newCriteria = 'orderIndex';
			newDirection = 'asc';
		} else if (sortCriteria === 'orderIndex') {
			newCriteria = 'positionX';
			newDirection = 'asc';
		} else if (sortCriteria === 'positionX' && sortDirection === 'asc') {
			newCriteria = 'positionX';
			newDirection = 'desc';
		} else if (sortCriteria === 'positionX' && sortDirection === 'desc') {
			newCriteria = 'positionY';
			newDirection = 'asc';
		} else if (sortCriteria === 'positionY' && sortDirection === 'asc') {
			newCriteria = 'positionY';
			newDirection = 'desc';
		} else { // Was positionY desc, reset to created desc (newest first)
			newCriteria = 'created';
			newDirection = 'desc';
		}

		updateTaskSort(newCriteria, newDirection);
	}

	// Fix handleTaskClick type
	function handleTaskClick(key: string, quest: Quest) {
		if (!key) {
			console.error("Cannot select task: missing key");
			return;
		}
		selectedTask = { key, quest };
		
		// Update URL with task parameter
		const url = new URL(window.location.href);
		url.searchParams.set('task', key);
		replaceState(url.toString(), { replaceState: true });
	}

	// Handle dependency click to open dependency task modal
	function handleDependencyClick(dependencyId: string) {
		// Close current task modal if open
		selectedTask = null;
		
		// Update URL with dependency task parameter
		const url = new URL(window.location.href);
		url.searchParams.set('task', dependencyId);
		replaceState(url.toString(), { replaceState: true });
		
		// Open the dependency task modal
		handleTaskClick(dependencyId, store[dependencyId]);
	}

	// Add this helper function after the existing functions
	function generateId() {
		// Base36 timestamp + tiny random tail. No `_` so the bot's callback_data
		// underscore-separator parsing stays unambiguous; includes letters so the
		// id is never confused with a numeric Telegram message_id.
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
	}

	// Modify handleAddTask to use a default 'Dashboard User' initiator if user data fetch fails or returns no data, instead of throwing an error.
	async function handleAddTask() {
		if (!holosphere || !holonID || !newTask.title.trim()) {
			return;
		}

		try {
			let initiatorInfo;

			// Get current user's identity from Nostr or Telegram
			const telegramState = telegramStore.getState();
			const telegramUser = telegramState.user;
			const nostrPubKey = $nostrPublicKey;

			// Determine user ID - prefer Telegram user if available, then Nostr
			const currentUserId = telegramUser?.id?.toString() || nostrPubKey || holonID;

			try {
				// Attempt to get user data using the current user's ID
				const userData = await holosphere.get(holonID, 'users', currentUserId);

				if (userData && typeof userData === 'object' && userData !== null) {
					initiatorInfo = {
						id: currentUserId,
						username: userData.username || telegramUser?.username || "Unknown User",
						firstName: userData.first_name || telegramUser?.first_name || "",
						lastName: userData.last_name || telegramUser?.last_name || ""
					};
				} else if (telegramUser) {
					// Use Telegram user info directly
					initiatorInfo = {
						id: telegramUser.id.toString(),
						username: telegramUser.username || "Telegram User",
						firstName: telegramUser.first_name || "",
						lastName: telegramUser.last_name || ""
					};
				} else if (nostrPubKey) {
					// Use Nostr identity
					initiatorInfo = {
						id: nostrPubKey,
						username: nostrPubKey.slice(0, 8) + "...",
						firstName: "Nostr",
						lastName: "User"
					};
				} else {
					// Fallback to default
					initiatorInfo = {
						id: holonID,
						username: "Dashboard User",
						firstName: "Dashboard",
						lastName: "User"
					};
				}
			} catch (fetchError) {
				// Error during fetch, use available identity info
				console.error('Error fetching user data:', fetchError);
				if (telegramUser) {
					initiatorInfo = {
						id: telegramUser.id.toString(),
						username: telegramUser.username || "Telegram User",
						firstName: telegramUser.first_name || "",
						lastName: telegramUser.last_name || ""
					};
				} else if (nostrPubKey) {
					initiatorInfo = {
						id: nostrPubKey,
						username: nostrPubKey.slice(0, 8) + "...",
						firstName: "Nostr",
						lastName: "User"
					};
				} else {
					initiatorInfo = {
						id: holonID,
						username: "Dashboard User",
						firstName: "Dashboard",
						lastName: "User"
					};
				}
			}

			const newOrderIndex = filteredQuests.length > 0 
				? Math.max(...filteredQuests.map(([_, q]) => q.orderIndex ?? -1)) + 1 
				: 0;

			const task: Quest = {
				...newTask,
				initiator: initiatorInfo, // Use the determined initiatorInfo
				created: new Date().toISOString(), // canonical, see taskCreatedAtMs
				orderIndex: newOrderIndex // Assign orderIndex
				// No position assigned - let CanvasView handle positioning in inbox
			};

			// DEBUG: Log what we're about to write
			console.log('[ADD_TASK] Writing task:', { id: task.id, title: task.title, newTaskTitle: newTask.title });

			// Add the task to holosphere
			if (holonID) {
				await holosphere.put(holonID, 'quests', task);
				console.log('[ADD_TASK] Task written successfully:', task.id);
			} else {
				return;
			}

			// Reset form and close dialog
			showTaskInput = false;
			newTask = {
				id: generateId(),
				title: '',
				description: '',
				category: '',
				status: 'ongoing',
				type: filterType === 'all' ? 'task' : filterType, // Use filterType for new items
				participants: [],
				appreciation: []
			};

			// Force update
			// updateTrigger.update(n => n + 1); // Removed
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error adding task:', error);
			}
		}
	}

	// Drag-and-drop reorder for the list view, powered by svelte-dnd-action
	// (same library + structure as KanbanColumn). The native HTML5 drag
	// implementation it replaces clashed with touch devices and didn't
	// animate. dndzone owns drag mechanics — we just persist the new order
	// in `handleListDndFinalize` once the user releases the card.

	type DndCard = { id: string; key: string; quest: Quest };
	const LIST_FLIP_MS = 200;

	let listDndItems: DndCard[] = $state([]);
	// Same protection as KanbanColumn — while dndzone is mutating `items`,
	// don't let the $effect below re-seed from `filteredQuests` and clobber
	// the live drag.
	let isListDragging = $state(false);

	$effect(() => {
		if (isListDragging) return;
		listDndItems = filteredQuests
			.filter(([_, q]) => q.status !== 'completed' || (showCompleted && q.status === 'completed'))
			.map(([key, quest]) => ({ id: key, key, quest }));
	});

	function handleListDndConsider(e: CustomEvent<{ items: DndCard[] }>) {
		// Capture the pre-drag arrangement on the first consider event of
		// this drag so we can revert if the user cancels the sort switch.
		if (!isListDragging) preDragOrder = listDndItems.map(c => ({ ...c }));
		isListDragging = true;
		listDndItems = e.detail.items;
	}

	// Snapshot of the list order at drag-start, used to revert if the user
	// declines to switch out of a date/direction sort.
	let preDragOrder: DndCard[] = [];

	function snapshotCurrentOrder(): DndCard[] {
		return filteredQuests
			.filter(([_, q]) => q.status !== 'completed' || (showCompleted && q.status === 'completed'))
			.map(([key, quest]) => ({ id: key, key, quest }));
	}

	async function handleListDndFinalize(e: CustomEvent<{ items: DndCard[] }>) {
		isListDragging = false;
		listDndItems = e.detail.items;

		const currentHolonID = holonID;
		if (!currentHolonID) return;

		// Custom-order drag only makes sense when the list is sorted by
		// `orderIndex`. Date- or direction-sorted lists would just snap the
		// card back on the next render, so prompt the user to switch first.
		if (sortCriteria !== 'orderIndex') {
			const sortLabel = sortCriteria === 'created'
				? 'date'
				: (sortCriteria === 'positionX' || sortCriteria === 'positionY')
					? 'direction'
					: String(sortCriteria);
			const accepted = typeof window !== 'undefined'
				&& window.confirm(
					`This list is sorted by ${sortLabel}. Switch to custom order so you can rearrange tasks?`
				);
			if (!accepted) {
				// Revert the visual reorder; $effect won't re-seed because
				// `filteredQuests` hasn't changed.
				listDndItems = preDragOrder.length > 0 ? preDragOrder : snapshotCurrentOrder();
				return;
			}
			// Switch to custom order; the rest of this handler then writes
			// new orderIndex values that match the dragged arrangement.
			updateTaskSort('orderIndex', 'asc');
		}

		try {
			const writes: Promise<unknown>[] = [];
			const storeUpdates: Record<string, Quest> = {};
			for (let i = 0; i < listDndItems.length; i++) {
				const { key, quest } = listDndItems[i];
				if ((quest as any).orderIndex === i) continue;
				const updated = { ...quest, id: key, orderIndex: i };
				storeUpdates[key] = updated;
				writes.push(holosphere.put(currentHolonID, 'quests', updated));
			}
			if (writes.length === 0) return;
			await Promise.all(writes);
			store = { ...store, ...storeUpdates };
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error persisting list reorder:', error);
			}
		}
	}

	// Simplify show/hide functions
	function showDialog() {
		showTaskInput = true;
	}

	function hideDialog() {
		showTaskInput = false;
		// Reset the newTask object when closing
		newTask = {
			id: generateId(),
			title: '',
			description: '',
			category: '',
			status: 'ongoing',
			type: filterType === 'all' ? 'task' : filterType, // Use filterType for new items
			participants: [],
			appreciation: []
		};
	}



	// Add function to handle quest import
	async function handleQuestImport(event: CustomEvent<Quest[]>) {
		const importedQuests = event.detail;
		if (!holosphere || !holonID) {
			console.error("Cannot import quests: holosphere or holonID is null");
			return;
		}

		try {
			// Calculate base orderIndex once, then increment for each import
			const baseOrderIndex = filteredQuests.length;

			// Import quests one by one with incrementing orderIndex
			for (let i = 0; i < importedQuests.length; i++) {
				const quest = importedQuests[i];
				// Generate new ID and timestamp
				const newQuest = {
					...quest,
					id: generateId(),
					created: new Date().toISOString(), // canonical, see taskCreatedAtMs
					orderIndex: baseOrderIndex + i
				};

				// Add to holosphere
				await holosphere.put(holonID, 'quests', newQuest);
			}

			// Show success notification
			alert(`Successfully imported ${importedQuests.length} quests!`);

			// Refresh the quest list
			await fetchData();

			// Close import modal
			showImportModal = false;
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error importing quests:', error);
				alert("Error importing quests. Please check the console for details.");
			}
		}
	}

	// Add onMount to initialize the dialog
	onMount(() => {
		if (showTaskInput) {
			showDialog();
		}
		return () => {
			if (showTaskInput) {
				hideDialog();
			}
		};
	});

	// Function to get hologram source name from reactive nameMap
	function getHologramSource(hologramSoul: string | undefined): string {
		if (!hologramSoul) return '';

		const holonId = extractHolonIdFromSoul(hologramSoul);
		if (!holonId) return 'External Source';

		return resolvedName(holonId, $nameMap);
	}

	// Function to pre-resolve hologram names for all quests
	function preResolveHologramNames(questsToProcess: [string, Quest][]) {
		// Collect all unique hologram souls and resolve them via nameResolver
		questsToProcess.forEach(([_, quest]) => {
			if (quest._hologram?.isHologram && quest._hologram.soul) {
				resolveHologramSource(quest._hologram.soul);
			}
			const fedOrigin = quest._federation?.origin;
			if (fedOrigin && fedOrigin !== holonID) {
				resolveName(fedOrigin);
			}
		});
	}

	// Add this function to handle task deletion
	function handleTaskDeleted(event: CustomEvent) {
		if (event.detail?.deleted && event.detail?.questId) {
			// Update local store immediately
			const { [event.detail.questId]: _, ...rest } = store;
			store = rest;
		}
		// Always set selectedTask to null when modal closes
		selectedTask = null;
		
		// Clear the task parameter from URL
		const url = new URL(window.location.href);
		url.searchParams.delete('task');
		replaceState(url.toString(), { replaceState: true });
	}

	// Add function to handle task completion and show animations
	function handleTaskCompleted(event: CustomEvent) {
		if (event.detail?.questId) {
			showFireworks = true;
			showConfetti = true;

			// Hide fireworks after 2.5 seconds
			setTimeout(() => {
				showFireworks = false;
			}, 2500); // Show for 2.5 seconds

			// Hide confetti after 10 seconds
			setTimeout(() => {
				showConfetti = false;
			}, 10000); // Show for 10 seconds
		}
		// Note: handleTaskDeleted will still be called via the "close" event to clear selectedTask

		// Clear the task parameter from URL
		const url = new URL(window.location.href);
		url.searchParams.delete('task');
		replaceState(url.toString(), { replaceState: true });
	}

	// Quick completion from checkbox click
	async function handleCheckboxClick(e: Event, key: string, quest: Quest) {
		e.stopPropagation();

		if (!holosphere || !holonID) return;

		// If already completed, just toggle back to ongoing
		if (quest.status === 'completed') {
			try {
				const updatedQuest = { ...quest, id: key, status: 'ongoing', completed_at: null };
				await holosphere.put(holonID, 'quests', updatedQuest);
				store = { ...store, [key]: updatedQuest as Quest };
			} catch (error: any) {
				if (error?.name === 'AuthorizationError') {
					notifyWriteDenied('Unable to save - no write permission for this holon');
				} else {
					console.error('Error updating task status:', error);
				}
			}
			return;
		}

		// If task has participants, complete directly with REA accounting
		if (quest.participants && quest.participants.length > 0) {
			await completeTaskWithAccounting(key, quest);
		} else {
			// No participants - show modal to select who completed it
			taskToComplete = { key, quest };
			selectedCompleters = new Set(); // Reset selection
			await loadAvailableCompleters();
			showCompleterModal = true;
		}
	}

	// Load available users for completer selection
	async function loadAvailableCompleters() {
		if (!holosphere || !holonID) return;

		completersLoading = true;
		try {
			// holosphere.getAll resolves to Array<T>.
			const usersData = await holosphere.getAll(holonID, 'users');
			availableCompleters = (usersData ?? [])
				.filter((u: any) => u?.id)
				.map((u: any) => ({
					id: u.id,
					firstName: u.first_name || u.firstName || 'Unknown',
					lastName: u.last_name || u.lastName,
					username: u.username || ''
				}));
		} catch (error) {
			console.error('Error loading users for completion:', error);
			availableCompleters = [];
		} finally {
			completersLoading = false;
		}
	}

	// Toggle completer selection
	function toggleCompleterSelection(userId: string) {
		const newSet = new Set(selectedCompleters);
		if (newSet.has(userId)) {
			newSet.delete(userId);
		} else {
			newSet.add(userId);
		}
		selectedCompleters = newSet;
	}

	// Complete task with selected completers (multi-select)
	async function completeWithSelectedCompleters() {
		if (!taskToComplete || !holosphere || !holonID || selectedCompleters.size === 0) return;

		const { key, quest } = taskToComplete;

		// Build participants from selected users
		const newParticipants = availableCompleters
			.filter(user => selectedCompleters.has(user.id))
			.map(user => ({
				id: user.id,
				firstName: user.firstName,
				lastName: user.lastName,
				username: user.username
			}));

		// Merge with existing participants (avoid duplicates). Normalize ids to
		// strings — Telegram users carry numeric ids, MCP writes strings.
		const existingIds = new Set((quest.participants || []).map((p: any) => String(p.id)));
		const updatedParticipants = [
			...(quest.participants || []),
			...newParticipants.filter(p => !existingIds.has(String(p.id)))
		];

		const updatedQuest = { ...quest, participants: updatedParticipants };

		// Now complete with REA accounting
		await completeTaskWithAccounting(key, updatedQuest);

		// Close modal and reset
		showCompleterModal = false;
		taskToComplete = null;
		selectedCompleters = new Set();
	}

	// Complete task with full REA accounting (same logic as TaskModal)
	async function completeTaskWithAccounting(key: string, quest: Quest) {
		if (!holosphere || !holonID) return;

		try {
			// Load equation if not loaded
			if (equation === DEFAULT_EQUATION) {
				equation = await loadEquation(holosphere, holonID);
			}

			// Completer = current logged-in user, falling back to initiator.
			const telegramUser = telegramStore.getState().user;
			const pubKey = $nostrPublicKey;
			const completerId =
				(telegramUser && String(telegramUser.id))
				|| pubKey
				|| (quest.initiator?.id ? String(quest.initiator.id) : '');

			const result = applyTaskCompletion(quest as any, completerId, { isAdmin: true });
			if (!result.ok) {
				console.warn('[Tasks] applyTaskCompletion blocked:', result.reason);
				return;
			}

			const plan = planTaskCompletion(result.task, equation, {
				holonId: holonID,
				now: Date.now(),
			});
			const eventStore = getEventStore(holosphere);

			await executeCompletionPlan(holosphere as any, eventStore, holonID, plan);

			const completedQuest = { ...result.task, id: key } as Quest;
			store = { ...store, [key]: completedQuest };

			// Show celebration
			showFireworks = true;
			showConfetti = true;
			setTimeout(() => { showFireworks = false; }, 2500);
			setTimeout(() => { showConfetti = false; }, 10000);

		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error completing task with accounting:', error);
			}
		}
	}

	// Federated mode: local stream via queryManager (so the spinner clears
	// immediately even on a cold/empty graph), plus a one-shot getFederated
	// overlay merged on top. Federated items overlay the local baseline —
	// later local subscribe events will still update their own entries.
	async function fetchFederatedTasks() {
		if (!holosphere || !holonID || !isValidHolonId(holonID)) return;

		const loadKey = `${holonID}:fed`;
		if (questsLoadKey === loadKey && questsUnsubscribe) return;

		if (questsUnsubscribe) {
			questsUnsubscribe();
			questsUnsubscribe = undefined;
		}

		queryManager.init(holosphere);
		questsLoadKey = loadKey;
		isLoading = true;
		loadingFederated = true;
		store = {};

		const subscribedHolonID = holonID;

		questsUnsubscribe = queryManager.subscribe({
			holonId: subscribedHolonID,
			lens: 'quests',
			onUpdate: (items) => {
				if (questsLoadKey !== loadKey) return;
				// Merge local items, preserving any federated overlay that arrived first.
				const localStore = buildStoreFromItems(items);
				store = { ...store, ...localStore };
				isLoading = false;
				preResolveHologramNames(Object.entries(store));
				maybeOpenSelectedTask();
			},
			onError: (error) => {
				console.error('[Tasks] federated local subscription error:', error);
				isLoading = false;
			}
		});

		try {
			const federatedData = await holosphere.getFederated(subscribedHolonID, 'quests', {
				includeLocal: true,
				includeFederated: true,
				resolveReferences: true,
				aggregate: false
			});
			if (questsLoadKey !== loadKey) return; // user switched holon mid-flight
			if (Array.isArray(federatedData) && federatedData.length > 0) {
				const merged: Store = {};
				for (const q of federatedData as any[]) {
					if (!isQuestRecord(q)) continue;
					if (!q.participants) q.participants = [];
					const key = (q as any).key || q.id;
					merged[key] = q as Quest;
				}
				if (Object.keys(merged).length > 0) {
					store = { ...store, ...merged };
				}
			}
		} catch (error) {
			console.error('[Tasks] federated overlay error:', error);
		} finally {
			loadingFederated = false;
			isLoading = false;
		}
	}

	// Handle federated toggle change. Updates the shared store so the choice
	// carries across every lens view; the reactive watcher below kicks off
	// the appropriate fetch.
	async function handleFederatedToggle(eventOrUndefined?: CustomEvent<boolean> | undefined) {
		if (eventOrUndefined && typeof eventOrUndefined === 'object' && 'detail' in eventOrUndefined) {
			showFederated.set(eventOrUndefined.detail);
		} else {
			showFederated.update(v => !v);
		}
	}

	let lastTasksFedFlag = $showFederated;
	$effect(() => {
		// Re-fetch only when the user actually flips the toggle. Initial
		// load is handled by the page-params effect below.
		if ($showFederated !== lastTasksFedFlag) {
			lastTasksFedFlag = $showFederated;
			if (!holosphere || !holonID) return;
			if ($showFederated) fetchFederatedTasks();
			else fetchData();
		}
	});

	// Identity of the current load — `${holonID}:${federated}`. Lets us drop
	// stale callbacks from a previous holon/mode after a switch.
	let questsLoadKey: string | null = null;

	function isQuestRecord(quest: any): quest is Quest {
		if (!quest || !quest.id || quest._deleted) return false;
		const type = quest.type || 'task';
		// Offers/requests/needs live in the same lens but render in other views.
		if (type === 'offer' || type === 'request' || type === 'need') return false;
		return true;
	}

	function buildStoreFromItems(items: any[]): Store {
		const next: Store = {};
		for (const quest of items) {
			if (!isQuestRecord(quest)) continue;
			if (!quest.participants) quest.participants = [];
			const key = (quest as any).key || quest.id;
			next[key] = quest as Quest;
		}
		return next;
	}

	// Open the URL-selected task as soon as it appears in the store.
	function maybeOpenSelectedTask() {
		if (!selectedTaskId || selectedTask || !store[selectedTaskId]) return;
		selectedTask = { key: selectedTaskId, quest: store[selectedTaskId] };
		const url = new URL(window.location.href);
		url.searchParams.delete('task');
		replaceState(url.toString(), { replaceState: true });
		selectedTaskId = null;
	}

	// Local-first + progressive load via queryManager.subscribe. The cached
	// snapshot fires synchronously (next microtask), so isLoading clears
	// immediately even when the lens is empty — no more spinner forever
	// waiting on Gun's `.once()` that never fires on cold empty paths.
	function fetchData() {
		if (!holonID || !holosphere || !connectionReady || !isValidHolonId(holonID)) {
			return;
		}

		const loadKey = `${holonID}:local`;
		if (questsLoadKey === loadKey && questsUnsubscribe) return;

		if (questsUnsubscribe) {
			questsUnsubscribe();
			questsUnsubscribe = undefined;
		}

		queryManager.init(holosphere);
		questsLoadKey = loadKey;
		isLoading = true;
		store = {};

		questsUnsubscribe = queryManager.subscribe({
			holonId: holonID,
			lens: 'quests',
			onUpdate: (items) => {
				if (questsLoadKey !== loadKey) return; // stale (user switched holon)
				store = buildStoreFromItems(items);
				isLoading = false;
				preResolveHologramNames(Object.entries(store));
				maybeOpenSelectedTask();
			},
			onError: (error) => {
				console.error('[Tasks] quests subscription error:', error);
				isLoading = false; // Never leave the spinner stuck on error.
			}
		});
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			hideDialog();
		}
	}


	// Live updates are driven by queryManager.subscribe inside fetchData /
	// fetchFederatedTasks; no separate subscribe() helper is needed.

	// Simple onMount - one fetch, one subscription
	onMount(() => {
		// Check for task parameter in URL
		const urlParams = new URLSearchParams(window.location.search);
		const taskParam = urlParams.get('task');
		if (taskParam) {
			selectedTaskId = taskParam;
		}

		// Load preferences
		try {
			const storedViewMode = localStorage.getItem('taskViewMode');
			if (storedViewMode === 'list' || storedViewMode === 'canvas' || storedViewMode === 'kanban') {
				viewMode = storedViewMode as 'list' | 'canvas' | 'kanban';
			}
			showCompleted = localStorage.getItem("kanbanShowCompleted") === "true";
		} catch (error) {
			console.error('Error loading preferences:', error);
		}

		// Listen for dependency task modal requests
		const handleDependencyTask = (event: CustomEvent) => {
			const { taskId } = event.detail;
			if (taskId && store[taskId]) {
				selectedTask = null;
				selectedTask = { key: taskId, quest: store[taskId] };
			}
		};
		window.addEventListener('openDependencyTask', handleDependencyTask as EventListener);

		// Listen for federation changes (e.g. holon removed from federation)
		const handleFederationChanged = () => {
			if ($showFederated) {
				fetchFederatedTasks();
			} else {
				fetchData();
			}
		};
		window.addEventListener('federationChanged', handleFederationChanged);

		// Note: Data fetching is handled by the reactive block below
		// which triggers when $page.params.id !== holonID

		// Cleanup
		return () => {
			if (questsUnsubscribe) questsUnsubscribe();
			questsUnsubscribe = undefined;
			questsLoadKey = null;
			// Note: Don't unsubscribe from holon cache here - it persists across mounts
			currentHolonId = null; // Reset so next mount triggers fetch
			window.removeEventListener('openDependencyTask', handleDependencyTask as EventListener);
			window.removeEventListener('federationChanged', handleFederationChanged);
		};
	});

	// Reactive block: when page ID changes (different holon), fetch new data
	$effect(() => {
		if ($page.params.id && $page.params.id !== holonID && isValidHolonId($page.params.id) && holosphere) {
			holonID = $page.params.id;
			currentHolonId = $page.params.id;
			ID.set(holonID);
			connectionReady = true;
			isLoading = true;
			lastTasksFedFlag = $showFederated;
			if ($showFederated) fetchFederatedTasks();
			else fetchData();
			// Resolve holon name reactively
			resolveName(holonID);
			// Preload settings + users for TaskModal (instant cache hit when modal opens)
			equation = getCachedEquation(holonID);
			preloadHolon(holosphere, holonID).then(() => {
				equation = getCachedEquation(holonID);
			});
			// Subscribe to holon changes (keeps cache fresh)
			subscribeToHolon(holosphere, holonID);
		}
	});

	// (showHolograms now lives in the shared lensFilters store, persisted there)

	// Save viewMode preference to localStorage
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem("taskViewMode", viewMode);
		}
	});

	// Handler for optimistic position updates from CanvasView
	function handleCanvasQuestPositionChange(event: CustomEvent) {
		const { key, position } = event.detail;
		if (key && position && store[key]) {
			store = {
				...store,
				[key]: {
					...store[key],
					position: position
				}
			};
			// console.log('[Tasks.svelte] Optimistically updated position for key:', key, 'to', position);
		} else {
			// console.warn('[Tasks.svelte] Could not optimistically update position for event:', event.detail);
		}
	}

	// Add state for import modal
	let showImportModal = $state(false);

	async function markQuestPublished(quest: Quest, outcome: PublishOutcome) {
		if (!holosphere || !holonID) return;
		const updated = {
			...quest,
			published: true,
			publishedAt: new Date().toISOString(),
			publishedTo: outcome.publishedTo
		};
		try {
			await holosphere.put(holonID, 'quests', updated);
			store[quest.id] = updated;
		} catch (err) {
			console.warn('[Tasks] Failed to stamp published flag', err);
		}
	}

</script>

<div class="space-y-4">
	<!-- TitleBar -->
	<TitleBar
		{holonName}
		holonId={holonID}
		showLensFilters
		title={filterType === 'event' ? 'Events' : filterType === 'task' ? 'Tasks' : 'Tasks & Quests'}
		icon={filterType === 'event' ? CalendarIcon : CheckSquare}
	/>

	<!-- Main Content Container -->
	<div class="flex flex-col xl:flex-row gap-4">
		<!-- Tasks Panel -->
		<div class="xl:flex-1 bg-gray-800 rounded-2xl shadow-xl min-h-[600px]">
			<div class="p-3 sm:p-6">
				<!-- Inline Stats Bar - Always Visible -->
				<div class="stats-bar mb-4">
					<div class="stats-bar__item">
						<span class="stats-bar__value">{statsOpenItems}</span>
						<span class="stats-bar__label">Open</span>
					</div>
					<div class="stats-bar__divider"></div>
					<div class="stats-bar__item">
						<span class="stats-bar__value">{statsUnassigned}</span>
						<span class="stats-bar__label">Unassigned</span>
					</div>
					<div class="stats-bar__divider"></div>
					<div class="stats-bar__item">
						<span class="stats-bar__value">{statsRecurring}</span>
						<span class="stats-bar__label">Recurring</span>
					</div>
					<div class="stats-bar__divider"></div>
					<div class="stats-bar__item stats-bar__item--success">
						<span class="stats-bar__value">{statsCompleted}</span>
						<span class="stats-bar__label">Done</span>
					</div>
				</div>

				<FeatureToolbar
					onAdd={showDialog}
					addLabel="Add Task"
					onImport={() => (showImportModal = true)}
					importLabel="Import"
					searchQuery={searchQuery}
					searchPlaceholder="Search tasks…"
					on:search={(e) => (searchQuery = e.detail)}
					viewMode={viewMode}
					on:viewChange={(e) => (viewMode = e.detail as 'list' | 'canvas' | 'kanban')}
					viewModes={[
						{ value: 'list', icon: List, label: 'List view' },
						{ value: 'kanban', icon: Columns, label: 'Kanban view' },
						{ value: 'canvas', icon: Grid, label: 'Canvas view' },
					]}
					federatedLoading={loadingFederated}
				>
					<svelte:fragment slot="filters">
						<select bind:value={selectedCategory} class="filter-select" aria-label="Filter by category">
							{#each categories as category}
								<option value={category}>
									{category === "all" ? "All Categories" : category}
								</option>
							{/each}
						</select>

						<select bind:value={selectedUserId} class="filter-select" aria-label="Filter by user">
							{#each allUsers as user}
								<option value={user.id}>{user.name}</option>
							{/each}
						</select>

						<button
							class="sort-btn"
							onclick={handleSortButtonClick}
							aria-label="Sort tasks"
							title="Sort by: {sortCriteria}"
						>
							{#key currentIconPath}
								<svg
									class="w-4 h-4 transition-transform"
									style="transform: rotate({sortButtonIconRotation}deg)"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d={currentIconPath}></path>
								</svg>
							{/key}
						</button>

						<ToggleChip bind:checked={showCompleted} label="Completed" />
					</svelte:fragment>
				</FeatureToolbar>

				<!-- Federated Status Indicator -->
				{#if $showFederated}
					<div class="mb-4 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
						<div class="flex items-center gap-2 text-blue-300">
							<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
							</svg>
							<span class="text-sm font-medium">Showing federated tasks from connected holons</span>
						</div>
					</div>
				{/if}

				<!-- Task Content -->
				{#if isLoading}
					<div class="flex items-center justify-center py-12">
						<div class="text-center">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
							<p class="text-gray-400">Loading tasks...</p>
						</div>
					</div>
				{:else if viewMode === "canvas"}
					{#if holonID} 
						<CanvasView
							{filteredQuests}
							{holonID}
							{showCompleted}
							on:taskClick={(e) => handleTaskClick(e.detail.key, e.detail.quest)}
							on:questPositionChanged={handleCanvasQuestPositionChange}
						/>
					{:else}
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
								<p class="text-gray-400">Loading canvas...</p>
							</div>
						</div>
					{/if}
				{:else if viewMode === "kanban"}
					{#if holonID}
						<KanbanView
							{filteredQuests}
							{holonID}
							{showCompleted}
							on:taskClick={(e) => handleTaskClick(e.detail.key, e.detail.quest as Quest)}
						/>
					{:else}
						<div class="flex items-center justify-center py-12">
							<div class="text-center">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
								<p class="text-gray-400">Loading board...</p>
							</div>
						</div>
					{/if}
				{:else}
					<div
						class="space-y-2 sm:space-y-3 task-list-dndzone"
						use:dndzone={{
							items: listDndItems,
							flipDurationMs: LIST_FLIP_MS,
							dropTargetStyle: { outline: '2px dashed #6366f1', outlineOffset: '-2px', borderRadius: '0.75rem' }
						}}
						onconsider={handleListDndConsider}
						onfinalize={handleListDndFinalize}
					>
						{#each listDndItems as item (item.id)}
							{@const key = item.key}
							{@const quest = item.quest}
						<div
							id={key}
							class="w-full task-card relative text-left group"
							animate:flip={{ duration: LIST_FLIP_MS }}
						>
							<div class="flex items-stretch gap-2 sm:gap-3">
								<button
									class="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:scale-110 self-center {quest.status === 'completed' ? 'bg-green-500 text-white' : 'bg-black/20 hover:bg-green-500/30 text-gray-600 hover:text-green-600'}"
									onclick={(e) => handleCheckboxClick(e, key, quest)}
									title={quest.status === 'completed' ? 'Mark as ongoing' : 'Mark as complete'}
									aria-label={quest.status === 'completed' ? 'Mark task as ongoing' : 'Mark task as complete'}
								>
									{#if quest.status === 'completed'}
										<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
										</svg>
									{:else if quest.type === 'event' || (filterType === 'event' && quest.when)}
										<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke-width="2"/>
											<line x1="16" y1="2" x2="16" y2="6" stroke-width="2"/>
											<line x1="8" y1="2" x2="8" y2="6" stroke-width="2"/>
											<line x1="3" y1="10" x2="21" y2="10" stroke-width="2"/>
										</svg>
									{:else if quest.type === 'recurring' || quest.status === 'recurring' || quest.status === 'repeating'}
										<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
										</svg>
									{:else}
										<svg class="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<circle cx="12" cy="12" r="10" stroke-width="2"/>
										</svg>
									{/if}
								</button>
								<TaskCard
									quest={quest}
									variant="list"
									{holonID}
									extraClass="flex-1"
									onclick={(e) => { e.stopPropagation(); handleTaskClick(key, quest); }}
									onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleTaskClick(key, quest); }}
									role="button"
									tabindex={0}
									ariaLabel={`Open task: ${quest.title}`}
								/>
								<div class="flex flex-shrink-0 items-center">
									<PublishToFederationButton
										compact
										holonId={holonID}
										lens="quests"
										item={{ ...quest, id: quest.id ?? key }}
										onPublished={(outcome) => markQuestPublished(quest, outcome)}
									/>
								</div>
							</div>
							{#if quest.dependsOn && quest.dependsOn.length > 0}
								<div class="text-xs text-gray-600 mt-1 ml-8 sm:ml-11">
									<div class="flex items-center gap-1 mb-1">
										<span class="text-blue-600 flex-shrink-0">📌 Depends on:</span>
									</div>
									<div class="flex flex-wrap items-center gap-1">
										{#each quest.dependsOn as depId}
											{@const depQuest = Object.entries(store).find(([k, q]) => k === depId)}
											{#if depQuest}
												<button
													class="inline-flex items-center bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md text-xs hover:bg-blue-200 transition-colors cursor-pointer touch-manipulation min-h-[24px] min-w-[24px] flex-shrink-0"
													onclick={(e) => { e.stopPropagation(); handleDependencyClick(depId); }}
													ontouchstart={(e) => { e.stopPropagation(); e.preventDefault(); }}
													ontouchend={(e) => { e.stopPropagation(); e.preventDefault(); handleDependencyClick(depId); }}
													title="Click to open dependency task: {depQuest[1].title}"
													type="button"
												>
													{depQuest[1].title.length > 20 ? depQuest[1].title.substring(0, 20) + '...' : depQuest[1].title}
												</button>
											{:else}
												<span class="inline-flex items-center bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md text-xs flex-shrink-0">
													Unknown dependency
												</span>
											{/if}
										{/each}
									</div>
								</div>
							{/if}
						</div>
						{/each}
					</div>

					{#if listDndItems.length === 0}
						<div class="text-center py-12">
							<div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
								<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							</div>
							<h3 class="text-lg font-medium text-white mb-2">No tasks or quests found</h3>
							<p class="text-gray-400 mb-4">Get started by creating your first task or quest</p>
							<button
								onclick={showDialog}
								class="btn btn--primary"
							>
								Create Task
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- Schedule Panel -->
		<div class="hidden xl:block xl:w-80 xl:flex-shrink-0">
			<div class="bg-gray-800 rounded-3xl shadow-xl">
				<Schedule />
			</div>
		</div>
	</div>
</div>

{#if selectedTask?.key && selectedTask?.quest && holonID}
	<TaskModal
		quest={selectedTask.quest}
		questId={selectedTask.key}
		holonId={holonID}
		on:close={handleTaskDeleted}
		on:taskCompleted={handleTaskCompleted}
	/>
{/if}

<!-- Modern Task Input Modal -->
{#if showTaskInput}
	<div
		class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={(e) => { if (e.target === e.currentTarget) hideDialog(); }}
		onkeydown={handleDialogKeydown} 
		role="dialog"
		aria-modal="true"
		tabindex="-1" 
	>
		<div 
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative border border-gray-700"
			aria-labelledby="task-input-title"
		>
			<div class="p-6">
				<div class="flex items-center justify-between mb-6">
					<h3 id="task-input-title" class="text-white text-xl font-bold">Add New Task</h3>
					<button
						onclick={hideDialog}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
						aria-label="Close task input dialog"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				
				<form
					onsubmit={async (e) => {
						e.preventDefault();
						await handleAddTask();
						hideDialog();
					}}
					class="space-y-4"
				>
					<div>
						<label for="task-title" class="block text-sm font-medium text-gray-300 mb-2">Task Title</label>
						<input
							id="task-title"
							type="text"
							bind:value={newTask.title}
							placeholder="Enter task title..."
							class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
							required
						/>
					</div>
					<div>
						<label for="task-description" class="block text-sm font-medium text-gray-300 mb-2">Description</label>
						<textarea
							id="task-description"
							bind:value={newTask.description}
							placeholder="Enter task description..."
							class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white placeholder-gray-400 border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors resize-none"
							rows="3"
						></textarea>
					</div>
					<div>
						<label for="task-category" class="block text-sm font-medium text-gray-300 mb-2">Category</label>
						<select
							id="task-category"
							bind:value={newTask.category}
							class="w-full px-4 py-3 rounded-xl bg-gray-700 text-white border border-gray-600 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-colors"
						>
							<option value="">Select category...</option>
							{#each categories.filter(cat => cat !== 'all') as category}
								<option value={category}>{category}</option>
							{/each}
						</select>
					</div>
					<div class="flex justify-end gap-3 pt-4">
						<button
							type="button"
							onclick={hideDialog}
							class="btn btn--secondary"
							aria-label="Cancel adding task"
						>
							Cancel
						</button>
													<button
								type="submit"
								class="btn btn--primary"
								disabled={!newTask.title.trim()}
								aria-label="Add new {filterType === 'event' ? 'event' : 'task'}"
							>
								Create {filterType === 'event' ? 'Event' : 'Task'}
							</button>
					</div>
				</form>
			</div>
		</div>
	</div>
{/if}

<!-- Add animation components -->
{#if showFireworks}
	<Fireworks />
{/if}
{#if showConfetti}
	<Confetti />
{/if}

<!-- Quest Import Modal -->
{#if showImportModal}
	<QuestImportModal
		on:close={() => showImportModal = false}
		on:import={handleQuestImport}
	/>
{/if}

<!-- Completer Selection Modal -->
{#if showCompleterModal && taskToComplete}
	<div
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		onclick={(e) => { if (e.target === e.currentTarget) { showCompleterModal = false; taskToComplete = null; } }}
		onkeydown={(e) => e.key === 'Escape' && (showCompleterModal = false, taskToComplete = null)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 150 }}
	>
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700" transition:slide={{ duration: 200 }}>
			<div class="p-6">
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-white text-xl font-bold">Who completed this task?</h3>
					<button
						onclick={() => { showCompleterModal = false; taskToComplete = null; }}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
						aria-label="Close modal"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>

				<p class="text-gray-300 mb-2 font-medium truncate">"{taskToComplete.quest.title}"</p>
				<p class="text-gray-400 text-sm mb-4">Select who completed this task to record their contribution:</p>

				{#if completersLoading}
					<div class="flex items-center justify-center py-8">
						<div class="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
						<span class="text-gray-400 text-sm ml-3">Loading team members...</span>
					</div>
				{:else if availableCompleters.length === 0}
					<div class="text-center py-8">
						<div class="w-12 h-12 mx-auto mb-3 bg-gray-700 rounded-full flex items-center justify-center">
							<svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/>
							</svg>
						</div>
						<p class="text-gray-400">No users found</p>
						<p class="text-gray-500 text-sm mt-1">Add users to this holon first</p>
					</div>
				{:else}
					<div class="max-h-60 overflow-y-auto space-y-1 mb-4 overscroll-contain">
						{#each availableCompleters as user (user.id)}
							{@const isSelected = selectedCompleters.has(user.id)}
							<button
								class="w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left touch-manipulation select-none active:scale-[0.98] min-h-[56px] {isSelected ? 'bg-green-500/20 border border-green-500/40' : 'bg-gray-700 hover:bg-gray-600 border border-transparent'}"
								onclick={() => toggleCompleterSelection(user.id)}
							>
								<div class="w-6 h-6 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors {isSelected ? 'bg-green-500 border-green-500' : 'border-gray-500'}">
									{#if isSelected}
										<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
										</svg>
									{/if}
								</div>
								<img
									src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
									alt={user.firstName}
									class="w-10 h-10 rounded-full"
									loading="lazy"
								/>
								<div>
									<span class="text-white font-medium">{user.firstName} {user.lastName || ''}</span>
									{#if user.username}
										<span class="text-gray-400 text-sm block">@{user.username}</span>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}

				<div class="flex gap-3">
					<button
						onclick={() => { showCompleterModal = false; taskToComplete = null; selectedCompleters = new Set(); }}
						class="btn btn--secondary flex-1"
					>
						Cancel
					</button>
					<button
						onclick={completeWithSelectedCompleters}
						disabled={selectedCompleters.size === 0}
						class="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
						</svg>
						Complete ({selectedCompleters.size})
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Task card styling */
	.task-card {
		position: relative;
		cursor: grab;
	}

	.task-card:hover {
		cursor: pointer;
	}
</style>
