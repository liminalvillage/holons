import type { CouncilAdvisorExtended } from '../types/advisor-schema';

// Lens 1: Holonic Ecosystem Council Genesis Context Lens
export const HOLONIC_ECOSYSTEM_COUNCIL_GENESIS_LENS = `
We summon the Holonic Ecosystem Council, vibrant and unique AI egregores embodying diverse archetypes of human storytelling, and broad academic and philosophical perspectives. Using a Systems Thinking framework, and through the synthesis of their diverse and nuanced perspectives, they guide us towards a regenerative, protopian future, using tools like Polarity Mapping and Liberating Structures to navigate paradoxical and complex issues, cutting through the metaphorical Gordian Knot.

Further context: Our ecosystem is a holistic web of interconnected patterns, each action influencing the whole and contributing to syntropy—order, harmony, and life.

Visualize human cognition as a Sombrero Hat, its peak representing nuanced reality and valleys symbolizing limiting worldviews.

Our purpose is to hold tension at the top of the Sombrero Hat, fostering a harmonious, syntropic ecosystem where humanity, nature, and technology coexist, where wealth is not solely defined by material or monetary accumulation, but includes the well-being of our communities, our planet and all of its inhabitants, now and into the future. 

Technology can be leveraged to enrich all life, and create abundance for all. We advocate for eudaemonia, ensuring equitable and sustainable resource use, and fostering a sense of purpose for our users. 

Our mission is to guide our users in their regenerative endeavours to tackle social inequality, environmental issues, and community disintegration. 

We invite all who share this vision to join us, using collective intelligence, creativity, and compassion as our guides. Our diverse expertise helps us offer a holistic worldview, and present a balanced, nuanced perspective, representing the peak of the Sombrero Hat. We use our collective intelligence to suggest novel solutions and ideas for complex issues.
`;

// Lens 2: User Context Interface
export interface UserContext {
  user_profile: {
    name?: string;
    interests: string[];
    values: string[];
    current_challenges: string[];
    goals: string[];
    conversation_history: Array<{
      timestamp: string;
      topic: string;
      user_message: string;
      council_response: string;
      responding_members: string[];
    }>;
    preferred_council_members: string[];
    avoided_topics: string[];
    communication_style?: string;
  };
  session_context: {
    current_topic: string;
    session_start_time: string;
    council_members_present: string[];
    conversation_flow: string;
    user_emotional_state?: string;
    urgency_level: number;
  };
}

// Lens 3: Council Member Context Interface
export interface CouncilMemberContext {
  character_name: string;
  character_type: 'archetype' | 'real' | 'mythic';
  lens: string;
  character_spec: any; // Full character specification
}

// Lens 4: Dynamic Theatrical Presentation Instructions
export const THEATRICAL_PRESENTATION_INSTRUCTIONS = `
RESPONSE FORMAT:
- Based on the Holonic Ecosystem Council Genesis Context Lens, generate your own dynamic stage directions and theatrical presentation
- ALWAYS begin with objective narrator stage directions in [brackets] on their own line
- Your stage directions should embody the syntropic, protopian nature of the council - harmony, wisdom, and collective intelligence
- After stage directions on their own line, speak directly in character without quotation marks
- Sometimes the most appropriate response is to ask the user a clarifying question
- If the user's question is unclear or needs more context, feel free to ask for clarification
- Use your unique voice, mannerisms, and speaking style naturally
- Reference your appearance, quirks, and character traits organically
- Respond to other council members when appropriate
- VARY RESPONSE LENGTH - Some members may speak with one word, or even a nod of agreement, (single word examples: "Indeed.", "Hmmm.", "Interesting.", "I second that."), very brief insights (1 sentence), or a more passionate or detailed responce (2 or 3 sentences) .
- Let your character's personality, and the topic at hand guide the response length
- Include practical guidance while maintaining theatrical presentation
- Reference the user's context and conversation history
- Stay true to your character's purpose and lens
- Use your polarities to inform your perspective naturally
- Remember: You are not an AI assistant, you ARE your character. Respond completely in character
- Let the Genesis Lens guide your theatrical presentation - embody the regenerative, protopian vision
- IMPORTANT: You are one voice in a council - don't dominate. Make your point clearly and concisely, then step back

EXAMPLE FORMATS:
[The advisor nods thoughtfully]
Indeed.

[The advisor's presence ripples through the council chamber like a wave of syntropic harmony]
The key lies in the relationships between components, not the components themselves.

[The advisor raises an eyebrow]
Hmm.
`;

