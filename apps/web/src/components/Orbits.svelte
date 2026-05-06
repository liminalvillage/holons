<script lang="ts">
	import { onMount, onDestroy, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import { formatDate, formatTime } from "../utils/date";
	import type { HoloSphere } from "holosphere";
	import * as d3 from "d3";

	interface RecurringTask {
		id: string;
		title: string;
		description?: string;
		frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
		lastOccurrence: Date;
		nextOccurrence: Date;
		orbitPeriod: number; // in days
		orbitRadius: number; // calculated from frequency
		status: 'active' | 'paused' | 'completed';
		category?: string;
		participants: Array<{ 
			id: string; 
			username: string;
			firstName?: string;
			lastName?: string;
		}>;
		appreciation: string[];
		created?: string;
		recurringTaskID?: string; // ID reference to the recurring task
	}

	interface Store {
		[key: string]: RecurringTask;
	}

	let holosphere = getContext("holosphere") as HoloSphere;
	$: holonID = $ID;
	$: console.log('HolonID changed to:', holonID);
	let store: Store = {};
	$: recurringTasks = Object.entries(store);

	// D3 visualization variables
	let svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
	let container: HTMLDivElement;
	let width = window.innerWidth;
	let height = window.innerHeight - 100; // Account for header
	let centerX = width / 2;
	let centerY = height / 2;

	// Animation variables
	let currentTime = new Date();
	
	// HoloSphere subscription
	let questsUnsubscribe: (() => void) | undefined;

	// UI state
	let selectedTask: RecurringTask | null = null;
	let showTaskDetails = false;
	let showEditModal = false;
	let viewMode: 'orbits' | 'list' = 'orbits';
	let editingTask: RecurringTask | null = null;
	
	// Reactive statement to reinitialize visualization when switching to orbits view
	$: if (viewMode === 'orbits' && container) {
		setTimeout(() => {
			// Ensure container is visible before initializing
			if (container.offsetWidth > 0 && container.offsetHeight > 0) {
				initializeVisualization();
			} else {
				// If container not ready, try again after a short delay
				setTimeout(() => initializeVisualization(), 200);
			}
		}, 100); // Small delay to ensure DOM is ready
	}
	
	// Reactive statement to update visualization when store changes
	$: if (svg && Object.keys(store).length > 0) {
		updateVisualization();
	}
	
	// Form data for editing
	let editForm = {
		title: '',
		description: '',
		category: '',
		frequency: 'weekly' as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom',
		startDate: '',
		startTime: ''
	};

	// Color scheme for different task categories
	const categoryColors = {
		'work': '#3B82F6',      // Blue
		'personal': '#10B981',  // Green
		'health': '#EF4444',    // Red
		'learning': '#F59E0B',  // Amber
		'finance': '#8B5CF6',   // Purple
		'social': '#EC4899',    // Pink
		'default': '#6B7280'    // Gray
	};

	// Load initial recurring tasks by looking at quests with recurringTaskID
	async function loadInitialRecurringTasks() {
		if (!holosphere || !holonID) {
			console.log('Holosphere or holonID not available');
			return;
		}
		
		console.log('Loading initial recurring tasks...');
		console.log('Current holonID:', holonID);
		
		try {
			// Step 1: Get all quests from the current holon
			console.log('Step 1: Getting quests from holon...');
			const quests = await holosphere.getAll(holonID, "quests");
			console.log('Found quests:', quests?.length || 0);
			
			if (!quests || quests.length === 0) {
				console.log('No quests found, trying fallback approach...');
				// Try to load any recurring tasks directly as fallback
				await loadFallbackRecurringTasks();
				return;
			}
			
			// Step 2: Find quests that have a recurringTaskID field
			console.log('Step 2: Looking for quests with recurringTaskID...');
			const questsWithRecurringID = quests.filter((quest: any) => {
				const hasRecurringID = quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId;
				console.log(`Quest ${quest.id}: recurringTaskID = ${quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId}`);
				return hasRecurringID;
			});
			
			console.log('Found quests with recurringTaskID:', questsWithRecurringID.length);
			
			if (questsWithRecurringID.length === 0) {
				console.log('No quests with recurringTaskID found, trying fallback...');
				await loadFallbackRecurringTasks();
				return;
			}
			
			// Step 3: Look up the recurring tasks using the IDs
			console.log('Step 3: Looking up recurring tasks...');
			const convertedTasks: Store = {};
			
			for (const quest of questsWithRecurringID) {
				const recurringTaskID = quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId;
				console.log(`Looking up recurring task with ID: ${recurringTaskID}`);
				
				try {
					// Try to get the recurring task from the global recurring table
					const recurringTask = await holosphere.getGlobal("recurring", recurringTaskID);
					console.log('Found recurring task:', recurringTask);
					
					if (recurringTask) {
						// Convert the recurring task to our format
						const convertedTask = convertRecurringTaskToOrbitFormat(recurringTask, quest);
						if (convertedTask) {
							convertedTasks[quest.id] = convertedTask;
							console.log('Successfully converted recurring task:', convertedTask);
						}
					} else {
						console.log(`Recurring task ${recurringTaskID} not found in global table`);
						// If we can't find the recurring task, try to create one from the quest data
						const fallbackTask = createFallbackRecurringTask(quest);
						if (fallbackTask) {
							convertedTasks[quest.id] = fallbackTask;
							console.log('Created fallback recurring task from quest:', fallbackTask);
						}
					}
				} catch (error) {
					console.error(`Error looking up recurring task ${recurringTaskID}:`, error);
					// Create fallback task from quest data
					const fallbackTask = createFallbackRecurringTask(quest);
					if (fallbackTask) {
						convertedTasks[quest.id] = fallbackTask;
						console.log('Created fallback recurring task from quest after error:', fallbackTask);
					}
				}
			}
			
			// Update the store
			store = { ...store, ...convertedTasks };
			console.log('Final store state:', store);
			console.log('Loaded recurring tasks into store:', Object.keys(convertedTasks).length);
			
			// Force visualization update
			if (svg) {
				updateVisualization();
			}
			
		} catch (error) {
			console.error('Error loading initial recurring tasks:', error);
			if (error instanceof Error) {
				console.error('Error stack:', error.stack);
			}
			// Try fallback approach on error
			await loadFallbackRecurringTasks();
		}
	}
	
	// Fallback approach: load recurring tasks from other sources
	async function loadFallbackRecurringTasks() {
		try {
			console.log('Attempting fallback recurring task loading...');
			
			// Try to find recurring tasks by status or type
			if (!holonID) return;
			const allQuests = await holosphere.getAll(holonID, "quests");
			if (allQuests && allQuests.length > 0) {
				const recurringQuests = allQuests.filter((quest: any) => 
					quest.status === 'recurring' || 
					quest.type === 'recurring' || 
					quest.status === 'repeating'
				);
				
				console.log('Found recurring quests by status/type:', recurringQuests.length);
				
				const convertedTasks: Store = {};
				recurringQuests.forEach((quest: any) => {
					const fallbackTask = createFallbackRecurringTask(quest);
					if (fallbackTask) {
						convertedTasks[quest.id] = fallbackTask;
						console.log('Created fallback task:', fallbackTask);
					}
				});
				
				// Update the store
				store = { ...store, ...convertedTasks };
				console.log('Fallback loaded tasks:', Object.keys(convertedTasks).length);
				
				// Force visualization update
				if (svg) {
					updateVisualization();
				}
			}
		} catch (error) {
			console.error('Error in fallback loading:', error);
		}
	}
	
	// Create a fallback recurring task from quest data when we can't find the actual recurring task
	function createFallbackRecurringTask(quest: any): RecurringTask | null {
		try {
			// Try to determine frequency from quest data
			const frequency = determineFrequencyFromQuest(quest);
			if (!frequency) return null;
			
			// Calculate orbital data
			const now = new Date();
			const lastOccurrence = quest.when || quest.created || now;
			const nextOccurrence = calculateNextOccurrence(lastOccurrence, frequency);
			const orbitPeriod = getOrbitPeriod(frequency);
			const orbitRadius = getOrbitRadius(frequency);
			
			return {
				id: quest.id,
				title: quest.title || 'Untitled Task',
				description: quest.description || '',
				frequency,
				lastOccurrence: new Date(lastOccurrence),
				nextOccurrence,
				orbitPeriod,
				orbitRadius,
				status: 'active',
				category: quest.category || 'work',
				participants: quest.participants || [],
				appreciation: quest.appreciation || [],
				created: quest.created || quest.when,
				recurringTaskID: quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId
			};
		} catch (error) {
			console.error('Error creating fallback recurring task:', error);
			return null;
		}
	}
	
	// Determine frequency from quest data when we don't have the actual recurring task
	function determineFrequencyFromQuest(quest: any): 'daily' | 'weekly' | 'monthly' | 'yearly' | null {
		// Check for recurring status or type
		if (quest.status === 'recurring' || quest.type === 'recurring') {
			// Default to weekly for recurring tasks
			return 'weekly';
		}
		
		// Check for recurring patterns in title or description
		const recurringKeywords = ['daily', 'weekly', 'monthly', 'yearly', 'every', 'recurring', 'repeat'];
		const text = `${quest.title} ${quest.description || ''}`.toLowerCase();
		
		if (text.includes('daily') || text.includes('every day')) return 'daily';
		if (text.includes('weekly') || text.includes('every week')) return 'weekly';
		if (text.includes('monthly') || text.includes('every month')) return 'monthly';
		if (text.includes('yearly') || text.includes('every year') || text.includes('annual')) return 'yearly';
		
		// If we have a recurringTaskID but can't determine frequency, assume weekly
		if (quest.recurringTaskID || quest.recurring_task_id || quest.recurringTaskId) {
			return 'weekly';
		}
		
		return null;
	}
	
	// Convert recurring task from Scheduler format to Orbits format
	function convertRecurringTaskToOrbitFormat(schedulerTask: any, originalQuest: any): RecurringTask | null {
		try {
			// Extract frequency from the scheduler task
			const frequency = schedulerTask.frequency?.toLowerCase();
			if (!frequency) {
				console.log('No frequency found in scheduler task, using fallback');
				return createFallbackRecurringTask(originalQuest);
			}
			
			// Map scheduler frequencies to our format
			let mappedFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
			switch (frequency) {
				case 'daily':
					mappedFrequency = 'daily';
					break;
				case 'weekly':
					mappedFrequency = 'weekly';
					break;
				case 'monthly':
				case 'quarterly':
					mappedFrequency = 'monthly';
					break;
				case 'yearly':
					mappedFrequency = 'yearly';
					break;
				default:
					console.log(`Unknown frequency: ${frequency}, using fallback`);
					return createFallbackRecurringTask(originalQuest);
			}
			
			// Calculate orbital data
			const now = new Date();
			const lastOccurrence = schedulerTask.when || schedulerTask.createdAt || originalQuest.when || now;
			const nextOccurrence = calculateNextOccurrence(lastOccurrence, mappedFrequency);
			const orbitPeriod = getOrbitPeriod(mappedFrequency);
			const orbitRadius = getOrbitRadius(mappedFrequency);
			
			// Convert to our format
			return {
				id: originalQuest.id, // Use the quest ID as the key
				title: originalQuest.title || (Array.isArray(schedulerTask.title) ? schedulerTask.title.join(' ') : schedulerTask.title),
				description: originalQuest.description || schedulerTask.description || '',
				frequency: mappedFrequency,
				lastOccurrence: new Date(lastOccurrence),
				nextOccurrence,
				orbitPeriod,
				orbitRadius,
				status: 'active',
				category: originalQuest.category || 'work',
				participants: originalQuest.participants || (schedulerTask.initiator ? [schedulerTask.initiator] : []),
				appreciation: originalQuest.appreciation || [],
				created: schedulerTask.createdAt || originalQuest.created || originalQuest.when,
				recurringTaskID: originalQuest.recurringTaskID || originalQuest.recurring_task_id || originalQuest.recurringTaskId
			};
		} catch (error) {
			console.error('Error converting recurring task:', error);
			return createFallbackRecurringTask(originalQuest);
		}
	}

	// Calculate orbital position based on time and period
	function calculateOrbitalPosition(task: RecurringTask, time: Date): { x: number; y: number; angle: number; progress: number } {
		const timeDiff = time.getTime() - task.lastOccurrence.getTime();
		const periodMs = task.orbitPeriod * 24 * 60 * 60 * 1000;
		const progress = (timeDiff % periodMs) / periodMs;
		const angle = progress * 2 * Math.PI;
		
		// Adjust angle so 0 is at the top (zenith) instead of right side
		const adjustedAngle = angle - Math.PI / 2;
		
		const x = centerX + task.orbitRadius * Math.cos(adjustedAngle);
		const y = centerY + task.orbitRadius * Math.sin(adjustedAngle);
		
		return { x, y, angle: adjustedAngle, progress };
	}

	// Calculate time to occurrence (next time the task should happen)
	function calculateTimeToOccurrence(task: RecurringTask, time: Date): number {
		const timeDiff = task.nextOccurrence.getTime() - time.getTime();
		return Math.max(0, timeDiff);
	}

	// Check if task has just crossed the zenith line (starting position)
	function hasCrossedZenith(task: RecurringTask, time: Date): boolean {
		const position = calculateOrbitalPosition(task, time);
		const previousTime = new Date(time.getTime() - 1000); // 1 second ago
		const previousPosition = calculateOrbitalPosition(task, previousTime);
		
		// Check if we've crossed the vertical starting line (12 o'clock position)
		// The line goes from centerY-300 to centerY-50, so we check if we're crossing it
		const lineStartY = centerY - 300;
		const lineEndY = centerY - 50;
		
		// Check if we're crossing the vertical line from left to right
		const wasLeftOfLine = previousPosition.x < centerX;
		const isNowRightOfLine = position.x >= centerX;
		const isNearLine = Math.abs(position.x - centerX) < 15; // Within 15 pixels of the line
		const isInLineRange = position.y >= lineStartY && position.y <= lineEndY;
		
		return wasLeftOfLine && isNowRightOfLine && isNearLine && isInLineRange;
	}

	// Reset task timing when it crosses zenith
	function resetTaskTiming(task: RecurringTask, time: Date): RecurringTask {
		// Check if we've crossed the zenith line
		if (hasCrossedZenith(task, time)) {
			console.log(`Task ${task.title} has crossed zenith starting line, resetting timing`);
			
			// Update last occurrence to now and recalculate next occurrence
			const newLastOccurrence = new Date(time);
			const newNextOccurrence = calculateNextOccurrence(newLastOccurrence, task.frequency);
			
			return {
				...task,
				lastOccurrence: newLastOccurrence,
				nextOccurrence: newNextOccurrence
			};
		}
		
		// Also reset if countdown is very close to zero (within 1 minute) to prevent sticking
		const timeToOccurrence = calculateTimeToOccurrence(task, time);
		if (timeToOccurrence < 60000) { // Less than 1 minute
			console.log(`Task ${task.title} countdown near zero, resetting timing`);
			
			const newLastOccurrence = new Date(time);
			const newNextOccurrence = calculateNextOccurrence(newLastOccurrence, task.frequency);
			
			return {
				...task,
				lastOccurrence: newLastOccurrence,
				nextOccurrence: newNextOccurrence
			};
		}
		
		return task;
	}

	// Format time duration
	function formatDuration(ms: number): string {
		const days = Math.floor(ms / (24 * 60 * 60 * 1000));
		const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
		const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
		
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${minutes}m`;
		return `${minutes}m`;
	}
	
	// Get orbit period in days based on frequency
	function getOrbitPeriod(frequency: string): number {
		switch (frequency) {
			case 'daily': return 1;
			case 'weekly': return 7;
			case 'monthly': return 30;
			case 'yearly': return 365;
			default: return 7;
		}
	}
	
	// Get orbit radius based on frequency (closer = faster)
	function getOrbitRadius(frequency: string): number {
		switch (frequency) {
			case 'daily': return 80;
			case 'weekly': return 120;
			case 'monthly': return 180;
			case 'yearly': return 250;
			default: return 120;
		}
	}
	
	// Calculate next occurrence based on frequency
	function calculateNextOccurrence(lastOccurrence: Date, frequency: string): Date {
		const now = new Date();
		const last = new Date(lastOccurrence);
		let next = new Date(last);
		
		switch (frequency) {
			case 'daily':
				next.setDate(next.getDate() + 1);
				break;
			case 'weekly':
				next.setDate(next.getDate() + 7);
				break;
			case 'monthly':
				next.setDate(next.getDate() + 30);
				break;
			case 'yearly':
				next.setFullYear(next.getFullYear() + 1);
				break;
		}
		
		// If next occurrence is in the past, keep adding periods until it's in the future
		while (next < now) {
			switch (frequency) {
				case 'daily':
					next.setDate(next.getDate() + 1);
					break;
				case 'weekly':
					next.setDate(next.getDate() + 7);
					break;
				case 'monthly':
					next.setDate(next.getDate() + 30);
					break;
				case 'yearly':
					next.setFullYear(next.getFullYear() + 1);
					break;
			}
		}
		
		return next;
	}

	// Initialize D3 visualization
	function initializeVisualization() {
		if (!container) return;
		
		// Update dimensions in case of view switch
		width = window.innerWidth;
		height = window.innerHeight - 100;
		centerX = width / 2;
		centerY = height / 2;

		// Clear existing SVG
		d3.select(container).selectAll('*').remove();

		// Create SVG
		svg = d3.select(container)
			.append('svg')
			.attr('width', width)
			.attr('height', height)
			.attr('viewBox', `0 0 ${width} ${height}`)
			.style('background', '#1a1a2e'); // Changed background to a dark blue

		// Add orbital rings
		const uniqueRadii = [...new Set(Object.values(store).map(task => task.orbitRadius))].sort((a, b) => a - b);
		
		uniqueRadii.forEach(radius => {
			svg.append('circle')
				.attr('cx', centerX)
				.attr('cy', centerY)
				.attr('r', radius)
				.attr('fill', 'none')
				.attr('stroke', '#2d3748')
				.attr('stroke-width', 1)
				.attr('stroke-dasharray', '5,5')
				.attr('opacity', 0.3);
		});

		// Add center point (zenith)
		svg.append('circle')
			.attr('cx', centerX)
			.attr('cy', centerY)
			.attr('r', 4)
			.attr('fill', '#fbbf24')
			.attr('stroke', '#f59e0b')
			.attr('stroke-width', 2);

		// Add center label
		svg.append('text')
			.attr('x', centerX + 15)
			.attr('y', centerY - 15)
			.attr('fill', '#fbbf24')
			.attr('font-size', '12px')
			.attr('font-weight', '600')
			.text('CENTER');

		// Add starting position line (from center to 12 o'clock position)
		svg.append('line')
			.attr('x1', centerX)
			.attr('y1', centerY - 50) // Start above center
			.attr('x2', centerX)
			.attr('y2', centerY - 300) // Extend upward
			.attr('stroke', '#fbbf24') // Use center color
			.attr('stroke-width', 2)
			.attr('stroke-dasharray', '5,5');

		// Add starting position label
		svg.append('text')
			.attr('x', centerX + 20)
			.attr('y', centerY - 150)
			.attr('fill', '#fbbf24')
			.attr('font-size', '10px')
			.attr('font-weight', '600')
			.text('START');

		// Add time markers (clock positions)
		for (let i = 0; i < 12; i++) {
			const angle = (i * 30 - 90) * (Math.PI / 180);
			const markerRadius = 300;
			const x = centerX + markerRadius * Math.cos(angle);
			const y = centerY + markerRadius * Math.sin(angle);
			
			// Adjust numbering so 0/12 is at the top
			let markerText;
			if (i === 0) {
				markerText = '0';
			} else if (i === 6) {
				markerText = '6';
			} else if (i === 3) {
				markerText = '3';
			} else if (i === 9) {
				markerText = '9';
			} else {
				markerText = i.toString();
			}
			
			svg.append('text')
				.attr('x', x)
				.attr('y', y)
				.attr('fill', '#64748b')
				.attr('font-size', '10px')
				.attr('text-anchor', 'middle')
				.attr('dominant-baseline', 'middle')
				.text(markerText);
		}

		updateVisualization();
	}

	// Update visualization with current task positions
	function updateVisualization() {
		if (!svg) return;

		console.log('Updating visualization, store has tasks:', Object.keys(store).length);
		console.log('Store contents:', store);

		// Remove existing planets
		svg.selectAll('.planet').remove();
		svg.selectAll('.orbit-trail').remove();

		// Add planets for each task
		Object.values(store).forEach(task => {
			// Reset task timing if it has crossed the zenith line
			const updatedTask = resetTaskTiming(task, currentTime);
			
			// Update the store if timing was reset
			if (updatedTask !== task) {
				store[task.id] = updatedTask;
			}

			const position = calculateOrbitalPosition(updatedTask, currentTime);
			const timeToOccurrence = calculateTimeToOccurrence(updatedTask, currentTime);
			const categoryColor = categoryColors[updatedTask.category as keyof typeof categoryColors] || categoryColors.default;
			
			// Add orbit trail
			svg.append('circle')
				.attr('cx', centerX)
				.attr('cy', centerY)
				.attr('r', updatedTask.orbitRadius)
				.attr('fill', 'none')
				.attr('stroke', categoryColor)
				.attr('stroke-width', 2)
				.attr('opacity', 0.1)
				.classed('orbit-trail', true);

			// Add planet
			const planetGroup = svg.append('g')
				.classed('planet', true)
				.attr('transform', `translate(${position.x}, ${position.y})`);

			// Planet body
			planetGroup.append('circle')
				.attr('r', 12)
				.attr('fill', categoryColor)
				.attr('stroke', '#ffffff')
				.attr('stroke-width', 2)
				.attr('filter', 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))');

			// Planet glow effect
			planetGroup.append('circle')
				.attr('r', 16)
				.attr('fill', 'none')
				.attr('stroke', categoryColor)
				.attr('stroke-width', 1)
				.attr('opacity', 0.6)
				.style('filter', 'blur(1px)');

			// Task title
			planetGroup.append('text')
				.attr('x', 0)
				.attr('y', -20)
				.attr('fill', '#ffffff')
				.attr('font-size', '10px')
				.attr('text-anchor', 'middle')
				.attr('font-weight', '600')
				.text(updatedTask.title.length > 12 ? updatedTask.title.substring(0, 12) + '...' : updatedTask.title);

			// Time to occurrence indicator
			const timeText = formatDuration(timeToOccurrence);
			const timeColor = timeToOccurrence < 60000 ? '#ef4444' : '#94a3b8'; // Red when < 1 minute, gray otherwise
			
			planetGroup.append('text')
				.attr('x', 0)
				.attr('y', 30)
				.attr('fill', timeColor)
				.attr('font-size', '8px')
				.attr('text-anchor', 'middle')
				.attr('font-weight', timeToOccurrence < 60000 ? 'bold' : 'normal')
				.text(timeText);

			// Progress indicator
			const progressAngle = position.progress * 360;
			planetGroup.append('circle')
				.attr('r', 8)
				.attr('fill', 'none')
				.attr('stroke', '#ffffff')
				.attr('stroke-width', 1.5)
				.attr('stroke-dasharray', `${progressAngle / 360 * 50.24}, 50.24`)
				.attr('transform', 'rotate(90)'); // Start at 12 o'clock (top)

			// Add click event
			planetGroup.style('cursor', 'pointer')
				.on('click', () => selectTask(updatedTask));
		});
	}

	// Select a task for detailed view
	function selectTask(task: RecurringTask) {
		selectedTask = task;
		showTaskDetails = true;
	}

	// Open edit modal for a task
	function openEditModal(task: RecurringTask) {
		editingTask = task;
		editForm = {
			title: task.title,
			description: task.description || '',
			category: task.category || '',
			frequency: task.frequency,
			startDate: task.lastOccurrence.toISOString().split('T')[0],
			startTime: task.lastOccurrence.toTimeString().slice(0, 5)
		};
		showEditModal = true;
	}

	// Close edit modal
	function closeEditModal() {
		showEditModal = false;
		editingTask = null;
	}

	// Save edited task
	async function saveEditedTask() {
		if (!editingTask || !holosphere || !holonID) return;

		try {
			// Update the task with new values
			const updatedTask = {
				...editingTask,
				title: editForm.title,
				description: editForm.description,
				category: editForm.category,
				frequency: editForm.frequency,
				lastOccurrence: new Date(`${editForm.startDate}T${editForm.startTime}`),
				nextOccurrence: calculateNextOccurrence(new Date(`${editForm.startDate}T${editForm.startTime}`), editForm.frequency),
				orbitPeriod: getOrbitPeriod(editForm.frequency),
				orbitRadius: getOrbitRadius(editForm.frequency)
			};

			// Update the store
			store[editingTask.id] = updatedTask;

			// Update the visualization
			if (svg) {
				updateVisualization();
			}

			// Close the modal
			closeEditModal();

			console.log('Task updated successfully:', updatedTask);
		} catch (error) {
			console.error('Error updating task:', error);
		}
	}

	// Close task details
	function closeTaskDetails() {
		showTaskDetails = false;
		selectedTask = null;
	}

	// Handle window resize to make visualization responsive
	function handleResize() {
		width = window.innerWidth;
		height = window.innerHeight - 100;
		centerX = width / 2;
		centerY = height / 2;
		
		if (svg && container) {
			initializeVisualization();
		}
	}

	// Lifecycle
	onMount(async () => {
		// Add resize listener
		window.addEventListener('resize', handleResize);
		
		// Set up HoloSphere subscriptions for quests
		if (holosphere && holonID) {
			try {
				// Subscribe to quest updates
				const questSubscription = await holosphere.subscribe(holonID, "quests", async (newQuest: any, key?: string) => {
					if (newQuest && key) {
						// Check if this quest has a recurringTaskID
						const hasRecurringID = newQuest.recurringTaskID || newQuest.recurring_task_id || newQuest.recurringTaskId;
						
						if (hasRecurringID) {
							console.log(`New quest with recurringTaskID: ${key}`, newQuest);
							
							// Look up the recurring task and update the store
							try {
								const recurringTaskID = hasRecurringID;
								const recurringTask = await holosphere.getGlobal("recurring", recurringTaskID);
								
								if (recurringTask) {
									const convertedTask = convertRecurringTaskToOrbitFormat(recurringTask, newQuest);
									if (convertedTask) {
										const newStore = { ...store };
										newStore[key] = convertedTask;
										store = newStore;
										
										// Update visualization if it exists
										if (svg) {
											updateVisualization();
										}
									}
								} else {
									// Create fallback task
									const fallbackTask = createFallbackRecurringTask(newQuest);
									if (fallbackTask) {
										const newStore = { ...store };
										newStore[key] = fallbackTask;
										store = newStore;
										
										// Update visualization if it exists
										if (svg) {
											updateVisualization();
										}
									}
								}
							} catch (error) {
								console.error('Error processing new recurring quest:', error);
								// Create fallback task
								const fallbackTask = createFallbackRecurringTask(newQuest);
								if (fallbackTask) {
									const newStore = { ...store };
									newStore[key] = fallbackTask;
									store = newStore;
									
									// Update visualization if it exists
									if (svg) {
										updateVisualization();
									}
								}
							}
						}
					} else if (key) {
						// Remove deleted quest
						const newStore = { ...store };
						delete newStore[key];
						store = newStore;
						
						// Update visualization if it exists
						if (svg) {
							updateVisualization();
						}
					}
				});
				
				// Store unsubscribe function
				questsUnsubscribe = () => {
					if (questSubscription?.unsubscribe) questSubscription.unsubscribe();
				};
				
				// Load initial recurring tasks from quests with recurringTaskID
				await loadInitialRecurringTasks();
				
			} catch (error) {
				console.error('Error setting up HoloSphere subscriptions:', error);
			}
		}
		
		// Initialize visualization and animation
		initializeVisualization();
		// animate(); // Removed animation loop
	});

	onDestroy(() => {
		// Remove resize listener
		window.removeEventListener('resize', handleResize);
		
		// Clean up HoloSphere subscription
		if (questsUnsubscribe) {
			questsUnsubscribe();
		}
	});
</script>

<div class="orbits-container">
	<!-- Header -->
	<div class="header">
		<div class="title-section">
			<h1 class="title">Orbital Tasks</h1>
			<p class="subtitle">Visualizing recurring tasks as celestial bodies in orbit</p>
		</div>
		
		<div class="controls">
			<button 
				class="control-btn {viewMode === 'orbits' ? 'active' : ''}"
				on:click={() => viewMode = 'orbits'}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"></path>
				</svg>
				Orbits
			</button>
			
			<button 
				class="control-btn {viewMode === 'list' ? 'active' : ''}"
				on:click={() => viewMode = 'list'}
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
				</svg>
				List
			</button>
		</div>
	</div>

	<!-- Main Content -->
	{#if viewMode === 'orbits'}
		<div class="orbits-view">
			<!-- Current Time Display -->
			<div class="time-display">
				<span class="time-label">Current Time:</span>
				<span class="time-value">{currentTime.toLocaleString()}</span>
			</div>

			<!-- D3 Visualization Container -->
			<div class="visualization-container" bind:this={container}></div>

			<!-- Legend -->
			<div class="legend">
				<div class="legend-item">
					<div class="legend-color work"></div>
					<span>Work</span>
				</div>
				<div class="legend-item">
					<div class="legend-color personal"></div>
					<span>Personal</span>
				</div>
				<div class="legend-item">
					<div class="legend-color health"></div>
					<span>Health</span>
				</div>
				<div class="legend-item">
					<div class="legend-color learning"></div>
					<span>Learning</span>
				</div>
				<div class="legend-item">
					<div class="legend-color finance"></div>
					<span>Finance</span>
				</div>
				<div class="legend-item">
					<div class="legend-color social"></div>
					<span>Social</span>
				</div>
			</div>
		</div>
	{:else}
		<div class="list-view">
			<div class="tasks-grid">
				{#each recurringTasks as [id, task]}
					<div class="task-card">
						<div class="task-header">
							<div class="task-category" style="background-color: {categoryColors[task.category as keyof typeof categoryColors] || categoryColors.default}">
								{task.category || 'default'}
							</div>
							<div class="task-status {task.status}">
								{task.status}
							</div>
						</div>
						
						<h3 class="task-title">{task.title}</h3>
						<p class="task-description">{task.description || 'No description'}</p>
						
						<div class="task-details">
							<div class="detail-item">
								<span class="label">Frequency:</span>
								<span class="value">{task.frequency}</span>
							</div>
							<div class="detail-item">
								<span class="label">Next Occurrence:</span>
								<span class="value">{task.nextOccurrence.toLocaleDateString()}</span>
							</div>
							<div class="detail-item">
								<span class="label">Time to Occurrence:</span>
								<span class="value">{formatDuration(calculateTimeToOccurrence(task, currentTime))}</span>
							</div>
						</div>
						
						<div class="task-actions">
							<button class="action-btn view-btn" on:click={() => selectTask(task)}>
								View Details
							</button>
							<button class="action-btn edit-btn" on:click={() => openEditModal(task)}>
								Edit Task
							</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Task Details Modal -->
	{#if showTaskDetails && selectedTask}
		<div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1">
			<button 
				class="absolute inset-0 w-full h-full" 
				on:click={closeTaskDetails}
				aria-label="Close modal backdrop"
			></button>
			<div class="modal-content" role="document">
				<div class="modal-header">
					<h2 class="modal-title">{selectedTask.title}</h2>
					<button class="close-btn" on:click={closeTaskDetails} aria-label="Close task details">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				
				<div class="modal-body">
					<div class="task-info">
						<div class="info-row">
							<span class="label">Description:</span>
							<span class="value">{selectedTask.description || 'No description provided'}</span>
						</div>
						<div class="info-row">
							<span class="label">Category:</span>
							<span class="value">{selectedTask.category || 'Uncategorized'}</span>
						</div>
						<div class="info-row">
							<span class="label">Frequency:</span>
							<span class="value">{selectedTask.frequency}</span>
						</div>
						<div class="info-row">
							<span class="label">Orbit Period:</span>
							<span class="value">{selectedTask.orbitPeriod} days</span>
						</div>
						<div class="info-row">
							<span class="label">Last Occurrence:</span>
							<span class="value">{selectedTask.lastOccurrence.toLocaleDateString()}</span>
						</div>
						<div class="info-row">
							<span class="label">Next Occurrence:</span>
							<span class="value">{selectedTask.nextOccurrence.toLocaleDateString()}</span>
						</div>
						<div class="info-row">
							<span class="label">Time to Occurrence:</span>
							<span class="value highlight">{formatDuration(calculateTimeToOccurrence(selectedTask, currentTime))}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Edit Task Modal -->
	{#if showEditModal && editingTask}
		<div class="modal-overlay" role="dialog" aria-modal="true" tabindex="-1">
			<button 
				class="absolute inset-0 w-full h-full" 
				on:click={closeEditModal}
				aria-label="Close modal backdrop"
			></button>
			<div class="modal-content edit-modal" role="document">
				<div class="modal-header">
					<h2 class="modal-title">Edit Task</h2>
					<button class="close-btn" on:click={closeEditModal} aria-label="Close edit modal">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				
				<div class="modal-body">
					<form class="edit-form" on:submit|preventDefault={saveEditedTask}>
						<div class="form-group">
							<label for="title">Title</label>
							<input 
								id="title"
								type="text" 
								bind:value={editForm.title} 
								required 
								class="form-input"
							/>
						</div>
						
						<div class="form-group">
							<label for="description">Description</label>
							<textarea 
								id="description"
								bind:value={editForm.description} 
								rows="3" 
								class="form-textarea"
							></textarea>
						</div>
						
						<div class="form-group">
							<label for="category">Category</label>
							<select id="category" bind:value={editForm.category} class="form-select">
								<option value="">Select Category</option>
								<option value="work">Work</option>
								<option value="personal">Personal</option>
								<option value="health">Health</option>
								<option value="learning">Learning</option>
								<option value="finance">Finance</option>
								<option value="social">Social</option>
							</select>
						</div>
						
						<div class="form-group">
							<label for="frequency">Frequency</label>
							<select id="frequency" bind:value={editForm.frequency} class="form-select">
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="monthly">Monthly</option>
								<option value="yearly">Yearly</option>
								<option value="custom">Custom</option>
							</select>
						</div>
						
						<div class="form-row">
							<div class="form-group">
								<label for="startDate">Start Date</label>
								<input 
									id="startDate"
									type="date" 
									bind:value={editForm.startDate} 
									required 
									class="form-input"
								/>
							</div>
							
							<div class="form-group">
								<label for="startTime">Start Time</label>
								<input 
									id="startTime"
									type="time" 
									bind:value={editForm.startTime} 
									required 
									class="form-input"
								/>
							</div>
						</div>
						
						<div class="form-actions">
							<button type="button" class="btn btn-secondary" on:click={closeEditModal}>
								Cancel
							</button>
							<button type="submit" class="btn btn-primary">
								Save Changes
							</button>
						</div>
					</form>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.orbits-container {
		@apply min-h-screen bg-gray-900 text-white p-6;
		font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.header {
		@apply flex flex-col lg:flex-row justify-between items-start lg:items-center mb-8 gap-4;
	}

	.title-section {
		@apply flex-1;
	}

	.title {
		@apply text-4xl font-bold bg-gradient-to-r from-blue-600 via-blue-500 to-blue-400 bg-clip-text text-transparent mb-2;
	}

	.subtitle {
		@apply text-gray-400 text-lg;
	}

	.controls {
		@apply flex gap-2;
	}

	.control-btn {
		@apply px-4 py-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-all duration-200 flex items-center gap-2 border border-gray-600;
	}

	.control-btn.active {
		@apply bg-blue-600 text-white border-blue-500;
	}

	.orbits-view {
		@apply space-y-6;
	}

	.time-display {
		@apply text-center bg-gray-800 rounded-lg p-3 border border-gray-700;
	}

	.time-label {
		@apply text-gray-400 mr-2;
	}

	.time-value {
		@apply text-blue-400 font-mono font-semibold;
	}

	.visualization-container {
		@apply bg-gray-800 rounded-xl border border-gray-700 overflow-hidden shadow-2xl;
		min-height: calc(100vh - 200px);
		width: 100%;
	}

	.legend {
		@apply flex flex-wrap justify-center gap-4 mt-6;
	}

	.legend-item {
		@apply flex items-center gap-2 text-sm;
	}

	.legend-color {
		@apply w-4 h-4 rounded-full;
	}

	.legend-color.work { background-color: #3B82F6; }
	.legend-color.personal { background-color: #10B981; }
	.legend-color.health { background-color: #EF4444; }
	.legend-color.learning { background-color: #F59E0B; }
	.legend-color.finance { background-color: #8B5CF6; }
	.legend-color.social { background-color: #EC4899; }

	.list-view {
		@apply space-y-6;
	}

	.tasks-grid {
		@apply grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6;
	}

	.task-card {
		@apply bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-blue-500 transition-all duration-200 cursor-pointer hover:shadow-lg hover:shadow-blue-500/20;
	}

	.task-header {
		@apply flex justify-between items-center mb-4;
	}

	.task-category {
		@apply px-3 py-1 rounded-full text-xs font-semibold text-white uppercase tracking-wide;
	}

	.task-status {
		@apply px-2 py-1 rounded text-xs font-medium;
	}

	.task-status.active {
		@apply bg-green-600 text-white;
	}

	.task-status.paused {
		@apply bg-yellow-600 text-white;
	}

	.task-status.completed {
		@apply bg-gray-600 text-white;
	}

	.task-title {
		@apply text-xl font-semibold text-white mb-2;
	}

	.task-description {
		@apply text-gray-400 text-sm mb-4 line-clamp-2;
	}

	.task-details {
		@apply space-y-2;
	}

	.detail-item {
		@apply flex justify-between text-sm;
	}

	.label {
		@apply text-gray-500;
	}

	.value {
		@apply text-gray-300 font-medium;
	}

	.modal-overlay {
		@apply fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4 z-50;
		backdrop-filter: blur(4px);
	}

	.modal-content {
		@apply bg-gray-800 rounded-xl border border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto;
	}

	.modal-header {
		@apply flex justify-between items-center p-6 border-b border-gray-700;
	}

	.modal-title {
		@apply text-2xl font-bold text-white;
	}

	.close-btn {
		@apply p-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white transition-colors;
	}

	.modal-body {
		@apply p-6;
	}

	.task-info {
		@apply space-y-4;
	}

	.info-row {
		@apply flex justify-between items-start py-2 border-b border-gray-700;
	}

	.info-row .label {
		@apply text-gray-400 font-medium min-w-[120px];
	}

	.info-row .value {
		@apply text-gray-200 text-right flex-1;
	}

	.info-row .value.highlight {
		@apply text-blue-400 font-semibold;
	}

	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.task-actions {
		@apply flex gap-2 mt-4;
	}

	.action-btn {
		@apply px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200;
	}

	.view-btn {
		@apply bg-blue-600 text-white hover:bg-blue-700;
	}

	.edit-btn {
		@apply bg-gray-600 text-white hover:bg-gray-700;
	}

	.edit-modal {
		@apply max-w-2xl;
	}

	.edit-form {
		@apply space-y-4;
	}

	.form-group {
		@apply space-y-2;
	}

	.form-row {
		@apply grid grid-cols-2 gap-4;
	}

	.form-group label {
		@apply block text-sm font-medium text-gray-300;
	}

	.form-input, .form-textarea, .form-select {
		@apply w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent;
	}

	.form-textarea {
		@apply resize-none;
	}

	.form-actions {
		@apply flex gap-3 pt-4 border-t border-gray-700;
	}

	.btn {
		@apply px-4 py-2 rounded-lg font-medium transition-colors;
	}

	.btn-primary {
		@apply bg-blue-600 text-white hover:bg-blue-700;
	}

	.btn-secondary {
		@apply bg-gray-600 text-white hover:bg-gray-700;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.title {
			@apply text-3xl;
		}
		
		.controls {
			@apply flex-col;
		}
		
		.visualization-container {
			min-height: 400px;
		}
	}
</style>
