<script lang="ts">
	
	import { onMount, getContext, createEventDispatcher } from "svelte";
	import { ID } from "../dashboard/store";

	import { formatDate, formatTime } from "../utils/date";

	import type { HoloSphere } from "holosphere";
	import type { Quest } from '../types/Quest';
	

	let holosphere = getContext("holosphere") as HoloSphere;

	$: holonID = $ID;
	let store: Record<string, Quest> = {};
	$: quests = Object.entries(store);

	let showDatePicker = false;
	let selectedQuest: { id: string; quest: Quest } | null = null;
	let tempDate: string;
	let tempTime: string;
	let dialogElement: HTMLDialogElement;

	const dispatch = createEventDispatcher();

	onMount(() => {
		//quests = data.filter((quest) => (quest.status === 'ongoing' || quest.status === 'scheduled') && (quest.type === 'task' || quest.type === 'quest'));
		ID.subscribe((value) => {
			holonID = value;
			subscribe();
		});

		// Add keyboard event listener for Escape key
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && showDatePicker) {
				showDatePicker = false;
				selectedQuest = null;
			}
		};

		document.addEventListener('keydown', handleEscape);

		return () => {
			document.removeEventListener('keydown', handleEscape);
		};
	});

	$: update(holonID);

	function subscribe() {
		store = {};
		if (holosphere && holonID) {
			holosphere.subscribe(holonID, "quests", (newquest, key) => {
				if (key) {
					if (newquest) {
						// Updates the store with the new value
						store[key] = newquest;
					} else {
						// A key may contain a null value (if data has been deleted/set to null)
						// if so, we remove the item from the store
						delete store[key];
						store = store;
					}
				}
			});
		}
	}

	function getStartTime(quest: Quest) {
		const date = new Date(quest.when);
		let hours = date.getHours();
		let minutes: number | string = date.getMinutes();
		minutes = minutes < 10 ? (minutes = `0${minutes}`) : minutes;
		return `${hours}${minutes}`;
	}

	function getEndTime(quest: Quest) {
		if (!quest.ends) {
			const date = new Date(quest.when);
			let hours = date.getHours();
			let minutes: number | string = date.getMinutes();
			minutes = minutes < 10 ? (minutes = `0${minutes}`) : minutes;
			return `${hours + 1}${minutes}`;
		} else {
			const date = new Date(quest.ends);
			let hours = date.getHours();
			let minutes: number | string = date.getMinutes();
			minutes = minutes < 10 ? (minutes = `0${minutes}`) : minutes;
			return `${hours}${minutes}`;
		}
	}

	function isToday(quest: Quest) {
		if (!quest || !quest.when) return false;
		
		const today = new Date();
		const date = new Date(quest.when);
		
		return (
			date.getDate() === today.getDate() &&
			date.getMonth() === today.getMonth() &&
			date.getFullYear() === today.getFullYear()
		);
	}

	function isTomorrow(quest: Quest) {
		const today = new Date();
		const date = new Date(quest.when);
		return date.getDate() === today.getDate() + 1;
	}

	function getDay(quest: Quest) {
		const today = new Date();
		const date = new Date(quest.when);
		if (date.getDate() < today.getDate()) return "past";
		if (date.getDate() === today.getDate()) return "today";
		if (date.getDate() === today.getDate() + 1) return "tomorrow";
		if (date.getDate() > today.getDate() + 1) return "future";
	}

	function getLength(quest: Quest	) {
		if (!quest.when) return 0;
		if (!quest.ends) return 1;
		const start: Date = new Date(quest.when);
		const end: Date = new Date(quest.end);
		const diff: number = end.getTime() - start.getTime();
		const minutes: number = Math.floor(diff / 60000);
		const length: number = minutes / 30;
		return length;
	}

	function update(hex) {
		// Filter ongoing and scheduled quests
		const filteredQuests = quests.filter(
			([key, questObj]) =>
				questObj.status === "ongoing"
		);

		// Sort quests by when property
		const sortedQuests = filteredQuests.sort(
			([keyA, questA], [keyB, questB]) => new Date(questA.when).getTime() - new Date(questB.when).getTime()
		);

		return sortedQuests;
	}

	function handleQuestClick(key: string, quest: Quest) {
		selectedQuest = { id: key, quest };
		const date = new Date(quest.when);
		tempDate = date.toISOString().split('T')[0];
		tempTime = date.toTimeString().slice(0, 5);
		showDatePicker = true;
	}

	function updateDateTime() {
		if (!selectedQuest) {
			console.error('No quest selected');
			return;
		}
		
		const newDate = new Date(`${tempDate}T${tempTime}`);
		const updatedQuest = {
			...selectedQuest.quest,
			when: newDate.toISOString()
		};
		
		// Close modal immediately
		showDatePicker = false;
		selectedQuest = null;
		
		// Then update in holosphere
		try {
			if (!holonID) return;
			holosphere.put(holonID, 'quests', updatedQuest)
				.then((success) => {
					if (!success) {
						console.error('Failed to update quest');
					}
				})
				.catch((error) => {
					console.error('Error updating quest:', error);
				});
		} catch (error) {
			console.error('Error updating quest:', error);
		}
	}

	function handleClickOutside(event: MouseEvent) {
		const modal = document.querySelector('.schedule-modal');
		if (modal && !modal.contains(event.target as Node)) {
			showDatePicker = false;
			selectedQuest = null;
		}
	}

	function deleteSchedule() {
		if (!selectedQuest) {
			console.error('No quest selected');
			return;
		}

		try {
			// Update the quest to remove scheduling
			const updatedQuest = {
				...selectedQuest.quest,
				when: null,
				status: 'ongoing'
			};
			
			// Close modal immediately
			showDatePicker = false;
			selectedQuest = null;
			
			// Update in holosphere
			holosphere.put(holonID, 'quests', updatedQuest)
				.then((success) => {
					if (!success) {
						console.error('Failed to remove schedule');
					}
				})
				.catch((error) => {
					console.error('Error removing schedule:', error);
				});
		} catch (error) {
			console.error('Error removing schedule:', error);
		}
	}
