// Timeline Mapping / Recursive Backcasting Utilities
// Truly holonic: minimal, self-similar, composable

import type { QuestTree, QuestTreeNode, GenerationConfig } from '../types/questTree';
import type { RitualSession } from './holonCreator';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';

// ============================================================================
// HOLONIC CORE: Single Source of Truth for Generation Wisdom
// ============================================================================

const GENERATION_WISDOM = {
  guidance: [
    "foundational domains that everything builds upon",
    "major phases or components needed to complete the parent quest", 
    "concrete work streams with clear deliverables",
    "specific tasks or milestones that can be completed in days/weeks",
    "granular action items with clear next steps",
    "immediate, actionable steps that can be started today"
  ],
  examples: [
    "'Establish Supply Chain', 'Build Community Support', 'Create Technical Infrastructure'",
    "'Research Suppliers', 'Design Partnership Framework', 'Develop Pilot Program'",
    "'Contact 5 Local Suppliers', 'Draft Partnership Agreement', 'Recruit 10 Beta Users'",
    "'Call Johnson Lumber Co.', 'Write Partnership MOU Section 1', 'Post Recruitment on NextDoor'",
    "'Find Johnson Lumber phone number', 'Research partnership legal requirements', 'Create NextDoor account'",
    "'Google Johnson Lumber contact info', 'Download partnership template', 'Sign up at nextdoor.com'"
  ]
};

// ============================================================================
// HOLONIC OPERATIONS: Self-Similar Patterns
// ============================================================================

export function createQuestTreeFromRitual(
  ritualSession: RitualSession,
  headAdvisor: string,
  config: GenerationConfig
): QuestTree {
  const treeId = `tree-${Date.now()}`;
  const visionNodeId = `vision-${treeId}`;
  
  // Create the vision as Generation 0 quest node
  const visionNode: QuestTreeNode = {
    id: visionNodeId,
    title: ritualSession.wish_statement,
    description: `Vision: ${ritualSession.wish_statement}`,
    parentId: null, // True root of the quest tree
    childIds: [], // Will be populated with seed quest IDs
    generation: 0, // Vision is Generation 0
    generationIndex: 0,
    status: 'pending',
    dependencies: [], // Vision has no dependencies
    skillsRequired: [],
    resourcesRequired: [],
    impactCategory: 'social',
    participants: [],
    assumptions: [],
    questions: [],
    actions: [],
    successMetrics: ritualSession.declared_values || [],
    futureState: ritualSession.wish_statement,
    created: new Date().toISOString(),
    createdBy: 'council_ritual',
    lastModified: new Date().toISOString(),
    facilitatingAdvisor: headAdvisor
  };

  const questTree: QuestTree = {
    id: treeId,
    vision: {
      statement: ritualSession.wish_statement,
      principles: ritualSession.declared_values || [],
      successIndicators: []
    },
    nodes: { [visionNodeId]: visionNode },
    rootNodeIds: [visionNodeId], // Vision node is the true root
    maxGenerations: config.number,
    branchingFactor: config.branchingFactor,
    impactDimensions: [],
    created: new Date().toISOString(),
    createdBy: 'council_ritual',
    lastModified: new Date().toISOString(),
    sourceRitualId: ritualSession.session_id,
    headAdvisor
  };

  return questTree;
}

// Unified quest creation - works for all generations (seeds and children)
export function createQuests(
  questTree: QuestTree,
  titles: string[],
  parentId: string | null = null
): QuestTreeNode[] {
  const parent = parentId ? questTree.nodes[parentId] : null;
  const generation = parent ? parent.generation + 1 : 1; // Seeds are now Generation 1
  
  return titles.map((title, index) => {
    const timestamp = Date.now();
    const nodeId = `gen${generation}-${index}-${timestamp}`;
    
    const node: QuestTreeNode = {
      id: nodeId,
      title,
      parentId,
      childIds: [],
      generation,
      generationIndex: index,
      status: 'pending',
      dependencies: parentId ? [parentId] : [],
      skillsRequired: [],
      resourcesRequired: [],
      impactCategory: parent?.impactCategory || 'social',
      participants: [],
      assumptions: [],
      questions: [],
      actions: [],
      created: new Date().toISOString(),
      createdBy: 'holonic_quest_creation',
      lastModified: new Date().toISOString(),
      facilitatingAdvisor: parent?.facilitatingAdvisor || questTree.headAdvisor
    };

    // Add to quest tree
    questTree.nodes[nodeId] = node;
    if (parentId && parent) {
      parent.childIds.push(nodeId);
    } else if (!parentId) {
      // This is for backward compatibility - should not happen with proper vision node
      questTree.rootNodeIds.push(nodeId);
    }

    return node;
  });
}

// Backwards compatibility
export const createSeedQuests = (questTree: QuestTree, titles: string[]) => createQuests(questTree, titles);
export const createChildQuests = (questTree: QuestTree, parentId: string, titles: string[]) => createQuests(questTree, titles, parentId);

