export interface DesignStreamsSession {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  isComplete: boolean;
  
  // Backcasting outputs
  backcasting?: {
    questTree?: any; // QuestTree type
    chatTranscript?: Array<{
      role: 'user' | 'assistant';
      content: string;
      timestamp: Date;
      advisor?: string;
    }>;
  };
  
  // Future design streams features can be added here
  // e.g., mindMapping?: { ... }, systemsThinking?: { ... }
}

export interface PreviousRitual {
  id: string;
  title: string; // 3 significant words from wish
  createdAt: Date;
  completedAt?: Date;
  holonId: string;
  userName?: string; // Optional user identifier
  
  // Session snapshot
  seating: Record<string, string>; // outer-top: advisorId, etc.
  wish: string; // full wish statement
  wishTitle: string; // 3 words for center display
  values: string[]; // inner ring values (≤6)
  
  // Design streams session
  designStreamsSession: DesignStreamsSession;
}

export interface CouncilSeating {
  'outer-top': string | null;
  'outer-top-right': string | null;
  'outer-bottom-right': string | null;
  'outer-bottom': string | null;
  'outer-bottom-left': string | null;
  'outer-top-left': string | null;
}

export interface CouncilState {
  seating: CouncilSeating;
  wish: string;
  wishTitle: string; // 3 words
  values: string[]; // ≤6
}


