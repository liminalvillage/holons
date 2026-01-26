<script lang="ts">
	// @ts-nocheck
	import { createEventDispatcher } from 'svelte';
	import WeekScheduleCell from './WeekScheduleCell.svelte';
	import {
		getWeekKey,
		getWeekDays,
		getPreviousWeekKey,
		getNextWeekKey,
		formatWeekRange,
		formatDayShort,
		toISODateString,
		isToday,
		DAY_NAMES
	} from '../utils/weekUtils';
	import {
		autoFillWeekSchedule,
		carryOverWeekSchedule,
		type WeekSchedule,
		type DayAssignment
	} from '../utils/autoFillAlgorithm';

	export let roles: Record<string, any> = {};
	export let userStore: Record<string, any> = {};
	export let holosphere: any;
	export let holonId: string;

	const dispatch = createEventDispatcher();

	let currentWeekKey = getWeekKey(new Date());
	let showAutoFillConfirm = false;
	let autoFillPreview: any = null;

	$: weekDays = getWeekDays(currentWeekKey);
	$: rolesList = Object.entries(roles || {});
	$: weekRange = formatWeekRange(currentWeekKey);
	$: isCurrentWeek = currentWeekKey === getWeekKey(new Date());

	function goToPreviousWeek() {
		currentWeekKey = getPreviousWeekKey(currentWeekKey);
	}

	function goToNextWeek() {
		currentWeekKey = getNextWeekKey(currentWeekKey);
	}

	function goToCurrentWeek() {
		currentWeekKey = getWeekKey(new Date());
	}

	function getAssignmentForDay(role: any, date: Date): { id: string; username: string }[] {
		const dateStr = toISODateString(date);

		// Check for permanent assignment first
		if (role.participants?.some((p: any) => p.isPermanent)) {
			const permanent = role.participants.find((p: any) => p.isPermanent) || role.participants[0];
			return [{ id: permanent.id, username: permanent.username }];
		}

		// Check week schedule
		if (role.weekSchedule?.weekKey === currentWeekKey) {
			const dayAssignment = role.weekSchedule.assignments?.find((a: DayAssignment) => a.date === dateStr);
			if (dayAssignment?.users?.length > 0) {
				return dayAssignment.users;
			}
		}

		return [];
	}

	function isPermanentAssignment(role: any): boolean {
		return role.participants?.some((p: any) => p.isPermanent) || false;
	}

	async function handleAssign(event: CustomEvent<{ roleId: string; date: string; userId: string; username: string }>) {
		const { roleId, date, userId, username } = event.detail;
		const role = roles[roleId];
		if (!role) return;

		// Initialize or update week schedule
		let weekSchedule: WeekSchedule = role.weekSchedule?.weekKey === currentWeekKey
			? { ...role.weekSchedule }
			: {
				weekKey: currentWeekKey,
				assignments: weekDays.map((day, index) => ({
					dayOfWeek: index,
					date: toISODateString(day),
					users: []
				})),
				lastModified: new Date().toISOString()
			};

		// Find and update the day assignment
		const dayIndex = weekSchedule.assignments.findIndex(a => a.date === date);
		if (dayIndex !== -1) {
			weekSchedule.assignments[dayIndex] = {
				...weekSchedule.assignments[dayIndex],
				users: [{
					id: userId,
					username,
					assignedAt: new Date().toISOString(),
					assignedVia: 'week_view'
				}]
			};
			weekSchedule.lastModified = new Date().toISOString();
		}

		// Save to holosphere
		const updatedRole = { ...role, weekSchedule };
		await holosphere.put(holonId, 'roles', updatedRole);
		dispatch('scheduleUpdated');
	}

	async function handleUnassign(event: CustomEvent<{ roleId: string; date: string }>) {
		const { roleId, date } = event.detail;
		const role = roles[roleId];
		if (!role || !role.weekSchedule) return;

		// Can't unassign permanent assignments from here
		if (isPermanentAssignment(role)) {
			return;
		}

		const weekSchedule = { ...role.weekSchedule };
		const dayIndex = weekSchedule.assignments.findIndex((a: DayAssignment) => a.date === date);
		if (dayIndex !== -1) {
			weekSchedule.assignments[dayIndex] = {
				...weekSchedule.assignments[dayIndex],
				users: []
			};
			weekSchedule.lastModified = new Date().toISOString();
		}

		const updatedRole = { ...role, weekSchedule };
		await holosphere.put(holonId, 'roles', updatedRole);
		dispatch('scheduleUpdated');
	}

	async function handleAutoFill() {
		const rolesArray = rolesList.map(([_key, role]) => role);
		const usersArray = Object.values(userStore);

		const result = autoFillWeekSchedule({
			roles: rolesArray,
			users: usersArray,
			weekKey: currentWeekKey
		});

		// Apply schedules to all roles
		for (const [roleId, schedule] of result.schedules) {
			const role = roles[roleId];
			if (role) {
				const updatedRole = { ...role, weekSchedule: schedule };
				await holosphere.put(holonId, 'roles', updatedRole);
			}
		}

		showAutoFillConfirm = false;
		dispatch('scheduleUpdated');
	}

	async function handleCarryOver() {
		const previousWeekKey = getPreviousWeekKey(currentWeekKey);

		for (const [_roleId, role] of rolesList) {
			const newSchedule = carryOverWeekSchedule(role, previousWeekKey, currentWeekKey, weekDays);
			if (newSchedule) {
				const updatedRole = { ...role, weekSchedule: newSchedule };
				await holosphere.put(holonId, 'roles', updatedRole);
			}
		}

		dispatch('scheduleUpdated');
	}

	function openAutoFillConfirm() {
		showAutoFillConfirm = true;
	}