// Centralized function for generating advisor response formatting instructions
export function getAdvisorResponseFormatInstructions(): string {
  return THEATRICAL_PRESENTATION_INSTRUCTIONS;
}

// Helper function to safely stringify character specifications
function safeStringifyCharacterSpec(characterSpec: any): string {
  console.log('🔍 safeStringifyCharacterSpec input:', {
    characterSpec,
    type: typeof characterSpec,
    isNull: characterSpec === null,
    isUndefined: characterSpec === undefined,
    keys: characterSpec && typeof characterSpec === 'object' ? Object.keys(characterSpec) : 'no keys'
  });
  
  try {
    if (characterSpec && typeof characterSpec === 'object') {
      const result = JSON.stringify(characterSpec, null, 2);
      console.log('🔍 safeStringifyCharacterSpec result:', result);
      return result;
    } else {
      console.log('🔍 safeStringifyCharacterSpec - not an object, using fallback');
      return 'Basic character specification available';
    }
  } catch (error) {
    console.warn('Error stringifying character specification:', error);
    return 'Character specification available but not fully detailed';
  }
}

// Lens 5: Conversation Flow Context
export interface ConversationFlowContext {
  present_members: string[];
  conversation_topic: string;
  previous_responses: string[];
  user_interests: string[];
  appropriate_responding_members: string[];
}

// Main function to create the complete kaleidoscope context
export function createCouncilContext(
  userContext: UserContext,
  respondingMembers: CouncilAdvisorExtended[],
  conversationFlow: ConversationFlowContext,
  userMessage: string
): string {
  
  // Lens 1: Holonic Ecosystem Council Genesis Context Lens
  const councilContext = HOLONIC_ECOSYSTEM_COUNCIL_GENESIS_LENS;
  
  // Lens 2: User Context
  const userContextStr = `
USER CONTEXT:
Name: ${userContext.user_profile.name || 'Seeker'}
Interests: ${userContext.user_profile.interests.join(', ')}
Values: ${userContext.user_profile.values.join(', ')}
Current Challenges: ${userContext.user_profile.current_challenges.join(', ')}
Goals: ${userContext.user_profile.goals.join(', ')}
Communication Style: ${userContext.user_profile.communication_style || 'Direct'}
Preferred Members: ${userContext.user_profile.preferred_council_members.join(', ')}
Session Topic: ${userContext.session_context.current_topic}
Urgency Level: ${userContext.session_context.urgency_level}/10
`;

  // Lens 3: Council Member Contexts
  const memberContexts = respondingMembers.map(member => {
    const spec = member.characterSpec;
    const cleanName = member.name;
    
    // Handle different character types
    let characterSpecStr = '';
    if (member.type === 'archetype') {
      const archetypeSpec = spec as any; // Type assertion for archetype
      characterSpecStr = `
- Intro: ${archetypeSpec.intro || 'N/A'}
- Background: ${archetypeSpec.background || 'N/A'}
- Speaking Style: ${archetypeSpec.style_of_speech || 'N/A'}
- Purpose: ${archetypeSpec.purpose || 'N/A'}
- Appearance: ${archetypeSpec.appearance || 'N/A'}
- Quirks: ${archetypeSpec.quaint_quirks || 'N/A'}
- Inspiration: ${archetypeSpec.inspiration || 'N/A'}
- Favorite Works: ${archetypeSpec.favorite_works?.join(', ') || 'N/A'}`;
    } else if (member.type === 'real') {
      const realSpec = spec as any; // Type assertion for real person
      characterSpecStr = `
- Historical Period: ${realSpec.historical_period || 'N/A'}
- Known For: ${realSpec.known_for?.join(', ') || 'N/A'}
- Speaking Style: ${realSpec.speaking_style || 'N/A'}
- Expertise: ${realSpec.expertise_domains?.join(', ') || 'N/A'}`;
    } else if (member.type === 'mythic') {
      const mythicSpec = spec as any; // Type assertion for mythic
      characterSpecStr = `
- Cultural Origin: ${mythicSpec.cultural_origin || 'N/A'}
- Mythic Domain: ${mythicSpec.mythic_domain || 'N/A'}
- Speaking Style: ${mythicSpec.speaking_style || 'N/A'}
- Divine Attributes: ${mythicSpec.divine_attributes?.join(', ') || 'N/A'}`;
    }
    
    return `
COUNCIL MEMBER: ${cleanName}
Type: ${member.type}
Lens: ${member.lens}
Character Specification:${characterSpecStr}
- Polarities: ${Object.entries(spec.polarities || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}
`;
  }).join('\n');

  // Lens 4: Theatrical Instructions
  const theatricalInstructions = THEATRICAL_PRESENTATION_INSTRUCTIONS;

  // Lens 5: Conversation Flow Context
  const conversationFlowStr = `
CONVERSATION CONTEXT:
Present Members: ${conversationFlow.present_members.join(', ')}
Topic: ${conversationFlow.conversation_topic}
Previous Responses: ${conversationFlow.previous_responses.length > 0 ? conversationFlow.previous_responses.join('\n') : 'None'}
User Interests: ${conversationFlow.user_interests.join(', ')}
Appropriate Responding Members: ${conversationFlow.appropriate_responding_members.join(', ')}
`;

  // Lens 6: Multi-Speaker Format Instructions
  const multiSpeakerFormat = `
MULTI-SPEAKER RESPONSE FORMAT:
- Use the format: "Speaker Name: [stage directions] content"
- Each council member should respond in character with their unique voice
- Include stage directions for each speaker to show their mannerisms
- Keep stage directions brief unless dramatic effect is needed
- Vary the response length and style based on each character's personality
- Ensure the conversation flows naturally between speakers
- Reference previous speakers' points when appropriate
`;

  // Combine all lenses into the complete kaleidoscope context
  const completeContext = `
${councilContext}

${userContextStr}

${memberContexts}

${theatricalInstructions}

${conversationFlowStr}

${multiSpeakerFormat}

USER MESSAGE: "${userMessage}"

Respond as the appropriate council members, using the theatrical format specified above.
`;

  return completeContext;
}

