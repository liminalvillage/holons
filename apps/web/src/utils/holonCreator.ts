import type { HoloSphere } from "holosphere";
import type { QuestTree } from '../types/questTree';

// Constants for repeated values
const COUNCIL_INITIATOR = {
	username: "Council",
	firstName: "AI",
	lastName: "Council"
};

const DEFAULT_TASK_CATEGORY = 'council-created';

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

// Interface for ritual session data
export interface RitualSession {
	session_id: string;
	wish_statement: string;
	declared_values: string[];
	advisors: Array<{
		name: string;
		type: 'real' | 'mythic' | 'archetype';
		lens: string;
		avatar_url?: string;
	}>;
	design_streams: Array<{
		name: string;
		description: string;
		materials: string[];
		steps: string[];
	}>;
	ritual_artifact: {
		format: string;
		text: string;
		quotes: Record<string, string>;
		ascii_glyph: string;
	};
}

// Interface for completed ritual
export interface CompletedRitual {
	id: string;
	title: string;
	date: string;
	artifact: any;
	design_streams: any[];
}

// Interface for ritual origin metadata
export interface RitualOrigin {
	origin_ritual: string;
	wish: string;
	values: string[];
	advisors: any[];
	created: string;
}

// Interface for task/quest structure
export interface Quest {
	id: string;
	title: string;
	description?: string;
	status: 'ongoing' | 'completed' | 'recurring' | 'repeating' | 'pending';
	type?: 'task' | 'quest' | 'event' | 'proposal' | 'recurring';
	category?: string;
	participants: any[];
	appreciation: string[];
	created: string;
	orderIndex?: number;
	initiator?: {
		id: string;
		username: string;
		firstName?: string;
		lastName?: string;
	};
  // Optional holonic linkage
  dependsOn?: string[];
  _meta?: {
    source?: 'design_streams' | 'quest_tree';
    questTreeId?: string;
    generation?: number;
    parentNodeId?: string | null;
    initiatedBy?: 'council' | 'user';
    holonicData?: {
      skillsRequired?: string[];
      resourcesRequired?: string[];
      impactCategory?: string;
      estimatedDuration?: string;
      assumptions?: string[];
      questions?: string[];
      actions?: string[];
      successMetrics?: string[];
      futureState?: string;
      facilitatingAdvisor?: string;
    };
  };
}

/**
 * Creates a task from a design stream step
 */
function createTaskFromStep(
	step: string,
	stream: RitualSession['design_streams'][0],
	streamIndex: number,
	stepIndex: number,
	holonID: string
): Quest {
	return {
		id: `${streamIndex}-${stepIndex}-${Date.now()}`,
		title: step,
		description: `From ${stream.name}: ${stream.description}`,
		status: 'pending' as const,
		type: 'task' as const,
		category: DEFAULT_TASK_CATEGORY,
		participants: [],
		appreciation: [],
		created: new Date().toISOString(),
		orderIndex: streamIndex * 100 + stepIndex,
		initiator: {
			id: holonID,
			...COUNCIL_INITIATOR
		}
	};
}

/**
 * Creates a default task when no design streams are provided
 */
function createDefaultTask(wishStatement: string, holonID: string): Quest {
	return {
		id: `default-${Date.now()}`,
		title: 'Begin the journey',
		description: `Start working towards: "${wishStatement}"`,
		status: 'pending' as const,
		type: 'task' as const,
		category: DEFAULT_TASK_CATEGORY,
		participants: [],
		appreciation: [],
		created: new Date().toISOString(),
		orderIndex: 0,
		initiator: {
			id: holonID,
			...COUNCIL_INITIATOR
		}
	};
}

/**
 * Creates tasks from design streams or a default task if no streams exist
 */
function createTasksFromDesignStreams(
	designStreams: RitualSession['design_streams'],
	wishStatement: string,
	holonID: string
): Quest[] {
	const tasks: Quest[] = designStreams.flatMap((stream, streamIndex) => 
		stream.steps.map((step, stepIndex) => 
			createTaskFromStep(step, stream, streamIndex, stepIndex, holonID)
		)
	);
	
	// If no design streams, create a default task
	if (tasks.length === 0) {
		tasks.push(createDefaultTask(wishStatement, holonID));
	}
	
	return tasks;
}

/**
 * Converts a QuestTree into an array of holonic tasks (quests)
 * - Each node becomes a task
 * - Parent relationships are encoded via dependsOn
 */
