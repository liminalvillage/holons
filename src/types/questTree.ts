// Timeline Mapping / Recursive Backcasting Quest Tree Structure

export interface QuestTreeNode {
  id: string;
  title: string;
  description?: string;
  
  // Holonic properties - each node is both part and whole
  parentId: string | null; // null for root vision
  childIds: string[]; // array of child quest IDs
  
  // Generation metadata
  generation: number; // 0 = vision, 1 = seed quests, 2+ = recursive branches
  generationIndex: number; // position within generation (0, 1, 2 for 3-child structure)
  
  // Quest metadata as specified in the prompt
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dependencies: string[]; // IDs of other quests this depends on
  skillsRequired: string[];
  resourcesRequired: string[];
  impactCategory: 'ecological' | 'social' | 'economic' | 'spiritual' | 'technical';
  
  // Timeline and execution
  estimatedDuration?: string; // "2 weeks", "3 months", etc.
  estimatedStartDate?: string;
  estimatedEndDate?: string;
  
  // Holon execution context
  participants: Array<{
    username: string;
    role?: string;
    [key: string]: any;
  }>;
  
  // Backcasting context
  futureState?: string; // What success looks like for this quest
  assumptions: string[]; // What we're assuming to be true
  questions: string[]; // Questions that arise from assumptions
  actions: string[]; // Specific actionable steps
  
  // Metrics and feedback
  successMetrics?: string[];
  feedbackLoopFrequency?: 'daily' | 'weekly' | 'monthly' | 'per-milestone';
  
  // Creation metadata
  created: string;
  createdBy: string;
  lastModified: string;
  
  // AI council context
  facilitatingAdvisor?: string; // Which council member is leading this quest
  advisorInsights?: Array<{
    advisorName: string;
    insight: string;
    timestamp: string;
  }>;
}

export interface QuestTree {
  id: string;
  
  // Root vision (generation 0)
  vision: {
    statement: string; // The regenerative vision (from wish_statement)
    principles: string[]; // The declared values
    targetDate?: string;
    successIndicators: string[];
  };
  
  // Tree structure
  nodes: Record<string, QuestTreeNode>; // Map of node ID to node
  rootNodeIds: string[]; // IDs of the root node (vision quest - generation 0)
  
  // Configuration
  maxGenerations: number; // 6-7 as per user settings, default 6
  branchingFactor: number; // Usually 3 (3,3,3 structure)
  
  // Impact tracking
  impactDimensions: string[]; // e.g., ["biodiversity", "water retention", "participation"]
  
  // Creation metadata
  created: string;
  createdBy: string;
  lastModified: string;
  sourceRitualId?: string; // Link back to the ritual that created this
  
  // AI facilitation
  headAdvisor: string; // The advisor at the head of metatron table leading facilitation
  
  // Flow metrics
  resourceFlows?: Array<{
    fromNodeId: string;
    toNodeId: string;
    resourceType: 'data' | 'energy' | 'material' | 'knowledge';
    description: string;
  }>;
}

export interface BackcastingSession {
  id: string;
  questTreeId: string;
  currentNodeId: string | null; // Which node we're currently working on
  
  // Session state
  phase: 'vision_setting' | 'seed_generation' | 'recursive_inquiry' | 'review' | 'complete';
  currentGeneration: number;
  currentGenerationIndex: number;
  
  // AI facilitation state
  facilitatingAdvisor: string;
  conversationHistory: Array<{
    speaker: 'user' | 'advisor' | 'system';
    content: string;
    timestamp: string;
    nodeId?: string; // Which quest node this relates to
  }>;
  
  // Inquiry loop state
  currentInquiryStep: 'assumptions' | 'questions' | 'actions' | 'complete';
  
  created: string;
  lastActivity: string;
}

// Utility types for the recursive inquiry process
export interface InquiryLoop {
  nodeId: string;
  previousContext: string; // What we know from previous quests
  assumptions: string[];
  questions: string[];
  actions: string[];
  facilitatingAdvisor: string;
}

export interface GenerationConfig {
  number: number; // 6-7, default 6
  branchingFactor: number; // usually 3
  inquiryDepth: 'light' | 'medium' | 'deep'; // How thorough each inquiry loop should be
}