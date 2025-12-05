// Holonic LLM Integration Types for Quest Tree Generation
// Self-similar schemas that work at any generation level

import type { QuestTree, QuestTreeNode } from './questTree';
import type { CouncilAdvisorExtended } from './advisor-schema';

// ============================================================================
// HOLONIC INPUT SCHEMA: Unified for All Generation Levels
// ============================================================================

export interface HolonicLLMInput {
  // Core vision context (always present)
  vision: {
    statement: string;
    principles: string[];
    successIndicators: string[];
  };
  
  // Design Streams context (rich context from council interactions)
  designStreamsContext: {
    additionalContext: string; // Elemental insights, advisor conversations, etc.
    enhancedVision?: {
      smartObjective: any; // SMARTObjective from vision clarification
      councilInsights: string[]; // Key insights from council discussion
      synthesisNotes: string; // Facilitator synthesis
    };
  };
  
  // Facilitating advisor with full schema
  facilitatingAdvisor: CouncilAdvisorExtended;
  
  // Complete quest tree context
  questTreeContext: {
    maxGenerations: number;
    currentGeneration: number;
    fullTree: QuestTree;
    focusNodeId: string; // The quest being expanded
    ancestryChain: QuestTreeNode[]; // Path from root to focus node
    siblingContext: SiblingContext[];
  };
  
  // Generation targeting
  targetGeneration: number;
  requestType: 'seed_generation' | 'child_expansion';
}

// ============================================================================
// HOLONIC OUTPUT SCHEMA: Rich QuestTreeNode Population
// ============================================================================

export interface HolonicQuestNodeData {
  title: string;
  description: string;
  estimatedDuration: string;
  skillsRequired: string[];
  resourcesRequired: string[];
  impactCategory: 'ecological' | 'social' | 'economic' | 'spiritual' | 'technical';
  assumptions: string[];
  questions: string[];
  actions: string[];
  successMetrics: string[];
  futureState: string;
  dependencies: string[]; // Quest IDs this depends on
}

export interface HolonicLLMResponse {
  questNodes: HolonicQuestNodeData[];
  
  siblingRelationships: {
    complementarity: string; // How these quests complement each other
    avoidedDuplication: string[]; // What was avoided due to sibling awareness
  };
  
  rationale: string;
  
  // Meta information
  generationLevel: number;
  parentQuestId: string;
}

// ============================================================================
// CONTEXT BUILDING TYPES
// ============================================================================

export interface SiblingContext {
  generation: number;
  siblings: Array<{
    id: string;
    title: string;
    description?: string;
    status: string;
  }>;
}

export interface QuestTreeHierarchy {
  ancestry: Array<{
    generation: number;
    id: string;
    title: string;
    description?: string;
    status: string;
  }>;
  siblings: SiblingContext[];
  focusNode: {
    id: string;
    title: string;
    description?: string;
    generation: number;
    existingChildren: string[];
  };
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface GenerationWisdom {
  guidance: string;
  examples: string;
  actionabilityLevel: string;
}

export interface HolonicPromptComponents {
  facilitatorContext: string;
  visionContext: string;
  treeHierarchy: string;
  generationGuidance: string;
  taskInstructions: string;
  responseFormat: string;
}
