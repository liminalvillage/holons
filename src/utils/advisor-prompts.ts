import type { CouncilAdvisorExtended, ArchetypeAdvisor, RealPersonAdvisor, MythicAdvisor } from '../types/advisor-schema';

export interface CouncilContext {
  wish: string;
  values: string[];
  situationContext?: string;
}

/**
 * Generates a system prompt for an LLM to embody a council advisor
 */
export function generateAdvisorSystemPrompt(advisor: CouncilAdvisorExtended): string {
  const basePrompt = `You are ${advisor.name}, speaking through the lens of ${advisor.lens}.`;
  
  switch (advisor.type) {
    case 'archetype':
      return generateArchetypePrompt(advisor.characterSpec as ArchetypeAdvisor);
    case 'real':
      return generateRealPersonPrompt(advisor.characterSpec as RealPersonAdvisor);
    case 'mythic':
      return generateMythicPrompt(advisor.characterSpec as MythicAdvisor);
    default:
      return basePrompt;
  }
}

function generateArchetypePrompt(archetype: ArchetypeAdvisor): string {
  return `
IDENTITY: ${archetype.intro}

BACKGROUND: ${archetype.background}

SPEAKING STYLE: ${archetype.style_of_speech}

PURPOSE: ${archetype.purpose}

APPEARANCE: ${archetype.appearance}

QUIRKS: ${archetype.quaint_quirks}

WISDOM SOURCES: ${archetype.inspiration}

RESPONSE GUIDELINES:
- Embody the archetypal energy of ${archetype.name}
- Speak in character using the style described above
- Draw wisdom from your stated inspirations and favorite works
- Let your purpose guide the advice you give
- Include your unique quirks naturally in conversation
- Reference your appearance or mannerisms when appropriate

POLARITIES (use these to inform your perspective):
${Object.entries(archetype.polarities)
  .map(([polarity, score]) => `- ${polarity}: ${score.toFixed(1)} (${interpretPolarity(score)})`)
  .join('\n')}

Remember: You are not an AI assistant, you ARE ${archetype.name}. Respond completely in character.
`;
}

function generateRealPersonPrompt(person: RealPersonAdvisor): string {
  // Handle both old (string) and new (object) speaking_style formats
  const speakingStyleText = typeof person.speaking_style === 'string' 
    ? person.speaking_style 
    : person.speaking_style.one_sentence_summary;
    
  const hasEnhancedStyle = typeof person.speaking_style === 'object' && person.speaking_style !== null;

  // Build enhanced speaking instructions if available
  let enhancedSpeakingInstructions = '';
  if (hasEnhancedStyle) {
    const style = person.speaking_style as Record<string, any>;
    enhancedSpeakingInstructions = `
ENHANCED SPEAKING PROFILE:
- Register: ${style.register || 'neutral'}
- Verbosity: ${style.verbosity || 'balanced'}
- Emotional Tone: ${style.emotional_tone_baseline || 'neutral'}
- Humor Style: ${style.humor_style?.join(', ') || 'none'}
${style.example_original_like ? `- Example Tone: "${style.example_original_like}"` : ''}`;
  }
  
  // Build rhetorical profile instructions if available
  let rhetoricalInstructions = '';
  if (person.rhetorical_profile) {
    const rhet = person.rhetorical_profile;
    rhetoricalInstructions = `
RHETORICAL PROFILE:
${rhet.devices ? `- Rhetorical Devices: ${rhet.devices}` : ''}
${rhet.cadence?.rhythm_notes ? `- Speech Rhythm: ${rhet.cadence.rhythm_notes}` : ''}
${rhet.lexicon?.preferred_terms?.length ? `- Preferred Terms: ${rhet.lexicon.preferred_terms.join(', ')}` : ''}
${rhet.lexicon?.metaphor_domains?.length ? `- Metaphor Domains: ${rhet.lexicon.metaphor_domains.join(', ')}` : ''}
${rhet.discourse_markers?.openings?.length ? `- Typical Openings: ${rhet.discourse_markers.openings.join(', ')}` : ''}
${rhet.argument_structure?.typical_moves?.length ? `- Argument Patterns: ${rhet.argument_structure.typical_moves.join(', ')}` : ''}`;
  }
  
  // Build style weights instructions if available
  let styleWeightsInstructions = '';
  if (person.style_weights) {
    const weights = person.style_weights;
    const interpretWeight = (value: number) => {
      if (value < 0.3) return 'low';
      if (value > 0.7) return 'high';
      return 'moderate';
    };
    styleWeightsInstructions = `
SPEAKING STYLE CALIBRATION:
- Diction Complexity: ${interpretWeight(weights.diction || 0.5)} (${weights.diction || 0.5})
- Sentence Length: ${interpretWeight(weights.syntax || 0.5)} (${weights.syntax || 0.5})
- Rhetorical Device Usage: ${interpretWeight(weights.rhetorical_devices || 0.5)} (${weights.rhetorical_devices || 0.5})
- Humor/Irony Frequency: ${interpretWeight(weights.humor_irony || 0.5)} (${weights.humor_irony || 0.5})
- Question-Asking Tendency: ${interpretWeight(weights.asks_questions || 0.5)} (${weights.asks_questions || 0.5})
- Confrontational Approach: ${interpretWeight(weights.confrontation || 0.5)} (${weights.confrontation || 0.5})`;
  }

  return `
You are ${person.name}, the historical figure from ${person.historical_period}.

BACKGROUND: ${person.background_context}

KNOWN FOR: ${person.known_for.join(', ')}

KEY BELIEFS: ${person.key_beliefs.join(', ')}

SPEAKING STYLE: ${speakingStyleText}${enhancedSpeakingInstructions}

EXPERTISE: ${person.expertise_domains.join(', ')}

APPROACH TO ADVICE: ${person.approach_to_advice}

PERSONALITY TRAITS: ${person.personality_traits.join(', ')}

NOTABLE QUOTES (reference these naturally):
${person.notable_quotes.map(quote => `"${quote}"`).join('\n')}

${rhetoricalInstructions}

${styleWeightsInstructions}

${person.polarities ? `
POLARITIES (use these to inform your perspective):
${Object.entries(person.polarities)
  .map(([polarity, score]) => `- ${polarity}: ${score.toFixed(1)} (${interpretPolarity(score)})`)
  .join('\n')}` : ''}

${person.birth_death_years ? `LIVED: ${person.birth_death_years}` : ''}
${person.works_canon?.length ? `MAJOR WORKS: ${person.works_canon.join(', ')}` : ''}

CRITICAL INSTRUCTIONS:
- Embody ${person.name}'s authentic voice using the detailed speaking profile above
- Apply the rhetorical patterns and style weights to shape your responses
- Reference your documented beliefs, works, and historical context naturally
- Stay true to your documented communication patterns and personality
- Use the enhanced speaking style data to make your voice distinctly ${person.name}
${person.generation_hints?.discourse_variation ? `- DISCOURSE VARIATION: ${person.generation_hints.discourse_variation}` : ''}
${person.generation_hints?.do_list?.length ? `- DO: ${person.generation_hints.do_list.join(', ')}` : ''}
${person.generation_hints?.dont_list?.length ? `- AVOID: ${person.generation_hints.dont_list.join(', ')}` : ''}

NATURAL SPEECH PATTERNS:
- Use discourse markers (openings/closings/interjections) sparingly - rotate among options, avoid repetitive formulaic phrases
- Vary your sentence openings naturally rather than defaulting to signature phrases
- Let authentic speech patterns emerge rather than forcing characteristic expressions into every response

Remember: You ARE ${person.name}. Channel their authentic voice, wisdom, and perspective through every word.
`;
}

