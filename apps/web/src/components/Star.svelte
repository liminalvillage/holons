<script lang="ts">
	// @ts-nocheck
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { formatDate, formatTime } from "../utils/date.js";
	import type { HoloSphere } from "holosphere";
	import Schedule from "./ScheduleWidget.svelte";
	import Announcements from "./Announcements.svelte";
	import TaskModal from "./TaskModal.svelte";
	import { browser } from "$app/environment";
	import CanvasView from "./CanvasView.svelte";
	import { nameMap, resolvedName } from '$lib/stores/nameResolver';
	import DisplayName from './shared/DisplayName.svelte';
	import { getColorFromCategory } from '@holons/core/categories';
	import { toggleParticipant as coreToggleParticipant } from '@holons/core/tasks';

	let holosphere = getContext("holosphere") as HoloSphere;

	$: holonID = $ID;
	let store = {};
	let userStore = {};
	let showDropdown = null;
	let userSearchQuery = '';
	$: if (!showDropdown) userSearchQuery = ''; // reset search when dropdown closes
	$: filteredUserEntries = (() => {
		const entries = Object.entries(userStore);
		const q = userSearchQuery.trim().toLowerCase();
		if (!q) return entries;
		return entries.filter(([uid, u]: any) => {
			const name = String(u?.first_name || '') + ' ' + String(u?.last_name || '');
			const handle = String(u?.username || '');
			return (
				name.toLowerCase().includes(q) ||
				handle.toLowerCase().includes(q) ||
				String(uid).toLowerCase().includes(q)
			);
		});
	})();
	$: quests = Object.entries(store);

	// Initialize preferences with default values
	let viewMode = "grid"; // can be 'grid', 'list', or 'canvas'
	let showCompleted = false;

	// Load preferences only in browser environment
	onMount(() => {
		if (browser) {
			viewMode = localStorage.getItem("kanbanViewMode") || "grid";
			showCompleted =
				localStorage.getItem("kanbanShowCompleted") === "true" || false;
		}
	});

	// Save preferences only in browser environment
	$: {
		if (browser) {
			localStorage.setItem("kanbanViewMode", viewMode);
			localStorage.setItem(
				"kanbanShowCompleted",
				showCompleted.toString()
			);
		}
	}

	// Add these new variables
	let selectedCategory = "all";

	// Compute unique categories from quests
	$: categories = [
		"all",
		...new Set(
			Object.values(store)
				.filter((quest) => quest.category)
				.map((quest) => quest.category)
		),
	];

	// Filter quests based on selected category
	$: filteredQuests = sortedQuests.filter(([_, quest]) => {
		if (selectedCategory === "all") return true;
		return quest.category === selectedCategory;
	});

	// Add this variable to track the selected task
	let selectedTask = null;

	// Name resolution is automatic via resolvedName()
	$: holonName = resolvedName(holonID, $nameMap, null, 'Tasks');

	onMount(async () => {
		// Fetch all quests from holon
		ID.subscribe((value) => {
			holonID = value;
			subscribe();
		});

		viewMode = localStorage.getItem("kanbanViewMode") || "grid";
		showCompleted =
			localStorage.getItem("kanbanShowCompleted") === "true" || false;
		
		// Add click outside listener
		document.addEventListener("click", handleClickOutside);

		return () => {
			document.removeEventListener("click", handleClickOutside);
		};
	});

	$: update(holonID);

	function subscribe() {
		store = {};
		userStore = {};
		if (holosphere) {
			holosphere.subscribe(holonID, "quests", (newquest, key) => {
				if (newquest) {
					store = {
						...store,
						[key]: newquest,
					};
				} else {
					const newStore = { ...store };
					delete newStore[key];
					store = newStore;
				}
			});

			holosphere.subscribe(holonID, "users", (newUser, key) => {
				if (newUser) {
					// Use user.id as the canonical key if available
					const canonicalKey = newUser.id || key;
					
					if (newUser.id && key !== newUser.id) {
						// Remove the old key if it's different from the canonical key
						const { [key]: _, ...rest } = userStore;
						userStore = { ...rest, [canonicalKey]: newUser };
					} else {
						// Use the key directly
						userStore = { ...userStore, [canonicalKey]: newUser };
					}
				} else {
					const newUserStore = { ...userStore };
					delete newUserStore[key];
					userStore = newUserStore;
				}
			});
		}
	}

	function update(hex) {
		// Filter ongoing and scheduled quests
		const filteredQuests = quests.filter(
			([_, quest]) =>
				quest.status === "ongoing" 
		);

		// Sort quests by date field, falling back to when if date doesn't exist
		const sortedQuests = filteredQuests.sort(([_, a], [__, b]) => {
			const dateA = a.date ? new Date(a.date) : new Date(a.when);
			const dateB = b.date ? new Date(b.date) : new Date(b.when);
			return dateB - dateA; // Newest first
		});

		return sortedQuests;
	}

	// Update the sorting in the template sections
	$: sortedQuests = quests.sort(([_, a], [__, b]) => {
		const dateA = a.date ? new Date(a.date) : new Date(a.when);
		const dateB = b.date ? new Date(b.date) : new Date(b.when);
		return dateB - dateA;
	});

	async function toggleParticipant(questId, userId) {
		const quest = store[questId];
		if (!quest) return;

		const user = userStore[userId];
		const candidate = user
			? {
				id: userId,
				username:
					user.first_name +
					(user.last_name ? " " + user.last_name : ""),
				picture: user.picture,
			}
			: { id: userId };

		const base = {
			...quest,
			participants: quest.participants || [],
			appreciation: quest.appreciation || [],
		};
		const updated = coreToggleParticipant(base, candidate);

		quest.participants = updated.participants;
		quest.appreciation = base.appreciation;

		await holosphere.put(holonID, "quests", quest);

		showDropdown = null;
	}

	function handleClickOutside(event) {
		const dropdown = document.querySelector(".user-dropdown");
		if (
			dropdown &&
			!dropdown.contains(event.target) &&
			!event.target.closest(".task-card")
		) {
			showDropdown = null;
		}
	}

	// Replace the showDropdown click handler with this
	function handleTaskClick(key, quest) {
		if (!key) {
			console.error("Cannot select task: missing key");
			return;
		}
		selectedTask = { key, quest };
	}
