<script lang="ts">
	import { onMount, getContext } from "svelte";
	import { ID } from "../dashboard/store";;
	import type { HoloSphere } from "holosphere";

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
		date: string;
	}

	let store: Record<string, Announcement> = {};
	$: holonID = $ID;
	$: announcements = Object.entries(store);

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
	<div class="bg-gray-800 rounded-3xl px-6 pt-6">
		<div class="flex text-white text-2xl pb-6 font-bold">
			<p>Announcements</p>
		</div>
		<div>
			{#each announcements.reverse() as [key, announcement]}
				<div
					class="border-t solid border-gray-700 p-4 flex 2xl:items-start w-full hover:bg-gray-700"
				>
					<img
						src="https://telegram.holons.io/getavatar?user_id={announcement.user?.id}"
						alt="profile"
						class="object-cover w-10 h-10 rounded-full"
					/>
					<div class="pl-4 w-full">
						<div class="flex items center justify-between w-full">
							<div
								class="text-white
                            font-medium"
							>
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
						<p class="my-2 text-sm text-gray-400">
							{announcement.content}
						</p>
						<p
							class="text-right
                        text-gray-400 text-sm"
						>
							{new Date(announcement.date).toLocaleDateString()}
							{new Date(announcement.date).toLocaleTimeString()}
						</p>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
