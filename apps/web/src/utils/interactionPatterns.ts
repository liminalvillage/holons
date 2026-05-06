// Council Interaction Patterns Library
// Configurable patterns for council-user interactions

import type { 
  InteractionPattern, 
  InteractionPatternType,
  VisionQuestionGenerationInput,
  VisionQuestionGenerationResponse,
  VisionSynthesisInput,
  VisionSynthesisResponse
} from '../types/visionClarification';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';

// ============================================================================
// INTERACTION PATTERN DEFINITIONS
// ============================================================================

export const CELEBRITY_INTERVIEW: InteractionPattern = {
  id: 'celebrity_interview',
  name: 'Celebrity Interview',
  description: 'Head advisor facilitates while 3 council members ask thoughtful questions, followed by council deliberation and synthesis',
  phases: [
    {
      id: 'interview_questions',
      name: 'Interview Questions',
      description: '3 advisors ask thoughtful clarifying questions about the vision',
      advisorCount: 3,
      questionPrompt: `You are conducting a vision clarification interview to help transform their vision into a specific, actionable S.M.A.R.T. objective. Focus your questions on clarifying:

**S.M.A.R.T. FRAMEWORK FOCUS:**
- **Specific**: What exactly will is the vision - help frame it more clearly. What are the desired outcomes, exactly?
- **Measurable**: How will success be measured? What are the quantifiable indicators?
- **Achievable**: What makes this realistic? What resources, skills, and support are needed?
- **Relevant**: Why does this matter now? How does it align with their values and larger purpose?
- **Time-bound**: What are the key milestones and deadlines? When will this be achieved?

**IMPORTANT**: Each advisor should ask questions that:
- Directly help define ONE aspect of the S.M.A.R.T. framework
- Reflect their unique expertise, perspective, and speaking style
- Drive toward concrete, actionable clarity (not just philosophical exploration)
- Help identify specific success metrics, constraints, stakeholders, and implementation steps

Generate exactly 3 questions from 3 different advisors, each focusing on different S.M.A.R.T. components, starting with specifying the precise objective, and speaking authentically in their documented voice and style.`
    }
  ]
};

// Library of all available interaction patterns
export const INTERACTION_PATTERNS: Partial<Record<InteractionPatternType, InteractionPattern>> = {
  celebrity_interview: CELEBRITY_INTERVIEW
  // Future patterns: socratic_dialogue, consensus_building, etc.
};

// ============================================================================
// PATTERN UTILITIES
// ============================================================================

export function getInteractionPattern(patternId: InteractionPatternType): InteractionPattern {
  const pattern = INTERACTION_PATTERNS[patternId];
  if (!pattern) {
    throw new Error(`Unknown interaction pattern: ${patternId}`);
  }
  return pattern;
}

export function getAvailablePatterns(): InteractionPattern[] {
  return Object.values(INTERACTION_PATTERNS);
}

// ============================================================================
// ADVISOR SELECTION FOR PATTERNS
// ============================================================================

export function selectAdvisorsForPhase(
  allAdvisors: CouncilAdvisorExtended[],
  phase: number,
  advisorCount: number
): CouncilAdvisorExtended[] {
  // For celebrity interview: 
  // Phase 1: First 3 non-facilitator advisors
  // Phase 2: Next 3 non-facilitator advisors
  
  console.log(`🔮 selectAdvisorsForPhase: allAdvisors count=${allAdvisors.length}, phase=${phase}, advisorCount=${advisorCount}`);
  console.log(`🔮 All advisor names:`, allAdvisors.map(a => a.name));
  
  const facilitatorIndex = 0; // Head advisor is always first
  const nonFacilitatorAdvisors = allAdvisors.slice(1); // Skip facilitator
  
  console.log(`🔮 Non-facilitator advisors:`, nonFacilitatorAdvisors.map(a => a.name));
  
  const startIndex = (phase - 1) * advisorCount;
  const selectedAdvisors = nonFacilitatorAdvisors.slice(startIndex, startIndex + advisorCount);
  
  console.log(`🔮 Selected advisors for phase ${phase}:`, selectedAdvisors.map(a => a.name));
  console.log(`🔮 Selected advisor IDs:`, selectedAdvisors.map(a => a.id));
  
  return selectedAdvisors;
}

// ============================================================================
// LLM PROMPT GENERATION
// ============================================================================

