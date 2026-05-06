// Shared task / quest types used by all Holons UIs.
//
// Two historical Quest shapes existed:
//   - apps/web (TS): minimal shape (title/when/status/participants...)
//   - packages/telegram-ui (JS): rich shape with extra Telegram metadata
//     (message_thread_id, stoppers, dependencies, frequency, timeTracking,
//     activeHolograms, document, where, when, until, completed, ...).
//
// We unify under a single `Quest` interface that lists the fields each UI
// relies on as optional, and keeps an open index signature so neither UI is
// forced to discard data it currently writes. The two creation helpers
// (createTasksFromDesignStreams, createTasksFromQuestTree) emit the same
// concrete shape they always have — only the type widens.

export interface QuestInitiator {
  id: string | number;
  username?: string;
  firstName?: string;
  lastName?: string;
  [key: string]: any;
}

export interface QuestParticipant {
  username?: string;
  id?: string | number;
  role?: string;
  [key: string]: any;
}

export interface QuestMeta {
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
}

export interface Quest {
  id?: string | number;
  title: string;
  description?: string;

  // Status — historic union plus open string for forward-compat.
  status:
    | 'ongoing'
    | 'completed'
    | 'cancelled'
    | 'scheduled'
    | 'recurring'
    | 'repeating'
    | 'pending'
    | 'stopped'
    | string;

  type?: 'task' | 'quest' | 'event' | 'proposal' | 'recurring' | string;
  category?: string;

  // Web-style schedule fields.
  when?: string;
  ends?: string;
  location?: string;

  // People.
  participants: QuestParticipant[];
  // Bot stores user objects, web stores string usernames — keep open.
  appreciation?: any[];

  // Provenance.
  created?: string; // ISO from web side
  date?: number; // ms epoch from bot side
  initiator?: QuestInitiator;

  // Ordering / dependencies (used by the council/quest-tree pipeline).
  orderIndex?: number;
  dependsOn?: string[];

  _meta?: QuestMeta;
  _deleted?: boolean;

  // Open shape so existing call sites that read/write extra fields keep working.
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Quest tree (recursive backcasting) — moved from apps/web/src/types/questTree.ts.
// ---------------------------------------------------------------------------

export interface QuestTreeNode {
  id: string;
  title: string;
  description?: string;

  // Holonic properties — each node is both part and whole.
  parentId: string | null;
  childIds: string[];

  // Generation metadata.
  generation: number;
  generationIndex: number;

  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dependencies: string[];
  skillsRequired: string[];
  resourcesRequired: string[];
  impactCategory:
    | 'ecological'
    | 'social'
    | 'economic'
    | 'spiritual'
    | 'technical';

  // Timeline and execution.
  estimatedDuration?: string;
  estimatedStartDate?: string;
  estimatedEndDate?: string;

  // Holon execution context.
  participants: Array<{
    username: string;
    role?: string;
    [key: string]: any;
  }>;

  // Backcasting context.
  futureState?: string;
  assumptions: string[];
  questions: string[];
  actions: string[];

  // Metrics and feedback.
  successMetrics?: string[];
  feedbackLoopFrequency?: 'daily' | 'weekly' | 'monthly' | 'per-milestone';

  // Creation metadata.
  created: string;
  createdBy: string;
  lastModified: string;

  // AI council context.
  facilitatingAdvisor?: string;
  advisorInsights?: Array<{
    advisorName: string;
    insight: string;
    timestamp: string;
  }>;
}

export interface QuestTree {
  id: string;

  vision: {
    statement: string;
    principles: string[];
    targetDate?: string;
    successIndicators: string[];
  };

  nodes: Record<string, QuestTreeNode>;
  rootNodeIds: string[];

  maxGenerations: number;
  branchingFactor: number;

  impactDimensions: string[];

  created: string;
  createdBy: string;
  lastModified: string;
  sourceRitualId?: string;

  headAdvisor: string;

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
  currentNodeId: string | null;

  phase:
    | 'vision_setting'
    | 'seed_generation'
    | 'recursive_inquiry'
    | 'review'
    | 'complete';
  currentGeneration: number;
  currentGenerationIndex: number;

  facilitatingAdvisor: string;
  conversationHistory: Array<{
    speaker: 'user' | 'advisor' | 'system';
    content: string;
    timestamp: string;
    nodeId?: string;
  }>;

  currentInquiryStep: 'assumptions' | 'questions' | 'actions' | 'complete';

  created: string;
  lastActivity: string;
}

export interface InquiryLoop {
  nodeId: string;
  previousContext: string;
  assumptions: string[];
  questions: string[];
  actions: string[];
  facilitatingAdvisor: string;
}

export interface GenerationConfig {
  number: number;
  branchingFactor: number;
  inquiryDepth: 'light' | 'medium' | 'deep';
}

// ---------------------------------------------------------------------------
// Ritual session shapes — used by createTasksFromDesignStreams.
// ---------------------------------------------------------------------------

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

export interface CompletedRitual {
  id: string;
  title: string;
  date: string;
  artifact: any;
  design_streams: any[];
}

export interface RitualOrigin {
  origin_ritual: string;
  wish: string;
  values: string[];
  advisors: any[];
  created: string;
}

// Minimal HoloSphere surface used by the persistence helpers. Both UIs pass
// the real instance from the `holosphere` package; we only require the
// methods we actually call so this stays UI-agnostic.
export interface HoloSphereLike {
  put: (
    holonId: string | number,
    bucket: string,
    value: any,
  ) => Promise<unknown>;
  get?: (
    holonId: string | number,
    bucket: string,
    key?: string,
  ) => Promise<unknown>;
}
