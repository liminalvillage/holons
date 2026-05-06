// Holon creation orchestration. The task-shape and persistence helpers now
// live in @holons/core/tasks (Phase B unit `core/tasks`). This file:
//   - re-exports the core symbols so existing call sites resolve unchanged
//   - keeps ritual-level orchestration that wires those primitives together
//     into a "create holon from ritual" flow.

import type { HoloSphere } from "holosphere";
import {
	createTasksFromDesignStreams as coreCreateTasksFromDesignStreams,
	createTasksFromQuestTree as coreCreateTasksFromQuestTree,
	saveTasksToHolon as coreSaveTasksToHolon,
} from "@holons/core/tasks";
import type {
	Quest as CoreQuest,
	RitualSession as CoreRitualSession,
	CompletedRitual as CoreCompletedRitual,
	RitualOrigin as CoreRitualOrigin,
} from "@holons/core/tasks";

// ---------------------------------------------------------------------------
// Re-exports — keep public surface identical to pre-extraction holonCreator.ts.
// ---------------------------------------------------------------------------

export type Quest = CoreQuest;
export type RitualSession = CoreRitualSession;
export type CompletedRitual = CoreCompletedRitual;
export type RitualOrigin = CoreRitualOrigin;

export const createTasksFromQuestTree = coreCreateTasksFromQuestTree;
export const saveTasksToHolon = coreSaveTasksToHolon;
// Internal helper kept exported (private to this module's prior callers).
const createTasksFromDesignStreams = coreCreateTasksFromDesignStreams;

// ---------------------------------------------------------------------------
// Ritual orchestration — stays in the web app (UI-driven flow).
// ---------------------------------------------------------------------------

// Utility function to create a simple hash of a string
function hashString(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash).toString(36);
}

/**
 * Saves a completed ritual to the source holon
 */
async function saveRitualToSourceHolon(
	holosphere: HoloSphere,
	sourceHolonID: string,
	ritualSession: RitualSession
): Promise<void> {
	const completedRitual: CompletedRitual = {
		id: ritualSession.session_id,
		title: ritualSession.wish_statement,
		date: new Date().toISOString(),
		artifact: ritualSession.ritual_artifact,
		design_streams: ritualSession.design_streams
	};

	// Get existing previous rituals
	let previousRituals: CompletedRitual[] = [];
	try {
		const existingRituals = await holosphere.get(sourceHolonID, "previous_rituals", sourceHolonID);
		if (existingRituals && Array.isArray(existingRituals)) {
			previousRituals = existingRituals;
		}
	} catch (error) {
		// No previous rituals found, continue with empty array
	}

	// Add new ritual to the beginning
	previousRituals = [completedRitual, ...previousRituals];

	try {
		await holosphere.put(sourceHolonID, "previous_rituals", previousRituals);
	} catch (putError) {
		console.error('Failed to save rituals to source holon:', putError);
		// Don't throw here - continue with holon creation
	}
}

/**
 * Saves ritual metadata to the holon
 */
async function saveRitualMetadata(
	holosphere: HoloSphere,
	holonID: string,
	ritualSession: RitualSession
): Promise<void> {
	const ritualOrigin: RitualOrigin = {
		origin_ritual: ritualSession.session_id,
		wish: ritualSession.wish_statement,
		values: ritualSession.declared_values,
		advisors: ritualSession.advisors,
		created: new Date().toISOString()
	};

	try {
		await holosphere.put(holonID, "ritual_origin", ritualOrigin);
	} catch (metadataError) {
		console.error('Failed to save ritual metadata:', metadataError);
	}
}

/**
 * Creates a new holon from ritual session data
 * @param holosphere - The HoloSphere instance
 * @param ritualSession - The ritual session data
 * @param sourceHolonID - The ID of the source holon (for saving previous rituals)
 * @returns Promise<string> - The new holon ID
 */
export async function createHolonFromRitual(
	holosphere: HoloSphere,
	ritualSession: RitualSession,
	sourceHolonID?: string
): Promise<string> {
	if (!ritualSession.wish_statement.trim()) {
		throw new Error('Wish statement is required to create a holon');
	}

	const newHolonID = hashString(ritualSession.wish_statement);

	try {
		// Save ritual as completed in source holon if provided
		if (sourceHolonID) {
			await saveRitualToSourceHolon(holosphere, sourceHolonID, ritualSession);
		}

		// Create tasks from design streams
		const tasks = createTasksFromDesignStreams(
			ritualSession.design_streams,
			ritualSession.wish_statement,
			newHolonID
		);

		// Save tasks to new holon
		const successfulTasks = await saveTasksToHolon(holosphere, newHolonID, tasks);

		// If no tasks were saved successfully, throw an error
		if (successfulTasks === 0) {
			throw new Error('Failed to save any tasks to the new holon');
		}

		// Save ritual metadata (optional - don't fail if this doesn't work)
		await saveRitualMetadata(holosphere, newHolonID, ritualSession);

		return newHolonID;

	} catch (error) {
		console.error('Error creating holon from ritual:', error);
		throw error;
	}
}

/**
 * Creates a test holon with sample ritual data
 * @param holosphere - The HoloSphere instance
 * @param sourceHolonID - The ID of the source holon
 * @returns Promise<string> - The new holon ID
 */
export async function createTestHolon(
	holosphere: HoloSphere,
	sourceHolonID?: string
): Promise<string> {
	const testRitualSession: RitualSession = {
		session_id: `test-ritual-${Date.now()}`,
		wish_statement: 'Create a test project to demonstrate council functionality',
		declared_values: ['Innovation', 'Collaboration'],
		advisors: [
			{
				name: 'Test Advisor',
				type: 'archetype',
				lens: 'Innovation and experimentation'
			}
		],
		design_streams: [
			{
				name: 'Innovation Path',
				description: 'A gentle approach emphasizing innovation and deep listening.',
				materials: ['Open mind', 'Curiosity'],
				steps: [
					'Define the project scope'
				]
			},
		],
		ritual_artifact: {
			format: 'scroll',
			text: 'The council has spoken. Your path to "Create a test project" weaves through Innovation, Collaboration. May wisdom guide your steps.',
			quotes: {
				'Test Advisor': 'Innovation requires both structure and freedom.'
			},
			ascii_glyph: '⚡'
		}
	};

	return createHolonFromRitual(holosphere, testRitualSession, sourceHolonID);
}
