import type { PreviousRitual, DesignStreamsSession, CouncilSeating } from '../types/previousRitual';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import { getAdvisorById, getAdvisorName, generateAdvisorId } from '../data/advisor-library';

/**
 * Extract 3 most significant words from a wish statement
 * Advanced filtering for meaningful, unique terms
 */
export function extractWishTitle(wish: string): string {
  if (!wish || !wish.trim()) return 'Untitled\nWish\nStatement';
  
  const stopWords = new Set([
    // Articles & pronouns
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'would', 'i', 'my', 'me',
    'we', 'our', 'us', 'you', 'your', 'they', 'them', 'their',
    // Common verbs that don't add meaning
    'do', 'does', 'did', 'can', 'could', 'should', 'may', 'might',
    'have', 'had', 'get', 'got', 'make', 'made', 'take', 'took',
    // Common wish starters
    'wish', 'want', 'hope', 'like', 'need', 'would'
  ]);
  
  // Extract and score words
  const wordFreq = new Map<string, number>();
  const words = wish
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  
  // Count word frequency and prefer longer, less common words
  words.forEach(word => {
    wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
  });
  
  // Score words: longer words get higher score, frequent words get penalty
  const scoredWords = Array.from(wordFreq.entries())
    .map(([word, freq]) => ({
      word,
      score: word.length * 2 - (freq > 1 ? freq : 0) // Prefer longer, unique words
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.word);
  
  // Capitalize first letter of each word
  const finalWords = scoredWords
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .slice(0, 3);
  
  // Pad with generic words if needed
  while (finalWords.length < 3) {
    const padding = ['Vision', 'Dream', 'Goal', 'Hope', 'Quest'];
    const nextWord = padding[finalWords.length - 1] || 'Purpose';
    finalWords.push(nextWord);
  }
  
  return finalWords.join('\n');
}

/**
 * Build a complete ritual snapshot from current state
 */
export function buildRitualSnapshot(
  holonId: string,
  seating: Record<string, string>,
  wish: string,
  values: string[],
  designStreamsSession: DesignStreamsSession,
  userName?: string
): PreviousRitual {
  const now = new Date();
  const wishTitle = extractWishTitle(wish);
  
  return {
    id: `ritual-${now.getTime()}`,
    title: wishTitle,
    createdAt: now,
    completedAt: designStreamsSession.isComplete ? now : undefined,
    holonId,
    userName,
    seating: { ...seating },
    wish,
    wishTitle,
    values: [...values],
    designStreamsSession: {
      ...designStreamsSession,
      updatedAt: now
    }
  };
}

/**
 * Create a new DesignStreamsSession
 */
export function createDesignStreamsSession(): DesignStreamsSession {
  const now = new Date();
  return {
    id: `session-${now.getTime()}`,
    createdAt: now,
    updatedAt: now,
    isComplete: false
  };
}

/**
 * Convert circle inputs (names) to advisor IDs for snapshot storage
 * HOLONIC APPROACH: Always store IDs, never names
 */
export function circleInputsToSeating(
  circleInputs: Record<string, string>
): Record<string, string> {
  const seating: Record<string, string> = {};
  
  const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
  
  outerPositions.forEach(position => {
    const advisorName = circleInputs[position];
    if (advisorName) {
      // Try to find advisor by name and get its ID
      let advisorId: string | null = null;
      
      // Strategy 1: Try exact key lookup
      const cleanName = advisorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const advisor = getAdvisorById(cleanName);
      if (advisor) {
        advisorId = advisor.id!;
      } else {
        // Strategy 2: Generate clean ID from name as fallback
        advisorId = generateAdvisorId(advisorName);
        console.warn(`⚠️ Advisor "${advisorName}" not found in library, using generated ID: ${advisorId}`);
      }
      
      if (advisorId) {
        seating[position] = advisorId;
        console.log(`📍 Mapped ${position}: "${advisorName}" → ID: ${advisorId}`);
      }
    }
  });
  
  return seating;
}

/**
 * Convert seating (advisor IDs) back to display names
 * HOLONIC APPROACH: Always resolve IDs to names for display
 */
export function seatingToDisplayNames(
  seating: Record<string, string>
): Record<string, string> {
  const displayNames: Record<string, string> = {};
  
  Object.entries(seating).forEach(([position, advisorId]) => {
    const displayName = getAdvisorName(advisorId);
    displayNames[position] = displayName;
    console.log(`🏷️ Display ${position}: ID "${advisorId}" → Name "${displayName}"`);
  });
  
  return displayNames;
}