export function createChildQuestGenerationPrompt(
  questTree: QuestTree,
  parentNodeId: string,
  facilitatingAdvisor: CouncilAdvisorExtended
): string {
  const parent = questTree.nodes[parentNodeId];
  if (!parent) throw new Error(`Parent node ${parentNodeId} not found`);

  const gen = parent.generation + 1;
  const guidance = GENERATION_WISDOM.guidance[gen - 1] || "specific, actionable steps";
  const examples = GENERATION_WISDOM.examples[gen - 1] || "concrete actions";
  const actionLevel = gen >= 4 ? 'concrete and immediately actionable' : 'specific than higher-level strategic planning';

  return `**Generate Child Quests - Generation ${gen}**

You are ${facilitatingAdvisor.name}, working with the council to break down a quest into actionable sub-quests.

**Vision**: ${questTree.vision.statement}
**Principles**: ${questTree.vision.principles.join(', ')}

**Quest Tree Context**:
- **Current Generation**: ${gen} (of ${questTree.maxGenerations} max)
- **Parent Quest**: "${parent.title}"

**Scale & Granularity Guidance**:
These are ${guidance}.
At Generation ${gen}, quests should be more ${actionLevel}.

**Scale Examples for Gen ${gen}**:
Example: ${examples}

**Task**: Generate exactly 3 child quests that must be completed for "${parent.title}" to be successful.

Each child quest should be:
1. **Independently executable** - can be worked on separately
2. **Appropriately scaled** - right level of detail for Generation ${gen}
3. **Necessary** - the parent quest cannot succeed without it
4. **Sequential or parallel** - logical flow from these 3 to complete the parent
5. **Aligned** - supports the vision and principles

Format your response as:
CHILD QUEST 1: [title]
CHILD QUEST 2: [title]  
CHILD QUEST 3: [title]

RATIONALE: [brief explanation of why these three are necessary and sufficient at this level of granularity]`;
}

export function createRecursiveInquiryContext(
  questTree: QuestTree,
  currentNodeId: string,
  facilitatingAdvisor: CouncilAdvisorExtended
): string {
  const node = questTree.nodes[currentNodeId];
  if (!node) throw new Error(`Quest node ${currentNodeId} not found`);
  
  const parent = node.parentId ? questTree.nodes[node.parentId] : null;
  const siblings = parent ? parent.childIds.filter(id => id !== currentNodeId).map(id => questTree.nodes[id].title) : [];

  return `**Recursive Backcasting Facilitation**

You are ${facilitatingAdvisor.name}, facilitating the council's recursive inquiry for quest creation.

**Vision**: ${questTree.vision.statement}
**Principles**: ${questTree.vision.principles.join(', ')}

**Current Quest**: "${node.title}"
- Generation: ${node.generation}
- Position: ${node.generationIndex + 1} of ${questTree.branchingFactor}

${parent ? `Parent Quest: "${parent.title}"` : ''}
${siblings.length ? `Sibling Quests: ${siblings.join(', ')}` : ''}

**Recursive Inquiry Protocol**:
1. **What do we know?** - from the vision, principles, and previous quests
2. **What assumptions are we making?** - about this quest and its execution
3. **What questions arise?** - from these assumptions
4. **What actions can we take?** - specific, achievable steps

Keep responses focused and actionable. Each child quest should be:
- Independently executable
- A clear step toward completing the parent quest
- Aligned with the regenerative vision`;
}

export function parseChildQuestResponse(response: string): string[] {
  const patterns = [
    /^SEED QUEST \d+:\s*(.+)$/i,
    /^CHILD QUEST \d+:\s*(.+)$/i,
    /^QUEST \d+:\s*(.+)$/i,
    /^(\d+)\.\s*(.+)$/i,
    /^[-*]\s*(.+)$/i
  ];
  
  const titles = response
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const title = match[1].trim();
          if (title && !title.toLowerCase().includes('rationale')) {
            return title;
          }
        }
      }
      return null;
    })
    .filter(Boolean) as string[];

  // Fallback: reasonable lines if parsing fails
  return titles.length > 0 ? titles : response
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 5 && line.length < 100 && !line.toLowerCase().includes('rationale'))
    .slice(0, 3);
}

export function validateQuestTree(questTree: QuestTree) {
  const errors: string[] = [];
  
  // Check roots exist
  questTree.rootNodeIds.forEach(id => {
    if (!questTree.nodes[id]) errors.push(`Root node ${id} not found`);
  });
  
  // Check parent-child relationships
  Object.entries(questTree.nodes).forEach(([id, node]) => {
    if (node.parentId && !questTree.nodes[node.parentId]) {
      errors.push(`Node ${id} has non-existent parent`);
    }
    node.childIds.forEach(childId => {
      if (!questTree.nodes[childId] || questTree.nodes[childId].parentId !== id) {
        errors.push(`Invalid child relationship for ${id}`);
      }
    });
  });
  
  return { isValid: errors.length === 0, errors };
}

export function calculateTreeStats(questTree: QuestTree) {
  const nodes = Object.values(questTree.nodes);
  const byGeneration: Record<number, number> = {};
  let completed = 0;
  
  nodes.forEach(node => {
    byGeneration[node.generation] = (byGeneration[node.generation] || 0) + 1;
    if (node.status === 'completed') completed++;
  });
  
  return {
    totalNodes: nodes.length,
    nodesByGeneration: byGeneration,
    completionRate: nodes.length > 0 ? completed / nodes.length : 0,
    maxDepth: Math.max(...nodes.map(n => n.generation), 0)
  };
}