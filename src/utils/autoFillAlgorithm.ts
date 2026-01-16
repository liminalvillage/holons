/**
 * Auto-fill algorithm for balanced role distribution
 */

import { getWeekDays, toISODateString } from './weekUtils';

export interface User {
	id: string;
	username?: string;
	first_name?: string;
	last_name?: string;
}

export interface AssignedUser {
	id: string;
	username: string;
	assignedAt?: string;
	assignedVia?: 'week_view' | 'auto_fill' | 'carry_over';
}

export interface DayAssignment {
	dayOfWeek: number;
	date: string;
	users: AssignedUser[];
}

export interface WeekSchedule {
	weekKey: string;
	assignments: DayAssignment[];
	lastModified?: string;
}

export interface Role {
	id: string;
	title: string;
	participants?: { id: string; username: string; isPermanent?: boolean }[];
	weekSchedule?: WeekSchedule;
}

export interface AutoFillInput {
	roles: Role[];
	users: User[];
	weekKey: string;
	excludeRoleIds?: string[];
	excludeUserIds?: string[];
}

export interface AutoFillResult {
	schedules: Map<string, WeekSchedule>;
	stats: {
		totalSlots: number;
		filledSlots: number;
		userAssignmentCounts: Map<string, number>;
		roleAssignmentCounts: Map<string, Map<string, number>>; // roleId -> userId -> count
	};
}

/**
 * Get display name for a user
 */
function getUserDisplayName(user: User): string {
	if (user.first_name) {
		return user.first_name + (user.last_name ? ' ' + user.last_name : '');
	}
	return user.username || user.id;
}

/**
 * Auto-fill week schedule with balanced distribution
 */
export function autoFillWeekSchedule(input: AutoFillInput): AutoFillResult {
	const { roles, users, weekKey, excludeRoleIds = [], excludeUserIds = [] } = input;

	// Filter available roles and users
	const availableRoles = roles.filter(r => !excludeRoleIds.includes(r.id));
	const availableUsers = users.filter(u => !excludeUserIds.includes(u.id));

	if (availableUsers.length === 0 || availableRoles.length === 0) {
		return {
			schedules: new Map(),
			stats: {
				totalSlots: 0,
				filledSlots: 0,
				userAssignmentCounts: new Map(),
				roleAssignmentCounts: new Map()
			}
		};
	}

	const weekDays = getWeekDays(weekKey);
	const totalSlots = availableRoles.length * 7;

	// Track assignment counts per user and per role-user combination
	const userAssignmentCounts = new Map<string, number>();
	const roleUserCounts = new Map<string, Map<string, number>>(); // roleId -> userId -> count

	// Initialize counts
	availableUsers.forEach(u => userAssignmentCounts.set(u.id, 0));
	availableRoles.forEach(r => {
		roleUserCounts.set(r.id, new Map());
		availableUsers.forEach(u => roleUserCounts.get(r.id)!.set(u.id, 0));
	});

	// Build list of slots to fill (excluding permanent assignments)
	interface Slot {
		roleId: string;
		dayIndex: number;
		date: string;
	}

	const slotsToFill: Slot[] = [];
	const schedules = new Map<string, WeekSchedule>();

	// Initialize schedules and collect slots to fill
	availableRoles.forEach(role => {
		// Check if role has permanent assignment
		const hasPermanent = role.participants?.some(p => p.isPermanent);

		const assignments: DayAssignment[] = weekDays.map((day, index) => {
			const dateStr = toISODateString(day);

			// If permanent assignment, use it for all days
			if (hasPermanent && role.participants) {
				const permanentUser = role.participants.find(p => p.isPermanent) || role.participants[0];
				return {
					dayOfWeek: index,
					date: dateStr,
					users: [{
						id: permanentUser.id,
						username: permanentUser.username,
						assignedVia: 'auto_fill' as const
					}]
				};
			}

			// Check existing assignment from weekSchedule
			const existingAssignment = role.weekSchedule?.assignments?.find(a => a.date === dateStr);
			if (existingAssignment && existingAssignment.users && existingAssignment.users.length > 0) {
				// Keep existing assignment
				return existingAssignment;
			}

			// Add to slots to fill
			slotsToFill.push({ roleId: role.id, dayIndex: index, date: dateStr });

			return {
				dayOfWeek: index,
				date: dateStr,
				users: []
			};
		});

		schedules.set(role.id, {
			weekKey,
			assignments,
			lastModified: new Date().toISOString()
		});
	});

	// Sort slots to distribute evenly (alternate between roles)
	slotsToFill.sort((a, b) => {
		if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
		return a.roleId.localeCompare(b.roleId);
	});

	// Fill slots with balanced distribution
	let filledSlots = 0;

	for (const slot of slotsToFill) {
		// Find user with lowest overall count
		let minCount = Infinity;
		let candidates: User[] = [];

		availableUsers.forEach(user => {
			const count = userAssignmentCounts.get(user.id) || 0;
			if (count < minCount) {
				minCount = count;
				candidates = [user];
			} else if (count === minCount) {
				candidates.push(user);
			}
		});

		// Among tied candidates, prefer user who hasn't done this role as much
		if (candidates.length > 1) {
			const roleUserCount = roleUserCounts.get(slot.roleId)!;
			let minRoleCount = Infinity;
			let finalCandidates: User[] = [];

			candidates.forEach(user => {
				const count = roleUserCount.get(user.id) || 0;
				if (count < minRoleCount) {
					minRoleCount = count;
					finalCandidates = [user];
				} else if (count === minRoleCount) {
					finalCandidates.push(user);
				}
			});

			candidates = finalCandidates;
		}

		// Pick first candidate (or random for more randomness)
		const selectedUser = candidates[Math.floor(Math.random() * candidates.length)];

		// Assign user to slot
		const schedule = schedules.get(slot.roleId)!;
		const dayAssignment = schedule.assignments[slot.dayIndex];
		dayAssignment.users = [{
			id: selectedUser.id,
			username: getUserDisplayName(selectedUser),
			assignedAt: new Date().toISOString(),
			assignedVia: 'auto_fill'
		}];

		// Update counts
		userAssignmentCounts.set(selectedUser.id, (userAssignmentCounts.get(selectedUser.id) || 0) + 1);
		roleUserCounts.get(slot.roleId)!.set(selectedUser.id, (roleUserCounts.get(slot.roleId)!.get(selectedUser.id) || 0) + 1);
		filledSlots++;
	}

	return {
		schedules,
		stats: {
			totalSlots,
			filledSlots,
			userAssignmentCounts,
			roleAssignmentCounts: roleUserCounts
		}
	};
}

