<script lang="ts">

	import { onMount, getContext } from 'svelte';
	import { ID } from '../dashboard/store';
	import { browser } from '$app/environment';
	
	import Announcements from './Announcements.svelte';

	import { formatDate, formatTime } from '../utils/date';

	import type { HoloSphere } from "holosphere";
	let holosphere = getContext('holosphere') as HoloSphere;

	let holonID: string = '';
	let store: Record<string, Quest> = {};
	let isLoading = true;
	let error = '';
	let unsubscribe: (() => void) | null = null;

	$: quests = Object.entries(store);

	// Wait for holosphere to be ready
	async function waitForHolosphere(): Promise<boolean> {
		if (holosphere) {
			return true;
		}
		
		let retries = 0;
		const maxRetries = 10;
		
		while (retries < maxRetries) {
			await new Promise(resolve => setTimeout(resolve, 200));
			try {
				holosphere = getContext("holosphere");
				if (holosphere) {
					return true;
				}
			} catch (error) {
				// Silently handle context errors
			}
			retries++;
		}
		
		return false;
	}

	// Load initial data and subscribe to changes
	async function loadScheduleData() {
		if (!holonID || !holosphere) {
			isLoading = false;
			return;
		}

		isLoading = true;
		error = '';
		store = {};

		try {
			// Load initial quests data
			const initialQuestsData = await holosphere.getAll(holonID, "quests");
			if (initialQuestsData && typeof initialQuestsData === 'object') {
				store = initialQuestsData;
			}

			// Subscribe to quest updates
			unsubscribe = holosphere.subscribe(holonID, 'quests', (newquest, key) => {
				if (newquest) {
					const parsedQuest = newquest;
					// Updates the store with the new value
					store = { ...store, [key]: parsedQuest };
				} else {
					// A key may contain a null value (if data has been deleted/set to null)
					// if so, we remove the item from the store
					const { [key]: _, ...rest } = store;
					store = rest;
				}
			});

			console.log(`Successfully loaded schedule for holon ${holonID}:`, Object.keys(store).length, 'quests');

		} catch (err) {
			console.error('Error loading schedule data:', err);
			error = 'Failed to load schedule. Please try again.';
		} finally {
			isLoading = false;
		}
	}

	onMount(async () => {
		// Wait for holosphere to be ready
		const holosphereAvailable = await waitForHolosphere();
		if (!holosphereAvailable) {
			error = 'Connection not available. Please refresh the page.';
			isLoading = false;
			return;
		}

		// Set up ID subscription
		const idUnsubscribe = ID.subscribe(async (value) => {
			if (value && value !== holonID) {
				holonID = value;
				// Clean up previous subscription
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
				await loadScheduleData();
			}
		});

		// Initial load if we have an ID
		if ($ID) {
			holonID = $ID;
			await loadScheduleData();
		}

		// Cleanup on unmount
		return () => {
			idUnsubscribe();
			if (unsubscribe) {
				unsubscribe();
			}
		};
	});

	function getStartTime(quest: Quest): string {
		const date = new Date(quest.when || '');
		let hours = date.getHours();
		let minutes: string | number = date.getMinutes();
		minutes = minutes < 10 ? `0${minutes}` : minutes;
		return `${hours}${minutes}`;
	}

	function getEndTime(quest: Quest): string {
		if (!quest.ends) {
			const date = new Date(quest.when || '');
			let hours = date.getHours();
			let minutes: string | number = date.getMinutes();
			minutes = minutes < 10 ? `0${minutes}` : minutes;
			return `${hours + 1}${minutes}`;
		} else {
			const date = new Date(quest.ends);
			let hours = date.getHours();
			let minutes: string | number = date.getMinutes();
			minutes = minutes < 10 ? `0${minutes}` : minutes;
			return `${hours}${minutes}`;
		}
	}

	function isToday(quest: Quest): boolean {
		if (!quest || !quest.when) return false;
		
		const today = new Date();
		const date = new Date(quest.when);
		
		return (
			date.getDate() === today.getDate() &&
			date.getMonth() === today.getMonth() &&
			date.getFullYear() === today.getFullYear()
		);
	}

	function isTomorrow(quest: Quest): boolean {
		const today = new Date();
		const date = new Date(quest.when || '');
		return date.getDate() === today.getDate() + 1;
	}

	function getDay(quest: Quest): string {
		const today = new Date();
		const date = new Date(quest.when || '');
		if (date.getDate() < today.getDate()) return 'past';
		if (date.getDate() === today.getDate()) return 'today';
		if (date.getDate() === today.getDate() + 1) return 'tomorrow';
		return 'future';
	}

	function getLength(quest: Quest): number {
		if (!quest.when) return 0;
		if (!quest.ends) return 1;
		const start = new Date(quest.when);
		const end = new Date(quest.ends);
		const diff = end.getTime() - start.getTime();
		const minutes = Math.floor(diff / 60000);
		const length = minutes / 30;
		return length;
	}