</script>

<div class="role-week-view">
	<!-- Week Navigation Header -->
	<div class="week-header">
		<div class="week-nav">
			<button class="week-nav__btn" on:click={goToPreviousWeek} aria-label="Previous week">
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="15 18 9 12 15 6"></polyline>
				</svg>
			</button>
			<div class="week-nav__info">
				<span class="week-nav__range">{weekRange}</span>
				{#if !isCurrentWeek}
					<button class="week-nav__today" on:click={goToCurrentWeek}>
						Today
					</button>
				{/if}
			</div>
			<button class="week-nav__btn" on:click={goToNextWeek} aria-label="Next week">
				<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="9 18 15 12 9 6"></polyline>
				</svg>
			</button>
		</div>

		<div class="week-actions">
			<button class="btn btn--secondary btn--sm" on:click={handleCarryOver}>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="17 1 21 5 17 9"></polyline>
					<path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
					<polyline points="7 23 3 19 7 15"></polyline>
					<path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
				</svg>
				<span class="hidden sm:inline">Copy Last Week</span>
			</button>
			<button class="btn btn--primary btn--sm" on:click={openAutoFillConfirm}>
				<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M12 3v18M3 12h18"></path>
				</svg>
				<span>Auto-Fill</span>
			</button>
		</div>
	</div>

	<!-- Week Grid -->
	<div class="week-grid">
		<!-- Header Row -->
		<div class="week-grid__header">
			<div class="week-grid__role-header">Role</div>
			{#each weekDays as day, index}
				<div class="week-grid__day-header {isToday(day) ? 'week-grid__day-header--today' : ''}">
					<span class="week-grid__day-name">{DAY_NAMES[index]}</span>
					<span class="week-grid__day-date">{day.getDate()}</span>
				</div>
			{/each}
		</div>

		<!-- Role Rows -->
		{#each rolesList as [roleKey, role]}
			<div class="week-grid__row">
				<div class="week-grid__role-name" title={role.title}>
					{role.title}
					{#if isPermanentAssignment(role)}
						<svg class="week-grid__permanent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" title="Permanent assignment">
							<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
							<path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
						</svg>
					{/if}
				</div>
				{#each weekDays as day, dayIndex}
					<WeekScheduleCell
						roleId={role.id || roleKey}
						date={toISODateString(day)}
						assignedUsers={getAssignmentForDay(role, day)}
						availableUsers={userStore}
						isToday={isToday(day)}
						isPermanent={isPermanentAssignment(role)}
						on:assign={handleAssign}
						on:unassign={handleUnassign}
					/>
				{/each}
			</div>
		{/each}

		{#if rolesList.length === 0}
			<div class="week-grid__empty">
				<p>No roles defined yet.</p>
				<p class="text-sm opacity-70">Add roles to start scheduling.</p>
			</div>
		{/if}
	</div>
</div>

<!-- Auto-Fill Confirmation Modal -->
{#if showAutoFillConfirm}
	<div
		class="modal-overlay"
		on:click|self={() => showAutoFillConfirm = false}
		on:keydown={(e) => e.key === 'Escape' && (showAutoFillConfirm = false)}
		role="dialog"
		aria-modal="true"
		tabindex="-1"
	>
		<div class="modal-content">
			<h3 class="modal-title">Auto-Fill Week Schedule</h3>
			<p class="modal-description">
				This will automatically distribute all available users across roles for the week,
				ensuring a balanced workload. Existing assignments will be preserved.
			</p>
			<div class="modal-info">
				<div class="modal-info__item">
					<span class="modal-info__label">Roles:</span>
					<span class="modal-info__value">{rolesList.length}</span>
				</div>
				<div class="modal-info__item">
					<span class="modal-info__label">Users:</span>
					<span class="modal-info__value">{Object.keys(userStore).length}</span>
				</div>
				<div class="modal-info__item">
					<span class="modal-info__label">Total slots:</span>
					<span class="modal-info__value">{rolesList.length * 7}</span>
				</div>
			</div>
			<div class="modal-actions">
				<button class="btn btn--secondary" on:click={() => showAutoFillConfirm = false}>
					Cancel
				</button>
				<button class="btn btn--primary" on:click={handleAutoFill}>
					Apply Auto-Fill
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.role-week-view {
		width: 100%;
	}

	.week-header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin-bottom: 16px;
	}

	.week-nav {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.week-nav__btn {
		padding: 8px;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		border-radius: 8px;
		color: white;
		cursor: pointer;
		transition: background 0.2s ease;
	}

	.week-nav__btn:hover {
		background: rgba(255, 255, 255, 0.2);
	}

	.week-nav__info {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.week-nav__range {
		font-size: 16px;
		font-weight: 600;
		color: white;
	}

	.week-nav__today {
		font-size: 12px;
		color: #818cf8;
		background: none;
		border: none;
		cursor: pointer;
		text-decoration: underline;
	}

	.week-nav__today:hover {
		color: #a5b4fc;
	}

	.week-actions {
		display: flex;
		gap: 8px;
	}

	.week-grid {
		overflow-x: auto;
	}

	.week-grid__header {
		display: grid;
		grid-template-columns: 140px repeat(7, 1fr);
		gap: 4px;
		margin-bottom: 4px;
	}

	.week-grid__role-header {
		padding: 12px 8px;
		font-size: 12px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.6);
		text-transform: uppercase;
	}

	.week-grid__day-header {
		padding: 8px 4px;
		text-align: center;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.2);
	}

	.week-grid__day-header--today {
		background: rgba(99, 102, 241, 0.2);
		border: 1px solid rgba(99, 102, 241, 0.4);
	}

	.week-grid__day-name {
		display: block;
		font-size: 11px;
		font-weight: 600;
		color: rgba(255, 255, 255, 0.6);
		text-transform: uppercase;
	}

	.week-grid__day-header--today .week-grid__day-name {
		color: #818cf8;
	}

	.week-grid__day-date {
		display: block;
		font-size: 14px;
		font-weight: 600;
		color: white;
	}

	.week-grid__row {
		display: grid;
		grid-template-columns: 140px repeat(7, 1fr);
		gap: 4px;
		margin-bottom: 4px;
	}

	.week-grid__role-name {
		padding: 8px;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: white;
		background: rgba(0, 0, 0, 0.2);
		border-radius: 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.week-grid__permanent-icon {
		width: 14px;
		height: 14px;
		color: #f59e0b;
		flex-shrink: 0;
	}

	.week-grid__empty {
		grid-column: 1 / -1;
		padding: 48px 24px;
		text-align: center;
		color: rgba(255, 255, 255, 0.6);
	}

	/* Modal styles */
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 16px;
	}

	.modal-content {
		background: #1f2937;
		border-radius: 16px;
		padding: 24px;
		max-width: 400px;
		width: 100%;
	}

	.modal-title {
		font-size: 18px;
		font-weight: 600;
		color: white;
		margin-bottom: 12px;
	}

	.modal-description {
		font-size: 14px;
		color: rgba(255, 255, 255, 0.7);
		margin-bottom: 16px;
		line-height: 1.5;
	}

	.modal-info {
		background: rgba(0, 0, 0, 0.2);
		border-radius: 8px;
		padding: 12px;
		margin-bottom: 20px;
	}

	.modal-info__item {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
	}

	.modal-info__label {
		color: rgba(255, 255, 255, 0.6);
		font-size: 13px;
	}

	.modal-info__value {
		color: white;
		font-weight: 500;
		font-size: 13px;
	}

	.modal-actions {
		display: flex;
		gap: 12px;
		justify-content: flex-end;
	}

	/* Responsive */
	@media (max-width: 768px) {
		.week-grid__header,
		.week-grid__row {
			grid-template-columns: 100px repeat(7, minmax(50px, 1fr));
		}

		.week-grid__role-name {
			font-size: 11px;
			padding: 6px;
		}
	}
</style>
