// Vision Clarification and Council Interaction Types

import type { CouncilAdvisorExtended } from './advisor-schema';

// S.M.A.R.T. Objective structure for enhanced vision
export interface SMARTObjective {
  // S.M.A.R.T. criteria
  specific: string; // Clear, specific description
  measurable: string[]; // How success will be measured
  achievable: string; // Why this is achievable
  relevant: string; // Why this matters/relevance
  timeBound: string; // Time constraints and milestones
  
  // Enhanced context from council discussion
  assumptions: string[]; // What we're assuming to be true
  successMetrics: string[]; // Specific metrics for success
  futureState: string; // Detailed vision of success
  constraints: string[]; // Known limitations or constraints
  stakeholders: string[]; // Key stakeholders identified
  risks: string[]; // Potential risks and mitigation strategies
}

// Interaction Pattern Types
export type InteractionPatternType = 'celebrity_interview' | 'socratic_dialogue' | 'consensus_building';

export interface InteractionPattern {
  id: InteractionPatternType;
  name: string;
  description: string;
  phases: InteractionPhase[];
}

export interface InteractionPhase {
  id: string;
  name: string;
  description: string;
  advisorCount: number; // How many advisors participate in this phase
  questionPrompt: string; // LLM prompt for generating questions
  synthesisPrompt?: string; // Optional synthesis prompt for this phase
}

// Council Question and Response Types
export interface AdvisorQuestion {
  id: string;
  advisorId: string;
  advisorName: string;
  question: string;
  phase: number; // Which phase this question belongs to (1, 2, etc.)
  generated: string; // ISO timestamp
}

export interface UserResponse {
  questionId: string;
  response: string;
  timestamp: string; // ISO timestamp
}

export interface VisionClarificationSession {
  id: string;
  originalVision: string;
  originalValues: string[];
  interactionPattern: InteractionPatternType;
  facilitatorId: string; // Head advisor ID
  phases: VisionClarificationPhase[];
  finalSMARTObjective?: SMARTObjective;
  created: string;
  completed?: string;
}

export interface VisionClarificationPhase {
  phaseNumber: number;
  phaseName: string;
  questions: AdvisorQuestion[];
  responses: UserResponse[];
  completed: boolean;
  completedAt?: string;
}

// LLM Integration Types
export interface VisionQuestionGenerationInput {
  originalVision: string;
  originalValues: string[];
  facilitator: CouncilAdvisorExtended;
  advisors: CouncilAdvisorExtended[]; // The advisors for this phase
  phase: number;
  previousResponses?: UserResponse[]; // For phase 2+ generation
  interactionPattern: InteractionPattern;
}

export interface VisionQuestionGenerationResponse {
  questions: Array<{
    advisorId: string;
    question: string;
  }>;
  facilitatorSummary?: string; // Optional summary from facilitator
}

export interface VisionSynthesisInput {
  originalVision: string;
  originalValues: string[];
  allQuestions: AdvisorQuestion[];
  allResponses: UserResponse[];
  facilitator: CouncilAdvisorExtended;
  interactionPattern: InteractionPattern;
}

export interface VisionSynthesisResponse {
  smartObjective: SMARTObjective;
  facilitatorSummary: string;
  keyInsights: string[];
  recommendedNextSteps: string[];
}
