<script lang="ts">

	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import { replaceState } from "$app/navigation";
	import { fade, slide } from "svelte/transition";
	import { formatDate, formatTime } from "../utils/date";
	import type { HoloSphere } from "holosphere";
	import Schedule from "./ScheduleWidget.svelte";
	import TaskModal from "./TaskModal.svelte";
	import CanvasView from "./CanvasView.svelte";
	import { writable } from 'svelte/store';
	import Fireworks from "./Fireworks.svelte";
	import Confetti from "./Confetti.svelte";
	import { getHologramSourceName } from "../utils/holonNames";
	import { taskSortStore, updateTaskSort, sortTasks, type SortCriteria } from "../dashboard/store";
	// Add new imports for quest library
	import QuestImportModal from "./QuestImportModal.svelte";
	import { fetchHolonName } from "../utils/holonNames";

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
		type?: 'task' | 'quest' | 'event' | 'proposal' | 'recurring';
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
		_hologram?: {
			isHologram: boolean;
			soul: string;
			sourceHolon: string;
			localOverrides?: string[];
		};
		_deleted?: boolean;
	}

	interface Store {
		[key: string]: Quest;
	}


	let holosphere = getContext("holosphere") as HoloSphere;

	let holonID = $state(''); // Start empty so reactive block triggers on first valid ID
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
	let viewMode: 'list' | 'canvas' = $state('list');
	let showCompleted = $state(false);
	let showHolograms = $state(true);
	let sortedQuests: [string, Quest][] = [];
	// filteredQuests is now defined as a $derived value below

	// Initialize preferences with default values
	let showTaskInput = $state(false);
	let newTask: Quest = $state({
		id: generateId(),
		title: '',
		description: '',
		category: '',
		status: 'ongoing',
		type: filterType === 'all' ? 'task' : filterType, // Use filterType for new items
		participants: [],
		appreciation: []
	});

	let questsUnsubscribe: (() => void) | undefined;

	// Share to federation state
	let showShareDialog = $state(false);
	let questToShare: { key: string; quest: Quest } | null = $state(null);
	let selectedHolonsToShare: string[] = $state([]);
	let federatedHolons: Array<{ id: string; name: string }> = $state([]);
	let sharingInProgress = $state(false);
	let shareSuccess = $state('');
	let shareError = $state('');

	// Add initialization state tracking
	let isInitialized = false;
	let isSubscribed = false;
	let isLoading = $state(true);
	let connectionReady = false;
	let currentHolonId: string | null = null;

	// Add subscription state tracking
	let subscriptionState = {
		currentHolonID: null as string | null,
		batchTimeout: null as NodeJS.Timeout | null,
		pendingUpdates: new Map<string, Quest>()
	};

	// Add state for animations
	let showFireworks = $state(false);
	let showConfetti = $state(false);

	// Sort state variables - now using shared store
	let sortButtonIconRotation = $state(0); // No rotation for calendar icon

	// Subscribe to the shared sort state
	let sortCriteria = $derived($taskSortStore.criteria);
	let sortDirection = $derived($taskSortStore.direction);

	// SVG Paths for sort icons
	const calendarIconPath = "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 002 2z"; // Calendar icon
	const orderIndexIconPath = "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"; // Heroicons bars-3
	const directionalSortIconPath = "M12 5v14M19 12l-7 7-7-7"; // Current arrow
	let currentIconPath = $state(calendarIconPath); // Initial icon

	// Add these variables after the existing let declarations
	let selectedCategory = $state("all");
	let selectedUserId = $state("all");
	
	// Compute unique categories from quests
	let categories = $derived([
		"all",
		...new Set(
			Object.values(store)
				.filter((quest: any) => quest.category)
				.map((quest: any) => quest.category)
		),
	]);

	// Compute unique users from quests
	let allUsers = $derived.by(() => {
		const users = new Map<string, { id: string; name: string }>();

		Object.values(store).forEach(quest => {
			if (quest.participants) {
				quest.participants.forEach(p => {
					if (p.id && !users.has(p.id)) {
						const name = (p.firstName ? `${p.firstName} ${p.lastName || ''}` : p.username).trim();
						if (name) { // Only add users with a name
							users.set(p.id, {
								id: p.id,
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

	// Add cache for hologram source names to avoid repeated resolution
	let hologramSourceNames = new Map<string, string>();

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
					if (!quest.participants || !quest.participants.some(p => p.id === selectedUserId)) {
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

			// Filter holograms if showHolograms is false
			if (!showHolograms && quest._hologram?.isHologram) {
				return false;
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
		let newCriteria: SortCriteria;
		let newDirection: 'asc' | 'desc';
		
		if (sortCriteria === 'created' && sortDirection === 'desc') {
			newCriteria = 'created';
			newDirection = 'asc';
			currentIconPath = calendarIconPath;
			sortButtonIconRotation = 180; // Calendar icon rotated for oldest first
		} else if (sortCriteria === 'created' && sortDirection === 'asc') {
			newCriteria = 'orderIndex';
			newDirection = 'asc';
			currentIconPath = orderIndexIconPath;
			sortButtonIconRotation = 0; // No rotation for burger icon
		} else if (sortCriteria === 'orderIndex') {
			newCriteria = 'positionX';
			newDirection = 'asc';
			currentIconPath = directionalSortIconPath;
			sortButtonIconRotation = 270; // Arrow left for X asc
		} else if (sortCriteria === 'positionX' && sortDirection === 'asc') {
			newCriteria = 'positionX';
			newDirection = 'desc';
			currentIconPath = directionalSortIconPath;
			sortButtonIconRotation = 90; // Arrow right for X desc
		} else if (sortCriteria === 'positionX' && sortDirection === 'desc') {
			newCriteria = 'positionY';
			newDirection = 'asc';
			currentIconPath = directionalSortIconPath;
			sortButtonIconRotation = 0; // Arrow down for Y asc
		} else if (sortCriteria === 'positionY' && sortDirection === 'asc') {
			newCriteria = 'positionY';
			newDirection = 'desc';
			currentIconPath = directionalSortIconPath;
			sortButtonIconRotation = 180; // Arrow up for Y desc
		} else { // Was positionY, desc, reset to created
			newCriteria = 'created';
			newDirection = 'desc'; // Newest first
			currentIconPath = calendarIconPath;
			sortButtonIconRotation = 0; // Calendar icon for newest first
		}
		
		// Update the shared store
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
		// Use timestamp + random suffix to prevent ID collisions on rapid creates
		return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	// Modify handleAddTask to use a default 'Dashboard User' initiator if user data fetch fails or returns no data, instead of throwing an error.
	async function handleAddTask() {
		if (!holosphere || !holonID || !newTask.title.trim()) {
			return;
		}

		try {
			let initiatorInfo;
			try {
				// Attempt to get user data
				const userData = await holosphere.get(holonID, 'users', holonID);

				if (userData && typeof userData === 'object' && userData !== null) {
					initiatorInfo = {
						id: holonID,
						username: userData.username || "Unknown User",
						firstName: userData.first_name || "",
						lastName: userData.last_name || ""
					};
				} else {
					// User data not found or not in expected format, use default
					console.warn(`User data not found or in unexpected format for holonID: ${holonID}. Using default "Dashboard User" as initiator.`);
					initiatorInfo = {
						id: holonID, 
						username: "Dashboard User",
						firstName: "Dashboard", 
						lastName: "User"      
					};
				}
			} catch (fetchError) {
				// Error during fetch, use default
				console.error('Error fetching user data:', fetchError);
				console.warn(`Using default "Dashboard User" as initiator due to fetch error for holonID: ${holonID}.`);
				initiatorInfo = {
					id: holonID,
					username: "Dashboard User",
					firstName: "Dashboard",
					lastName: "User"
				};
			}

			const newOrderIndex = filteredQuests.length > 0 
				? Math.max(...filteredQuests.map(([_, q]) => q.orderIndex ?? -1)) + 1 
				: 0;

			const task: Quest = {
				...newTask,
				initiator: initiatorInfo, // Use the determined initiatorInfo
				created: new Date().toISOString(),
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
		} catch (error) {
			console.error('Error adding task:', error);
		}
	}

	// Add drag and drop state
	const dragState = writable<{
		dragging: boolean;
		draggedId: string | null;
		dragOverId: string | null;
	}>({
		dragging: false,
		draggedId: null,
		dragOverId: null
	});

	// Add drag and drop handlers
	function handleDragStart(event: DragEvent, key: string) {
		event.dataTransfer?.setData('text/plain', key);
		dragState.set({
			dragging: true,
			draggedId: key,
			dragOverId: null
		});
	}

	function handleDragOver(event: DragEvent, key: string) {
		event.preventDefault();
		dragState.update(state => ({
			...state,
			dragOverId: key
		}));
	}

	function handleDragEnd() {
		dragState.set({
			dragging: false,
			draggedId: null,
			dragOverId: null
		});
	}

	// Modify handleDrop to use 100px spacing
	async function handleDrop(event: DragEvent, targetKey: string) {
		event.preventDefault();
		const sourceKey = event.dataTransfer?.getData('text/plain') || '';

		// Ensure holonID is not null before proceeding
		const currentHolonID = holonID; // Use the reactive holonID variable
		if (!currentHolonID) {
			console.error("Cannot handle drop: holonID is null.");
			handleDragEnd();
			return;
		}

		if (!sourceKey || sourceKey === targetKey) {
			handleDragEnd();
			return;
		}

		if (sortCriteria === 'orderIndex') {
			const currentQuestsArray = [...filteredQuests];
			const sourceIndex = currentQuestsArray.findIndex(([key]) => key === sourceKey);
			const targetIndexOriginal = currentQuestsArray.findIndex(([key]) => key === targetKey);

			if (sourceIndex === -1 || targetIndexOriginal === -1) {
				handleDragEnd();
				return;
			}

			const [draggedItemKey, draggedItemQuest] = currentQuestsArray.splice(sourceIndex, 1)[0];
			
			const actualTargetIndex = sourceIndex < targetIndexOriginal ? targetIndexOriginal -1 : targetIndexOriginal;
			
			currentQuestsArray.splice(actualTargetIndex, 0, [draggedItemKey, draggedItemQuest]);

			// Temporarily disable subscription to prevent override during update
			let tempQuestsUnsub = questsUnsubscribe;
			questsUnsubscribe = undefined;

			// Build updates for store immutably
			const storeUpdates: Record<string, Quest> = {};
			const updatedQuestsPromises = currentQuestsArray.map(async ([key, questToUpdate], index) => {
				if (questToUpdate.orderIndex !== index) {
					const updatedQuest = { ...questToUpdate, id: key, orderIndex: index };
					storeUpdates[key] = updatedQuest;
					return holosphere.put(currentHolonID, 'quests', updatedQuest);
				}
				return Promise.resolve();
			});

			try {
				await Promise.all(updatedQuestsPromises);
				// Re-enable subscription after save
				questsUnsubscribe = tempQuestsUnsub;
				// Immutable store update for Svelte reactivity
				store = { ...store, ...storeUpdates };
			} catch (error) {
				console.error('Error updating quest orderIndex after drop:', error);
				// Re-enable subscription even on error
				questsUnsubscribe = tempQuestsUnsub;
			}
		} else { // sortCriteria is 'positionX' or 'positionY'
			const POSITION_STEP = 10.0;

			const sourceQuestEntry = filteredQuests.find(([k]) => k === sourceKey);
			if (!sourceQuestEntry) { 
				handleDragEnd(); 
				console.error('Source quest not found during drop for position sort.');
				return; 
			}
			const draggedQuest = { ...sourceQuestEntry[1] }; // Mutable copy of the quest data

			const otherItems = filteredQuests.filter(([k]) => k !== sourceKey);
			const insertionIndexInOthers = otherItems.findIndex(([k]) => k === targetKey);

			if (insertionIndexInOthers === -1) {
				console.error("Error determining drop position: targetKey not found in otherItems.");
				handleDragEnd();
				return;
			}

			const prevTaskData = (insertionIndexInOthers > 0) ? otherItems[insertionIndexInOthers - 1][1] : null;
			const nextTaskData = otherItems[insertionIndexInOthers][1]; // This is the quest data for targetKey

			const mainAxis = sortCriteria === 'positionX' ? 'x' : 'y';
			const crossAxis = sortCriteria === 'positionX' ? 'y' : 'x';

			const prevMainCoord = prevTaskData?.position?.[mainAxis];
			const nextMainCoord = nextTaskData?.position?.[mainAxis];

			let newMainCoordValue: number;

			if (prevMainCoord !== undefined && nextMainCoord !== undefined) {
				newMainCoordValue = (prevMainCoord + nextMainCoord) / 2.0;
			} else if (nextMainCoord !== undefined) {
				newMainCoordValue = nextMainCoord - (POSITION_STEP * (sortDirection === 'asc' ? 1 : -1));
			} else if (prevMainCoord !== undefined) {
				newMainCoordValue = prevMainCoord + (POSITION_STEP * (sortDirection === 'asc' ? 1 : -1));
			} else {
				newMainCoordValue = draggedQuest.position?.[mainAxis] ?? 0;
			}
			
			const currentFullPosition = draggedQuest.position || { x: 0, y: 0 };
			
			let newPosition = {
				...currentFullPosition,
				[mainAxis]: newMainCoordValue
			};

			if (newPosition[crossAxis] === undefined) {
				newPosition[crossAxis] = 0;
			}
			draggedQuest.position = newPosition;

			draggedQuest.id = sourceKey; // Ensure ID is set
			try {
				await holosphere.put(currentHolonID, 'quests', draggedQuest);
				// Immutable store update for Svelte reactivity
				store = { ...store, [sourceKey]: draggedQuest };
			} catch (error) {
				console.error(`Error updating quest position after drop (sort by ${sortCriteria}):`, error);
			}
		}

		handleDragEnd();
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
					created: new Date().toISOString(),
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
		} catch (error) {
			console.error('Error importing quests:', error);
			alert("Error importing quests. Please check the console for details.");
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

	// Function to get hologram source name from cache
	function getHologramSource(hologramSoul: string | undefined): string {
		if (!hologramSoul) return '';
		
		// Return cached name if available
		if (hologramSourceNames.has(hologramSoul)) {
			return hologramSourceNames.get(hologramSoul)!;
		}
		
		// Return fallback while loading
		const match = hologramSoul.match(/Holons\/([^\/]+)/);
		return match ? `Holon ${match[1]}` : 'External Source';
	}

		// Function to pre-resolve hologram names for all quests
	async function preResolveHologramNames(questsToProcess: [string, Quest][]) {
		const hologramSouls = new Set<string>();

		// Collect all unique hologram souls that we don't already have cached
		questsToProcess.forEach(([_, quest]) => {
			if (quest._hologram?.isHologram && quest._hologram.soul) {
				// Only add if we don't already have it cached
				if (!hologramSourceNames.has(quest._hologram.soul)) {
					hologramSouls.add(quest._hologram.soul);
				}
			}
		});

		// Only resolve names we don't already have
		if (hologramSouls.size === 0) return;

		// Resolve names for all new hologram souls using the async version to get real names
		// fetchHolonName is already imported at the top - no dynamic import needed
		const promises = Array.from(hologramSouls).map(async (hologramSoul) => {
			try {
				const match = hologramSoul.match(/Holons\/([^\/]+)/);
				if (match) {
					const holonId = match[1];
					const realName = await fetchHolonName(holosphere, holonId);
					hologramSourceNames.set(hologramSoul, realName);
				}
			} catch (error) {
				// Error resolving hologram source name - set fallback
				const match = hologramSoul.match(/Holons\/([^\/]+)/);
				if (match) {
					hologramSourceNames.set(hologramSoul, `Holon ${match[1]}`);
				}
			}
		});

		await Promise.allSettled(promises);

		// Trigger reactivity only if we actually resolved new names
		if (hologramSouls.size > 0) {
			hologramSourceNames = new Map(hologramSourceNames);
		}
	}

	// Add color category function
	function getColorFromCategory(category: string | undefined, type: string = 'task') {
		if (!category) {
			// Default colors based on type
			switch (type) {
				case 'event':
					return "hsl(280, 70%, 85%)"; // Purple for events
				case 'quest':
					return "hsl(200, 70%, 85%)"; // Blue for quests
				default:
					return "#E5E7EB"; // Gray for tasks
			}
		}

		// For items with categories, generate color but adjust based on type
		let hash = 0;
		for (let i = 0; i < category.length; i++) {
			hash = (hash << 5) - hash + category.charCodeAt(i);
			hash = hash & hash;
		}

		const hue = Math.abs(hash % 360);
		// Adjust saturation and lightness based on type
		switch (type) {
			case 'event':
				return `hsl(${hue}, 85%, 80%)`; // More saturated for events
			case 'quest':
				return `hsl(${hue}, 75%, 82%)`; // Slightly saturated for quests
			default:
				return `hsl(${hue}, 70%, 85%)`; // Original for tasks
		}
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

	// Add fetchData function with retry logic
	async function fetchData(retryCount = 0) {
		if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
			return;
		}

		isLoading = true;

		// Clean up previous subscription before fetching new data
		if (questsUnsubscribe) {
			questsUnsubscribe();
			questsUnsubscribe = undefined;
		}
		subscriptionState.currentHolonID = null;

		// Clear store for fresh data
		store = {};

		try {
			const initialData = await holosphere.getAll(holonID, "quests");

			// Process initial data
			const newStore: Store = {};
			if (Array.isArray(initialData)) {
				initialData.forEach((quest: any, index) => {
					if (quest && quest.id) {
						// Use the quest ID as the key, or generate one if missing
						const key = quest.id || `initial_${index}`;

						// Ensure required arrays are initialized
						if (!quest.participants) quest.participants = [];
						if (!quest.appreciation) quest.appreciation = [];

						newStore[key] = quest as Quest;
					}
				});
			} else if (typeof initialData === 'object' && initialData !== null) {
				// If it's already a keyed object, use it directly
				Object.entries(initialData).forEach(([key, quest]: [string, any]) => {
					if (quest && quest.id) {
						// Ensure required arrays are initialized
						if (!quest.participants) quest.participants = [];
						if (!quest.appreciation) quest.appreciation = [];

						newStore[key] = quest as Quest;
					}
				});
			}
			
			// Update store and stats
			store = newStore;
			updateStats();

			// Pre-resolve hologram names in background (don't block rendering)
			preResolveHologramNames(Object.entries(store));

			// Set up subscription in background (don't block rendering)
			subscribe();

			// Open task modal if we have a selectedTaskId from URL
			if (selectedTaskId && store[selectedTaskId]) {
				selectedTask = { key: selectedTaskId, quest: store[selectedTaskId] };
				// Clear the task parameter from URL
				const url = new URL(window.location.href);
				url.searchParams.delete('task');
				replaceState(url.toString(), { replaceState: true });
				selectedTaskId = null; // Reset after opening
			}

		} catch (error: any) {
			// Retry on network errors up to 3 times with exponential backoff
			if (retryCount < 3) {
				const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
				setTimeout(() => fetchData(retryCount + 1), delay);
				return;
			}
		} finally {
			isLoading = false;
		}
	}

	function handleDialogKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			hideDialog();
		}
	}


	// Set up real-time subscription for future updates (does NOT fetch initial data)
	async function subscribe() {
		if (!holosphere || !holonID) return;

		// Don't resubscribe if already subscribed to this holon
		if (subscriptionState.currentHolonID === holonID && questsUnsubscribe) return;

		// Clear existing subscription
		if (questsUnsubscribe) {
			questsUnsubscribe();
			questsUnsubscribe = undefined;
		}

		// Capture the holon ID at subscription time to verify in callbacks
		const subscribedHolonID = holonID;

		try {
			// Update subscription state
			subscriptionState.currentHolonID = holonID;

			// Set up subscription for future updates (initial data already loaded by fetchData)
			const off = holosphere.subscribe(holonID, "quests", async (newquest: Quest | null, key?: string) => {
				// IMPORTANT: Verify this callback is still for the current holon
				// Old subscriptions may fire after we've switched holons
				if (holonID !== subscribedHolonID) {
					return; // Ignore updates from old subscription
				}

				// Check if this is the circular hologram that's causing issues
				if (newquest && newquest.id === '1750286259429') {
					console.warn('Blocking circular hologram quest:', newquest.id);
					return;
				}

				// Use the key from the callback, or fall back to quest.id
				const questKey = key || newquest?.id;
				if (!questKey) {
					return;
				}

				// Update store atomically - read current store at update time to avoid race conditions
				// Check if this is a deletion: either null, _deleted flag, or empty object (no id)
				const isDeleted = !newquest || newquest._deleted || !newquest.id;

				if (!isDeleted) {
					// Ensure required arrays are initialized
					if (!newquest.participants) newquest.participants = [];
					if (!newquest.appreciation) newquest.appreciation = [];
					// Atomic update: spread current store and add/update this quest
					store = { ...store, [questKey]: newquest };
				} else {
					// Delete: create new store without this key
					const { [questKey]: _, ...rest } = store;
					store = rest;
				}
				updateStats();

				// Only resolve hologram names if this is a new hologram we haven't seen before
				if (newquest && newquest._hologram?.isHologram && newquest._hologram.soul &&
					!hologramSourceNames.has(newquest._hologram.soul)) {
					await preResolveHologramNames([[questKey, newquest]]);
				}
			});

			// Ensure the unsubscribe handler is callable and typed correctly
			if (typeof off === 'function') {
				questsUnsubscribe = off as unknown as () => void;
			}
		} catch (error) {
			console.error('Error setting up quest subscription:', error);
			subscriptionState.currentHolonID = null; // Reset on error
			questsUnsubscribe = undefined;
		}
	}

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
			if (storedViewMode === 'list' || storedViewMode === 'canvas') {
				viewMode = storedViewMode as 'list' | 'canvas';
			}
			showCompleted = localStorage.getItem("kanbanShowCompleted") === "true";
			const storedShowHolograms = localStorage.getItem("taskShowHolograms");
			if (storedShowHolograms !== null) {
				showHolograms = storedShowHolograms === "true";
			}
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

		// Note: Data fetching is handled by the reactive block below
		// which triggers when $page.params.id !== holonID

		// Cleanup
		return () => {
			if (questsUnsubscribe) questsUnsubscribe();
			questsUnsubscribe = undefined;
			if (subscriptionState.batchTimeout) {
				clearTimeout(subscriptionState.batchTimeout);
			}
			subscriptionState.currentHolonID = null;
			currentHolonId = null; // Reset so next mount triggers fetch
			window.removeEventListener('openDependencyTask', handleDependencyTask as EventListener);
		};
	});

	// Helper to validate holon ID
	const isValidHolonId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	// Reactive block: when page ID changes (different holon), fetch new data
	$effect(() => {
		if ($page.params.id && $page.params.id !== holonID && isValidHolonId($page.params.id) && holosphere) {
			holonID = $page.params.id;
			currentHolonId = $page.params.id;
			ID.set(holonID);
			connectionReady = true;
			isLoading = true;
			fetchData();
		}
	});

	// Save showHolograms preference to localStorage
	$effect(() => {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem("taskShowHolograms", showHolograms.toString());
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

	// ============================================================================
	// Share to Federation Functions
	// ============================================================================

	async function openShareDialog(key: string, quest: Quest) {
		questToShare = { key, quest };
		selectedHolonsToShare = [];
		shareError = '';
		shareSuccess = '';
		showShareDialog = true;
		await loadFederatedHolons();
	}

	async function loadFederatedHolons() {
		if (!holosphere || !holonID) return;

		try {
			const federationInfo = await holosphere.getFederation(holonID);
			if (federationInfo?.federated && Array.isArray(federationInfo.federated)) {
				const holons: Array<{ id: string; name: string }> = [];
				for (const id of federationInfo.federated) {
					const name = await fetchHolonName(holosphere, id);
					holons.push({ id, name });
				}
				federatedHolons = holons;
			} else {
				federatedHolons = [];
			}
		} catch (err) {
			console.error('Failed to load federated holons:', err);
			federatedHolons = [];
		}
	}

	async function shareQuestToSelected() {
		if (!questToShare || !holosphere || !holonID) return;

		sharingInProgress = true;
		shareError = '';
		shareSuccess = '';

		try {
			for (const targetHolonId of selectedHolonsToShare) {
				// Create hologram reference in target holon using propagateData
				if (holosphere.propagateData) {
					await holosphere.propagateData(
						questToShare.quest,
						holonID,
						targetHolonId,
						'quests',
						{ mode: 'reference' }
					);
				} else if (holosphere.propagate) {
					// Alternative method if propagateData doesn't exist
					await holosphere.propagate(holonID, 'quests', questToShare.quest, {
						targets: [targetHolonId],
						mode: 'reference'
					});
				} else {
					console.warn('No propagation method available on holosphere');
				}
			}

			shareSuccess = `Shared to ${selectedHolonsToShare.length} holon(s)`;
			setTimeout(() => {
				showShareDialog = false;
				questToShare = null;
				shareSuccess = '';
			}, 1500);
		} catch (err) {
			shareError = err instanceof Error ? err.message : 'Failed to share quest';
			console.error('Share quest error:', err);
		} finally {
			sharingInProgress = false;
		}
	}

	function closeShareDialog() {
		showShareDialog = false;
		questToShare = null;
		selectedHolonsToShare = [];
		shareError = '';
		shareSuccess = '';
	}

</script>

<div class="space-y-8">
	<!-- Header Section -->
	<div class="bg-gradient-to-r from-gray-800 to-gray-700 py-6 px-3 sm:py-8 sm:px-8 rounded-3xl shadow-2xl">
		<div class="flex flex-col sm:flex-row justify-between items-center sm:gap-0 gap-2">
			<div class="text-center sm:text-left mb-2 sm:mb-0 flex-1 min-w-0">
				<h1 class="text-3xl sm:text-4xl font-bold text-white mb-1 sm:mb-2 truncate overflow-hidden text-ellipsis">
					{filterType === 'event' ? 'Events & Scheduled Items' : filterType === 'task' ? 'Tasks' : 'Tasks & Quests'}
				</h1>
			</div>
			<!-- Hide date on xs screens -->
			<p class="text-gray-300 text-base sm:text-lg flex-shrink-0 hidden sm:block">{new Date().toDateString()}</p>
		</div>
	</div>

	<!-- Main Content Container -->
	<div class="flex flex-col xl:flex-row gap-4 sm:gap-8">
		<!-- Tasks Panel -->
		<div class="xl:flex-1 bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
			<div class="p-3 sm:p-8">
				<!-- Stats Section -->
				<div class="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-4 mb-4 sm:mb-8">
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{statsUnassigned}
						</div>
						<div class="text-sm text-gray-400">Unassigned</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{statsOpenItems}
						</div>
						<div class="text-sm text-gray-400">Open Items</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{statsRecurring}
						</div>
						<div class="text-sm text-gray-400">Recurring</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{statsCompleted}
						</div>
						<div class="text-sm text-gray-400">Completed</div>
					</div>
					<div class="bg-gray-700/50 rounded-2xl p-4 text-center">
						<div class="text-2xl font-bold text-white mb-1">
							{statsFilterSpecific}
						</div>
						<div class="text-sm text-gray-400">{filterType === 'event' ? 'Scheduled' : filterType === 'task' ? 'Tasks' : 'Quests'}</div>
					</div>
				</div>

				<!-- Controls Section -->
				<div class="mb-4 sm:mb-6">
					<div class="flex flex-wrap sm:flex-nowrap items-center gap-1 sm:gap-2 justify-between compact-toolbar">
						<!-- View Mode Toggle -->
						<div class="flex items-center bg-gray-700 rounded-xl p-0.5 h-9">
							<button
								class="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors text-sm h-7 {viewMode === 'list' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}"
								on:click={() => (viewMode = 'list')}
								aria-label="Switch to list view"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<line x1="8" y1="6" x2="21" y2="6" />
									<line x1="8" y1="12" x2="21" y2="12" />
									<line x1="8" y1="18" x2="21" y2="18" />
									<line x1="3" y1="6" x2="3.01" y2="6" />
									<line x1="3" y1="12" x2="3.01" y2="12" />
									<line x1="3" y1="18" x2="3.01" y2="18" />
								</svg>
								<span>List</span>
							</button>
							<button
								class="flex items-center gap-1 px-3 py-1.5 rounded-lg transition-colors text-sm h-7 {viewMode === 'canvas' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}"
								on:click={() => (viewMode = 'canvas')}
								aria-label="Switch to canvas view"
							>
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M5 9l-3 3 3 3"></path>
									<path d="M9 5l3-3 3 3"></path>
									<path d="M9 19l3 3 3-3"></path>
									<path d="M19 9l3 3-3 3"></path>
									<path d="M2 12h20"></path>
									<path d="M12 2v20"></path>
								</svg>
								<span>Canvas</span>
							</button>
						</div>

						<!-- Category Filter -->
						<div class="relative flex-1 w-auto min-w-[120px] max-w-[180px]">
							<select
								bind:value={selectedCategory}
								class="appearance-none bg-gray-700 text-white px-3 py-1.5 pr-7 rounded-xl cursor-pointer text-sm border border-gray-600 focus:border-blue-500 focus:outline-none w-full h-9"
							>
								{#each categories as category}
									<option value={category}>
										{category === "all" ? "All Categories" : category}
									</option>
								{/each}
							</select>
							<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
								<svg class="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
									<path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
								</svg>
							</div>
						</div>

						<!-- User Filter -->
						<div class="relative flex-1 w-auto min-w-[120px] max-w-[180px]">
							<select
								bind:value={selectedUserId}
								class="appearance-none bg-gray-700 text-white px-3 py-1.5 pr-7 rounded-xl cursor-pointer text-sm border border-gray-600 focus:border-blue-500 focus:outline-none w-full h-9"
							>
								{#each allUsers as user}
									<option value={user.id}>{user.name}</option>
								{/each}
							</select>
							<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
								<svg class="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
									<path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"/>
								</svg>
							</div>
						</div>

						<!-- Sort Button -->
						<button
							class="flex items-center justify-center gap-1 px-3 py-1.5 bg-gray-700 text-white rounded-xl text-sm hover:bg-gray-600 transition-colors border border-gray-600 w-auto min-w-[80px] h-9"
							on:click={handleSortButtonClick}
							aria-label="Sort tasks"
						>
							<span>Sort</span>
							{#key currentIconPath}
								<svg
									class="w-3 h-3 transform transition-transform"
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

						<!-- Toggle Switches -->
						<div class="flex flex-row gap-2 items-center ml-2">
							<!-- Show Completed Toggle -->
							<label class="flex items-center cursor-pointer text-sm">
								<div class="relative">
									<input
										type="checkbox"
										class="sr-only"
										bind:checked={showCompleted}
									/>
									<div class="w-8 h-4 bg-gray-600 rounded-full shadow-inner border border-gray-500"></div>
									<div
										class="dot absolute w-3 h-3 bg-white rounded-full transition-transform duration-300 ease-in-out left-0.5 top-0.5"
										class:translate-x-4={showCompleted}
									></div>
								</div>
								<span class="ml-1 text-white font-medium">Show Completed</span>
							</label>

							<!-- Show Holograms Toggle -->
							<label class="flex items-center cursor-pointer text-sm">
								<div class="relative">
									<input
										type="checkbox"
										class="sr-only"
										bind:checked={showHolograms}
									/>
									<div class="w-8 h-4 bg-gray-600 rounded-full shadow-inner border border-gray-500"></div>
									<div
										class="dot absolute w-3 h-3 bg-white rounded-full transition-transform duration-300 ease-in-out left-0.5 top-0.5"
										class:translate-x-4={showHolograms}
									></div>
								</div>
								<span class="ml-1 text-white font-medium">Show Holograms</span>
							</label>
						</div>
					</div>
				</div>

				<!-- Action Buttons -->
				<div class="flex justify-center gap-4 mb-6">
					<button
						on:click={showDialog}
						class="w-12 h-12 bg-gray-600 hover:bg-gray-500 text-white rounded-full flex items-center justify-center transition-all duration-300 transform hover:scale-110 shadow-lg hover:shadow-xl"
						aria-label="Add new task"
					>
						<span class="text-xl font-bold leading-none">+</span>
					</button>
					
					<button
						on:click={() => showImportModal = true}
						class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex items-center gap-2 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl text-sm font-medium"
						aria-label="Import quests from JSON file or library"
						title="Import quests from JSON file or library"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
						</svg>
						Import Quests
					</button>
				</div>

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
				{:else}
					<div class="space-y-2 sm:space-y-3">
										{#each filteredQuests as [key, quest]}
					{#if quest.status !== "completed" || (showCompleted && quest.status === "completed")}
						<div
							id={key}
							class="w-full task-card relative text-left group cursor-pointer"
							on:click|stopPropagation={() => handleTaskClick(key, quest)}
							draggable="true"
							on:dragstart={(e) => handleDragStart(e, key)}
							on:dragover={(e) => handleDragOver(e, key)}
							on:drop={(e) => handleDrop(e, key)}
							on:dragend={handleDragEnd}
							role="button"
							tabindex="0"
							aria-label={`Open task: ${quest.title}`}
							class:dragging={$dragState.draggedId === key}
							class:drag-over={$dragState.dragOverId === key}
							on:keydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									handleTaskClick(key, quest);
								}
							}}
						>
							<div
								class="p-2 sm:p-3 rounded-lg sm:rounded-xl transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005]"
								style="background-color: {getColorFromCategory(quest.category, quest.type)};
								   opacity: {quest._hologram?.isHologram ? '0.75' : '1'};
								   {quest._hologram?.isHologram ? 'border: 2px solid #00BFFF; box-sizing: border-box; box-shadow: 0 0 20px rgba(0, 191, 255, 0.4), inset 0 0 20px rgba(0, 191, 255, 0.1);' : ''}"
							>
								<div class="flex items-center justify-between gap-2 sm:gap-3">
									<div class="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
										<!-- Task Icon -->
										<div class="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 rounded-lg bg-black/20 flex items-center justify-center text-xs sm:text-sm">
											{quest.status === 'completed' ? '✅' : quest.type === 'event' ? '📅' : quest.type === 'quest' ? '⚔️' : quest.type === 'recurring' || quest.status === 'recurring' || quest.status === 'repeating' ? '🔄' : (filterType === 'event' && quest.when) ? '📅' : '✓'}
										</div>
										
										<!-- Main Content -->
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-1 sm:gap-2 mb-0.5 sm:mb-1">
												<h3 class="text-sm sm:text-base font-bold truncate {quest.status === 'completed' ? 'text-gray-800 line-through' : 'text-gray-800'}">
													{quest.title}
												</h3>
												{#if quest.category}
													<span class="inline-block px-1.5 sm:px-2 py-0.5 text-xs bg-black/10 text-gray-700 rounded-md flex-shrink-0 hidden sm:inline-block">
														{quest.category}
													</span>
												{/if}
												{#if quest._hologram?.isHologram}
													<span
														class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-800 flex-shrink-0 hover:bg-blue-500/30 transition-colors cursor-pointer"
														title="Navigate to source holon: {getHologramSource(quest._hologram.soul)}"
														on:click|stopPropagation={() => {
															if (quest._hologram?.sourceHolon) {
																window.location.href = `/${quest._hologram.sourceHolon}/tasks`;
															}
														}}
														on:keydown|stopPropagation={(e) => {
															if (e.key === 'Enter' || e.key === ' ') {
																if (quest._hologram?.sourceHolon) {
																	window.location.href = `/${quest._hologram.sourceHolon}/tasks`;
																}
															}
														}}
														tabindex="0"
														role="button"
														aria-label="Navigate to source holon: {getHologramSource(quest._hologram.soul)}"
													>
														<svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
															<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
														</svg>
														{getHologramSource(quest._hologram.soul)}
														<svg class="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
														</svg>
													</span>
												{/if}
											</div>

											{#if quest.description}
												<p class="text-xs sm:text-sm mb-1 sm:mb-2 line-clamp-2 {quest.status === 'completed' ? 'text-gray-700' : 'text-gray-700'}">{quest.description}</p>
											{/if}
											
											{#if quest.dependsOn && quest.dependsOn.length > 0}
												<div class="text-xs text-gray-600 mb-1">
													<div class="flex items-center gap-1 mb-1">
														<span class="text-blue-600 flex-shrink-0">📌 Depends on:</span>
													</div>
													<div class="flex flex-wrap items-center gap-1">
														{#each quest.dependsOn as depId, index}
															{@const depQuest = Object.entries(store).find(([key, q]) => key === depId)}
															{#if depQuest}
																<button
																	class="inline-flex items-center bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md text-xs hover:bg-blue-200 transition-colors cursor-pointer touch-manipulation min-h-[24px] min-w-[24px] flex-shrink-0"
																	on:click|stopPropagation={() => handleDependencyClick(depId)}
																	on:touchstart|stopPropagation={(e) => e.preventDefault()}
																	on:touchend|stopPropagation={(e) => {
																		e.preventDefault();
																		handleDependencyClick(depId);
																	}}
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
									</div>
									
									<!-- Right Side Content -->
									<div class="flex items-center gap-1.5 sm:gap-3 text-xs sm:text-sm text-gray-700">
										{#if quest.when}
											<div class="text-center hidden sm:block" title="Scheduled time">
												<span class="block text-xs opacity-75">
													{formatDate(quest.when)} @ {formatTime(quest.when)}
													{#if quest.ends}- {formatTime(quest.ends)}{/if}
												</span>
											</div>
										{/if}
										
										{#if quest.participants && quest.participants.length > 0}
											<div class="flex -space-x-1 relative" title={quest.participants.map(p => `${p.firstName || p.username} ${p.lastName ? p.lastName[0] + '.' : ''}`).join(', ')}>
												{#each quest.participants.slice(0, 3) as participant}
													{#if participant.id}
														<img 
															class="w-5 h-5 sm:w-7 sm:h-7 rounded-full border-1 sm:border-2 border-white object-cover" 
															src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`} 
															alt={participant.firstName || participant.username || 'User'} 
															title={`${participant.firstName || participant.username} ${participant.lastName || ''}`}
														/>
													{:else}
														<div class="w-5 h-5 sm:w-7 sm:h-7 rounded-full border-1 sm:border-2 border-white flex items-center justify-center text-xs font-medium bg-blue-500 text-white">
															{participant.firstName ? participant.firstName[0] : (participant.username ? participant.username[0] : '?')}
														</div>
													{/if}
												{/each}
												{#if quest.participants.length > 3}
													<div class="w-5 h-5 sm:w-7 sm:h-7 rounded-full border-1 sm:border-2 border-white flex items-center justify-center text-xs font-medium bg-gray-500 text-white">
														<span>+{quest.participants.length - 3}</span>
													</div>
												{/if}
											</div>
										{/if}

										{#if quest.appreciation && quest.appreciation.length > 0}
											<div class="flex items-center gap-0.5 sm:gap-1" title={`${quest.appreciation.length} appreciations`}>
												<span class="text-xs">👍</span>
												<span class="text-xs sm:text-sm">{quest.appreciation.length}</span>
											</div>
										{/if}

										<!-- Share to Federation Button (only for non-hologram quests) -->
										{#if !quest._hologram?.isHologram}
											<button
												class="text-gray-500 hover:text-blue-400 p-1 rounded transition-colors hidden sm:block"
												title="Share to federated holons"
												on:click|stopPropagation={() => openShareDialog(key, quest)}
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
												</svg>
											</button>
										{/if}
									</div>
								</div>
							</div>
						</div>
							{/if}
						{/each}
						
						{#if filteredQuests.length === 0}
							<div class="text-center py-12">
								<div class="w-16 h-16 mx-auto mb-4 bg-gray-700 rounded-full flex items-center justify-center">
									<svg class="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
									</svg>
								</div>
								<h3 class="text-lg font-medium text-white mb-2">No tasks or quests found</h3>
								<p class="text-gray-400 mb-4">Get started by creating your first task or quest</p>
								<button
									on:click={showDialog}
									class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-colors"
								>
									Create Task
								</button>
							</div>
						{/if}
					</div>
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

{#if selectedTask && holonID}
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
		on:click|self={hideDialog}
		on:keydown={handleDialogKeydown} 
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
						on:click={hideDialog}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
						aria-label="Close task input dialog"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				
				<form 
					on:submit|preventDefault={async (e) => {
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
							on:click={hideDialog}
							class="px-6 py-2.5 text-sm font-medium rounded-xl bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors"
							aria-label="Cancel adding task"
						>
							Cancel
						</button>
													<button
								type="submit"
								class="px-6 py-2.5 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
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

<!-- Share to Federation Dialog -->
{#if showShareDialog && questToShare}
	<div
		class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:click|self={closeShareDialog}
		on:keydown={(e) => e.key === 'Escape' && closeShareDialog()}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		transition:fade={{ duration: 150 }}
	>
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700" transition:slide={{ duration: 200 }}>
			<div class="p-6">
				<div class="flex items-center justify-between mb-4">
					<h3 class="text-white text-xl font-bold">Share Quest</h3>
					<button
						on:click={closeShareDialog}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
						aria-label="Close share dialog"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>

				<p class="text-gray-300 mb-2 font-medium truncate">"{questToShare.quest.title}"</p>
				<p class="text-gray-400 text-sm mb-4">Select federated holons to share with:</p>

				{#if federatedHolons.length === 0}
					<div class="text-center py-8">
						<div class="w-12 h-12 mx-auto mb-3 bg-gray-700 rounded-full flex items-center justify-center">
							<svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
							</svg>
						</div>
						<p class="text-gray-400">No federated holons found</p>
						<p class="text-gray-500 text-sm mt-1">Add federations in the Federation settings</p>
					</div>
				{:else}
					<div class="max-h-60 overflow-y-auto space-y-2 mb-4">
						{#each federatedHolons as holon (holon.id)}
							<label class="flex items-center p-3 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600 transition-colors">
								<input
									type="checkbox"
									bind:group={selectedHolonsToShare}
									value={holon.id}
									class="w-4 h-4 text-blue-600 bg-gray-600 border-gray-500 rounded focus:ring-blue-500 mr-3"
								/>
								<span class="text-white">{holon.name}</span>
							</label>
						{/each}
					</div>
				{/if}

				{#if shareError}
					<div class="bg-red-900/50 border border-red-600 text-red-200 px-4 py-2 rounded-lg mb-4 text-sm">
						{shareError}
					</div>
				{/if}

				{#if shareSuccess}
					<div class="bg-green-900/50 border border-green-600 text-green-200 px-4 py-2 rounded-lg mb-4 text-sm flex items-center">
						<svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
						</svg>
						{shareSuccess}
					</div>
				{/if}

				<div class="flex gap-3">
					<button
						on:click={closeShareDialog}
						class="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
					>
						Cancel
					</button>
					<button
						on:click={shareQuestToSelected}
						disabled={selectedHolonsToShare.length === 0 || sharingInProgress}
						class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
					>
						{#if sharingInProgress}
							<svg class="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
							</svg>
							Sharing...
						{:else}
							Share
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Toggle switch styling */
	.dot {
		transition: transform 0.3s ease-in-out;
	}

	/* Task card styling */
	.task-card {
		position: relative;
		cursor: grab;
	}

	.task-card:hover {
		cursor: pointer;
	}

	/* Text truncation utilities */
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		line-clamp: 2;
	}

	/* Smooth animations */
	@keyframes slideDown {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.compact-toolbar {
		gap: 0.5rem !important;
	}
	.compact-toolbar select,
	.compact-toolbar button {
		font-size: 0.95rem;
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
		padding-left: 0.75rem;
		padding-right: 0.75rem;
		height: 2.25rem;
	}
	.compact-toolbar .dot {
		transition: transform 0.3s ease-in-out;
	}
</style>
