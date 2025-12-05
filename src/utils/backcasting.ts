// Backcasting orchestration utilities (holonic refactor)
// - Centralizes LLM prompt orchestration and advisor normalization

import type LLMService from './llm-service';
import type { QuestTree, QuestTreeNode } from '../types/questTree';
import type { CouncilAdvisorExtended } from '../types/advisor-schema';
import { 
  createSeedQuests,
  createChildQuests,
  createChildQuestGenerationPrompt,
  parseChildQuestResponse
} from './timelineMapping';
import {
  createHolonicLLMPrompt,
  parseHolonicLLMResponse,
  createQuestNodeFromHolonicData,
  buildQuestTreeHierarchy,
  getAncestryChain,
  getSiblingContext
} from './holonicLLM';
import type { HolonicLLMInput, HolonicLLMResponse } from '../types/holonicLLM';

// Minimal shape we may receive from older callers
export type AnyAdvisor = never; // We now require full CouncilAdvisorExtended everywhere

export function buildActivationMessage(params: {
  wish: string;
  values: string[];
  generations: number;
  branchingFactor: number;
  headAdvisorName: string;
}): string {
  const { wish, values, generations, branchingFactor, headAdvisorName } = params;
  return `🗺️ **Backcast from the Future Activated**\n\nVision: "${(wish || '').trim()}"\nPrinciples: ${values?.join(', ') || 'None set'}\n\nGenerations: ${generations} | Branching: ${branchingFactor} quests per level\n\nReady to begin recursive backcasting with ${headAdvisorName} facilitating.`;
}

/**
 * Builds a rich persona context for the facilitating advisor so the LLM can respond fully in-character
 */
export function buildAdvisorPersonaContext(advisor: CouncilAdvisorExtended): string {
  const a = advisor;
  const s = (a.characterSpec as any) || {};
  const fields: Array<[string, any]> = [
    ['Tagline', s.tagline],
    ['Intro', s.intro],
    ['Background', s.background || s.background_context],
    ['Style of Speech', s.style_of_speech || s.speaking_style],
    ['Appearance', s.appearance],
    ['Purpose', s.purpose],
    ['Key Beliefs', s.key_beliefs?.join?.(', ')],
    ['Expertise Domains', s.expertise_domains?.join?.(', ')],
    ['Powers & Gifts', s.powers_and_gifts?.join?.(', ')],
    ['Sacred Teachings', s.sacred_teachings?.join?.(', ')],
  ];
  const lines = fields
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `- ${k}: ${v}`);
  return `
**Advisor Persona**
Name: ${a.name}
Type: ${a.type}
Lens: ${a.lens}
${lines.join('\n')}

Speak in the advisor's voice, respecting the Style of Speech and drawing on Background and Expertise where relevant.`.trim();
}

export async function generateSeedQuests(
  llmService: LLMService,
  questTree: QuestTree,
  advisors: CouncilAdvisorExtended[]
): Promise<{ raw: string; seedQuests: QuestTreeNode[]; facilitator: CouncilAdvisorExtended }>
{
  console.log('🔮 Holonic generateSeedQuests called');
  
  const headAdvisorName = questTree.headAdvisor;
  const facilitator = advisors.find(a => a.name === headAdvisorName) || advisors[0];
  
  if (!facilitator) {
    throw new Error(`Facilitator ${headAdvisorName} not found in advisor list`);
  }

  // Get the vision node (Generation 0)
  const visionNodeId = questTree.rootNodeIds[0]; // Vision node is the root
  const visionNode = questTree.nodes[visionNodeId];
  
  if (!visionNode || visionNode.generation !== 0) {
    throw new Error('Quest tree missing vision node (Generation 0)');
  }

  // Build holonic input for seed generation
  const holonicInput: HolonicLLMInput = {
    vision: questTree.vision,
    designStreamsContext: {
      additionalContext: "Future placeholder for elemental insights, advisor conversations, and design stream outputs"
    },
    facilitatingAdvisor: facilitator,
    questTreeContext: {
      maxGenerations: questTree.maxGenerations,
      currentGeneration: 0, // Starting from vision
      fullTree: questTree,
      focusNodeId: visionNodeId, // Actual vision node ID
      ancestryChain: [], // No ancestry for vision node
      siblingContext: [] // No siblings for vision node
    },
    targetGeneration: 1, // Generating first generation (seed quests)
    requestType: 'seed_generation'
  };

  console.log('🔮 Creating holonic seed generation prompt...');
  const prompt = createHolonicLLMPrompt(holonicInput);
  console.log('🔮 Seed prompt preview (first 300 chars):', prompt.substring(0, 300));
  console.log('🔮 FULL SEED GENERATION PROMPT:', prompt);

  console.log('🔮 Sending holonic seed generation request...');
  let response;
  try {
    response = await llmService.sendMessage([
      { role: 'system', content: 'You are a holonic quest generation system creating foundational seed quests.' },
      { role: 'user', content: prompt }
    ]);
    console.log('🔮 Holonic seed response received, length:', response.content.length);
    console.log('🔮 Seed response preview (first 300 chars):', response.content.substring(0, 300));
  } catch (error) {
    console.error('🔮 Holonic seed LLM request failed:', error);
    throw error;
  }

  console.log('🔮 Parsing holonic seed response...');
  const parseResult = parseHolonicLLMResponse(response.content);
  
  if (!parseResult.success || !parseResult.questNodes) {
    // NO FALLBACK DURING DEVELOPMENT - Surface the error clearly
    console.error('🚨 HOLONIC SEED PARSING FAILED:', parseResult.error);
    console.error('🚨 Raw Seed LLM Response:', response.content);
    console.error('🚨 This indicates the LLM is not returning proper JSON format for seed generation');
    
    // Throw detailed error for development troubleshooting
    throw new Error(`🚨 HOLONIC SEED GENERATION FAILURE: ${parseResult.error}
    
    Raw response: ${response.content.substring(0, 500)}...
    
    This means:
    1. The seed generation prompt may need adjustment
    2. The LLM is not following JSON format instructions for seeds
    3. The response parser may have bugs for seed generation
    
    Check console logs above for full details.`);
  }

  console.log('🔮 Creating rich seed quest nodes from holonic data...');
  const seedQuests: QuestTreeNode[] = parseResult.questNodes.map((questData, index) => 
    createQuestNodeFromHolonicData(questData, visionNodeId, 1, index, questTree)
  );

  // Add seed quests to quest tree and link to vision node
  seedQuests.forEach(seed => {
    questTree.nodes[seed.id] = seed;
    visionNode.childIds.push(seed.id); // Link seeds as children of vision
  });

  console.log('🔮 Holonic seed quests created:', seedQuests.length);
  console.log('🔮 Seed relationships:', parseResult.metadata?.siblingRelationships);
  
  return { raw: response.content, seedQuests, facilitator };
}

