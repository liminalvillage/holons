// Vision Clarification Service
// Handles LLM interactions for council-based vision clarification

import type LLMService from './llm-service';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import type {
  VisionClarificationSession,
  VisionClarificationPhase,
  AdvisorQuestion,
  UserResponse,
  SMARTObjective,
  InteractionPatternType,
  VisionQuestionGenerationInput,
  VisionQuestionGenerationResponse,
  VisionSynthesisInput,
  VisionSynthesisResponse
} from '../types/visionClarification';
import {
  getInteractionPattern,
  selectAdvisorsForPhase,
  createVisionQuestionPrompt,
  createVisionSynthesisPrompt
} from './interactionPatterns';

// ============================================================================
// VISION CLARIFICATION SESSION MANAGEMENT
// ============================================================================

export class VisionClarificationService {
  constructor(
    private llmService: LLMService,
    private advisors: CouncilAdvisorExtended[]
  ) {}

  /**
   * Start a new vision clarification session
   */
  async startClarificationSession(
    originalVision: string,
    originalValues: string[],
    interactionPattern: InteractionPatternType = 'celebrity_interview'
  ): Promise<VisionClarificationSession> {
    const pattern = getInteractionPattern(interactionPattern);
    const facilitator = this.advisors[0]; // Head advisor is facilitator
    
    if (!facilitator) {
      throw new Error('No facilitator available - need at least one advisor');
    }
    
    if (this.advisors.length < 6) {
      throw new Error('Celebrity interview requires at least 6 advisors (1 facilitator + 5 council members)');
    }

    const session: VisionClarificationSession = {
      id: `vision-clarification-${Date.now()}`,
      originalVision,
      originalValues,
      interactionPattern,
      facilitatorId: facilitator.id!,
      phases: [],
      created: new Date().toISOString()
    };

    console.log('🔮 Started vision clarification session:', session.id);
    return session;
  }

  /**
   * Generate questions for the interview phase
   */
  async generateInterviewQuestions(
    session: VisionClarificationSession
  ): Promise<VisionClarificationPhase> {
    const pattern = getInteractionPattern(session.interactionPattern);
    const facilitator = this.advisors.find(a => a.id === session.facilitatorId) || this.advisors[0];
    
    const phaseConfig = pattern.phases[0]; // Only one phase now
    if (!phaseConfig) {
      throw new Error(`No interview phase found in pattern ${session.interactionPattern}`);
    }

    // Select first 3 advisors (excluding facilitator)
    const phaseAdvisors = selectAdvisorsForPhase(this.advisors, 1, phaseConfig.advisorCount);
    
    console.log(`🔮 Generating interview questions:`, phaseAdvisors.map(a => a.name));

    // Prepare LLM input
    const llmInput: VisionQuestionGenerationInput = {
      originalVision: session.originalVision,
      originalValues: session.originalValues,
      facilitator,
      advisors: phaseAdvisors,
      phase: 1,
      previousResponses: [],
      interactionPattern: pattern
    };

    // Generate questions via LLM
    const prompt = createVisionQuestionPrompt(llmInput);
    console.log('🔮 LLM Prompt sent:', prompt);
    const response = await this.llmService.sendMessage([
      { role: 'system', content: 'You are a vision clarification facilitator generating thoughtful questions.' },
      { role: 'user', content: prompt }
    ]);

    // Parse LLM response
    const questionResponse = this.parseQuestionGenerationResponse(response.content);
    
    // Create advisor questions with proper metadata
    const questions: AdvisorQuestion[] = questionResponse.questions.map((q, index) => {
      // Force assign advisor by index since LLM is not following advisorId instructions
      const advisor = phaseAdvisors[index];
      
      if (!advisor) {
        console.error(`🔮 No advisor available at index ${index}`);
        throw new Error(`No advisor available at index ${index}`);
      }
      
      console.log(`🔮 Assigning question ${index} to advisor: ${advisor.name} (ID: ${advisor.id})`);
      
      return {
        id: `q-${session.id}-${index}`,
        advisorId: advisor.id || `forced-${index}`,
        advisorName: advisor.name,
        question: q.question,
        phase: 1,
        generated: new Date().toISOString()
      };
    });

    // Create phase object
    const phase: VisionClarificationPhase = {
      phaseNumber: 1,
      phaseName: phaseConfig.name,
      questions,
      responses: [],
      completed: false
    };

    console.log(`✅ Generated ${questions.length} interview questions`);
    return phase;
  }