</script>

<div class="flex flex-wrap">
	<div class="w-full lg:w-8/12 bg-gray-800 py-6 px-6 rounded-3xl">
		<div class="flex justify-between text-white items-center mb-8">
			<p class="text-2xl font-bold">Schedule Today</p>
			<p class="">{new Date().toDateString()}</p>
		</div>
		<div class="scheduleContainer">
			<!-- TIMES -->
			<div class="time start-800">8:00</div>
			<div class="time start-830">8:30</div>
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

			{#if isLoading}
				<div class="event stage-today">Loading schedule...</div>
			{/if}
			{#if error}
				<div class="event stage-today text-red-500">{error}</div>
			{/if}
				{#each quests as [key, quest]}
					{#if quest && quest.when && isToday(quest)}
						<div
							id={key}
							class="event stage-{getDay(quest)} start-{getStartTime(quest)} end-{getEndTime(quest)} length-4"
						>
							{quest.title} <span>{quest.location || ''}</span>
							<span>
								<p class="mb-0 text-muted">🙋‍♂️ {quest.participants.length}</p>
								{#each quest.participants as participant}
									<p>{@html `@${participant.username}`}</p>
								{/each}
							</span>
						</div>
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
	<Announcements />
</div>

<style lang="scss">
	$blockTimes: 800, 830, 900, 930, 1000, 1030, 1100, 1130, 1200, 1230, 1300, 1330, 1400, 1430, 1500,
		1530, 1600, 1630, 1700, 1730, 1800, 1830, 1900, 1930, 2000, 2030, 2100, 2130, 2200, 2230, 2300, 2330;
	$blockLengths: 1, 2, 3, 4;

	// body {
	// 	display: flex;
	// 	align-items: center;
	// 	justify-content: center;
	// 	min-height: 100vh;
	// 	padding: 4rem 0;
	// 	font-family: -system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
	// }

	.scheduleContainer {
		display: grid;
		grid-gap: 0.2rem;

		grid-template-columns: 5rem repeat(4, 1fr);
		grid-template-rows: repeat(28, 1fr);
		grid-template-areas:
			'time800 stage stage stage stage'
			'time830 stage stage stage stage'
			'time900 stage stage stage stage'
			'time930 stage stage stage stage'
			'time1000 stage stage stage stage'
			'time1030 stage stage stage stage'
			'time1100 stage stage stage stage'
			'time1130 stage stage stage stage'
			'time1200 stage stage stage stage'
			'time1230 stage stage stage stage'
			'time1300 stage stage stage stage'
			'time1330 stage stage stage stage'
			'time1400 stage stage stage stage'
			'time1430 stage stage stage stage'
			'time1500 stage stage stage stage'
			'time1530 stage stage stage stage'
			'time1600 stage stage stage stage'
			'time1630 stage stage stage stage'
			'time1700 stage stage stage stage'
			'time1730 stage stage stage stage'
			'time1800 stage stage stage stage'
			'time1830 stage stage stage stage'
			'time1900 stage stage stage stage'
			'time1930 stage stage stage stage'
			'time2000 stage stage stage stage'
			'time2030 stage stage stage stage'
			'time2100 stage stage stage stage'
			'time2130 stage stage stage stage'
			'time2200 stage stage stage stage'
			'time2230 stage stage stage stage'
			'time2300 stage stage stage stage'
			'time2330 stage stage stage stage';
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

		&[class*='30']:not(.start-1300) {
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