export function createVisionQuestionPrompt(input: VisionQuestionGenerationInput): string {
  const { originalVision, originalValues, facilitator, advisors, phase, previousResponses, interactionPattern } = input;
  
  // Debug logging
  console.log('🔮 createVisionQuestionPrompt - advisors received:', advisors);
  console.log('🔮 Advisor IDs:', advisors.map(a => ({ name: a.name, id: a.id })));
  
  const phaseConfig = interactionPattern.phases[phase - 1];
  if (!phaseConfig) {
    throw new Error(`Phase ${phase} not found in interaction pattern ${interactionPattern.id}`);
  }
  
  // Validate advisor data
  if (!advisors || advisors.length === 0) {
    throw new Error('No advisors provided for vision clarification');
  }
  
  if (advisors.some(a => !a.id)) {
    console.error('🔮 Advisors missing IDs:', advisors.map(a => ({ name: a.name, id: a.id })));
    throw new Error('Advisors must have valid IDs for vision clarification');
  }
  
  const advisorContext = advisors.map(advisor => {
    // Provide FULL advisor context like the Council system does
    // Safely stringify character specification
    let characterSpecString = '';
    try {
      if (advisor.characterSpec && typeof advisor.characterSpec === 'object') {
        characterSpecString = JSON.stringify(advisor.characterSpec, null, 2);
      } else {
        characterSpecString = 'Basic character specification available';
      }
    } catch (error) {
      console.warn('Error stringifying character specification:', error);
      characterSpecString = 'Character specification available but not fully detailed';
    }
    
    return `**${advisor.name}** (${advisor.type})
- Lens: "${advisor.lens}"

**FULL CHARACTER SPECIFICATION:**
${characterSpecString}`;
  }).join('\n\n');
  
  const previousContext = previousResponses && previousResponses.length > 0 
    ? `\n\n**Previous User Responses:**
${previousResponses.map(r => `Q: [Previous question]\nA: ${r.response}`).join('\n\n')}`
    : '';
  
  return `**${interactionPattern.name} - ${phaseConfig.name}**

You are ${facilitator.name}, facilitating a vision clarification session using the "${interactionPattern.name}" pattern.

**USER'S ORIGINAL VISION:** "${originalVision}"

**USER'S DECLARED VALUES:** ${originalValues.join(', ')}

**PARTICIPATING ADVISORS:**
${advisorContext}

**ADVISOR IDS FOR QUESTIONS:**
${advisors.map(a => `- ${a.name}: "${a.id}"`).join('\n')}

${phaseConfig.questionPrompt}${previousContext}

**CRITICAL**: Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "questions": [
    {
      "advisorId": "${advisors[0].id}",
      "question": "Thoughtful question from ${advisors[0].name}'s perspective..."
    },
    {
      "advisorId": "${advisors[1].id}",
      "question": "Thoughtful question from ${advisors[1].name}'s perspective..."
    },
    {
      "advisorId": "${advisors[2].id}",
      "question": "Thoughtful question from ${advisors[2].name}'s perspective..."
    }
  ],
  "facilitatorSummary": "Brief summary of this phase's focus as the facilitator"
}
\`\`\`

**CRITICAL INSTRUCTIONS:**
1. You MUST use the exact advisorId values shown above: "${advisors[0].id}", "${advisors[1].id}", "${advisors[2].id}"
2. Do NOT change these IDs or make up new ones
3. Do NOT use "undefined" or any other value
4. Each question must have the exact advisorId from the list above

Each question should:
- **Embody the advisor's authentic voice**: Use their documented speaking style, personality traits, and approach to advice
- **Focus on S.M.A.R.T. clarity**: Drive toward specific, measurable, achievable, relevant, and time-bound details
- **Leverage their expertise**: Draw from their unique lens and knowledge domains
- **Be actionable**: Help identify concrete steps, metrics, resources, and timelines (not just philosophical insights)
- **Reflect their character**: Reference their key beliefs, background, or notable perspectives naturally

**VOICE AUTHENTICITY**: Each advisor should sound distinctly like themselves - use their documented speaking patterns, characteristic phrases, and approach to advice. Avoid generic interviewer questions.`;
}

export function createVisionSynthesisPrompt(input: VisionSynthesisInput): string {
  const { originalVision, originalValues, allQuestions, allResponses, facilitator, interactionPattern } = input;
  
  const conversationFlow = allQuestions.map(q => {
    const response = allResponses.find(r => r.questionId === q.id);
    return `**${q.advisorName}:** ${q.question}
**User:** ${response?.response || '[No response]'}`;
  }).join('\n\n');
  
  return `**Vision Synthesis - ${interactionPattern.name}**

You are ${facilitator.name}, synthesizing a powerful vision clarification conversation into a S.M.A.R.T. objective.

**ORIGINAL VISION:** "${originalVision}"
**DECLARED VALUES:** ${originalValues.join(', ')}

**COMPLETE CONVERSATION:**
${conversationFlow}

**YOUR TASK:** Synthesize this conversation into a comprehensive S.M.A.R.T. objective that captures:
- The enriched vision based on the user's responses
- Clear, actionable objectives
- Practical implementation insights
- Success measures and constraints

**CRITICAL**: Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "smartObjective": {
    "specific": "Clear, specific description of what will be achieved",
    "measurable": ["Specific metrics and measures"],
    "achievable": "Why this is realistic and achievable",
    "relevant": "Why this matters and its significance",
    "timeBound": "Timeline, milestones, and time constraints",
    "assumptions": ["Key assumptions identified from the conversation"],
    "successMetrics": ["Specific success indicators"],
    "futureState": "Detailed description of the successful future state",
    "constraints": ["Known limitations or constraints"],
    "stakeholders": ["Key stakeholders identified"],
    "risks": ["Potential risks and challenges"]
  },
  "facilitatorSummary": "Your summary as the facilitator of key insights gained",
  "keyInsights": ["Most important insights from the conversation"],
  "recommendedNextSteps": ["Specific next steps toward implementation"]
}
\`\`\`

Focus on creating a S.M.A.R.T. objective that is both inspiring and actionable, grounded in the user's responses and your council's wisdom.`;
}