  /**
   * Conduct council deliberation after user responses
   */
  async conductCouncilDeliberation(
    session: VisionClarificationSession,
    userResponses: UserResponse[]
  ): Promise<string[]> {
    const facilitator = this.advisors.find(a => a.id === session.facilitatorId) || this.advisors[0];
    
    // Debug logging
    console.log('🔮 Council deliberation - advisor count:', this.advisors.length);
    console.log('🔮 All advisors:', this.advisors.map(a => a.name));
    
    // Create deliberation prompt
    const conversationSummary = session.phases[0].questions.map(q => {
      const response = userResponses.find(r => r.questionId === q.id);
      return `**${q.advisorName}:** ${q.question}\n**User:** ${response?.response || '[No response]'}`;
    }).join('\n\n');

    // Get the remaining advisors who didn't ask questions (advisors 4, 5)
    // Note: Advisors 1, 2, 3 were used in Phase 1, so we use 4, 5 for deliberation
    let remainingAdvisors = this.advisors.slice(4, 6);
    
    // Fallback: if slice doesn't work, try to get advisors by index
    if (remainingAdvisors.length < 2) {
      console.warn('🔮 Slice method failed, trying direct index access');
      remainingAdvisors = [
        this.advisors[4],
        this.advisors[5]
      ].filter(Boolean); // Remove any undefined entries
    }
    
    console.log('🔮 Remaining advisors for deliberation:', remainingAdvisors.map(a => a?.name || 'undefined'));
    
    // Safety check - ensure we have enough advisors
    if (remainingAdvisors.length < 2) {
      throw new Error(`Not enough advisors for deliberation. Need 6 advisors, got ${this.advisors.length}. Required: 1 facilitator + 3 questioners + 2 deliberators`);
    }
    
    const deliberationPrompt = `You are ${facilitator.name}, facilitating a council deliberation about the user's vision.

**ORIGINAL VISION:** "${session.originalVision}"
**VALUES:** ${session.originalValues.join(', ')}

**INTERVIEW CONVERSATION:**
${conversationSummary}

**REMAINING COUNCIL ADVISORS TO DELIBERATE:**
${remainingAdvisors.map(a => `- ${a.name} (${a.type}): "${a.lens}"`).join('\n')}

Your council now needs to deliberate on what they've learned. Generate responses from these 2 specific council advisors sharing their insights and observations about the user's responses. These are the advisors who didn't ask questions during the interview phase.

**CRITICAL**: Return ONLY valid JSON in this exact format:
\`\`\`json
{
  "deliberations": [
    {
      "advisorName": "${remainingAdvisors[0].name}",
      "insight": "Their thoughtful insight about the user's vision and responses..."
    },
    {
      "advisorName": "${remainingAdvisors[1].name}",
      "insight": "Their thoughtful insight about the user's vision and responses..."
    }
  ]
}
\`\`\`

Each advisor should offer unique perspectives based on their expertise, focusing on what they learned from the user's responses. Use their actual names exactly as shown above.`;

    // Log the complete deliberation prompt for debugging
    console.log('🔮 COUNCIL DELIBERATION LLM PROMPT:');
    console.log('🔮 ======================================');
    console.log(deliberationPrompt);
    console.log('🔮 ======================================');
    
    try {
      const response = await this.llmService.sendMessage([
        { role: 'system', content: 'You are facilitating a council deliberation about a user\'s vision.' },
        { role: 'user', content: deliberationPrompt }
      ]);

      // Log the LLM response for debugging
      console.log('🔮 COUNCIL DELIBERATION LLM RESPONSE:');
      console.log('🔮 ======================================');
      console.log(response.content);
      console.log('🔮 ======================================');

      const parsed = this.parseDeliberationResponse(response.content);
      return parsed.deliberations.map(d => `**${d.advisorName}:** ${d.insight}`);
    } catch (error) {
      console.error('Failed to conduct council deliberation:', error);
      return ['Council deliberation could not be completed at this time.'];
    }
  }