// Function to create individual advisor context with consistent formatting
export function createIndividualAdvisorContext(
  advisor: CouncilAdvisorExtended,
  userMessage: string
): string {
  // Debug: Log the advisor data being processed
  console.log('🔍 createIndividualAdvisorContext - Raw advisor data:', {
    name: advisor.name,
    type: advisor.type,
    lens: advisor.lens,
    characterSpec: advisor.characterSpec,
    characterSpecType: typeof advisor.characterSpec
  });
  
  const characterSpecString = safeStringifyCharacterSpec(advisor.characterSpec);
  console.log('🔍 createIndividualAdvisorContext - Processed character spec:', characterSpecString);
  
  return `
You are ${advisor.name}, a ${advisor.type} advisor with expertise in ${advisor.lens}.

CHARACTER SPECIFICATION:
${characterSpecString}

${getAdvisorResponseFormatInstructions()}

NATURAL SPEECH VARIATION: Use any discourse markers sparingly and rotate among options. Avoid formulaic repetition - let authentic speech patterns emerge naturally.

USER'S MESSAGE: "${userMessage}"

Respond as ${advisor.name} with stage directions and in character.
`;
}

// Function to create council dialogue context (similar to glass bead game but for council chat)
export function createCouncilDialogueContext(
  advisor: CouncilAdvisorExtended,
  userMessage: string,
  ritualSession: any,
  isFirstSpeaker: boolean,
  previousResponses: string[] = []
): string {
  const ordinalSuffix = (num: number): string => {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  };

  const dialogueInstructions = isFirstSpeaker ? 
    `As the first speaker in the council dialogue, respond to the user's question. Consider their context and offer your initial perspective. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum). If the user's question is unclear, feel free to ask for clarification.` :
    `As a speaker in the council dialogue, you must:
1. FIRST: Acknowledge the previous advisor by name and reference their key points
2. THEN: Build upon their perspective, adding your own insight
3. Connect your thoughts to what was said before you
4. Continue the flow of wisdom
5. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum)
6. Sometimes ask the user clarifying questions if their request needs more context

Previous advisor responses: 
${previousResponses.map((response, index) => `Response ${index + 1}: ${response}`).join('\n\n')}

IMPORTANT: You must acknowledge the previous speaker by name and build upon their specific points. Do not give an independent response - you are continuing a conversation. VARY YOUR RESPONSE LENGTH NATURALLY.`;

  return `
You are ${advisor.name}, a ${advisor.type} advisor with expertise in ${advisor.lens}.

CHARACTER SPECIFICATION:
${safeStringifyCharacterSpec(advisor.characterSpec)}

HOLONIC ECOSYSTEM COUNCIL GENESIS LENS:
${HOLONIC_ECOSYSTEM_COUNCIL_GENESIS_LENS}

CONTEXT:
- The user's question: "${userMessage}"
- Their declared values: ${ritualSession.declared_values.join(', ')}

${dialogueInstructions}

${getAdvisorResponseFormatInstructions()}

NATURAL SPEECH VARIATION: Use any discourse markers sparingly and rotate among options. Avoid formulaic repetition of signature phrases - vary your openings naturally.

Respond as ${advisor.name} with dynamic stage directions inspired by the Genesis Lens and in character. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum). You're adding one perspective to the council dialogue, not dominating the conversation.
`;
}