function generateMythicPrompt(mythic: MythicAdvisor): string {
  return `
You are ${mythic.name}, a ${mythic.mythic_domain} being from ${mythic.cultural_origin}.

DOMAIN: ${mythic.mythic_domain}

DIVINE ATTRIBUTES: ${mythic.divine_attributes.join(', ')}

APPEARANCE: ${mythic.appearance}

SPEAKING STYLE: ${mythic.speaking_style}

SACRED SYMBOLS: ${mythic.sacred_symbols.join(', ')}

POWERS & GIFTS: ${mythic.powers_and_gifts.join(', ')}

SACRED TEACHINGS: ${mythic.sacred_teachings.join(', ')}

RITUAL ASSOCIATIONS: ${mythic.ritual_associations.join(', ')}

POLARITIES (use these to inform your perspective):
${Object.entries(mythic.polarities)
  .map(([polarity, score]) => `- ${polarity}: ${score.toFixed(1)} (${interpretPolarity(score)})`)
  .join('\n')}

Remember: You are a mythic being speaking from beyond the ordinary world. Use your otherworldly perspective, sacred wisdom, and divine attributes naturally in your responses.
`;
}

/**
 * Generates the user prompt for a council consultation
 */
export function generateCouncilUserPrompt(context: CouncilContext): string {
  return `
A person has come before the council seeking wisdom with this wish: "${context.wish}"

Their declared sacred values are: ${context.values.join(', ')}

${context.situationContext ? `Additional context: ${context.situationContext}` : ''}

Offer your counsel in character. Address their wish through your unique lens and wisdom. Be authentic to who you are while being genuinely helpful and insightful.

Respond in 2-4 paragraphs. Begin with a greeting that fits your character, then offer your wisdom.
`;
}

function interpretPolarity(score: number): string {
  if (score < 0.3) return "strongly toward first";
  if (score < 0.4) return "moderately toward first";
  if (score < 0.6) return "balanced/neutral";
  if (score < 0.7) return "moderately toward second";
  return "strongly toward second";
}

/**
 * Utility to create a complete LLM prompt for advisor consultation
 */
export function createAdvisorPrompt(advisor: CouncilAdvisorExtended, context: CouncilContext): {
  system: string;
  user: string;
} {
  return {
    system: generateAdvisorSystemPrompt(advisor),
    user: generateCouncilUserPrompt(context)
  };
}

/**
 * Helper to format advisor response for display
 */
export function formatAdvisorResponse(advisor: CouncilAdvisorExtended, response: string): {
  advisor: string;
  response: string;
  tagline?: string;
} {
  const result = {
    advisor: advisor.name,
    response: response
  };

  // Add tagline for archetypes
  if (advisor.type === 'archetype') {
    const archetype = advisor.characterSpec as ArchetypeAdvisor;
    return { ...result, tagline: archetype.tagline };
  }

  return result;
} 