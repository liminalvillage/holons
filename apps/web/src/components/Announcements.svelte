<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { page } from "$app/stores";
	import type { HoloSphere } from "holosphere";
	import { Bell } from 'svelte-feathers';

	let holosphere = getContext("holosphere") as HoloSphere;

	// Track current subscription state
	let currentHolonID: string | null = null;
	let unsubscribeFunction: (() => void) | null = null;

	onMount(() => {
		const idUnsubscribe = ID.subscribe((value) => {
			if (value && value !== currentHolonID) {
				// Clean up previous subscription
				if (unsubscribeFunction) {
					unsubscribeFunction();
					unsubscribeFunction = null;
				}
				
				currentHolonID = value;
				subscribeToAnnouncements();
			}
		});
		
		return () => {
			idUnsubscribe();
			if (unsubscribeFunction) {
				unsubscribeFunction();
			}
		};
	});

	interface Announcement {
		user: {
			id: string;
			first_name?: string;
			last_name?: string;
			username?: string;
		};
		content: string;
		/** Canonical timestamp; legacy records may carry `date` instead. */
		created?: string;
		date?: string;
	}

	let store: Record<string, Announcement> = {};
	$: holonID = $ID;
	$: announcements = Object.entries(store);

	// Helper to validate holon ID
	const isValidHolonId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	// Reactive block: when page ID changes (different holon), reload announcements
	$: if ($page.params.id && $page.params.id !== currentHolonID && isValidHolonId($page.params.id) && holosphere) {
		// Clean up previous subscription
		if (unsubscribeFunction) {
			unsubscribeFunction();
			unsubscribeFunction = null;
		}

		currentHolonID = $page.params.id;
		ID.set(currentHolonID);
		subscribeToAnnouncements();
	}

	// Subscribe to changes in the specified holon
	async function subscribeToAnnouncements() {
		store = {};
		if (holosphere && holonID) {
			try {
				const subscription = await holosphere.subscribe(holonID, "announcements", (announce, key) => {
					if (!key) return;
					
					if (announce) {
						// Updates the store with the new value
						store[key] = announce;
					} else {
						// A key may contain a null value (if data has been deleted/set to null)
						// if so, we remove the item from the store
						delete store[key];
						store = store;
					}
				});
				
				if (subscription && typeof subscription.unsubscribe === 'function') {
					unsubscribeFunction = subscription.unsubscribe;
				}
			} catch (error) {
				console.error('Failed to subscribe to announcements:', error);
			}
		}
	}
</script>

<div class="w-full mt-8 lg:mt-0 lg:w-4/12 lg:pl-4">
	<div class="bg-gray-800 rounded-2xl p-4 sm:p-6">
		<!-- Announcements Header -->
		<div class="flex items-center gap-2 text-white pb-4 border-b border-gray-700 mb-4">
			<Bell size="20" class="text-indigo-400" />
			<h2 class="text-lg font-semibold">Announcements</h2>
		</div>
		<!-- The shared list-row shape (see components.css). -->
		<div class="space-y-3">
			{#each announcements.reverse() as [key, announcement]}
				<div class="list-row list-row--static items-start">
					<img
						src="/api/avatar?user_id={announcement.user?.id}"
						alt="profile"
						class="object-cover w-8 h-8 rounded-full flex-shrink-0"
					/>
					<div class="list-row__body">
						<div class="flex items center justify-between w-full">
							<div class="list-row__title">
								{announcement.user?.first_name
									? announcement.user.first_name
									: announcement.user?.username}
								{announcement.user?.last_name
									? announcement.user?.last_name
									: ""}
							</div>
							<div
								class="flex justify-center items-center cursor-pointer h-7 w-7"
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
									class="text-white"
								>
									<polygon
										points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
									/>
								</svg>
							</div>
						</div>
						<p class="my-1 text-sm text-gray-300">
							{announcement.content}
						</p>
						<p class="list-row__meta justify-end">
							{new Date(announcement.created ?? announcement.date ?? '').toLocaleDateString()}
							{new Date(announcement.created ?? announcement.date ?? '').toLocaleTimeString()}
						</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