/**
 * Get a preview of auto-fill distribution without applying
 */
export function previewAutoFill(input: AutoFillInput): {
	userSummary: { user: User; totalAssignments: number; roleBreakdown: Map<string, number> }[];
	isBalanced: boolean;
	maxDifference: number;
} {
	const result = autoFillWeekSchedule(input);
	const { users } = input;

	const userSummary = users
		.filter(u => !input.excludeUserIds?.includes(u.id))
		.map(user => {
			const totalAssignments = result.stats.userAssignmentCounts.get(user.id) || 0;
			const roleBreakdown = new Map<string, number>();

			result.stats.roleAssignmentCounts.forEach((userCounts, roleId) => {
				const count = userCounts.get(user.id) || 0;
				if (count > 0) {
					roleBreakdown.set(roleId, count);
				}
			});

			return { user, totalAssignments, roleBreakdown };
		});

	const counts = Array.from(result.stats.userAssignmentCounts.values());
	const maxDifference = counts.length > 0 ? Math.max(...counts) - Math.min(...counts) : 0;
	const isBalanced = maxDifference <= 1;

	return { userSummary, isBalanced, maxDifference };
}

/**
 * Carry over assignments from previous week
 */
export function carryOverWeekSchedule(
	role: Role,
	previousWeekKey: string,
	newWeekKey: string,
	newWeekDays: Date[]
): WeekSchedule | null {
	if (!role.weekSchedule || role.weekSchedule.weekKey !== previousWeekKey) {
		return null;
	}

	const newAssignments: DayAssignment[] = newWeekDays.map((day, index) => {
		const previousDayAssignment = role.weekSchedule!.assignments.find(a => a.dayOfWeek === index);

		if (previousDayAssignment && previousDayAssignment.users && previousDayAssignment.users.length > 0) {
			return {
				dayOfWeek: index,
				date: toISODateString(day),
				users: previousDayAssignment.users.map(u => ({
					...u,
					assignedAt: new Date().toISOString(),
					assignedVia: 'carry_over' as const
				}))
			};
		}

		return {
			dayOfWeek: index,
			date: toISODateString(day),
			users: []
		};
	});

	return {
		weekKey: newWeekKey,
		assignments: newAssignments,
		lastModified: new Date().toISOString()
	};
}