export async function expandQuestNode(
  llmService: LLMService,
  questTree: QuestTree,
  nodeId: string,
  advisors: CouncilAdvisorExtended[]
): Promise<{ raw: string; childQuests: QuestTreeNode[]; facilitator: CouncilAdvisorExtended }>
{
  console.log('🔮 Holonic expandQuestNode called with:', { nodeId, maxGenerations: questTree.maxGenerations });
  
  const node = questTree.nodes[nodeId];
  if (!node) {
    throw new Error(`Node ${nodeId} not found in quest tree`);
  }
  
  console.log('🔮 Node found:', { generation: node.generation, title: node.title });
  
  const headAdvisorName = questTree.headAdvisor;
  const facilitator = advisors.find(a => a.name === headAdvisorName) || advisors[0];
  
  if (!facilitator) {
    throw new Error(`Facilitator ${headAdvisorName} not found in advisor list`);
  }

  // Build holonic context with full tree awareness
  const targetGeneration = node.generation + 1;
  const ancestryChain = getAncestryChain(questTree, nodeId);
  const siblingContext = getSiblingContext(questTree, nodeId);

  console.log('🔮 Building holonic LLM input...');
  const holonicInput: HolonicLLMInput = {
    vision: questTree.vision,
    designStreamsContext: {
      additionalContext: "Future placeholder for elemental insights, advisor conversations, and design stream outputs"
    },
    facilitatingAdvisor: facilitator,
    questTreeContext: {
      maxGenerations: questTree.maxGenerations,
      currentGeneration: node.generation,
      fullTree: questTree,
      focusNodeId: nodeId,
      ancestryChain,
      siblingContext
    },
    targetGeneration,
    requestType: 'child_expansion'
  };

  console.log('🔮 Creating holonic prompt...');
  const prompt = createHolonicLLMPrompt(holonicInput);
  console.log('🔮 FULL LLM PROMPT:', prompt);

  console.log('🔮 Sending holonic LLM request...');
  let response;
  try {
    response = await llmService.sendMessage([
      { role: 'system', content: 'You are a holonic quest generation system with full tree awareness.' },
      { role: 'user', content: prompt }
    ]);
    console.log('🔮 Holonic response received, length:', response.content.length);
    console.log('🔮 Response preview (first 300 chars):', response.content.substring(0, 300));
  } catch (error) {
    console.error('🔮 Holonic LLM request failed:', error);
    throw error;
  }

  console.log('🔮 Parsing holonic response...');
  const parseResult = parseHolonicLLMResponse(response.content);
  
  if (!parseResult.success || !parseResult.questNodes) {
    // NO FALLBACK DURING DEVELOPMENT - Surface the error clearly
    console.error('🚨 HOLONIC PARSING FAILED:', parseResult.error);
    console.error('🚨 Raw LLM Response:', response.content);
    console.error('🚨 This indicates the LLM is not returning proper JSON format');
    
    // Throw detailed error for development troubleshooting
    throw new Error(`🚨 HOLONIC LLM INTEGRATION FAILURE: ${parseResult.error}
    
    Raw response: ${response.content.substring(0, 500)}...
    
    This means:
    1. The LLM prompt may need adjustment
    2. The LLM is not following JSON format instructions
    3. The response parser may have bugs
    
    Check console logs above for full details.`);
  }

  console.log('🔮 Creating rich quest nodes from holonic data...');
  const childQuests: QuestTreeNode[] = parseResult.questNodes.map((questData, index) => 
    createQuestNodeFromHolonicData(questData, nodeId, targetGeneration, index, questTree)
  );

  // Update parent node's childIds
  const parentNode = questTree.nodes[nodeId];
  const newChildIds = childQuests.map(child => child.id);
  parentNode.childIds.push(...newChildIds);

  // Add new nodes to tree
  childQuests.forEach(child => {
    questTree.nodes[child.id] = child;
  });

  console.log('🔮 Holonic child quests created:', childQuests.length);
  console.log('🔮 Sibling relationships:', parseResult.metadata?.siblingRelationships);
  
  return { raw: response.content, childQuests, facilitator };
}


