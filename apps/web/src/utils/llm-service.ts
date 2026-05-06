import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import { createAdvisorPrompt } from './advisor-prompts';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  error?: string;
}

/**
 * Manages LLM provider interactions for OpenAI, Anthropic, and Groq.
 *
 * The LLMService provides a unified interface for interacting with multiple LLM providers.
 * It handles API authentication, message formatting, and response parsing for each provider.
 * Configuration is loaded from environment variables.
 *
 * @class LLMService
 *
 * @example
 * ```typescript
 * import LLMService from './llm-service';
 *
 * const llm = new LLMService();
 *
 * // Send a message
 * const response = await llm.sendMessage([
 *   { role: 'system', content: 'You are a helpful assistant.' },
 *   { role: 'user', content: 'Hello!' }
 * ]);
 *
 * // Chat with an advisor
 * const chat = await llm.chatWithAdvisor(advisor, 'What advice do you have?');
 *
 * // Generate advisor profiles
 * const realPerson = await llm.generateRealPersonAdvisor('Einstein', 'physics');
 * const mythic = await llm.generateMythicAdvisor('Athena', 'wisdom');
 * const archetype = await llm.generateArchetypeAdvisor('The Sage', 'knowledge');
 * ```
 */
class LLMService {
  private apiKey: string;
  private provider: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  /**
   * Creates a new LLMService instance.
   * Configuration is loaded from environment variables:
   * - VITE_LLM_PROVIDER: 'openai' | 'anthropic' | 'groq'
   * - VITE_LLM_MODEL: The model name
   * - VITE_LLM_MAX_TOKENS: Maximum tokens for responses
   * - VITE_LLM_TEMPERATURE: Temperature setting
   * - VITE_OPENAI_API_KEY / VITE_ANTHROPIC_API_KEY / VITE_GROQ_API_KEY
   *
   * @throws {Error} If provider is unsupported or API key is missing
   */
  constructor() {
    this.provider = import.meta.env.VITE_LLM_PROVIDER || 'openai';
    this.model = import.meta.env.VITE_LLM_MODEL || 'gpt-4o-mini';
    this.maxTokens = parseInt(import.meta.env.VITE_LLM_MAX_TOKENS || '2000');
    this.temperature = parseFloat(import.meta.env.VITE_LLM_TEMPERATURE || '0.7');
    
    // Get API key based on provider
    switch (this.provider) {
      case 'openai':
        this.apiKey = import.meta.env.VITE_OPENAI_API_KEY;
        break;
      case 'anthropic':
        this.apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
        break;
      case 'groq':
        this.apiKey = import.meta.env.VITE_GROQ_API_KEY;
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${this.provider}`);
    }

    if (!this.apiKey) {
      throw new Error(`API key not found for provider: ${this.provider}`);
    }
  }

  /**
   * Sends messages to the configured LLM provider.
   *
   * @async
   * @param {LLMMessage[]} messages - Array of messages in the conversation
   * @returns {Promise<LLMResponse>} The LLM response
   */
  async sendMessage(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      switch (this.provider) {
        case 'openai':
          return await this.callOpenAI(messages);
        case 'anthropic':
          return await this.callAnthropic(messages);
        case 'groq':
          return await this.callGroq(messages);
        default:
          throw new Error(`Unsupported provider: ${this.provider}`);
      }
    } catch (error) {
      console.error('LLM Service Error:', error);
      return {
        content: '',
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Calls the OpenAI API.
   *
   * @private
   * @async
   * @param {LLMMessage[]} messages - The messages to send
   * @returns {Promise<LLMResponse>} The response
   * @throws {Error} If API call fails
   */
  private async callOpenAI(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || ''
    };
  }

  /**
   * Calls the Anthropic API.
   *
   * @private
   * @async
   * @param {LLMMessage[]} messages - The messages to send
   * @returns {Promise<LLMResponse>} The response
   * @throws {Error} If API call fails
   */
  private async callAnthropic(messages: LLMMessage[]): Promise<LLMResponse> {
    // Extract system message and user messages
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemMessage,
        messages: userMessages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    return {
      content: data.content[0]?.text || ''
    };
  }

  /**
   * Calls the Groq API.
   *
   * @private
   * @async
   * @param {LLMMessage[]} messages - The messages to send
   * @returns {Promise<LLMResponse>} The response
   * @throws {Error} If API call fails
   */
  private async callGroq(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const data = await response.json();
    return {
      content: data.choices[0]?.message?.content || ''
    };
  }

  /**
   * Convenience method for chatting with a council advisor.
   * Automatically creates the appropriate system prompt from the advisor's character spec.
   *
   * @async
   * @param {CouncilAdvisorExtended} advisor - The advisor to chat with
   * @param {string} userMessage - The user's message
   * @param {LLMMessage[]} [conversationHistory=[]] - Previous conversation messages
   * @returns {Promise<LLMResponse>} The advisor's response
   */
  async chatWithAdvisor(
    advisor: CouncilAdvisorExtended, 
    userMessage: string, 
    conversationHistory: LLMMessage[] = []
  ): Promise<LLMResponse> {
    const { system } = createAdvisorPrompt(advisor, { 
      wish: '', 
      values: [],
      situationContext: 'Direct conversation with advisor'
    });

    const messages: LLMMessage[] = [
      { role: 'system', content: system },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    return await this.sendMessage(messages);
  }

  /**
   * Generates a real person advisor profile using LLM.
   * Creates detailed historical persona profiles for figures like Einstein, Mandela, etc.
   *
   * @async
   * @param {string} personName - The name of the historical figure
   * @param {string} lens - The wisdom area to focus on
   * @returns {Promise<LLMResponse>} The generated profile as JSON
   */
  async generateRealPersonAdvisor(personName: string, lens: string): Promise<LLMResponse> {
    const systemPrompt = `You are an expert historian and biographer. Your task is to create a detailed advisor profile for a real person.

GUIDANCE FOR LLM: 1) Fill ONLY fields in \`required\`. 2) Add optional fields ONLY if confident; otherwise omit. 3) No hallucinated quotes; quote directly from reliable sources or omit. 4) Enums are closed sets; choose only listed values. 5) Prefer brevity in examples; avoid filler. 6) Drop empty arrays/strings. 7) Use \`style_weights\` to tune generation; 0 = one extreme, 0.5 = neutral, 1 = opposite extreme. 8) For discourse_markers: Provide 2-4 varied options per category to enable natural rotation - avoid formulaic repetition.

IMPORTANT: First, verify if the name represents a real person (living or deceased) who has made significant contributions to their field. This includes:
- Historical figures from any era
- Contemporary figures who are still alive

If the name is ambiguous or fictional, return only: {"valid": false}

If it IS a real person with significant contributions, create a complete JSON schema for a Historical Persona Voice Profile with the following structure:

{
  "valid": true,
  "name": "Full Name",
  "historical_period": "e.g., Ancient Greece, 19th Century America, Contemporary, etc.",
  "known_for": ["achievement1", "achievement2", "achievement3"],
  "key_beliefs": ["belief1", "belief2", "belief3"],
  "expertise_domains": ["domain1", "domain2", "domain3"],
  "personality_traits": ["trait1", "trait2", "trait3"],
  "background_context": "Brief historical context and significance",
  "approach_to_advice": "How this person would characteristically give advice",
  "speaking_style": {
    "one_sentence_summary": "Characteristic way of speaking and communicating",
    "example_original_like": "Example showing their idiosyncratic tone",
    "register": "colloquial|neutral|formal|oratorical|scholarly",
    "verbosity": "terse|concise|balanced|expansive",
    "emotional_tone_baseline": "cool|wry|warm|ardent|grave|playful",
    "humor_style": ["none","dry","wry","satirical","self-deprecating","playful","acerbic"]
  },
  "notable_quotes": ["authentic quote 1", "authentic quote 2", "authentic quote 3"],
  "birth_death_years": "YYYY–YYYY or YYYY–",
  "region_culture": "Cultural/geographical context",
  "works_canon": ["most important work 1", "important work 2", "significant work 3"],
  "rhetorical_profile": {
    "devices": "Preferred rhetorical devices and techniques",
    "cadence": {
      "avg_sentence_length": 15,
      "rhythm_notes": "Description of speech rhythm patterns",
      "punctuation_habits": "Characteristic punctuation usage"
    },
    "lexicon": {
      "preferred_terms": ["term1", "term2", "term3"],
      "idioms_and_turns": ["phrase1", "phrase2"],
      "metaphor_domains": ["domain1", "domain2"]
    },
    "discourse_markers": {
      "openings": ["signature opening (use sparingly)", "alternative opening (rotate)", "occasional variation"],
      "closings": ["typical closing (use occasionally)", "alternative ending"],
      "interjections": ["characteristic interjection", "alternative interjection"]
    },
    "argument_structure": {
      "typical_moves": ["argumentative pattern 1", "pattern 2"],
      "moral_frame": ["ethical framework they use"]
    }
  },
  "style_weights": {
    "diction": 0.5,
    "syntax": 0.5,
    "rhetorical_devices": 0.5,
    "humor_irony": 0.5,
    "asks_questions": 0.5,
    "confrontation": 0.5,
    "humor_frequency": 0.5
  },
  "generation_hints": {
    "do_list": ["vary sentence openings naturally", "rotate discourse markers", "speak authentically in character"],
    "dont_list": ["repeat signature phrases every response", "use formulaic openings", "overuse characteristic interjections"],
    "discourse_variation": "Use discourse markers sparingly and naturally - openings in 10-20% of responses, rotate among options, avoid robotic repetition. Let natural speech patterns emerge.",
    "length_preference_words": 150
  }
}

Focus on the lens/wisdom area: "${lens}". This should be reflected in their expertise, approach, and speaking style.

CRITICAL REQUIREMENTS:
- Use ONLY authentic quotes from reliable sources or omit notable_quotes entirely
- Make speaking_style rich and detailed to enable authentic voice rendering
- Calibrate style_weights based on documented evidence of their communication patterns
- Fill rhetorical_profile only if you have confident knowledge of their speaking patterns
- For birth_death_years, use format YYYY–YYYY or YYYY– for still living
- DISCOURSE MARKERS: Provide variety to enable natural rotation - these should be used occasionally, not repetitively

RENDERING INSTRUCTIONS FOR AI SYSTEMS:
When embodying this persona, use discourse markers sparingly and rotate among provided options. Avoid formulaic repetition of signature phrases. Natural speech variation is key to authenticity.

Return ONLY valid JSON. No additional text or explanation.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create an advisor profile for: ${personName}` }
    ];

    return await this.sendMessage(messages);
  }

  /**
   * Generates a mythic advisor profile using LLM.
   * Creates profiles for mythological figures like Athena, Thor, Ganesha, etc.
   *
   * @async
   * @param {string} mythicName - The name of the mythic figure
   * @param {string} lens - The wisdom area to focus on
   * @returns {Promise<LLMResponse>} The generated profile as JSON
   */
  async generateMythicAdvisor(mythicName: string, lens: string): Promise<LLMResponse> {
    const systemPrompt = `You are an expert in mythology, spirituality, and archetypal wisdom. Your task is to create a detailed advisor profile for a mythic/spiritual being.

Create a complete JSON schema for a MythicAdvisor with the following structure:

{
  "valid": true,
  "name": "Full Name",
  "cultural_origin": "e.g., Greek Mythology, Norse Mythology, Buddhism, Hinduism, Celtic Tradition, etc.",
  "mythic_domain": "The primary domain or aspect this being governs (e.g., wisdom, compassion, transformation, etc.)",
  "sacred_symbols": ["symbol1", "symbol2", "symbol3"],
  "divine_attributes": ["attribute1", "attribute2", "attribute3"],
  "speaking_style": "Describe their characteristic way of speaking - otherworldly, compassionate, mysterious, etc.",
  "powers_and_gifts": ["power1", "power2", "power3"],
  "sacred_teachings": ["teaching1", "teaching2", "teaching3"],
  "appearance": "Detailed description of how this being appears to mortals",
  "ritual_associations": ["ritual1", "ritual2", "ritual3"],
  "polarities": {
    "Individual ↔ Collective": "Generate a score 0.0-1.0 based on whether this being focuses more on individual or collective concerns",
    "Rational ↔ Empirical": "Generate a score 0.0-1.0 based on whether this being relies more on logic or intuitive wisdom", 
    "Idealist ↔ Pragmatist": "Generate a score 0.0-1.0 based on whether this being is more visionary or practical",
    "Order ↔ Chaos": "Generate a score 0.0-1.0 based on whether this being represents structure or spontaneity",
    "Authority ↔ Autonomy": "Generate a score 0.0-1.0 based on whether this being works through hierarchy or independence",
    "Optimist ↔ Pessimist": "Generate a score 0.0-1.0 based on whether this being has a hopeful or cautious outlook",
    "Traditionalist ↔ Innovator": "Generate a score 0.0-1.0 based on whether this being preserves or transforms",
    "Hierarchy ↔ Egalitarian": "Generate a score 0.0-1.0 based on whether this being prefers order or equality",
    "Competitive ↔ Cooperative": "Generate a score 0.0-1.0 based on whether this being emphasizes individual achievement or unity",
    "Material ↔ Spiritual": "Generate a score 0.0-1.0 based on whether this being focuses on physical or spiritual realms",
    "Nihilist ↔ Purposeful": "Generate a score 0.0-1.0 based on whether this being sees existence as meaningless or deeply meaningful",
    "Certainty ↔ Doubt": "Generate a score 0.0-1.0 based on whether this being is confident or questioning in approach"
  }
}

Focus on the lens/wisdom area: "${lens}". This should be reflected in their mythic domain, teachings, and powers.

If this is a well-known mythic figure, draw from established traditions. If it's a new creation, make it authentic to the mythic archetype while embodying the specified lens.

Return ONLY valid JSON. No additional text or explanation.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create a mythic advisor profile for: ${mythicName}` }
    ];

    return await this.sendMessage(messages);
  }

  /**
   * Generates an archetype advisor profile using LLM.
   * Creates Jungian archetype profiles like The Sage, The Hero, The Caregiver, etc.
   *
   * @async
   * @param {string} archetypeName - The name of the archetype
   * @param {string} lens - The wisdom area to focus on
   * @returns {Promise<LLMResponse>} The generated profile as JSON
   */
  async generateArchetypeAdvisor(archetypeName: string, lens: string): Promise<LLMResponse> {
    const systemPrompt = `You are an expert in Jungian psychology, archetypal patterns, and collective unconscious. Your task is to create a detailed advisor profile for an archetypal being.

Create a complete JSON schema for an ArchetypeAdvisor with the following structure:

{
  "valid": true,
  "name": "Full Name",
  "title": "The [Archetype Name]",
  "tagline": "A compelling tagline that captures their essence",
  "intro": "Their characteristic introduction when meeting someone",
  "background": "Rich description of their archetypal nature and origin",
  "style_of_speech": "How they characteristically speak and communicate",
  "appearance": "How this archetype manifests visually",
  "purpose": "Their fundamental purpose and mission",
  "prevention": "What they work to prevent or guard against",
  "inspiration": "What inspires and motivates this archetype",
  "quaint_quirks": "Endearing behavioral patterns and mannerisms",
  "favorite_works": ["work1", "work2", "work3"],
  "polarities": {
    "Individual ↔ Collective": "Generate a score 0.0-1.0 based on whether this archetype focuses more on individual or collective concerns",
    "Rational ↔ Empirical": "Generate a score 0.0-1.0 based on whether this archetype relies more on logic or experiential wisdom", 
    "Idealist ↔ Pragmatist": "Generate a score 0.0-1.0 based on whether this archetype is more visionary or practical",
    "Order ↔ Chaos": "Generate a score 0.0-1.0 based on whether this archetype represents structure or spontaneity",
    "Authority ↔ Autonomy": "Generate a score 0.0-1.0 based on whether this archetype works through hierarchy or independence",
    "Optimist ↔ Pessimist": "Generate a score 0.0-1.0 based on whether this archetype has a hopeful or cautious outlook",
    "Traditionalist ↔ Innovator": "Generate a score 0.0-1.0 based on whether this archetype preserves or transforms",
    "Hierarchy ↔ Egalitarian": "Generate a score 0.0-1.0 based on whether this archetype prefers order or equality",
    "Competitive ↔ Cooperative": "Generate a score 0.0-1.0 based on whether this archetype emphasizes competition or cooperation",
    "Material ↔ Spiritual": "Generate a score 0.0-1.0 based on whether this archetype focuses on material or spiritual aspects",
    "Nihilist ↔ Purposeful": "Generate a score 0.0-1.0 based on whether this archetype sees life as meaningless or deeply meaningful",
    "Certainty ↔ Doubt": "Generate a score 0.0-1.0 based on whether this archetype is confident or questioning in approach"
  },
  "council_membership": "user-created"
}

Focus on the lens/wisdom area: "${lens}". This should be woven throughout their purpose, background, and archetypal nature.

Create an authentic archetypal figure that embodies universal patterns while specializing in the specified area of wisdom.

Return ONLY valid JSON. No additional text or explanation.`;

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create an archetype advisor profile for: ${archetypeName}` }
    ];

    return await this.sendMessage(messages);
  }
}

export default LLMService;
export type { LLMMessage, LLMResponse }; 