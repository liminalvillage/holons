<script lang="ts">
	// @ts-nocheck

	import { onMount, onDestroy, getContext } from "svelte";
	import { ID } from "../dashboard/store";
	import { browser } from "$app/environment";
	import { page } from "$app/stores";

	import type { HoloSphere } from "holosphere";
	import Announcements from "./Announcements.svelte";
	import RoleModal from "./RoleModal.svelte";
	import RoleWeekView from "./RoleWeekView.svelte";
	import PermanentAssignmentNotification from "./PermanentAssignmentNotification.svelte";
	import TitleBar from "./shared/TitleBar.svelte";
	import StatCard from "./shared/StatCard.svelte";
	import StatGrid from "./shared/StatGrid.svelte";
	import FeatureToolbar from "./shared/FeatureToolbar.svelte";
	import GenericImportModal from "./shared/GenericImportModal.svelte";
	import { Users, UserCheck, UserX, Plus, Calendar, List, Grid } from 'svelte-feathers';
	import { nameMap, resolvedName, resolveName, buildHologramLink, extractHolonIdFromSoul } from '$lib/stores/nameResolver';
	import { goto } from '$app/navigation';
	import { showFederated, showHolograms } from '$lib/stores/lensFilters';
	import SourceBadge from './shared/SourceBadge.svelte';
	import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
	import { getWeekKey, toISODateString } from "../utils/weekUtils";
	import { notifyWriteDenied } from "../lib/stores/writeNotifications";

	/**
	 * @type {Record<string, any>}
	 */
	let store = {};
	/**
	 * @type {Record<string, any>}
	 */
	let userStore = {};
	let activeHolonId: string | undefined; // Manages the current Holon ID for this component
	let isUserStoreReady = false; // Tracks if userStore has been populated for the activeHolonId

	let holosphere = getContext("holosphere") as HoloSphere;
	$: holonName = resolvedName(activeHolonId, $nameMap, null, 'Roles');
	let statsCollapsed = false; // For mobile stats toggle

	// Per-feature filters (search + view). Federation/hologram toggles are
	// global — see $lib/stores/lensFilters.
	let filters = loadFilters('roles', {
		searchQuery: '',
		viewMode: 'grid' as 'list' | 'grid' | 'week',
	});
	$: saveFilters('roles', filters);

	// Legacy convenience flags derived from filters.viewMode so the existing
	// template blocks (week / list / grid) keep working without rewrites.
	$: viewMode = filters.viewMode === 'week' ? 'week' : 'cards';
	$: isListView = filters.viewMode === 'list';

	const ROLE_VIEW_MODES = [
		{ value: 'list', icon: List, label: 'List' },
		{ value: 'grid', icon: Grid, label: 'Grid' },
		{ value: 'week', icon: Calendar, label: 'Week' },
	];

	// One-time migration from the legacy localStorage keys so existing users
	// keep the view mode they had before this refactor.
	onMount(() => {
		if (browser) {
			try {
				const savedIsList = localStorage.getItem("rolesViewMode");
				const savedType = localStorage.getItem("rolesViewModeType");
				if (savedType === 'week') filters.viewMode = 'week';
				else if (savedIsList === 'list') filters.viewMode = 'list';
			} catch {}
		}
	});

	// Apply the search filter against the role title; 'roles' stays unchanged
	// for stats so the top bar reflects the full dataset, not the filtered one.
	$: roles = Object.entries(store || {});
	$: visibleRoles = (() => {
		const q = filters.searchQuery.trim().toLowerCase();
		if (!q && $showHolograms && $showFederated) return roles;
		return roles.filter(([, role]) => {
			const isHologram = (role as any)?._hologram?.isHologram === true;
			const isFederated = !!(role as any)?._federation;
			if (!$showHolograms && isHologram) return false;
			if (!$showFederated && (isHologram || isFederated)) return false;
			if (!q) return true;
			const title = (role as any)?.title ?? '';
			const description = (role as any)?.description ?? '';
			return `${title} ${description}`.toLowerCase().includes(q);
		});
	})();

	let notification: { roleName: string; userName: string } | null = null;

	// Get today's assigned user for a role (from week schedule or permanent)
	function getTodayAssignment(role: any): { id: string; username: string } | null {
		// Check for permanent assignment first
		if (role.participants?.some((p: any) => p.isPermanent)) {
			const permanent = role.participants.find((p: any) => p.isPermanent);
			return permanent || role.participants[0];
		}

		// Check week schedule for today
		const today = new Date();
		const todayStr = toISODateString(today);
		const currentWeekKey = getWeekKey(today);

		if (role.weekSchedule?.weekKey === currentWeekKey) {
			const todayAssignment = role.weekSchedule.assignments?.find(
				(a: any) => a.date === todayStr
			);
			if (todayAssignment?.users?.length > 0) {
				return todayAssignment.users[0];
			}
		}

		// Fall back to first participant
		return role.participants?.[0] || null;
	}

	function handlePermanentAssignment(event: CustomEvent<{ roleName: string; userName: string }>) {
		notification = event.detail;
	}

	let idStoreUnsubscribe: (() => void) | undefined;
	let rolesSubscriptionUnsubscribe: (() => void) | undefined;
	let usersSubscriptionUnsubscribe: (() => void) | undefined;

	async function loadAndSubscribeData(holonIdToLoad: string) {
		console.log(`[Roles.svelte] loadAndSubscribeData called for holon: ${holonIdToLoad}`);
		
		// Clean up previous subscriptions
		if (typeof rolesSubscriptionUnsubscribe === 'function') {
			console.log(`[Roles.svelte] Cleaning up previous roles subscription`);
			rolesSubscriptionUnsubscribe();
		}
		rolesSubscriptionUnsubscribe = undefined;

		if (typeof usersSubscriptionUnsubscribe === 'function') {
			console.log(`[Roles.svelte] Cleaning up previous users subscription`);
			usersSubscriptionUnsubscribe();
		}
		usersSubscriptionUnsubscribe = undefined;

		// Reset stores and readiness flags
		store = {};
		userStore = {};
		isUserStoreReady = false;

		if (!holosphere || !holonIdToLoad) {
			console.warn("[Roles.svelte] loadAndSubscribeData called without holosphere or holonIdToLoad.");
			return;
		}

		// Fetch initial roles (federated when toggle is on)
		try {
			let initialRolesData = $showFederated
				? await holosphere.getFederated(holonIdToLoad, "roles", {
					includeLocal: true,
					includeFederated: true,
					resolveReferences: true,
					aggregate: false
				})
				: await holosphere.getAll(holonIdToLoad, "roles");
			console.log(`[Roles.svelte] Initial roles data:`, initialRolesData);
			
			// Log detailed role information to see what's actually stored
			if (Array.isArray(initialRolesData)) {
				initialRolesData.forEach((role, index) => {
					console.log(`[Roles.svelte] Role ${index}:`, {
						id: role.id,
						title: role.title,
						participants: role.participants,
						participantCount: role.participants?.length || 0,
						created_at: role.created_at,
						created_via: role.created_via
					});
				});
			}
			
			if (Array.isArray(initialRolesData)) {
				// Try to use role ID if available, otherwise use title
				store = initialRolesData.reduce((acc, role) => {
					// For QR-generated roles, ensure we use a consistent key
					let roleKey;
					if (role.id && role.id !== role.title) {
						roleKey = role.id;
					} else if (role.title) {
						roleKey = role.title;
					} else {
						roleKey = `role_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
					}
					
					if (roleKey) {
						acc[roleKey] = role;
						console.log(`[Roles.svelte] Added role with key '${roleKey}' (ID: ${role.id}, title: '${role.title}')`);
					}
					return acc;
				}, {});
			} else if (typeof initialRolesData === 'object' && initialRolesData !== null) {
				// If it's already an object, normalize the keys to ensure consistency
				let normalizedRoleStore = {};
				Object.entries(initialRolesData).forEach(([key, role]) => {
					if (role && (role.id || role.title)) {
						// For QR-generated roles, prefer title as key if id equals title
						let roleKey;
						if (role.id && role.id !== role.title) {
							roleKey = role.id;
						} else if (role.title) {
							roleKey = role.title;
						} else {
							roleKey = key; // Fallback to original key
						}
						
						normalizedRoleStore[roleKey] = role;
						console.log(`[Roles.svelte] Normalized role with key '${roleKey}' from original key '${key}'`);
					} else if (role) {
						// Keep original key if no id or title
						normalizedRoleStore[key] = role;
						console.log(`[Roles.svelte] Kept role with original key '${key}' (no ID/title found)`);
					}
				});
				store = normalizedRoleStore;
                console.log(`[Roles.svelte] Store initialized with normalized object data, keys:`, Object.keys(store));
            } else {
				store = {};
				console.log(`[Roles.svelte] Store initialized as empty object`);
			}
			
			console.log(`[Roles.svelte] Final store after initialization:`, Object.keys(store));
		} catch (e) {
			console.error(`[Roles.svelte] Error fetching initial roles for ${holonIdToLoad}:`, e);
			store = {};
		}

		// Fetch initial users
		try {
			const initialUsers = await holosphere.getAll(holonIdToLoad, "users");
			console.log(`[Roles.svelte] Initial users data:`, initialUsers);
			
			// Log detailed user information to see what's actually stored
			if (Array.isArray(initialUsers)) {
				initialUsers.forEach((user, index) => {
					console.log(`[Roles.svelte] User ${index}:`, {
						id: user.id,
						username: user.username,
						first_name: user.first_name,
						last_name: user.last_name
					});
				});
			}
			
			if (Array.isArray(initialUsers)) {
				// Convert array to object map using user.id as the canonical key
				userStore = initialUsers.reduce((acc, user) => {
					if (user && user.id) {
						acc[user.id] = user;
						console.log(`[Roles.svelte] Added user with key '${user.id}' (username: '${user.username || user.first_name}')`);
					}
					return acc;
				}, {});
			} else if (typeof initialUsers === 'object' && initialUsers !== null) {
				// If it's already an object, normalize the keys to use user.id
				let normalizedUserStore = {};
				Object.entries(initialUsers).forEach(([key, user]) => {
					if (user && user.id) {
						normalizedUserStore[user.id] = user;
						console.log(`[Roles.svelte] Normalized user with key '${user.id}' from original key '${key}'`);
					} else if (user) {
						// Fallback: keep original key if no id
						normalizedUserStore[key] = user;
						console.log(`[Roles.svelte] Kept user with original key '${key}' (no ID found)`);
					}
				});
				userStore = normalizedUserStore;
			} else {
				userStore = {};
				console.log(`[Roles.svelte] No initial users data, initialized empty userStore`);
			}
			
			console.log(`[Roles.svelte] Final userStore after initialization:`, Object.keys(userStore));
		} catch (e) {
			console.error(`[Roles.svelte] Error fetching initial users for ${holonIdToLoad}:`, e);
			userStore = {};
		} finally {
			isUserStoreReady = true;
		}

		// Subscribe to role updates
		const subscribedHolonId = holonIdToLoad;
		rolesSubscriptionUnsubscribe = holosphere.subscribe(holonIdToLoad, "roles", (newRole, key) => {
			if (activeHolonId !== subscribedHolonId) {
				return; // Ignore updates from old holon subscription
			}
			if (!key || key === 'undefined') {
				console.warn(`[Roles.svelte] Subscription received update with invalid key: '${key}'`);
				return;
			}

			console.log(`[Roles.svelte] Role update received - Key: '${key}', Role title: '${newRole?.title}', Role ID: '${newRole?.id}'`);
			console.log(`[Roles.svelte] Current store keys:`, Object.keys(store));
			console.log(`[Roles.svelte] Store before update:`, store);

			if (newRole) {
				// Normalize the role key using the same logic as initialization
				let normalizedKey;
				if (newRole.id && newRole.id !== newRole.title) {
					normalizedKey = newRole.id;
				} else if (newRole.title) {
					normalizedKey = newRole.title;
				} else {
					normalizedKey = key; // Fallback to subscription key
				}

				// Check if we already have this role by normalized key
				const existingKey = Object.keys(store).find(storeKey => 
					store[storeKey].id === newRole.id || store[storeKey].title === newRole.title
				);

				if (existingKey && existingKey !== normalizedKey) {
					// We have this role but with a different key, update the existing key
					console.log(`[Roles.svelte] Role exists with different key '${existingKey}', updating it instead of '${normalizedKey}'`);
					store = { ...store, [existingKey]: newRole };
					// Remove the old key if it's different
					if (existingKey !== normalizedKey) {
						const { [normalizedKey]: _, ...rest } = store;
						store = rest;
					}
				} else {
					// Use the normalized key for updates
					const oldRole = store[normalizedKey];
					if (oldRole) {
						console.log(`[Roles.svelte] Updating existing role with key '${normalizedKey}' (title: '${newRole.title}')`);
					} else {
						console.log(`[Roles.svelte] Adding new role with key '${normalizedKey}' (title: '${newRole.title}')`);
					}
					store = { ...store, [normalizedKey]: newRole };
				}
				console.log(`[Roles.svelte] Store after update:`, store);
			} else {
				// Remove the role - try to find it by the subscription key or normalized key
				const roleToRemove = store[key] || store[newRole?.title] || store[newRole?.id];
				if (roleToRemove) {
					const keyToRemove = Object.keys(store).find(storeKey => store[storeKey] === roleToRemove);
					if (keyToRemove) {
						console.log(`[Roles.svelte] Removing role with key '${keyToRemove}'`);
						const { [keyToRemove]: _, ...rest } = store;
						store = rest;
					}
				} else {
					console.log(`[Roles.svelte] Removing role with subscription key '${key}'`);
					const { [key]: _, ...rest } = store;
					store = rest;
				}
			}
		});

		// Subscribe to user updates
		usersSubscriptionUnsubscribe = holosphere.subscribe(holonIdToLoad, "users", (newUser, key) => {
			if (activeHolonId !== subscribedHolonId) {
				return; // Ignore updates from old holon subscription
			}
			if (!key || key === 'undefined') {
				console.warn(`[Roles.svelte] User subscription received update with invalid key: '${key}'`);
				return;
			}
			
			console.log(`[Roles.svelte] User update received - Key: '${key}', User:`, newUser);
			
			if (newUser) {
				// Use user.id as the canonical key if available
				const canonicalKey = newUser.id || key;
				
				if (newUser.id && key !== newUser.id) {
					console.log(`[Roles.svelte] Normalizing user key from '${key}' to '${newUser.id}'`);
					// Remove the old key if it's different from the canonical key
					const { [key]: _, ...rest } = userStore;
					userStore = { ...rest, [canonicalKey]: newUser };
				} else {
					// Use the key directly
					userStore = { ...userStore, [canonicalKey]: newUser };
				}
				console.log(`[Roles.svelte] Updated userStore with key '${canonicalKey}'`);
			} else {
				// Remove the user
				console.log(`[Roles.svelte] Removing user with key '${key}'`);
				const { [key]: _, ...rest } = userStore;
				userStore = rest;
			}
		});
	}

	onMount(() => {
		console.log(`[Roles.svelte] Component mounted, setting up ID subscription`);
		idStoreUnsubscribe = ID.subscribe(newIdFromStore => {
			console.log(`[Roles.svelte] ID store update received: ${newIdFromStore}, current activeHolonId: ${activeHolonId}`);
			if (newIdFromStore !== activeHolonId) {
				console.log(`[Roles.svelte] ID store changed. Old: ${activeHolonId}, New: ${newIdFromStore}`);
				activeHolonId = newIdFromStore;

				if (activeHolonId) {
					console.log(`[Roles.svelte] Loading data for new holon: ${activeHolonId}`);
					isUserStoreReady = false; 
					loadAndSubscribeData(activeHolonId);
				} else {
					console.log("[Roles.svelte] ActiveHolonId cleared. Cleaning up subscriptions and stores.");
					if (typeof rolesSubscriptionUnsubscribe === 'function') rolesSubscriptionUnsubscribe();
					rolesSubscriptionUnsubscribe = undefined;
					if (typeof usersSubscriptionUnsubscribe === 'function') usersSubscriptionUnsubscribe();
					usersSubscriptionUnsubscribe = undefined;
					store = {};
					userStore = {};
					isUserStoreReady = false;
				}
			} else {
				console.log(`[Roles.svelte] ID store update ignored - same holon ID`);
			}
		});
	});

	onDestroy(() => {
		console.log("[Roles.svelte] Component destroyed. Cleaning up all subscriptions.");
		if (typeof idStoreUnsubscribe === 'function') idStoreUnsubscribe();
		idStoreUnsubscribe = undefined;
		if (typeof rolesSubscriptionUnsubscribe === 'function') rolesSubscriptionUnsubscribe();
		rolesSubscriptionUnsubscribe = undefined;
		if (typeof usersSubscriptionUnsubscribe === 'function') usersSubscriptionUnsubscribe();
		usersSubscriptionUnsubscribe = undefined;
	});

	// Helper to validate holon ID
	const isValidHolonId = (id: string | undefined | null): id is string =>
		!!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

	// Reactive block: when page ID changes (different holon), reload roles data
	$: if ($page.params.id && $page.params.id !== activeHolonId && isValidHolonId($page.params.id) && holosphere) {
		console.log(`[Roles.svelte] Page param changed. Old: ${activeHolonId}, New: ${$page.params.id}`);
		activeHolonId = $page.params.id;
		ID.set(activeHolonId);
		isUserStoreReady = false;
		loadAndSubscribeData(activeHolonId);
		// Resolve holon name reactively
		resolveName(activeHolonId);
	}

	let lastRolesFedFlag = $showFederated;
	$: if (activeHolonId && holosphere && $showFederated !== lastRolesFedFlag) {
		lastRolesFedFlag = $showFederated;
		loadAndSubscribeData(activeHolonId);
	}

	// Format time for display
	/**
	 * @param {string | number | Date} dateTime
	 */
	function formatTime(dateTime) {
		const options = { hour: "2-digit", minute: "2-digit" };
		return new Date(dateTime).toLocaleTimeString([], options);
	}

	function formatDate(dateTime) {
		const date = new Date(dateTime);
		const today = new Date();
		const tomorrow = new Date(today);
		tomorrow.setDate(tomorrow.getDate() + 1);

		if (date.toDateString() === today.toDateString()) {
			return "today";
		} else if (date.toDateString() === tomorrow.toDateString()) {
			return "tomorrow";
		} else {
			const diff = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
			return `in ${diff} days`;
		}
	}

	function getRoleColor(role) {
		// Check if there's an assignment for today (from week schedule or permanent)
		const todayAssignment = getTodayAssignment(role);

		if (!todayAssignment) {
			return "#553333"; // Red tint for unassigned roles
		}

		// Role has someone assigned for today - show as active/green
		return "#335533"; // Green tint for assigned roles
	}

	let selectedRole = null;

	function handleRoleClick(key, role) {
		console.log("Clicked role:", { key, role });
		selectedRole = { key, role };
		console.log("Selected role:", selectedRole);
	}

	async function addNewRole() {
		const newRoleId = `role-${Date.now()}`;
		const newRole = {
			id: newRoleId,
			title: 'New Role',
			participants: [],
			created_at: new Date().toISOString()
		};
		try {
			// Save the new role to HoloSphere
			await holosphere.put(activeHolonId, 'roles', newRole);
			// Open the modal for editing
			selectedRole = { key: newRoleId, role: newRole };
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error adding new role:', error);
			}
		}
	}

	let showImportModal = false;

	async function handleImport(event) {
		if (!activeHolonId) return;
		const items = event.detail;
		try {
			for (let i = 0; i < items.length; i++) {
				const raw = items[i] ?? {};
				const title = String(raw.title ?? raw.name ?? raw.text ?? '').trim();
				if (!title) continue;
				const newRole = {
					id: raw.id ?? `role-${Date.now()}-${i}`,
					title,
					description: raw.description ?? '',
					participants: Array.isArray(raw.participants) ? raw.participants : [],
					created_at: new Date().toISOString()
				};
				await holosphere.put(activeHolonId, 'roles', newRole);
			}
			showImportModal = false;
		} catch (error: any) {
			if (error?.name === 'AuthorizationError') {
				notifyWriteDenied('Unable to save - no write permission for this holon');
			} else {
				console.error('Error importing roles:', error);
			}
		}
	}
</script>

<div class="space-y-4">
	<TitleBar {holonName} holonId={activeHolonId} showLensFilters title="Roles" icon={Users} />

	<div class="w-full bg-gray-800 p-4 sm:p-6 rounded-2xl">
		<!-- Stats Bar -->
		<div class="stats-bar mb-4">
			<div class="stats-bar__item">
				<span class="stats-bar__value">{roles.length}</span>
				<span class="stats-bar__label">Total</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--success">
				<span class="stats-bar__value">{roles.filter((role) => role[1].participants?.length > 0).length}</span>
				<span class="stats-bar__label">Assigned</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--warning">
				<span class="stats-bar__value">{roles.length - roles.filter((role) => role[1].participants?.length > 0).length}</span>
				<span class="stats-bar__label">Unassigned</span>
			</div>
		</div>

		<FeatureToolbar
			onAdd={addNewRole}
			addLabel="Add Role"
			onImport={() => (showImportModal = true)}
			importLabel="Import"
			bind:searchQuery={filters.searchQuery}
			searchPlaceholder="Search roles…"
			bind:viewMode={filters.viewMode}
			viewModes={ROLE_VIEW_MODES}
		/>

		{#if viewMode === 'week'}
			<RoleWeekView
				roles={store}
				{userStore}
				{holosphere}
				holonId={activeHolonId}
				on:scheduleUpdated={() => {
					console.log('[Roles.svelte] Week schedule updated');
				}}
			/>
		{:else if isListView}
			<div class="space-y-3">
				{#each visibleRoles as [key, role]}
					{@const todayAssignment = getTodayAssignment(role)}
					<div
						id={key}
						class="w-full task-card relative cursor-pointer"
						on:click|stopPropagation={() =>
							handleRoleClick(key, role)}
						on:keydown|stopPropagation={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								handleRoleClick(key, role);
							}
						}}
						role="button"
						tabindex="0"
					>
						<div
							class="p-4 rounded-xl transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005]"
							style="background-color: {getRoleColor(role)}; color: white;"
						>
							<div class="flex items-center justify-between gap-4">
								<div class="flex items-center gap-4 flex-1 min-w-0">
									<!-- Role Icon -->
									<div class="flex-shrink-0 w-12 h-12 rounded-xl bg-black/20 flex items-center justify-center text-2xl">
										{todayAssignment ? '👥' : '👤'}
									</div>

									<!-- Main Content -->
									<div class="flex-1 min-w-0">
										<h3 class="text-lg font-bold text-white mb-1 line-clamp-2">
											{role.title}
											<SourceBadge item={role} currentHolonId={activeHolonId} lensRoute="roles" />
										</h3>
										{#if role.description}
											<p class="text-sm text-white/80 line-clamp-2">
												{role.description}
											</p>
										{/if}
									</div>
								</div>

								<div class="flex items-center gap-4 text-sm whitespace-nowrap">
									<!-- Show "Today" indicator -->
									<div class="text-xs text-white/60 font-medium uppercase tracking-wide">
										Today
									</div>

									{#if todayAssignment}
										<div class="flex items-center gap-3">
											<!-- Participant Name -->
											<div class="text-white/90 text-sm font-medium">
												{todayAssignment.username?.split(' ')[0] || todayAssignment.username}
											</div>

											<!-- Participant Icon -->
											<div class="relative group">
												<img
													class="w-8 h-8 rounded-full border-2 border-white/30 object-cover"
													src={`https://telegram.holons.io/getavatar?user_id=${todayAssignment.id}`}
													alt={todayAssignment.username}
													on:error={(e) => {
														e.currentTarget.style.display = 'none';
														e.currentTarget.nextElementSibling.style.display = 'flex';
													}}
												/>
												<div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-bold border-2 border-white/30" style="display: none;">
													{todayAssignment.username ? todayAssignment.username[0] : '?'}
												</div>
												<div class="absolute invisible group-hover:visible bg-gray-900 text-white text-xs rounded py-1 px-2 -bottom-8 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10">
													{todayAssignment.username}
												</div>
											</div>
										</div>
									{:else}
										<div class="text-white/70 text-sm font-medium">
											Unassigned
										</div>
									{/if}
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				{#each visibleRoles as [key, role]}
					{@const todayAssignment = getTodayAssignment(role)}
					<div
						id={key}
						class="task-card relative cursor-pointer"
						on:click|stopPropagation={() =>
							handleRoleClick(key, role)}
						on:keydown|stopPropagation={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								handleRoleClick(key, role);
							}
						}}
						role="button"
						tabindex="0"
					>
						<div
							class="p-4 rounded-xl transition-all duration-300 border border-transparent hover:border-gray-600 hover:shadow-md transform hover:scale-[1.005] h-full flex flex-col"
							style="background-color: {getRoleColor(role)}; color: white;"
						>
							<!-- Header with "Today" indicator -->
							<div class="text-center mb-2">
								<div class="text-xs text-white/60 font-medium uppercase tracking-wide">
									Today
								</div>
							</div>

							<!-- Today's Assignment Section - Prominent and Centered -->
							<div class="flex-grow flex flex-col items-center justify-center mb-3">
								{#if todayAssignment}
									<div class="text-center mb-4">
										<!-- Today's Assigned User Icon -->
										<div class="relative group mb-3 flex justify-center">
											<div class="relative">
												<img
													class="w-16 h-16 rounded-full border-4 border-white/30 object-cover"
													src={`https://telegram.holons.io/getavatar?user_id=${todayAssignment.id}`}
													alt={todayAssignment.username}
													on:error={(e) => {
														e.currentTarget.style.display = 'none';
														e.currentTarget.nextElementSibling.style.display = 'flex';
													}}
												/>
												<div class="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-white text-xl font-bold border-4 border-white/30" style="display: none;">
													{todayAssignment.username ? todayAssignment.username[0] : '?'}
												</div>
												<div class="absolute invisible group-hover:visible bg-gray-900 text-white text-sm rounded py-2 px-3 bottom-full mb-2 left-1/2 transform -translate-x-1/2 whitespace-nowrap z-10">
													{todayAssignment.username}
												</div>
											</div>
										</div>

										<!-- Today's Assigned User Name -->
										<div class="text-center">
											<div class="text-sm text-white/90 font-medium">
												{todayAssignment.username?.split(' ')[0] || todayAssignment.username}
											</div>
										</div>
									</div>
								{:else}
									<div class="text-center mb-4">
										<div class="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center text-4xl opacity-70 mb-2">
											👤
										</div>
										<div class="text-lg font-medium text-white/70">
											Unassigned
										</div>
									</div>
								{/if}
							</div>

							<!-- Role Title - Prominent and Full Width -->
							<div class="text-center mb-3">
								<h3 class="text-xl font-bold text-white leading-tight line-clamp-2">
									{role.title}
								</h3>
							</div>

							<!-- Description - Below title -->
							{#if role.description}
								<div class="text-sm text-white/80 text-center line-clamp-2 flex-grow">
									{role.description}
								</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

{#if selectedRole && isUserStoreReady}
	<RoleModal
		role={selectedRole.role}
		roleId={selectedRole.key}
		{userStore}
		{holosphere}
		holonId={activeHolonId}
		on:close={() => {
			console.log("[Roles.svelte] Closing RoleModal from on:close.");
			selectedRole = null;
		}}
		on:deleted={(event) => {
			const deletedRoleId = event.detail.roleId;
			console.log(`[Roles.svelte] Role deleted event received for ID: ${deletedRoleId}`);
			if (store[deletedRoleId]) {
				const { [deletedRoleId]: _, ...rest } = store;
				store = rest;
				console.log(`[Roles.svelte] Role ${deletedRoleId} removed from local store.`);
			}
			selectedRole = null;
		}}
		on:permanentAssignment={handlePermanentAssignment}
	/>
{:else if selectedRole && !isUserStoreReady}
	<div class="fixed inset-0 bg-black bg-opacity-70 z-[60] flex items-center justify-center p-4" aria-live="polite" aria-busy="true">
		<div class="bg-gray-800 p-6 rounded-lg text-white flex items-center">
			<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
			</svg>
			<span>Loading user data for modal...</span>
		</div>
	</div>
{/if}

{#if notification}
	<PermanentAssignmentNotification
		roleName={notification.roleName}
		userName={notification.userName}
		on:dismiss={() => notification = null}
	/>
{/if}

<GenericImportModal
	bind:open={showImportModal}
	title="Import Roles"
	itemNoun="roles"
	helpText="Paste a JSON array of roles or one role title per line. Required: title."
	sampleJson={`[
  {
    "title": "Facilitator",
    "description": "Runs the weekly council meeting.",
    "participants": []
  },
  {
    "title": "Note Taker"
  }
]`}
	on:import={handleImport}
	on:close={() => (showImportModal = false)}
/>

<style>
	.space-y-3 > :not([hidden]) ~ :not([hidden]) {
		margin-top: 0.75rem;
	}

	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}



	.task-card {
		position: relative;
	}

	/* Add tooltip arrow */
	.group-hover\:visible {
		position: absolute;
		pointer-events: none;
	}

	.group-hover\:visible::before {
		content: "";
		position: absolute;
		bottom: -4px;
		left: 50%;
		transform: translateX(-50%);
		border-width: 4px 4px 0 4px;
		border-style: solid;
		border-color: #1f2937 transparent transparent transparent;
	}

	/* Grid layout improvements */
	.grid {
		display: grid;
	}

	.grid-cols-1 {
		grid-template-columns: repeat(1, minmax(0, 1fr));
	}

	@media (min-width: 768px) {
		.md\:grid-cols-2 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 768px) {
		.md\:grid-cols-2 {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (min-width: 1024px) {
		.lg\:grid-cols-4 {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.gap-6 {
		gap: 1.5rem;
	}

</style>