export function createTasksFromQuestTree(
  questTree: QuestTree,
  holonID: string
): Quest[] {
  const tasks: Quest[] = [];

  // Precompute mapping from nodeId to taskId for dependency linking
  const makeTaskId = (nodeId: string) => `qt-${questTree.id}-${nodeId}`;

  Object.values(questTree.nodes).forEach((node) => {
    const taskId = makeTaskId(node.id);
    const parentTaskId = node.parentId ? makeTaskId(node.parentId) : undefined;

    const dependsOn: string[] = [];
    
    // RECURSIVE DEPENDENCY LOGIC: Parent always depends on child
    // Find all child quests for this node
    const childQuestIds = Object.values(questTree.nodes)
      .filter(n => n.parentId === node.id)
      .map(n => makeTaskId(n.id));
    
    // This quest depends on all its children
    dependsOn.push(...childQuestIds);
    
    // Additional dependencies (if any)
    if (node.dependencies && node.dependencies.length > 0) {
      for (const depNodeId of node.dependencies) {
        dependsOn.push(makeTaskId(depNodeId));
      }
    }

    // Build rich description from holonic metadata
    let richDescription = node.description || `(Generation ${node.generation})`;
    
    // Append holonic metadata that doesn't map directly to Quest.js schema
    const metadataSections: string[] = [];
    
    if (node.estimatedDuration) {
      metadataSections.push(`⏱️ Duration: ${node.estimatedDuration}`);
    }
    
    if (node.skillsRequired && node.skillsRequired.length > 0) {
      metadataSections.push(`🔧 Skills: ${node.skillsRequired.join(', ')}`);
    }
    
    if (node.resourcesRequired && node.resourcesRequired.length > 0) {
      metadataSections.push(`📦 Resources: ${node.resourcesRequired.join(', ')}`);
    }
    
    if (node.actions && node.actions.length > 0) {
      metadataSections.push(`⚡ Actions: ${node.actions.join(' • ')}`);
    }
    
    if (node.futureState) {
      metadataSections.push(`🎯 Success: ${node.futureState}`);
    }
    
    if (node.assumptions && node.assumptions.length > 0) {
      metadataSections.push(`💭 Assumptions: ${node.assumptions.join(' • ')}`);
    }
    
    if (node.questions && node.questions.length > 0) {
      metadataSections.push(`❓ Questions: ${node.questions.join(' • ')}`);
    }
    
    if (node.successMetrics && node.successMetrics.length > 0) {
      metadataSections.push(`📊 Metrics: ${node.successMetrics.join(' • ')}`);
    }
    
    if (node.impactCategory) {
      metadataSections.push(`🌱 Impact: ${node.impactCategory}`);
    }
    
    // Combine description with metadata
    if (metadataSections.length > 0) {
      richDescription += '\n\n' + metadataSections.join('\n\n');
    }

    const task: Quest = {
      id: taskId,
      title: node.title,
      description: richDescription,
      status: 'pending',
      type: 'task',
      category: DEFAULT_TASK_CATEGORY,
      participants: node.participants || [],
      appreciation: [],
      created: new Date().toISOString(),
      orderIndex: node.generation * 100 + (node.generationIndex ?? 0),
      initiator: {
        id: holonID,
        ...COUNCIL_INITIATOR
      },
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      _meta: {
        source: 'quest_tree',
        questTreeId: questTree.id,
        generation: node.generation,
        parentNodeId: node.parentId,
        initiatedBy: 'council',
        // Store holonic metadata for future reference
        holonicData: {
          skillsRequired: node.skillsRequired,
          resourcesRequired: node.resourcesRequired,
          impactCategory: node.impactCategory,
          estimatedDuration: node.estimatedDuration,
          assumptions: node.assumptions,
          questions: node.questions,
          actions: node.actions,
          successMetrics: node.successMetrics,
          futureState: node.futureState,
          facilitatingAdvisor: node.facilitatingAdvisor
        }
      }
    };

    tasks.push(task);
  });

  return tasks;
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
 * Saves tasks to the holon and returns the count of successful saves
 */
export async function saveTasksToHolon(
	holosphere: HoloSphere,
	holonID: string,
	tasks: Quest[]
): Promise<number> {
	let successfulTasks = 0;
	
	for (const task of tasks) {
		try {
			await holosphere.put(holonID, "quests", task);
			successfulTasks++;
		} catch (taskError) {
			console.error(`Failed to save task ${task.title}:`, taskError);
			// Don't throw here - continue with other tasks
		}
	}
	
	return successfulTasks;
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