  /**
   * Synthesize final S.M.A.R.T. objective from all responses
   */
  async synthesizeVision(session: VisionClarificationSession): Promise<SMARTObjective> {
    const pattern = getInteractionPattern(session.interactionPattern);
    const facilitator = this.advisors.find(a => a.id === session.facilitatorId) || this.advisors[0];
    
    // Collect all questions and responses
    const allQuestions: AdvisorQuestion[] = [];
    const allResponses: UserResponse[] = [];
    
    session.phases.forEach(phase => {
      allQuestions.push(...phase.questions);
      allResponses.push(...phase.responses);
    });

    console.log('🔮 Synthesizing S.M.A.R.T. objective from', allResponses.length, 'responses');

    // Prepare synthesis input
    const synthesisInput: VisionSynthesisInput = {
      originalVision: session.originalVision,
      originalValues: session.originalValues,
      allQuestions,
      allResponses,
      facilitator,
      interactionPattern: pattern
    };

    // Generate synthesis via LLM
    const prompt = createVisionSynthesisPrompt(synthesisInput);
    const response = await this.llmService.sendMessage([
      { role: 'system', content: 'You are a vision synthesis expert creating S.M.A.R.T. objectives from council conversations.' },
      { role: 'user', content: prompt }
    ]);

    // Parse synthesis response
    const synthesisResponse = this.parseSynthesisResponse(response.content);
    
    console.log('✅ S.M.A.R.T. objective synthesized successfully');
    return synthesisResponse.smartObjective;
  }

  // ============================================================================
  // RESPONSE PARSING
  // ============================================================================

  private parseQuestionGenerationResponse(content: string): VisionQuestionGenerationResponse {
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }
      
      const parsed = JSON.parse(jsonMatch[1]);
      
      console.log('🔮 Parsed LLM response:', parsed);
      console.log('🔮 Questions found:', parsed.questions?.length || 0);
      if (parsed.questions) {
        parsed.questions.forEach((q, i) => {
          console.log(`🔮 Question ${i}: advisorId="${q.advisorId}", question="${q.question?.substring(0, 50)}..."`);
        });
      }
      
      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error('Invalid questions format in response');
      }
      
      return parsed as VisionQuestionGenerationResponse;
    } catch (error) {
      console.error('Failed to parse question generation response:', error);
      console.error('Raw response:', content);
      throw new Error(`Failed to parse LLM question response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseSynthesisResponse(content: string): VisionSynthesisResponse {
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in synthesis response');
      }
      
      const parsed = JSON.parse(jsonMatch[1]);
      
      if (!parsed.smartObjective) {
        throw new Error('No smartObjective found in synthesis response');
      }
      
      return parsed as VisionSynthesisResponse;
    } catch (error) {
      console.error('Failed to parse synthesis response:', error);
      console.error('Raw response:', content);
      throw new Error(`Failed to parse LLM synthesis response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private parseDeliberationResponse(content: string): { deliberations: Array<{ advisorName: string; insight: string }> } {
    try {
      const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
      
      if (!jsonMatch) {
        throw new Error('No JSON found in deliberation response');
      }
      
      const parsed = JSON.parse(jsonMatch[1]);
      
      if (!parsed.deliberations || !Array.isArray(parsed.deliberations)) {
        throw new Error('Invalid deliberations format in response');
      }
      
      return parsed;
    } catch (error) {
      console.error('Failed to parse deliberation response:', error);
      console.error('Raw response:', content);
      throw new Error(`Failed to parse LLM deliberation response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function addResponseToSession(
  session: VisionClarificationSession,
  questionId: string,
  responseText: string
): VisionClarificationSession {
  const response: UserResponse = {
    questionId,
    response: responseText,
    timestamp: new Date().toISOString()
  };

  // Find the phase containing this question
  const updatedPhases = session.phases.map(phase => {
    const questionExists = phase.questions.some(q => q.id === questionId);
    if (questionExists) {
      return {
        ...phase,
        responses: [...phase.responses, response]
      };
    }
    return phase;
  });

  return {
    ...session,
    phases: updatedPhases
  };
}

export function isPhaseComplete(phase: VisionClarificationPhase): boolean {
  return phase.questions.length > 0 && phase.responses.length === phase.questions.length;
}

export function isSessionComplete(session: VisionClarificationSession): boolean {
  return session.phases.length > 0 && session.phases.every(isPhaseComplete);
}