</script>

<div class="w-full h-full">
	<div class="p-6 h-full flex flex-col">
		<div class="flex text-white text-2xl pb-6 font-bold">
			<p>Schedule</p>
		</div>
		<div 
			class="scheduleContainer flex-1 overflow-y-auto"
			role="grid"
			aria-label="Daily schedule"
		>
			<!-- TIMES -->
			<div class="time start-800" role="rowheader">8:00</div>
			<div class="time start-830" role="rowheader">8:30</div>
			<div class="time start-900">9:00</div>
			<div class="time start-930">9:30</div>
			<div class="time start-1000">10:00</div>
			<div class="time start-1030">10:30</div>
			<div class="time start-1100">11:00</div>
			<div class="time start-1130">11:30</div>
			<div class="time start-1200">12:00</div>
			<div class="time start-1230">12:30</div>
			<div class="time start-1300">13:00</div>
			<div class="time start-1330">13:30</div>
			<div class="time start-1400">14:00</div>
			<div class="time start-1430">14:30</div>
			<div class="time start-1500">15:00</div>
			<div class="time start-1530">15:30</div>
			<div class="time start-1600">16:00</div>
			<div class="time start-1630">16:30</div>
			<div class="time start-1700">17:00</div>
			<div class="time start-1730">17:30</div>
			<div class="time start-1800">18:00</div>
			<div class="time start-1830">18:30</div>
			<div class="time start-1900">19:00</div>
			<div class="time start-1930">19:30</div>
			<div class="time start-2000">20:00</div>
			<div class="time start-2030">20:30</div>
			<div class="time start-2100">21:00</div>
			<div class="time start-2130">21:30</div>
			<div class="time start-2200">22:00</div>
			<div class="time start-2230">22:30</div>
			<div class="time start-2300">23:00</div>
			<div class="time start-2330">23:30</div>

			{#each quests as [key, quest]}
				{#if quest && quest.when && isToday(quest)}
					<button 
						type="button"
						id={key}
						class="event stage-{getDay(quest)} start-{getStartTime(quest)} end-{getEndTime(quest)} length-4"
						on:click={() => handleQuestClick(key, quest)}
						aria-label="Edit schedule for {quest.title}"
						role="gridcell"
					>
						<span class="font-medium">{quest.title}</span>
						{#if quest.location}
							<span class="text-sm text-gray-300">{quest.location}</span>
						{/if}
						<span class="text-sm">
							<span class="text-gray-400">
								🙋‍♂️ {quest.participants.length}
							</span>
							{#each quest.participants as participant}
								<span class="block text-gray-300">@{participant.username}</span>
							{/each}
						</span>
					</button>
				{/if}
			{/each}

			<!-- EVENTS -->
			<!-- <div class="event stage-saturn start-800 end-930 length-4">Arrival and registration <span>Registration Area</span></div>
	<div class="event stage-earth start-1000 end-1000 length-4">Welcome <span>Earth Stage</span></div>
	<div class="event stage-earth start-1030 end-1030 length-4">Speaker One <span>Earth Stage</span></div>
	<div class="event stage-earth start-1100 end-1100 length-4">Speaker Two <span>Earth Stage</span></div>
	<div class="event stage-earth start-1130 end-1130 length-4">Speaker Three <span>Earth Stage</span></div>
	
	<div class="event stage-mercury start-1200 end-1600 length-1">Speaker Five <span>Mercury Stage</span></div>
	<div class="event stage-venus start-1200 end-1600 length-1">Speaker Six <span>Venus Stage</span></div>
	<div class="event stage-mars start-1200 end-1600 length-1">Speaker Seven <span>Mars Stage</span></div>
	<div class="event stage-saturn start-1200 end-1300 length-1">Lunch <span>Saturn Stage</span></div>
	
	<div class="event stage-earth start-1630 end-1630 length-4">Speaker Eigth <span>Earth Stage</span></div>
	<div class="event stage-earth start-1700 end-1700 length-4">Speaker Nine <span>Earth Stage</span></div>
	
	<div class="event stage-saturn start-1730 end-1730 length-4">Break <span>Saturn Stage</span></div>
	
	<div class="event stage-earth start-1800 end-1900 length-1">Speaker Ten <span>Earth Stage</span></div>
	<div class="event stage-mercury start-1800 end-1900 length-1">Speaker Eleven <span>Mercury Stage</span></div>
	<div class="event stage-jupiter start-1800 end-1900 length-2">Speaker Twelve <span>Jupiter Stage</span></div>
	
	<div class="event stage-venus start-1930 end-2130 length-2">Speaker Thirteen <span>Venus Stage</span></div>
	<div class="event stage-saturn start-1930 end-2130 length-2">Drinks <span>Saturn Stage</span></div> -->
		</div>
	</div>
</div>

{#if showDatePicker}
	<dialog 
		class="fixed inset-0 bg-black/75 z-50"
		bind:this={dialogElement}
		on:close={() => { showDatePicker = false; selectedQuest = null; }}
		open
	>
		<div class="fixed inset-0 flex items-center justify-center">
			<form 
				method="dialog"
				class="bg-gray-800 p-6 rounded-xl schedule-modal border border-gray-700 shadow-xl max-w-md w-full"
				aria-labelledby="modal-title"
				aria-describedby="modal-description"
			>
				<div class="flex justify-between items-center mb-6">
					<h3 id="modal-title" class="text-white text-lg font-medium">Update Schedule</h3>
					<span id="modal-description" class="sr-only">Update schedule date and time</span>
					<div 
						class="text-gray-400 hover:text-white transition-colors cursor-pointer"
						on:click={() => {
							showDatePicker = false;
							selectedQuest = null;
						}}
						on:keydown={(e) => e.key === 'Enter' && (showDatePicker = false)}
						role="button"
						tabindex="0"
						aria-label="Close modal"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</div>
				</div>
				
				<div class="space-y-4">
					<div>
						<label for="date-input" class="text-gray-300 text-sm font-medium block mb-2">Date</label>
						<input 
							id="date-input"
							type="date" 
							bind:value={tempDate}
							class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
						>
					</div>
					
					<div>
						<label for="time-input" class="text-gray-300 text-sm font-medium block mb-2">Time</label>
						<input 
							id="time-input"
							type="time" 
							bind:value={tempTime}
							class="w-full bg-gray-900 text-white p-2.5 rounded-lg border border-gray-700 focus:border-gray-500 focus:ring-1 focus:ring-gray-500 outline-none transition-colors"
						>
					</div>
					
					<div class="flex gap-3 justify-end pt-2">
						<button 
							type="button"
							class="px-4 py-2 bg-gray-700 text-red-300 rounded-lg hover:bg-gray-600 border border-red-900/20 transition-colors text-sm font-medium"
							on:click={deleteSchedule}
							aria-label="Remove schedule"
						>
							Remove Schedule
						</button>
						<button 
							type="button"
							class="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 border border-gray-600 transition-colors text-sm font-medium"
							on:click={() => {
								showDatePicker = false;
								selectedQuest = null;
							}}
							aria-label="Cancel changes"
						>
							Cancel
						</button>
						<button 
							type="button"
							class="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 transition-colors text-sm font-medium"
							on:click={updateDateTime}
							aria-label="Update schedule"
						>
							Update
						</button>
					</div>
				</div>
			</form>
		</div>
	</dialog>
{/if}

<style lang="scss">
	$blockTimes: 800, 830, 900, 930, 1000, 1030, 1100, 1130, 1200, 1230, 1300,
		1330, 1400, 1430, 1500, 1530, 1600, 1630, 1700, 1730, 1800, 1830, 1900,
		1930, 2000, 2030, 2100, 2130, 2200, 2230, 2300, 2330;
	$blockLengths: 1, 2, 3, 4;

	.scheduleContainer {
		display: grid;
		grid-gap: 0.2rem;

		grid-template-columns: 5rem repeat(4, 1fr);
		grid-template-rows: repeat(28, 1fr);
		grid-template-areas:
			"time800 stage stage stage stage"
			"time830 stage stage stage stage"
			"time900 stage stage stage stage"
			"time930 stage stage stage stage"
			"time1000 stage stage stage stage"
			"time1030 stage stage stage stage"
			"time1100 stage stage stage stage"
			"time1130 stage stage stage stage"
			"time1200 stage stage stage stage"
			"time1230 stage stage stage stage"
			"time1300 stage stage stage stage"
			"time1330 stage stage stage stage"
			"time1400 stage stage stage stage"
			"time1430 stage stage stage stage"
			"time1500 stage stage stage stage"
			"time1530 stage stage stage stage"
			"time1600 stage stage stage stage"
			"time1630 stage stage stage stage"
			"time1700 stage stage stage stage"
			"time1730 stage stage stage stage"
			"time1800 stage stage stage stage"
			"time1830 stage stage stage stage"
			"time1900 stage stage stage stage"
			"time1930 stage stage stage stage"
			"time2000 stage stage stage stage"
			"time2030 stage stage stage stage"
			"time2100 stage stage stage stage"
			"time2130 stage stage stage stage"
			"time2200 stage stage stage stage"
			"time2230 stage stage stage stage"
			"time2300 stage stage stage stage"
			"time2330 stage stage stage stage";
	}

	/**
 * Time
 */
	.time {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		border-top: thin dotted #ccc;
		height: 100%;
		padding: 0 0.5rem;

		@each $time in $blockTimes {
			&.start-#{$time} {
				grid-area: time#{$time};
			}
		}

		color: #ccc;

		&[class*="30"]:not(.start-1300) {
			font-size: 0.8rem;
			color: #4d4949;
		}
	}

	/**
 * Event
 */
	.event {
		display: flex;
		justify-content: center;
		flex-direction: column;
		padding: 0.5rem 1rem;
		background-color: orange;
		border-radius: 0.2rem;
		font-size: 0.8rem;
		font-weight: bold;
		line-height: 1.4;

		span {
			display: block;
			width: 100%;
			font-size: 0.8em;
			font-weight: normal;
		}

		@each $time in $blockTimes {
			&.start-#{$time} {
				grid-row-start: time#{$time};
			}
		}

		@each $time in $blockTimes {
			&.end-#{$time} {
				grid-row-end: time#{$time};
			}
		}

		@each $length in $blockLengths {
			&.length-#{$length} {
				grid-column-end: span #{$length};
			}
		}

		&.stage-past {
			background-color: #9ccc65;
		}
		&.stage-today {
			background-color: #979797;
		}
		&.stage-tomorrow {
			background-color: #b3e5fc;
		}
		&.stage-future {
			background-color: #81d4fa;
		}
		&.stage-saturn {
			background-color: #26c6da;
		}
		&.stage-mercury {
			background-color: #9ccc65;
		}
		&.stage-venus {
			background-color: #ff8a65;
		}
		&.stage-mars {
			background-color: #b3e5fc;
		}
		&.stage-jupiter {
			background-color: #81d4fa;
		}
		&.stage-saturn {
			background-color: #26c6da;
		}
	}
</style>