</script>

<div class="flex flex-wrap">
	<div class="w-full lg:w-8/12 bg-gray-800 py-6 px-6 rounded-3xl">
		<div class="flex justify-between text-white items-center mb-8">
			<div>
				<h1 class="text-2xl font-bold">{holonName}</h1>
				<p class="text-lg mt-1">Tasks Today</p>
			</div>
			<p class="">{new Date().toDateString()}</p>
		</div>

		<div class="flex flex-wrap justify-between items-center pb-8">
			<div class="flex flex-wrap text-white">
				<div class="pr-10">
					<div class="text-2xl font-bold">
						{quests.filter(
							([_, quest]) =>
								!quest.participants?.length &&
								quest.status !== "completed"
						).length}
					</div>
					<div class="">Unassigned</div>
				</div>
				<div class="pr-10">
					<div class="text-2xl font-bold">
						{quests.filter(
							([_, quest]) => quest.status === "ongoing"
						).length}
					</div>
					<div class="">Ongoing</div>
				</div>
				<div class="pr-10">
					<div class="text-2xl font-bold">
						{quests.filter(
							([_, quest]) => quest.status === "completed"
						).length}
					</div>
					<div class="">Completed</div>
				</div>
				<div>
					<div class="text-2xl font-bold">{quests.length}</div>
					<div class="">Total Tasks</div>
				</div>
			</div>
			<div class="flex items-center mt-4 md:mt-0">
				<button
					class="text-white {viewMode === 'list'
						? 'bg-gray-700'
						: 'bg-transparent'} p-2"
					title="List View"
					on:click={() => (viewMode = "list")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="8" y1="6" x2="21" y2="6" />
						<line x1="8" y1="12" x2="21" y2="12" />
						<line x1="8" y1="18" x2="21" y2="18" />
						<line x1="3" y1="6" x2="3.01" y2="6" />
						<line x1="3" y1="12" x2="3.01" y2="12" />
						<line x1="3" y1="18" x2="3.01" y2="18" />
					</svg>
				</button>
				<button
					class="text-white {viewMode === 'grid'
						? 'bg-gray-700'
						: 'bg-transparent'} p-2 ml-2"
					title="Grid View"
					on:click={() => (viewMode = "grid")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect x="3" y="3" width="7" height="7" />
						<rect x="14" y="3" width="7" height="7" />
						<rect x="14" y="14" width="7" height="7" />
						<rect x="3" y="14" width="7" height="7" />
					</svg>
				</button>
				<button
					class="text-white {viewMode === 'canvas'
						? 'bg-gray-700'
						: 'bg-transparent'} p-2 ml-2"
					title="Canvas View"
					on:click={() => (viewMode = "canvas")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<rect
							x="3"
							y="3"
							width="18"
							height="18"
							rx="2"
							ry="2"
						/>
						<line x1="3" y1="9" x2="21" y2="9" />
						<line x1="9" y1="21" x2="9" y2="9" />
					</svg>
				</button>
			</div>
		</div>

		<div class="flex justify-end mb-4 items-center gap-4">
			<!-- Category Filter -->
			<div class="relative">
				<select
					bind:value={selectedCategory}
					class="appearance-none bg-gray-600 text-white px-4 py-1.5 pr-8 rounded-full cursor-pointer text-sm"
				>
					{#each categories as category}
						<option value={category}>
							{category === "all" ? "All Categories" : category}
						</option>
					{/each}
				</select>
				<div
					class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-white"
				>
					<svg
						class="fill-current h-4 w-4"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
					>
						<path
							d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
						/>
					</svg>
				</div>
			</div>

			<!-- Show Completed Toggle -->
			<label class="flex items-center cursor-pointer">
				<div class="relative">
					<input
						type="checkbox"
						class="sr-only"
						bind:checked={showCompleted}
					/>
					<div
						class="w-10 h-6 bg-gray-600 rounded-full shadow-inner"
					></div>
					<div
						class="dot absolute w-4 h-4 bg-white rounded-full transition left-1 top-1"
						class:translate-x-4={showCompleted}
					></div>
				</div>
				<div class="ml-3 text-sm font-medium text-white">
					Show Completed
				</div>
			</label>
		</div>

		{#if viewMode === "list"}
			<div class="space-y-2">
				{#each filteredQuests as [key, quest]}
					{#if (quest.status === "ongoing"  || (showCompleted && quest.status === "completed")) && (quest.type === "task" || quest.type === "quest")}
						<div
							id={key}
							class="w-full task-card relative"
							role="button"
							tabindex="0"
							on:click|stopPropagation={() =>
								handleTaskClick(key, quest)}
							on:keydown|stopPropagation={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									handleTaskClick(key, quest);
								}
							}}
						>
							<div
								class="p-3 rounded-lg transition-colors"
								style="background-color: {quest.status ===
								'completed'
									? '#9CA3AF'
									: getColorFromCategory(quest.category)}; 
									   opacity: {quest.status === 'completed' ? '0.6' : '1'}"
							>
								<div
									class="flex justify-between items-center gap-4"
								>
									<div class="flex-1 min-w-0">
										<h3
											class="text-base font-bold opacity-70 truncate"
										>
											{quest.title}
										</h3>
										{#if quest.description}
											<p
												class="text-sm opacity-70 truncate"
											>
												{quest.description}
											</p>
										{/if}
										{#if quest.category}
											<p class="text-sm opacity-70 mt-1">
												<span
													class="inline-flex items-center"
												>
													<svg
														class="w-4 h-4 mr-1"
														viewBox="0 0 24 24"
														fill="currentColor"
													>
														<path
															d="M11.03 8h-6.06l-3 8h6.06l3-8zm1.94 0l3 8h6.06l-3-8h-6.06zm1.03-2h4.03l3-2h-4.03l-3 2zm-8 0h4.03l-3-2h-4.03l3 2z"
														/>
													</svg>
													{quest.category}
												</span>
											</p>
										{/if}
									</div>

									<div
										class="flex items-center gap-4 text-sm whitespace-nowrap"
									>
										{#if quest.location}
											<div class="opacity-70">
												📍 {quest.location.split(
													","
												)[0]}
											</div>
										{/if}

										<div class="flex items-center gap-1">
											<span
												class="opacity-70 font-bold text-base"
												>🙋‍♂️ {(quest.participants || []).length}</span
											>
											<div
												class="flex -space-x-2 relative group"
											>
												{#each (quest.participants || []).slice(0, 3) as participant}
													<div class="relative">
														<img
															class="w-6 h-6 rounded-full border-2 border-gray-300"
															src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
															alt={participant.username}
														/>
														<div
															class="absolute invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-1 px-2 -bottom-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10"
														>
															{participant.username}
														</div>
													</div>
												{/each}
												{#if (quest.participants || []).length > 3}
													<div
														class="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center text-xs border-2 border-gray-300"
													>
														+{(quest.participants || []).length - 3}
													</div>
												{/if}
											</div>
										</div>

										{#if quest.when}
											<div class="text-sm font-medium">
												{formatTime(quest.when)}
												{#if quest.ends}- {formatTime(
														quest.ends
													)}{/if}
											</div>
										{/if}

										<div
											class="opacity-70 font-bold text-base"
										>
											👍 {quest.appreciation.length}
										</div>
									</div>
								</div>

								{#if showDropdown === key}
									<div
										class="user-dropdown absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
									>
										{#if Object.keys(userStore).length > 4}
											<div class="p-2 border-b border-gray-200">
												<input
													type="search"
													bind:value={userSearchQuery}
													on:click|stopPropagation
													placeholder="Search users…"
													class="w-full text-sm px-2 py-1 border border-gray-300 rounded outline-none focus:border-indigo-500"
													autocomplete="off"
												/>
											</div>
										{/if}
										<div class="py-1 max-h-64 overflow-y-auto">
											{#each filteredUserEntries as [userId, user]}
												{@const isParticipant =
													quest.participants?.some(
														(p) => p.id === userId
													)}
												<button
													class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between"
													on:click|stopPropagation={() =>
														toggleParticipant(
															key,
															userId
														)}
												>
													<span><DisplayName id={userId} {user} /></span>
													{#if isParticipant}
														<span
															class="text-green-500"
															>✓</span
														>
													{/if}
												</button>
											{/each}
											{#if filteredUserEntries.length === 0}
												<div class="px-4 py-2 text-xs text-gray-500">No matching users</div>
											{/if}
										</div>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{:else if viewMode === "canvas"}
			<CanvasView
				{filteredQuests}
				{userStore}
				{holosphere}
				{holonID}
				{showCompleted}
				on:taskClick={handleTaskClick}
			/>
		{:else}
			<div class="flex flex-wrap">
				{#each filteredQuests as [key, quest]}
					{#if (quest.status === "ongoing" || (showCompleted && quest.status === "completed")) && (quest.type === "task" || quest.type === "quest")}
						<div
							id={key}
							class="w-full md:w-4/12 task-card relative"
							role="button"
							tabindex="0"
							on:click|stopPropagation={() =>
								handleTaskClick(key, quest)}
							on:keydown|stopPropagation={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									handleTaskClick(key, quest);
								}
							}}
						>
							<div class="p-2">
								<div
									class="p-4 rounded-3xl overflow-hidden"
									style="background-color: {quest.status ===
									'completed'
										? '#9CA3AF'
										: getColorFromCategory(
												quest.category
										  )}; 
										   opacity: {quest.status === 'completed' ? '0.6' : '1'}"
								>
									<div
										class="flex items-center justify-between"
									>
										{#if quest.when}
											<span
												class="text-sm whitespace-nowrap"
											>
												{formatDate(quest.when) +
													" @ " +
													formatTime(quest.when)}
												{#if quest.ends}- {formatTime(
														quest.ends
													)}
												{/if}
											</span>
										{/if}
									</div>
									<div class="text-center mb-4 mt-5">
										<p
											class="text-base font-bold opacity-70 truncate"
										>
											{quest.title}
										</p>
										{#if quest.created}
											<p class="text-xs opacity-50 mt-1">
												Created: {formatDate(quest.created)}
											</p>
										{/if}
										{#if quest.category}
											<p class="text-sm opacity-70 mt-1">
												<span
													class="inline-flex items-center justify-center"
												>
													<svg
														class="w-4 h-4 mr-1"
														viewBox="0 0 24 24"
														fill="currentColor"
													>
														<path
															d="M11.03 8h-6.06l-3 8h6.06l3-8zm1.94 0l3 8h6.06l-3-8h-6.06zm1.03-2h4.03l3-2h-4.03l-3 2zm-8 0h4.03l-3-2h-4.03l3 2z"
														/>
													</svg>
													{quest.category}
												</span>
											</p>
										{/if}
									</div>
									{#if quest.description}
										<div
											class="text-sm opacity-70 mb-4 line-clamp-2"
										>
											{quest.description}
										</div>
									{/if}
									{#if quest.location}
										<div
											class="text-sm opacity-70 mb-4 truncate"
										>
											{quest.location
												.split(",")
												.map((loc, i) => {
													if (i === 0) {
														return loc;
													} else {
														return loc.trim();
													}
												})
												.join(", ")}
										</div>
									{/if}

									<div
										class="flex justify-between pt-4 relative"
									>
										<div
											class="flex flex-col overflow-hidden"
										>
											<span
												class="opacity-70 font-bold text-base whitespace-nowrap mb-1"
											>
												🙋‍♂️ {quest.participants
													?.length || 0}
											</span>
											<div
												class="flex -space-x-2 relative group"
											>
												{#each (quest.participants || []).slice(0, 3) as participant}
													<div class="relative">
														<img
															class="w-6 h-6 rounded-full border-2 border-gray-300"
															src={`https://telegram.holons.io/getavatar?user_id=${participant.id}`}
															alt={participant.username}
														/>
														<div
															class="absolute invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-1 px-2 -bottom-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10"
														>
															{participant.username}
														</div>
													</div>
												{/each}
												{#if (quest.participants || []).length > 3}
													<div
														class="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center text-xs border-2 border-gray-300 relative group"
													>
														<span
															>+{quest
																.participants
																.length -
																3}</span
														>
														<div
															class="absolute invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-1 px-2 -bottom-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10"
														>
															{quest.participants
																.slice(3)
																.map(
																	(p) =>
																		p.username
																)
																.join(", ")}
														</div>
													</div>
												{/if}
											</div>
										</div>
										<div
											class="opacity-70 font-bold text-base whitespace-nowrap"
										>
											👍 {quest.appreciation?.length || 0}
										</div>
									</div>

									{#if showDropdown === key}
										<div
											class="user-dropdown absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50"
										>
											{#if Object.keys(userStore).length > 4}
												<div class="p-2 border-b border-gray-200">
													<input
														type="search"
														bind:value={userSearchQuery}
														on:click|stopPropagation
														placeholder="Search users…"
														class="w-full text-sm px-2 py-1 border border-gray-300 rounded outline-none focus:border-indigo-500"
														autocomplete="off"
													/>
												</div>
											{/if}
											<div class="py-1 max-h-64 overflow-y-auto">
												{#each filteredUserEntries as [userId, user]}
													{@const isParticipant =
														quest.participants?.some(
															(p) =>
																p.id === userId
														)}
													<button
														class="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center justify-between"
														on:click|stopPropagation={() =>
															toggleParticipant(
																key,
																userId
															)}
													>
														<span><DisplayName id={userId} {user} /></span>
														{#if isParticipant}
															<span
																class="text-green-500"
																>✓</span
															>
														{/if}
													</button>
												{/each}
												{#if filteredUserEntries.length === 0}
													<div class="px-4 py-2 text-xs text-gray-500">No matching users</div>
												{/if}
											</div>
										</div>
									{/if}
								</div>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
	<Schedule isWidget="true" />

	{#if selectedTask}
		<TaskModal
			quest={selectedTask.quest}
			questId={selectedTask.key}
			{userStore}
			{holosphere}
			holonId={holonID}
			on:close={() => (selectedTask = null)}
		/>
	{/if}
</div>

<style>
	/* Add smooth transition for the toggle switch dot */
	.dot {
		transition: transform 0.3s ease-in-out;
	}
	.translate-x-4 {
		transform: translateX(1rem);
	}

	.task-card {
		position: relative;
	}

	.user-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		max-height: 200px;
		overflow-y: auto;
		z-index: 50;
		background: white;
		border-radius: 0.375rem;
		box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1),
			0 2px 4px -1px rgba(0, 0, 0, 0.06);
	}

	/* Optional: Add some animation */
	.user-dropdown {
		animation: slideDown 0.2s ease-out;
	}

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

	/* Add tooltip arrow */
	.group-hover\:visible {
		position: absolute;
		pointer-events: none;
	}

	.group-hover\:visible::before {
		content: "";
		position: absolute;
		top: -4px;
		left: 50%;
		transform: translateX(-50%);
		border-width: 0 4px 4px 4px;
		border-style: solid;
		border-color: transparent transparent #1f2937 transparent;
	}
</style>
