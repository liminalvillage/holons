import type { DesignStreamsSession } from '../types/previousRitual';
import { createDesignStreamsSession, buildRitualSnapshot } from './ritualSnapshot';
import type { HoloSphere } from "holosphere";

/**
 * Session Manager for Design Streams lifecycle
 * Handles session creation, tracking, and completion
 */
export class SessionManager {
  private holosphere: HoloSphere | null = null;
  private holonId: string = '';
  private currentSession: DesignStreamsSession | null = null;
  private sessionStartCallback: ((session: DesignStreamsSession) => void) | null = null;
  private sessionCompleteCallback: ((session: DesignStreamsSession) => void) | null = null;

  constructor(holosphere: HoloSphere | null, holonId: string) {
    this.holosphere = holosphere;
    this.holonId = holonId;
  }

  /**
   * Initialize a new Design Streams session
   * Called when Design Streams modal opens
   */
  startSession(): DesignStreamsSession {
    console.log('🚀 Starting new Design Streams session');
    
    this.currentSession = createDesignStreamsSession();
    
    // Persist session start to holosphere
    if (this.holosphere && this.holonId) {
      this.holosphere.put(this.holonId, `design_session_${this.currentSession.id}`, {
        ...this.currentSession,
        createdAt: this.currentSession.createdAt.toISOString(),
        updatedAt: this.currentSession.updatedAt.toISOString()
      });
    }

    // Trigger callback if registered
    if (this.sessionStartCallback) {
      this.sessionStartCallback(this.currentSession);
    }

    return this.currentSession;
  }

  /**
   * Track an interaction within the session
   * Called when user engages with any Design Streams feature
   */
  trackInteraction(type: 'quest_generation' | 'chat' | 'backcasting' | 'wish_update' | 'values_update', data?: any) {
    if (!this.currentSession) {
      console.warn('⚠️ No active session to track interaction');
      return;
    }

    console.log(`📊 Tracking interaction: ${type}`, data);
    
    // Update session timestamp
    this.currentSession.updatedAt = new Date();
    
    // Store interaction-specific data
    switch (type) {
      case 'quest_generation':
        if (!this.currentSession.backcasting) {
          this.currentSession.backcasting = {};
        }
        if (data?.questTree) {
          this.currentSession.backcasting.questTree = data.questTree;
        }
        break;
      
      case 'chat':
        if (!this.currentSession.backcasting) {
          this.currentSession.backcasting = {};
        }
        if (!this.currentSession.backcasting.chatTranscript) {
          this.currentSession.backcasting.chatTranscript = [];
        }
        if (data?.message) {
          this.currentSession.backcasting.chatTranscript.push({
            role: data.role || 'user',
            content: data.content,
            timestamp: new Date(),
            advisor: data.advisor
          });
        }
        break;
    }

    // Persist updated session
    this.persistSession();
  }

  /**
   * Mark session as complete and create ritual snapshot
   * Called when user indicates they're done with Design Streams
   */
  async completeSession(
    seating: Record<string, string>,
    wish: string,
    values: string[],
    userName?: string
  ) {
    if (!this.currentSession) {
      console.warn('⚠️ No active session to complete');
      return null;
    }

    console.log('✅ Completing Design Streams session');
    
    // Mark session as complete
    this.currentSession.isComplete = true;
    this.currentSession.updatedAt = new Date();
    
    // Create ritual snapshot
    const ritualSnapshot = buildRitualSnapshot(
      this.holonId,
      seating,
      wish,
      values,
      this.currentSession,
      userName
    );

    // Persist final session and ritual snapshot
    this.persistSession();
    
    if (this.holosphere && this.holonId) {
      // Save individual ritual snapshot
      await this.holosphere.put(this.holonId, `previous_ritual_${ritualSnapshot.id}`, {
        ...ritualSnapshot,
        createdAt: ritualSnapshot.createdAt.toISOString(),
        completedAt: ritualSnapshot.completedAt?.toISOString(),
        designStreamsSession: {
          ...ritualSnapshot.designStreamsSession,
          createdAt: ritualSnapshot.designStreamsSession.createdAt.toISOString(),
          updatedAt: ritualSnapshot.designStreamsSession.updatedAt.toISOString()
        }
      });
      
      // Save ritual to previous_rituals collection (following quest pattern)
      try {
        console.log('🔑 SessionManager: Saving ritual with key pattern like quests');
        // Serialize dates before saving to prevent HoloSphere corruption
        const serializedRitual = {
          ...ritualSnapshot,
          createdAt: ritualSnapshot.createdAt.toISOString(),
          completedAt: ritualSnapshot.completedAt?.toISOString(),
          designStreamsSession: {
            ...ritualSnapshot.designStreamsSession,
            createdAt: ritualSnapshot.designStreamsSession.createdAt.toISOString(),
            updatedAt: ritualSnapshot.designStreamsSession.updatedAt.toISOString()
          }
        };
        await this.holosphere.put(this.holonId, "previous_rituals", serializedRitual);
        console.log('✅ Ritual snapshot saved to previous_rituals collection');
      } catch (error) {
        console.error('❌ Error saving to previous_rituals collection:', error);
      }
    }

    // Trigger callback if registered
    if (this.sessionCompleteCallback) {
      this.sessionCompleteCallback(this.currentSession);
    }

    // Clear current session
    const completedSession = this.currentSession;
    this.currentSession = null;

    return { session: completedSession, ritual: ritualSnapshot };
  }

  /**
   * Get the current active session
   */
  getCurrentSession(): DesignStreamsSession | null {
    return this.currentSession;
  }

  /**
   * Check if there's an active session
   */
  hasActiveSession(): boolean {
    return this.currentSession !== null;
  }

  /**
   * Set callback for session start events
   */
  onSessionStart(callback: (session: DesignStreamsSession) => void) {
    this.sessionStartCallback = callback;
  }

  /**
   * Set callback for session completion events
   */
  onSessionComplete(callback: (session: DesignStreamsSession) => void) {
    this.sessionCompleteCallback = callback;
  }

  /**
   * Persist current session to holosphere
   */
  private persistSession() {
    if (!this.currentSession || !this.holosphere || !this.holonId) {
      return;
    }

    this.holosphere.put(this.holonId, `design_session_${this.currentSession.id}`, {
      ...this.currentSession,
      createdAt: this.currentSession.createdAt.toISOString(),
      updatedAt: this.currentSession.updatedAt.toISOString()
    });
  }

  /**
   * Load existing incomplete session (for recovery)
   */
  async loadIncompleteSession(): Promise<DesignStreamsSession | null> {
    if (!this.holosphere || !this.holonId) {
      return null;
    }

    try {
      // Look for incomplete sessions (this is a simplified approach)
      // In a real implementation, you might want to query for incomplete sessions
      // For now, we'll just return null and always start fresh
      return null;
    } catch (error) {
      console.error('Error loading incomplete session:', error);
      return null;
    }
  }
}

/**
 * Global session manager instance
 * Initialize with holosphere and holonId when available
 */
export let sessionManager: SessionManager | null = null;

export function initializeSessionManager(holosphere: HoloSphere | null, holonId: string) {
  sessionManager = new SessionManager(holosphere, holonId);
  return sessionManager;
}