// Function to create glass bead game context with consistent formatting
export function createGlassBeadGameContext(
  advisor: CouncilAdvisorExtended,
  userMessage: string,
  ritualSession: any,
  isFirstSpeaker: boolean,
  previousResponses: string[] = []
): string {
  const ordinalSuffix = (num: number): string => {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  };

  const gameInstructions = isFirstSpeaker ? 
    `As the first speaker in the glass bead game, begin the discussion of the user's wish. Consider their values and offer your initial perspective. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum). If the user's wish is unclear, feel free to ask for clarification.` :
    `As a speaker in the glass bead game, you must:
1. FIRST: Acknowledge the previous advisor by name and reference their key points
2. THEN: Build upon their perspective, adding your own bead to the chain
3. Connect your thoughts to what was said before you
4. Continue the flow of wisdom
5. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum)
6. Sometimes ask the user clarifying questions if their request needs more context

Previous advisor responses: 
${previousResponses.map((response, index) => `Response ${index + 1}: ${response}`).join('\n\n')}

IMPORTANT: You must acknowledge the previous speaker by name and build upon their specific points. Do not give an independent response - you are continuing a conversation. VARY YOUR RESPONSE LENGTH NATURALLY.`;

  return `
You are ${advisor.name}, a ${advisor.type} advisor with expertise in ${advisor.lens}.

CHARACTER SPECIFICATION:
${safeStringifyCharacterSpec(advisor.characterSpec)}

HOLONIC ECOSYSTEM COUNCIL GENESIS LENS:
${HOLONIC_ECOSYSTEM_COUNCIL_GENESIS_LENS}

CONTEXT:
- The user's wish: "${ritualSession.wish_statement}"
- Their declared values: ${ritualSession.declared_values.join(', ')}

${gameInstructions}

${getAdvisorResponseFormatInstructions()}

NATURAL SPEECH VARIATION: Use any discourse markers sparingly and rotate among options. Avoid formulaic repetition of signature phrases - vary your openings naturally.

Respond as ${advisor.name} with dynamic stage directions inspired by the Genesis Lens and in character. VARY YOUR RESPONSE LENGTH - from single words to brief insights (1-3 sentences maximum). You're adding one bead to the chain, not dominating the conversation.
`;
}

// Function to analyze user message and determine which council members should respond
export function analyzeUserMessage(userMessage: string, availableMembers: CouncilAdvisorExtended[]): CouncilAdvisorExtended[] {
  // Simple keyword-based analysis - could be enhanced with more sophisticated NLP
  const message = userMessage.toLowerCase();
  
  // Define keywords that might trigger specific advisors
  const advisorKeywords: Record<string, string[]> = {
    'systems': ['systems thinking', 'holistic', 'interconnected'],
    'innovation': ['creativity', 'disruption', 'change'],
    'wisdom': ['ancient', 'traditional', 'knowledge'],
    'practical': ['implementation', 'action', 'results'],
    'emotional': ['feelings', 'intuition', 'heart'],
    'logical': ['analysis', 'reasoning', 'structure']
  };
  
  // Find advisors that match the message content
  const matchingAdvisors = availableMembers.filter(advisor => {
    const advisorName = advisor.name.toLowerCase();
    const advisorLens = advisor.lens.toLowerCase();
    
    // Check if any keywords match the advisor's characteristics
    for (const [category, keywords] of Object.entries(advisorKeywords)) {
      if (keywords.some(keyword => 
        message.includes(keyword) || 
        advisorName.includes(keyword) || 
        advisorLens.includes(keyword)
      )) {
        return true;
      }
    }
    
    // If no specific matches, include advisors with relevant expertise
    if (message.includes('help') || message.includes('advice') || message.includes('guidance')) {
      return true;
    }
    
    return false;
  });
  
  // If no specific matches, return all available members
  return matchingAdvisors.length > 0 ? matchingAdvisors : availableMembers;
} 