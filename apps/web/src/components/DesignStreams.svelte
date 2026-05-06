<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { goto } from "$app/navigation";
    import { createEventDispatcher } from 'svelte';
    import type { QuestTree, QuestTreeNode, GenerationConfig } from '../types/questTree';
    import { createQuestTreeFromRitual } from '../utils/timelineMapping';
    import { buildActivationMessage, generateSeedQuests, expandQuestNode, buildAdvisorPersonaContext } from '../utils/backcasting';
    import { getAdvisorResponseFormatInstructions } from '../utils/council-context';
    import LLMService from '../utils/llm-service';
    import type { HoloSphere } from "holosphere";
    import { ID } from '../dashboard/store';
    	import { createTasksFromQuestTree, saveTasksToHolon } from '../utils/holonCreator';
	import type { CouncilAdvisorExtended } from '../types/advisor-schema';
	import { VisionClarificationService, addResponseToSession } from '../utils/visionClarificationService';
	import { getAvailablePatterns } from '../utils/interactionPatterns';
	import type { 
		VisionClarificationSession, 
		AdvisorQuestion, 
		UserResponse,
		SMARTObjective,
		InteractionPatternType 
	} from '../types/visionClarification';

	interface Props {
		advisors: CouncilAdvisorExtended[];
		ritualSession?: {
			wish_statement: string;
			declared_values: string[];
			[key: string]: any;
		};
		onClose?: () => void;
	}

	export let advisors: CouncilAdvisorExtended[] = [];
	export let ritualSession: Props['ritualSession'] = undefined;
	export let onClose: (() => void) | undefined = undefined;
	export let sessionManager: any = null; // Session manager from parent

	const dispatch = createEventDispatcher();

	let selectedElement = '';
	let showElementModal = false;
	let showBackcastModal = false;


	let tempWishStatement = '';
	let tempValues: string[] = [];
	let newValueInput = '';

	// Backcast from the Future state
	let showTimelineMapping = false;
	let questTree: QuestTree | null = null;
	let currentGenerations = 6; // Default to 6 generation structure
	let branchingFactor = 3;
	let isGeneratingQuests = false;
	let currentNodeId: string | null = null;
	let timelineMappingMessages: Array<{
		speaker: 'user' | 'advisor' | 'system';
		content: string;
		timestamp: string;
		nodeId?: string;
	}> = [];
	let llmService: LLMService | null = null;
	
    // User chat input state
    let userChatInput = '';

	// Vision Clarification state
	let showVisionClarification = false;
	let visionClarificationSession: VisionClarificationSession | null = null;
	let currentQuestionIndex = 0;
	let isProcessingVisionClarification = false;
	let enhancedVision: SMARTObjective | null = null;
	let selectedInteractionPattern: InteractionPatternType = 'celebrity_interview';
	let userResponseInput = '';
	let visionClarificationService: VisionClarificationService | null = null;
	let showCouncilDeliberation = false;
	let councilDeliberations: string[] = [];
	let isDeliberating = false;
	let deliberationMessages: Array<{
		content: string;
		displayContent?: string;
		isTyping?: boolean;
		advisor: string;
		timestamp: Date;
	}> = [];

    // Holosphere context
    let holosphere = (typeof window !== 'undefined' ? (getContext && getContext('holosphere')) : null) as HoloSphere | null;
    let holonID: string | null = null;
    $: holonID = $ID;

	// Ensure a session is started when the Design Streams modal mounts
	onMount(() => {
		try {
			if (sessionManager) {
				if (!sessionManager.hasActiveSession || !sessionManager.getCurrentSession || !sessionManager.startSession) {
					console.warn('sessionManager provided, but missing API');
					return;
				}
				const current = sessionManager.getCurrentSession();
				if (!current) {
					const s = sessionManager.startSession();
					console.log('🚀 Started Design Streams session:', s.id);
				} else {
					console.log('🔁 Resumed Design Streams session:', current.id);
				}
			}
			
			// Debug advisors prop
			console.log('🔮 DesignStreams mounted with advisors:', advisors);
			console.log('🔮 Advisor IDs on mount:', advisors?.map(a => ({ name: a.name, id: a.id })) || []);
		} catch (e) {
			console.warn('Unable to start/resume Design Streams session:', e);
		}
	});

    // Save/export state
    let isSavingQuests = false;
    let showSaveMenu = false;
    let pendingNewHolonId: string | null = null;

    function hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    function getQuestTreeStorageKey() {
        const idPart = holonID || 'local';
        return `backcastQuestTree:${idPart}`;
    }

    function saveQuestTreeDraftToLocal() {
        if (typeof window === 'undefined' || !questTree) return;
        try {
            localStorage.setItem(getQuestTreeStorageKey(), JSON.stringify(questTree));
        } catch {}
    }

    function loadQuestTreeDraftFromLocal(): boolean {
        if (typeof window === 'undefined') return false;
        try {
            const raw = localStorage.getItem(getQuestTreeStorageKey());
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (parsed && parsed.nodes) {
                // Upgrade old quest trees to use 6 generations if they have less
                if (!parsed.maxGenerations || parsed.maxGenerations < 6) {
                    console.log('🔄 Upgrading quest tree maxGenerations from', parsed.maxGenerations, 'to 6');
                    parsed.maxGenerations = 6;
                }
                questTree = parsed;
                return true;
            }
        } catch {}
        return false;
    }

    function clearQuestTreeDraft() {
        if (typeof window === 'undefined') return;
        try { localStorage.removeItem(getQuestTreeStorageKey()); } catch {}
    }

    async function saveQuestTreeToHolon(target: 'current' | 'new') {
        if (!questTree) return;
        if (!holosphere) {
            addTimelineMappingMessage('system', '❌ Cannot save quests: holosphere is not available.');
            return;
        }

        try {
            isSavingQuests = true;
            showSaveMenu = false;

            const targetHolonId = target === 'current' && holonID ? holonID : `qt-${hashString(questTree.vision.statement)}-${Date.now().toString(36)}`;

            const tasks = createTasksFromQuestTree(questTree, targetHolonId);
            const count = await saveTasksToHolon(holosphere, targetHolonId, tasks);

            if (count > 0) {
                addTimelineMappingMessage('system', `✅ Saved ${count} quest${count === 1 ? '' : 's'} to ${target === 'current' ? 'this holon' : 'a new holon'} (${targetHolonId}).`);
                
                // ✅ SAVE SESSION after publishing quests (but don't exit)
                completeSession();
                
                // Clear local draft after successful save
                clearQuestTreeDraft();
                if (target === 'new') {
                    // Offer to open the new holon via inline UI and message
                    pendingNewHolonId = targetHolonId;
                    addTimelineMappingMessage('system', `➡️ New holon created. Click the button above to open it. ID: ${targetHolonId}`);
                }
            } else {
                addTimelineMappingMessage('system', '❌ No quests were saved.');
            }
        } catch (error) {
            console.error('Error saving quest tree to holon:', error);
            addTimelineMappingMessage('system', `❌ Error saving quests: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            isSavingQuests = false;
        }
    }

    // Reactive statement to ensure quest tree updates trigger re-renders
    $: if (questTree) {
		console.log('Quest tree updated:', {
			rootNodeIds: questTree.rootNodeIds,
			totalNodes: Object.keys(questTree.nodes).length,
			vision: questTree.vision
		});
        // Persist draft locally so user doesn't lose work if not generated to holosphere
        // saveQuestTreeDraftToLocal(); // Commented out for testing HoloSphere save
	}

	// Elemental configurations
	const elements = [
		{
			name: 'Earth',
			emoji: '🌍',
			color: 'from-green-600 to-emerald-600',
			borderColor: 'border-green-500/50',
			hoverBorderColor: 'hover:border-green-400',
			shadowColor: 'hover:shadow-green-500/25',
			description: 'Grounding, stability, and material manifestation'
		},
		{
			name: 'Fire',
			emoji: '🔥',
			color: 'from-red-600 to-orange-600',
			borderColor: 'border-red-500/50',
			hoverBorderColor: 'hover:border-red-400',
			shadowColor: 'hover:shadow-red-500/25',
			description: 'Transformation, passion, and creative energy'
		},
		{
			name: 'Water',
			emoji: '🌊',
			color: 'from-blue-600 to-cyan-600',
			borderColor: 'border-blue-500/50',
			hoverBorderColor: 'hover:border-blue-400',
			shadowColor: 'hover:shadow-blue-500/25',
			description: 'Flow, intuition, and emotional wisdom'
		},
		{
			name: 'Air',
			emoji: '💨',
			color: 'from-purple-600 to-indigo-600',
			borderColor: 'border-purple-500/50',
			hoverBorderColor: 'hover:border-purple-400',
			shadowColor: 'hover:shadow-purple-500/25',
			description: 'Intellect, communication, and spiritual insight'
		}
	];

	function openElementChat(element: string) {
		selectedElement = element;
		showElementModal = true;
	}

	function closeElementModal() {
		showElementModal = false;
		selectedElement = '';
	}

	// Holonic pattern: Back-cast modal functions
	function openBackcastModal() {
		showBackcastModal = true;
		// Initialize temp values with current ritual data
		tempWishStatement = ritualSession?.wish_statement || '';
		tempValues = ritualSession?.declared_values ? [...ritualSession.declared_values] : [];
	}

	function closeBackcastModal() {
		showBackcastModal = false;
		tempWishStatement = '';
		tempValues = [];
		newValueInput = '';
	}

	function saveWishStatement() {
		// Dispatch event to update ritual session
		dispatch('updateRitualData', {
			type: 'wish_statement',
			value: tempWishStatement
		});
	}



	function saveValues() {
		// Filter out empty values and limit to 6
		const cleanValues = tempValues.filter(v => v.trim() !== '').slice(0, 6);
		dispatch('updateRitualData', {
			type: 'declared_values',
			value: cleanValues
		});
		// Persist values to holosphere so inner metatron can mirror after refresh
		if (holosphere && holonID) {
			try { holosphere.put(holonID, 'council_values', { values: cleanValues }); } catch {}
		}

	}

	function addValueDirect() {
		if (newValueInput.trim() && tempValues.length < 6) {
			tempValues = [...tempValues, newValueInput.trim()];
			newValueInput = '';
			saveValues(); // Auto-save
		}
	}

	function removeValueDirect(index: number) {
		tempValues = tempValues.filter((_, i) => i !== index);
		saveValues(); // Auto-save
	}

	// Holonic pattern: Get element data in consistent format
	function getElementData(elementName: string) {
		return elements.find(el => el.name === elementName) || elements[0];
	}

	// Holonic pattern: Get advisors aligned with specific element
	function getElementAdvisors(elementName: string): CouncilAdvisorExtended[] {
		// For now, return all advisors. In future: filter by element affinity
		return advisors;
	}

	function openAdvisorChat(advisor: CouncilAdvisorExtended) {
		console.log('Opening advisor chat for:', advisor.name);
		// Dispatch event to parent to handle advisor chat
		dispatch('openAdvisorChat', { advisor });
	}

	// Backcast from the Future functions
	function openBackcastFromFuture() {
		showBackcastModal = false; // Close the backcast modal
		
		if (!ritualSession?.wish_statement) {
			addTimelineMappingMessage('system', 'Please set your wish statement first before starting backcasting from the future.');
			return;
		}
		
		// Check if we have advisors available
		if (!advisors || advisors.length < 6) {
			addTimelineMappingMessage('system', 'Please ensure you have at least 6 advisors in your council for vision clarification.');
			return;
		}

		// Initialize LLM service if needed
		if (!llmService) {
			llmService = new LLMService();
		}

		// Initialize vision clarification service
		console.log('🔮 Initializing VisionClarificationService with advisors:', advisors);
		console.log('🔮 Advisor count:', advisors?.length || 0);
		console.log('🔮 Advisor names:', advisors?.map(a => a.name) || []);
		console.log('🔮 Full advisor objects:', advisors?.map(a => ({ id: a.id, name: a.name, type: a.type, lens: a.lens })) || []);
		visionClarificationService = new VisionClarificationService(llmService, advisors);

        // Check for existing quest tree draft
        const restored = loadQuestTreeDraftFromLocal();
        if (restored) {
			// If we have a restored quest tree, skip vision clarification and go directly to timeline mapping
			showTimelineMapping = true;
			currentGenerations = 6;
			userChatInput = '';
            addTimelineMappingMessage('system', '🗂️ Restored your previous quest tree draft from this device.');
            if (questTree && questTree.maxGenerations === 6) {
                addTimelineMappingMessage('system', '🔄 Quest tree has been upgraded to support 6 generations! You can now expand quests beyond generation 3.');
            }
            return;
        }

		// Start vision clarification process
		showVisionClarification = true;
	}

	// Vision Clarification functions
	async function startVisionClarification() {
		if (!visionClarificationService || !ritualSession?.wish_statement) return;
		
		try {
			isProcessingVisionClarification = true;
			
			// Start clarification session
			visionClarificationSession = await visionClarificationService.startClarificationSession(
				ritualSession.wish_statement,
				ritualSession.declared_values || [],
				selectedInteractionPattern
			);
			
			// Generate interview questions
			const phase = await visionClarificationService.generateInterviewQuestions(visionClarificationSession);
			visionClarificationSession.phases = [phase];
			
			// Reset state
			currentQuestionIndex = 0;
			
		} catch (error) {
			console.error('Failed to start vision clarification:', error);
		} finally {
			isProcessingVisionClarification = false;
		}
	}

	async function submitResponse() {
		if (!visionClarificationSession || !userResponseInput.trim()) return;
		
		const currentPhaseData = visionClarificationSession.phases[0];
		const currentQuestion = currentPhaseData?.questions[currentQuestionIndex];
		
		if (!currentQuestion) return;
		
		try {
			isProcessingVisionClarification = true;
			
			// Add response to session
			visionClarificationSession = addResponseToSession(
				visionClarificationSession,
				currentQuestion.id,
				userResponseInput.trim()
			);
			
			// Clear input
			userResponseInput = '';
			
			// Move to next question or start council deliberation
			if (currentQuestionIndex < currentPhaseData.questions.length - 1) {
				// More questions remaining
				currentQuestionIndex++;
			} else {
				// All questions completed - start council deliberation
				await startCouncilDeliberation();
			}
			
		} catch (error) {
			console.error('Failed to submit response:', error);
		} finally {
			isProcessingVisionClarification = false;
		}
	}

	async function startCouncilDeliberation() {
		if (!visionClarificationService || !visionClarificationSession) return;
		
		try {
			isDeliberating = true;
			showCouncilDeliberation = true;
			deliberationMessages = []; // Reset messages
			
			// Get all user responses
			const allResponses = visionClarificationSession.phases.flatMap(p => p.responses);
			
			// Conduct council deliberation
			const rawDeliberations = await visionClarificationService.conductCouncilDeliberation(
				visionClarificationSession,
				allResponses
			);
			
			// Convert to typing messages and type them one by one
			for (const deliberation of rawDeliberations) {
				// Extract advisor name from "**Name:** content" format
				const match = deliberation.match(/\*\*(.*?):\*\*\s*(.*)/);
				const advisorName = match ? match[1] : 'Council Member';
				const content = match ? match[2] : deliberation;
				
				const message = {
					content,
					displayContent: '',
					isTyping: true,
					advisor: advisorName,
					timestamp: new Date()
				};
				
				deliberationMessages = [...deliberationMessages, message];
				await typeDeliberationMessage(message);
				
				// Brief pause between advisor messages
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
			
			// Deliberation complete - user can now proceed manually with Next button
			
		} catch (error) {
			console.error('Failed to conduct council deliberation:', error);
		} finally {
			isDeliberating = false;
		}
	}

	async function synthesizeEnhancedVision() {
		if (!visionClarificationService || !visionClarificationSession) return;
		
		try {
			isProcessingVisionClarification = true;
			
			// Synthesize S.M.A.R.T. objective
			enhancedVision = await visionClarificationService.synthesizeVision(visionClarificationSession);
			
			// Mark session as completed
			visionClarificationSession.finalSMARTObjective = enhancedVision;
			visionClarificationSession.completed = new Date().toISOString();
			
		} catch (error) {
			console.error('Failed to synthesize enhanced vision:', error);
		} finally {
			isProcessingVisionClarification = false;
		}
	}

	function skipVisionClarification() {
		showVisionClarification = false;
		startQuestGeneration();
	}

	function proceedWithEnhancedVision() {
		showVisionClarification = false;
		startQuestGeneration();
	}

	// Typing simulation for deliberation messages
	async function typeDeliberationMessage(message: any, delayMs: number = 3.75) {
		message.isTyping = true;
		message.displayContent = '';
		deliberationMessages = [...deliberationMessages]; // Trigger reactivity
		
		for (let i = 0; i < message.content.length; i++) {
			message.displayContent += message.content[i];
			deliberationMessages = [...deliberationMessages]; // Trigger reactivity
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
		
		message.isTyping = false;
		deliberationMessages = [...deliberationMessages]; // Trigger reactivity
	}

	function startQuestGeneration() {
		showTimelineMapping = true;
		currentGenerations = 6;
		userChatInput = '';
		
		// Get head advisor (first advisor in the list, or default)
		const headAdvisorName = advisors.length > 0 ? advisors[0].name : 'The Sage';
		
		// Create initial quest tree with enhanced vision if available
		const config: GenerationConfig = {
			number: currentGenerations,
			branchingFactor: branchingFactor,
			inquiryDepth: 'medium'
		};

		// Use enhanced vision if available, otherwise use original
		const visionStatement = enhancedVision?.specific || ritualSession?.wish_statement || '';
		const visionPrinciples = ritualSession?.declared_values || [];

		// Create a proper RitualSession object
		const fullRitualSession = {
			session_id: `timeline-${Date.now()}`,
			advisors: [],
			design_streams: [],
			ritual_artifact: {
				format: 'scroll' as const,
				text: '',
				quotes: {},
				ascii_glyph: ''
			},
			...ritualSession,
			wish_statement: visionStatement,
			declared_values: visionPrinciples
		};
		
		questTree = createQuestTreeFromRitual(fullRitualSession, headAdvisorName, config);
		
		addTimelineMappingMessage('system', buildActivationMessage({
			wish: visionStatement,
			values: visionPrinciples,
			generations: currentGenerations,
			branchingFactor,
			headAdvisorName
		}));
		
		// Start with seed quest generation
		startSeedQuestGeneration();
	}

	function closeTimelineMapping() {
		showTimelineMapping = false;
		questTree = null;
		currentNodeId = null;
		timelineMappingMessages = [];
		// Reset to 6 generations as default
		currentGenerations = 6;
		// Clear user chat input
		userChatInput = '';
	}

	function addTimelineMappingMessage(speaker: 'user' | 'advisor' | 'system', content: string, nodeId?: string) {
		const message = {
			speaker,
			content,
			timestamp: new Date().toISOString(),
			nodeId
		};
		
		timelineMappingMessages = [...timelineMappingMessages, message];
		
		// Track chat interactions in session (exclude system messages)
		if (sessionManager && speaker !== 'system') {
			sessionManager.trackInteraction('chat', { 
				message: {
					role: speaker === 'user' ? 'user' : 'assistant',
					content,
					timestamp: new Date(),
					advisor: speaker === 'advisor' ? 'Backcasting Facilitator' : undefined
				}
			});
		}
	}

	async function startSeedQuestGeneration() {
		if (!questTree || !llmService) {
			console.error('startSeedQuestGeneration: questTree or llmService not available', { questTree: !!questTree, llmService: !!llmService });
			return;
		}
		
		console.log('Starting seed quest generation with quest tree:', questTree);
		
		isGeneratingQuests = true;
		addTimelineMappingMessage('system', '🌱 **Generating Seed Quests**\n\nAnalyzing your vision to identify the 3 fundamental quests that must be completed...');

		try {
			// Get the head advisor from the quest tree
			const headAdvisorName = questTree.headAdvisor;
			
			// Find the advisor in the available advisors list
			const headAdvisor = advisors.find(a => a.name === headAdvisorName);
			
			if (!headAdvisor) {
				// Fallback: use the first available advisor
				const fallbackAdvisor = advisors[0];
				addTimelineMappingMessage('system', `⚠️ Note: Using ${fallbackAdvisor.name} as facilitator (${headAdvisorName} not found in current council).`);
			}

			// Use holonic backcasting orchestrator
			const { raw, seedQuests } = await generateSeedQuests(llmService, questTree, advisors);
			
			// Debug: Log the quest tree state after creating seed quests
			console.log('Quest tree after creating seed quests:', {
				questTree,
				rootNodeIds: questTree.rootNodeIds,
				nodes: Object.keys(questTree.nodes),
				seedQuests
			});
			
			// Force Svelte to detect the change by reassigning the quest tree
			questTree = { ...questTree };
			
			// Track quest generation in session
			if (sessionManager) {
				sessionManager.trackInteraction('quest_generation', { 
					questTree: questTree,
					type: 'seed_quests',
					advisor: headAdvisorName 
				});
			}
			
			addTimelineMappingMessage('advisor', raw);
			addTimelineMappingMessage('system', `✅ **Seed Quests Created**\n\n${seedQuests.map((q, i) => `${i + 1}. ${q.title}`).join('\n')}\n\nReady to expand into child quests. Click on any seed quest to break it down further.`);

		} catch (error) {
			console.error('Error generating seed quests:', error);
			addTimelineMappingMessage('system', `❌ Error generating seed quests: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			isGeneratingQuests = false;
		}
	}

	async function expandQuest(nodeId: string) {
		if (!questTree || !llmService || isGeneratingQuests) {
			return;
		}
		
		const node = questTree.nodes[nodeId];
		if (!node) return;

		// Check if we've reached max generations
		console.log('🐛 Expansion check:', { 
			nodeGeneration: node.generation, 
			maxGenerations: questTree.maxGenerations, 
			currentGenerations: currentGenerations,
			canExpand: node.generation < questTree.maxGenerations 
		});
		
		if (node.generation >= questTree.maxGenerations) {
			addTimelineMappingMessage('system', `🏁 Maximum generation depth (${questTree.maxGenerations}) reached for this quest. Current: Gen ${node.generation}`);
			return;
		}

		// Check if already has children
		console.log('🐛 Checking children:', { nodeId, childIds: node.childIds, hasChildren: node.childIds.length > 0 });
		if (node.childIds.length > 0) {
			addTimelineMappingMessage('system', `📋 Quest "${node.title}" already has child quests. View them below.`);
			return;
		}

		console.log('🐛 Starting expansion process for node:', nodeId);
		currentNodeId = nodeId;
		isGeneratingQuests = true;
		
		addTimelineMappingMessage('system', `🔍 **Expanding Quest: "${node.title}"**\n\nGenerating ${branchingFactor} child quests...`);

		try {
			console.log('🐛 Inside try block, getting advisor...');
			// Get the facilitating advisor from the quest tree
			const headAdvisorName = questTree.headAdvisor;
			
			// Find the advisor in the available advisors list
			const headAdvisor = advisors.find(a => a.name === headAdvisorName);
			
			if (!headAdvisor) {
				// Fallback: use the first available advisor
				const fallbackAdvisor = advisors[0];
				addTimelineMappingMessage('system', `⚠️ Note: Using ${fallbackAdvisor.name} as facilitator (${headAdvisorName} not found in current council).`);
			}

			console.log('🔮 About to call holonic expandQuestNode...', { nodeId, questTreeMaxGen: questTree.maxGenerations });
			
			// Use holonic backcasting orchestrator - NO FALLBACKS, surface errors clearly
			let expandResult;
			try {
				expandResult = await expandQuestNode(llmService, questTree, nodeId, advisors);
				console.log('🔮 Holonic expandQuestNode succeeded:', { raw: expandResult.raw.length, childQuestsCount: expandResult.childQuests.length });
			} catch (error) {
				// Surface holonic errors clearly in UI
				console.error('🚨 HOLONIC EXPANSION FAILED:', error);
				
				addTimelineMappingMessage('system', `🚨 HOLONIC LLM FAILURE: ${error instanceof Error ? error.message : 'Unknown error'}`);
				addTimelineMappingMessage('system', `🔧 Check console for detailed troubleshooting information.`);
				
				// Re-throw to stop execution - no masking during development
				throw error;
			}
			
			const { raw, childQuests } = expandResult;
			
			// Debug: Log the quest tree state after creating child quests
			console.log('🐛 Quest tree state after creating child quests:', {
				parentNodeId: nodeId,
				childQuestsCreated: childQuests.length,
				totalNodes: Object.keys(questTree.nodes).length,
				parentNode: questTree.nodes[nodeId],
				parentChildIds: questTree.nodes[nodeId]?.childIds
			});
			
			console.log('🐛 Before forcing Svelte reactivity...');
			// Force Svelte to detect the change by reassigning the quest tree
			questTree = { ...questTree };
			console.log('🐛 After forcing Svelte reactivity, questTree updated');
			
			// Track quest expansion in session
			if (sessionManager) {
				sessionManager.trackInteraction('quest_generation', { 
					questTree: questTree,
					type: 'child_quests',
					parentNodeId: nodeId,
					advisor: headAdvisorName 
				});
			}
			
			addTimelineMappingMessage('advisor', raw, nodeId);
			addTimelineMappingMessage('system', `✅ **Child Quests Created for "${node.title}"**\n\n${childQuests.map((q, i) => `${i + 1}. ${q.title}`).join('\n')}\n\nContinue expanding or review the quest tree.`);

		} catch (error) {
			console.error('🐛 Error expanding quest:', error);
			console.error('🐛 Error stack:', error instanceof Error ? error.stack : 'No stack');
			addTimelineMappingMessage('system', `❌ Error expanding quest: ${error instanceof Error ? error.message : 'Unknown error'}`);
		} finally {
			console.log('🐛 Expansion finally block executed');
			isGeneratingQuests = false;
			currentNodeId = null;
		}
	}

	function toggleGenerations() {
		// Toggle between 6 and 7 generations
		currentGenerations = currentGenerations === 6 ? 7 : 6;
		
		if (questTree) {
			questTree.maxGenerations = currentGenerations;
			addTimelineMappingMessage('system', `🔄 Generation depth updated to ${currentGenerations} levels.`);
		}
	}

	function getAdvisorsForElement(element: string): CouncilAdvisorExtended[] {
		// For now, return all advisors. In the future, you could filter based on element affinity
		return advisors;
	}

	// Handle user chat messages in the backcasting tool
	async function sendUserMessage() {
		if (!userChatInput.trim() || !llmService || !questTree) return;
		
		const userMessage = userChatInput.trim();
		userChatInput = '';
		
		// Add user message to chat
		addTimelineMappingMessage('user', userMessage);
		
		try {
			// Get the head advisor for response
			const headAdvisorName = questTree.headAdvisor;
			
			// Find the advisor in the available advisors list
			const headAdvisor = advisors.find(a => a.name === headAdvisorName);
			
			if (!headAdvisor) {
				addTimelineMappingMessage('system', '❌ Error: Could not find advisor data');
				return;
			}
			
        // Create context-aware response based on current quest tree state, embedding full persona and theatrical directions
            const persona = buildAdvisorPersonaContext(headAdvisor);
            const directions = getAdvisorResponseFormatInstructions();
            const prompt = `
${persona}

${directions}

CONTEXT:
- Vision: "${questTree.vision.statement}"
- Principles: ${questTree.vision.principles.join(', ')}
- Quest Tree: ${Object.keys(questTree.nodes).length} quests across ${questTree.maxGenerations} generations

USER MESSAGE: "${userMessage}"

Respond as ${headAdvisorName}. ALWAYS begin with objective stage directions in [brackets] on their own line, then speak fully in character. Keep the flow conversational; ask clarifying questions when useful, and suggest concrete next steps in the backcasting process.`;
			
			const response = await llmService.sendMessage([
				{ role: 'system', content: 'You are a backcasting facilitator helping users navigate the quest generation process.' },
				{ role: 'user', content: prompt }
			]);
			
			// Add advisor response to chat
			addTimelineMappingMessage('advisor', response.content);
			
		} catch (error) {
			console.error('Error processing user message:', error);
			addTimelineMappingMessage('system', `❌ Error processing your message: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	// Complete the Design Streams session
	function completeSession() {
		if (sessionManager) {
			dispatch('sessionComplete');
			console.log('🏁 Design Streams session completed');
			
			// Add completion message to chat - but don't exit
			addTimelineMappingMessage('system', '✅ **Session Data Saved**\n\nYour Design Streams session has been saved to Previous Rituals. **Please publish quests to save those too.**\n\nYou can continue working on your quest tree or publish quests when ready.');
			
			// Don't close the session - keep it open for continued work
			// setTimeout(() => {
			// 	if (onClose) {
			// 		onClose();
			// 	}
			// }, 2000);
		}
	}

	// Helper function to get styling for quest nodes based on generation
	function getQuestNodeStyling(generation, hasChildren) {
		const baseClasses = "w-full rounded text-xs text-left border transition-colors";
		
		switch(generation) {
			case 1: return `${baseClasses} mb-3 bg-gray-700 hover:bg-gray-600 text-white p-3 ${hasChildren ? 'border-green-500' : 'border-gray-600'}`;
			case 2: return `${baseClasses} mb-2 bg-gray-600 hover:bg-gray-500 text-white p-3 ${hasChildren ? 'border-green-500' : 'border-gray-500'}`;
			case 3: return `${baseClasses} mb-2 bg-gray-500 hover:bg-gray-400 text-white p-2 border-gray-400`;
			case 4: return `${baseClasses} mb-2 bg-gray-400 hover:bg-gray-300 text-white p-2 border-gray-300`;
			case 5: return `${baseClasses} mb-2 bg-gray-300 hover:bg-gray-200 text-gray-800 p-2 border-gray-200`;
			case 6: return `${baseClasses} mb-2 bg-gray-200 hover:bg-gray-100 text-gray-800 p-2 border-gray-100`;
			default: return `${baseClasses} mb-2 bg-gray-500 hover:bg-gray-400 text-white p-2 border-gray-400`;
		}
	}

	// Helper function to recursively collect all descendant nodes in display order
	function getAllDescendantNodes(nodeId, questTree, depth = 0) {
		const node = questTree.nodes[nodeId];
		if (!node) return [];
		
		const result = [{ node, nodeId, depth }];
		
		if (node.childIds && node.childIds.length > 0) {
			for (const childId of node.childIds) {
				result.push(...getAllDescendantNodes(childId, questTree, depth + 1));
			}
		}
		
		return result;
	}
</script>

<!-- Modal Backdrop -->
<div
	class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
	on:click={() => onClose && onClose()}
	on:keydown={(e) => e.key === 'Escape' && onClose && onClose()}
	role="dialog"
	tabindex="-1"
>
	<!-- Modal Container -->
	<div
		class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden"
		on:click|stopPropagation={() => {}}
		on:keydown|stopPropagation={() => {}}
		role="presentation"
	>
		<!-- Header with Close Button -->
		<div class="flex items-center justify-between p-6 border-b border-gray-700 bg-gradient-to-r from-gray-700 to-gray-600 rounded-t-2xl">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">
					🛠
				</div>
				<div>
					<h3 class="text-white text-xl font-bold">Design Streams</h3>
					<p class="text-white/80 text-sm">Elemental paths to manifest your vision</p>
				</div>
			</div>
			<!-- Close Button -->
			{#if onClose}
				<button
					on:click={onClose}
					class="text-white hover:text-white/80 transition-colors p-2 rounded-lg hover:bg-white/10"
					aria-label="Close modal"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			{/if}
		</div>
		
		<!-- Modal Content -->
		<div class="flex-1 overflow-y-auto p-6">

			<!-- Elemental Buttons Grid -->
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
				{#each elements as element}
					<button
						on:click={() => openElementChat(element.name)}
						class="group relative bg-gray-700 hover:bg-gray-600 border-2 {element.borderColor} {element.hoverBorderColor} text-white py-6 px-4 rounded-xl transition-all duration-300 flex flex-col items-center justify-center gap-3 text-sm font-medium shadow-lg {element.shadowColor} min-h-[140px]"
					>
						<div class="text-3xl mb-2">{element.emoji}</div>
						<h3 class="text-lg font-bold">{element.name}</h3>
						<p class="text-gray-300 text-xs text-center leading-relaxed">
							{element.description}
						</p>
						<div class="absolute inset-0 bg-gradient-to-r {element.color} opacity-0 group-hover:opacity-10 rounded-xl transition-opacity duration-300"></div>
					</button>
				{/each}
			</div>

			<!-- Back-cast from Future Button -->
			<div class="mb-8">
				<button
					on:click={openBackcastModal}
					class="w-full bg-gradient-to-r from-purple-700 to-indigo-700 hover:from-purple-600 hover:to-indigo-600 text-white py-6 px-6 rounded-xl transition-all duration-300 flex flex-col items-center justify-center gap-3 text-lg font-medium shadow-lg border-2 border-purple-500/50 hover:border-purple-400"
				>
					<div class="text-3xl mb-2">🔮</div>
					<h3 class="text-xl font-bold">Back-cast from the Future</h3>
					<p class="text-purple-200 text-sm text-center leading-relaxed">
						Envision your realized future and work backwards to create the path
					</p>
				</button>
			</div>

			<!-- Council Advisors Section -->
			<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
				<h2 class="text-xl font-bold text-white mb-4 text-center">Your Council Advisors</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					{#each advisors as advisor}
											<div 
						on:click={() => openAdvisorChat(advisor)}
						class="bg-gray-600 rounded-lg p-3 hover:bg-gray-500 transition-colors cursor-pointer"
						role="button"
						tabindex="0"
						on:keydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								openAdvisorChat(advisor);
							}
						}}
					>
													<div class="flex items-start justify-between">
							<div class="flex-1">
								<h4 class="text-white font-bold text-sm">{advisor.name}</h4>
								<p class="text-gray-300 text-xs capitalize">{advisor.type}</p>
								<p class="text-gray-300 text-xs italic">"{advisor.lens}"</p>
							</div>
							<div class="text-blue-400 text-sm">
								💬
							</div>
						</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>

<!-- Element Modal Popup -->
{#if showElementModal && selectedElement}
	{@const elementData = getElementData(selectedElement)}
	{@const elementAdvisors = getElementAdvisors(selectedElement)}
	
	<!-- Modal Backdrop -->
	<div
		class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={closeElementModal}
		on:keydown={(e) => e.key === 'Escape' && closeElementModal()}
		role="dialog"
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] relative border border-gray-700 flex flex-col overflow-hidden"
			on:click|stopPropagation={() => {}}
			on:keydown|stopPropagation={() => {}}
			role="presentation"
		>
			<!-- Header with Close Button -->
			<div class="flex items-center justify-between p-6 border-b border-gray-700 bg-gradient-to-r {elementData.color} rounded-t-2xl">
				<div class="flex items-center gap-3">
					<div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
						{elementData.emoji}
					</div>
					<div>
						<h3 class="text-white text-xl font-bold">{elementData.name} Stream</h3>
						<p class="text-white/80 text-sm">{elementData.description}</p>
					</div>
				</div>
				<!-- Close Button -->
				<button
					on:click={closeElementModal}
					class="text-white hover:text-white/80 transition-colors p-2 rounded-lg hover:bg-white/10"
					aria-label="Close element modal"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
			
			<!-- Modal Content -->
			<div class="flex-1 overflow-y-auto p-6">
				<!-- Element Description -->
				<div class="mb-6">
					<h4 class="text-lg font-bold text-white mb-2">Channel the {elementData.name} Element</h4>
					<p class="text-gray-300 text-sm leading-relaxed">
						{#if elementData.name === 'Earth'}
							Ground your vision in practical manifestation. Earth brings stability, resources, and step-by-step implementation to make your ideas tangible and sustainable.
						{:else if elementData.name === 'Fire'}
							Ignite transformation and passionate action. Fire brings creative energy, bold innovation, and the power to burn away what no longer serves your vision.
						{:else if elementData.name === 'Water'}
							Flow with intuitive wisdom and emotional intelligence. Water brings adaptability, deep insight, and the ability to navigate the emotional landscape of change.
						{:else if elementData.name === 'Air'}
							Elevate through intellectual clarity and communication. Air brings perspective, strategic thinking, and the power to share your vision with others.
						{/if}
					</p>
				</div>

				<!-- Element-Aligned Advisors -->
				{#if elementAdvisors.length > 0}
					<div class="mb-6">
						<h4 class="text-lg font-bold text-white mb-3">Consult with {elementData.name}-Aligned Advisors</h4>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
							{#each elementAdvisors as advisor}
								<div 
									on:click={() => openAdvisorChat(advisor)}
									class="bg-gray-700 rounded-lg p-3 hover:bg-gray-600 transition-colors cursor-pointer border-l-4 {elementData.borderColor}"
									role="button"
									tabindex="0"
									on:keydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											openAdvisorChat(advisor);
										}
									}}
								>
									<div class="flex items-start justify-between">
										<div class="flex-1">
											<h5 class="text-white font-bold text-sm">{advisor.name}</h5>
											<p class="text-gray-300 text-xs capitalize">{advisor.type}</p>
											<p class="text-gray-300 text-xs italic">"{advisor.lens}"</p>
										</div>
										<div class="text-blue-400 text-sm">
											💬
										</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Element Actions -->
				<div class="bg-gray-700 rounded-xl p-4 border border-gray-600">
					<h4 class="text-lg font-bold text-white mb-3">{elementData.name} Stream Actions</h4>
					<div class="space-y-2">
						{#if elementData.name === 'Earth'}
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🏗️ Create Implementation Plan
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								📋 Resource Assessment
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								⚖️ Stability Analysis
							</button>
						{:else if elementData.name === 'Fire'}
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🔥 Ignite Innovation Session
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								⚡ Energy Amplification
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🎯 Passionate Focus
							</button>
						{:else if elementData.name === 'Water'}
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🌊 Flow State Meditation
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								💧 Intuitive Guidance
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🔄 Adaptive Strategy
							</button>
						{:else if elementData.name === 'Air'}
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🧠 Strategic Analysis
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								📢 Communication Plan
							</button>
							<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-3 rounded-lg text-white text-sm transition-colors">
								🎭 Perspective Shift
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Back-cast from Future Modal -->
{#if showBackcastModal}
	<!-- Modal Backdrop -->
	<div
		class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={closeBackcastModal}
		on:keydown={(e) => e.key === 'Escape' && closeBackcastModal()}
		role="dialog"
		tabindex="-1"
	>
		<!-- Modal Container -->
		<div
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] relative border border-gray-700 flex flex-col overflow-hidden"
			on:click|stopPropagation={() => {}}
			on:keydown|stopPropagation={() => {}}
			role="presentation"
		>
			<!-- Header with Close Button -->
			<div class="flex items-center justify-between p-6 border-b border-gray-700 bg-gradient-to-r from-purple-700 to-indigo-700 rounded-t-2xl">
				<div class="flex items-center gap-3">
					<div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
						🔮
					</div>
					<div>
						<h3 class="text-white text-xl font-bold">Back-cast from the Future</h3>
						<p class="text-white/80 text-sm">Envision your realized future and work backwards</p>
					</div>
				</div>
				<!-- Close Button -->
				<button
					on:click={closeBackcastModal}
					class="text-white hover:text-white/80 transition-colors p-2 rounded-lg hover:bg-white/10"
					aria-label="Close backcast modal"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
			
			<!-- Modal Content -->
			<div class="flex-1 overflow-y-auto p-6 space-y-6">
				<!-- Back-casting Process Description -->
				<div class="bg-gradient-to-r from-purple-900/50 to-indigo-900/50 rounded-xl p-4 border border-purple-500/30">
					<h4 class="text-lg font-bold text-white mb-2">🌌 The Back-casting Process</h4>
					<p class="text-gray-300 text-sm leading-relaxed">
						Back-casting starts with envisioning your ideal future state, then works backwards to identify the steps, decisions, and milestones needed to make that future reality. Using your wish statement and values as anchors, we'll create a pathway from your envisioned future to the present moment.
					</p>
				</div>

				<!-- Wish Statement Section -->
				<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
					<h4 class="text-lg font-bold text-white flex items-center gap-2 mb-4">
						✨ Your Wish Statement
					</h4>
					
					<textarea
						bind:value={tempWishStatement}
						placeholder="What do you seek to bring into being?"
						class="w-full bg-gray-600 border border-gray-500 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
						rows="4"
						on:blur={saveWishStatement}
					></textarea>
				</div>

				<!-- Values Section -->
				<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
					<div class="flex items-center justify-between mb-4">
						<h4 class="text-lg font-bold text-white flex items-center gap-2">
							🎯 Your Declared Values
						</h4>
						<div class="text-sm text-gray-400">
							{tempValues.length}/6 values
						</div>
					</div>
					
					<!-- Direct Value Input -->
					<div class="space-y-4">
						<!-- Input field for new value -->
						<div class="flex gap-3">
							<input
								bind:value={newValueInput}
								placeholder="Enter a core value..."
								class="flex-1 bg-gray-600 border border-gray-500 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								on:keydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										addValueDirect();
									}
								}}
							/>
							<button
								on:click={addValueDirect}
								disabled={!newValueInput.trim() || tempValues.length >= 6}
								class="btn btn--primary btn--lg"
							>
								Add Value
							</button>
						</div>
						
						<!-- Display existing values as chips -->
						{#if tempValues.length > 0}
							<div class="flex flex-wrap gap-2">
								{#each tempValues as value, index}
									<div class="bg-purple-600 text-white px-4 py-2 rounded-full text-sm border border-purple-500 flex items-center gap-2">
										<span>✦ {value}</span>
										<button
											on:click={() => removeValueDirect(index)}
											class="text-purple-200 hover:text-white transition-colors"
										>
											✕
										</button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- Back-casting Actions -->
				<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
					<h4 class="text-lg font-bold text-white mb-4 flex items-center gap-2">
						🔄 Back-casting Tools
					</h4>
					<div class="space-y-3">
						<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-4 rounded-lg text-white transition-colors flex items-center gap-3">
							<span class="text-2xl">🎅</span>
							<div>
								<div class="font-semibold">Future Self Dialogue</div>
								<div class="text-sm text-gray-300">Have a conversation with your future self who has achieved your wish</div>
							</div>
						</button>
						
						<button 
							on:click={openBackcastFromFuture}
							class="w-full text-left bg-gray-600 hover:bg-gray-500 p-4 rounded-lg text-white transition-colors flex items-center gap-3"
						>
							<span class="text-2xl">🗺️</span>
							<div>
								<div class="font-semibold">Backcast from the Future</div>
								<div class="text-sm text-gray-300">Create a reverse timeline from future success to present actions</div>
							</div>
						</button>
						
						<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-4 rounded-lg text-white transition-colors flex items-center gap-3">
							<span class="text-2xl">🌱</span>
							<div>
								<div class="font-semibold">Values Alignment Check</div>
								<div class="text-sm text-gray-300">Ensure each step honors your declared values</div>
							</div>
						</button>
						
						<button class="w-full text-left bg-gray-600 hover:bg-gray-500 p-4 rounded-lg text-white transition-colors flex items-center gap-3">
							<span class="text-2xl">🕶️</span>
							<div>
								<div class="font-semibold">Decision Point Analysis</div>
								<div class="text-sm text-gray-300">Identify key decisions that led to your successful future</div>
							</div>
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Backcast from the Future Modal -->
{#if showTimelineMapping}
	<div
		class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={closeTimelineMapping}
		on:keydown={(e) => e.key === 'Escape' && closeTimelineMapping()}
		role="dialog"
		tabindex="-1"
	>
		<div
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden"
			on:click|stopPropagation={() => {}}
			on:keydown|stopPropagation={() => {}}
			role="presentation"
		>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-gray-700 bg-gradient-to-r from-purple-700 to-indigo-700 rounded-t-2xl">
				<div class="flex items-center gap-3">
					<div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
						🗺️
					</div>
					<div>
						<h3 class="text-white text-xl font-bold">Backcast from the Future</h3>
						<p class="text-white/80 text-sm">Recursive Backcasting | Generations: {currentGenerations}</p>
					</div>
				</div>
				<div class="flex items-center gap-3">
					<!-- Temporarily commented out - might come back to it
					<button
						on:click={toggleGenerations}
						class="bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-sm transition-colors"
					>
						Toggle {currentGenerations === 6 ? '7' : '6'} Gen
					</button>
					-->
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						on:click={closeTimelineMapping}
						class="text-white hover:text-white/80 transition-colors p-2 rounded-lg hover:bg-white/10"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
			</div>
			
			<!-- Content -->
			<div class="flex-1 overflow-hidden flex relative">
				<!-- Loading Overlay -->
				{#if isGeneratingQuests}
					<div class="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
						<div class="bg-gray-800 border border-purple-500 rounded-xl p-8 text-center shadow-2xl">
							<div class="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-600 flex items-center justify-center animate-pulse">
								<div class="text-2xl">🧙‍♂️</div>
							</div>
							<div class="text-white text-lg font-semibold mb-2">LLM Processing...</div>
							<div class="text-purple-300 text-sm mb-4">Your advisor is generating quests</div>
							<div class="flex justify-center">
								<div class="flex space-x-1">
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
								</div>
							</div>
						</div>
					</div>
				{/if}
				<!-- Chat/Messages Section -->
				<div class="w-2/3 flex flex-col border-r border-gray-700">
					<div class="flex-1 overflow-y-auto p-4 space-y-4">
						{#each timelineMappingMessages as message}
							<div class="flex gap-3">
								<div class="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm">
									{#if message.speaker === 'system'}
										🤖
									{:else if message.speaker === 'advisor'}
										🧙‍♂️
									{:else}
										👤
									{/if}
								</div>
								<div class="flex-1">
									<div class="bg-gray-700 rounded-lg p-3 text-white text-sm whitespace-pre-wrap">
										{message.content}
									</div>
									<div class="text-xs text-gray-400 mt-1">
										{new Date(message.timestamp).toLocaleTimeString()}
									</div>
								</div>
							</div>
						{/each}
						{#if isGeneratingQuests}
							<div class="flex gap-3">
								<div class="w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center text-sm animate-pulse">
									🧙‍♂️
								</div>
								<div class="flex-1">
									<div class="bg-purple-900/50 border border-purple-500 rounded-lg p-3 text-white text-sm animate-pulse">
										<div class="flex items-center gap-2">
											<span>🔮 LLM Processing...</span>
											<div class="flex space-x-1">
												<div class="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
												<div class="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
												<div class="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
											</div>
										</div>
									</div>
								</div>
							</div>
						{/if}
					</div>
					
					<!-- Chat Input Section -->
					<div class="border-t border-gray-700 p-4">
						<div class="flex gap-3">
							<input
								bind:value={userChatInput}
								placeholder={isGeneratingQuests ? "Please wait - LLM is processing..." : "Ask questions or provide guidance to the backcasting process..."}
								disabled={isGeneratingQuests}
								class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
								on:keydown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										sendUserMessage();
									}
								}}
							/>
							<button
								on:click={sendUserMessage}
								disabled={!userChatInput.trim() || isGeneratingQuests}
								class="btn btn--primary"
							>
								Send
							</button>
						</div>
					</div>
				</div>
				
				<!-- Quest Tree Visualization -->
				<div class="w-1/3 flex flex-col">
					<div class="p-4 border-b border-gray-700">
						<h4 class="text-white font-bold text-sm">Quest Tree</h4>
						{#if questTree}
							<p class="text-gray-400 text-xs">
								Vision: {questTree.vision.statement.length > 50 ? questTree.vision.statement.substring(0, 50) + '...' : questTree.vision.statement}
							</p>
						{/if}
					</div>
					<div class="flex-1 overflow-y-auto p-4">
						{#if questTree}

							
							{#if pendingNewHolonId}
								<div class="mb-3 p-3 bg-gray-700 border border-gray-600 rounded-lg text-xs text-white">
									<div class="flex items-center justify-between">
										<span>New holon ready: {pendingNewHolonId}</span>
										<button 
											class="btn btn--primary btn--sm" 
											on:click={() => goto(`/${pendingNewHolonId}`)}
										>
											Open New Holon
										</button>
									</div>
								</div>
							{/if}

							<!-- Fully Recursive Quest Tree Rendering -->
							{#if questTree.rootNodeIds && questTree.rootNodeIds.length > 0}
								<div class="mb-4">
									<div class="text-gray-400 text-xs mb-2">Quest Tree - All Generations (Max: {questTree.maxGenerations})</div>
									{#each questTree.rootNodeIds as rootNodeId}
										{@const allNodes = getAllDescendantNodes(rootNodeId, questTree)}
										{#each allNodes as {node, nodeId, depth}}
											<div class="quest-node" style="margin-left: {depth * 16}px;">
												<button
													on:click={() => expandQuest(nodeId)}
													disabled={isGeneratingQuests}
													class="{getQuestNodeStyling(node.generation, node.childIds?.length > 0)} {isGeneratingQuests ? 'opacity-50 cursor-not-allowed' : ''}"
												>
													<div class="font-semibold">{node.title}</div>
													
													<!-- Rich Holonic Metadata Display -->
													{#if node.description}
														<div class="text-gray-300 text-xs mt-1 italic">
															{node.description}
														</div>
													{/if}
													
													<div class="text-gray-400 text-xs mt-1">
														Gen {node.generation} | 
														{node.childIds && node.childIds.length > 0 ? `${node.childIds.length} children` : 'Click to expand'}
														{#if node.estimatedDuration}
															| ⏱️ {node.estimatedDuration}
														{/if}
													</div>

													<!-- Holonic Quest Details -->
													{#if node.generation >= 1}
														<div class="mt-2 space-y-1 text-xs">
															{#if node.skillsRequired && node.skillsRequired.length > 0}
																<div class="text-blue-300">
																	<span class="font-medium">Skills:</span> {node.skillsRequired.join(', ')}
																</div>
															{/if}
															
															{#if node.resourcesRequired && node.resourcesRequired.length > 0}
																<div class="text-green-300">
																	<span class="font-medium">Resources:</span> {node.resourcesRequired.join(', ')}
																</div>
															{/if}
															
															{#if node.actions && node.actions.length > 0}
																<div class="text-yellow-300">
																	<span class="font-medium">Actions:</span> {node.actions.slice(0, 2).join(', ')}{node.actions.length > 2 ? '...' : ''}
																</div>
															{/if}
															
															{#if node.futureState}
																<div class="text-purple-300">
																	<span class="font-medium">Success:</span> {node.futureState.length > 60 ? node.futureState.substring(0, 60) + '...' : node.futureState}
																</div>
															{/if}
															
															{#if node.impactCategory}
																<div class="text-orange-300">
																	<span class="font-medium">Impact:</span> {node.impactCategory}
																</div>
															{/if}
														</div>
													{/if}
												</button>
											</div>
										{/each}
									{/each}
								</div>
							{:else if isGeneratingQuests}
								<div class="text-center p-8">
									<div class="w-12 h-12 mx-auto mb-4 rounded-full bg-purple-600 flex items-center justify-center animate-pulse">
										<div class="text-xl">🧙‍♂️</div>
									</div>
									<div class="text-white text-sm font-semibold mb-2">LLM Processing</div>
									<div class="text-purple-300 text-xs mb-3">Generating seed quests...</div>
									<div class="flex justify-center">
										<div class="flex space-x-1">
											<div class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
											<div class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
											<div class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
										</div>
									</div>
								</div>
							{:else}
								<div class="text-gray-400 text-xs text-center p-4">
									🎯 Click "Publish Quests" to begin backcasting from the future
								</div>
							{/if}
						{:else}
							<div class="text-gray-400 text-xs text-center p-4">
								No quest tree loaded
							</div>
						{/if}
					</div>
					
					<!-- Action Buttons - Fixed at Bottom -->
					{#if questTree}
						<div class="border-t border-gray-700 p-4 space-y-3">
							<!-- Main Publish Quests Button -->
							<button
								on:click={() => showSaveMenu = !showSaveMenu}
								disabled={isSavingQuests}
								class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-600 disabled:to-gray-600 text-white p-3 rounded-lg text-sm font-semibold text-center transition-all duration-200 disabled:cursor-not-allowed shadow-lg"
								aria-label="Publish Quests"
							>
								{isSavingQuests ? '🔄 Saving…' : '🎯 Publish Quests'}
							</button>
							
							<!-- Auto-save notice -->
							<div class="text-xs text-gray-400 text-center -mt-2">
								💾 Automatically saves session after publishing
							</div>
							
							<!-- Save Menu -->
							{#if showSaveMenu}
								<div class="p-3 bg-gray-800 border border-gray-700 rounded-lg">
									<div class="text-gray-300 text-xs mb-3 font-semibold text-center">Choose where to save your quests:</div>
									<div class="space-y-2">
										<button 
											class="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 text-white bg-gray-700 rounded transition-colors flex items-center gap-2"
											on:click={() => saveQuestTreeToHolon('current')}
										>
											💾 Save to This Holon
											<span class="text-gray-400 text-xs">({holonID || 'current'})</span>
										</button>
										<button 
											class="w-full text-left px-3 py-2 text-sm hover:bg-gray-700 text-white bg-gray-700 rounded transition-colors flex items-center gap-2"
											on:click={() => saveQuestTreeToHolon('new')}
										>
											🆕 Save to New Holon
											<span class="text-gray-400 text-xs">(creates new holon)</span>
										</button>
									</div>
								</div>
							{/if}
							
							<!-- Delete Button -->
							<button
								on:click={() => {
									if (confirm('Delete current quest tree and start fresh? This cannot be undone.')) {
										questTree = null;
										clearQuestTreeDraft();
										addTimelineMappingMessage('system', '🗑️ Quest tree deleted. Ready to start fresh.');
									}
								}}
								class="w-full bg-red-600 hover:bg-red-700 text-white p-2 rounded-lg text-sm font-medium transition-colors border border-red-500 shadow-sm"
								title="Delete current quest tree and start fresh"
							>
								🗑️ Delete & Start New
							</button>
							
							<!-- Save Session Button -->
							<button
								on:click={completeSession}
								class="w-full bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg text-sm font-medium transition-colors border border-green-500 shadow-sm"
								title="Save this Design Streams session to Previous Rituals"
							>
								✅ Save Session
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Vision Clarification Modal -->
{#if showVisionClarification}
	<div
		class="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={() => showVisionClarification = false}
		on:keydown={(e) => e.key === 'Escape' && (showVisionClarification = false)}
		role="dialog"
		tabindex="-1"
	>
		<div
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden"
			on:click|stopPropagation={() => {}}
			on:keydown|stopPropagation={() => {}}
			role="presentation"
			style="height: 90vh;"
		>
			<!-- Header -->
			<div class="flex items-center justify-between p-6 border-b border-gray-700 bg-gradient-to-r from-purple-700 to-indigo-700 rounded-t-2xl">
				<div class="flex items-center gap-3">
					<div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-2xl">
						🎤
					</div>
					<div>
						<h3 class="text-white text-xl font-bold">Vision Clarification</h3>
						<p class="text-white/80 text-sm">Council Interview - Celebrity Style</p>
					</div>
				</div>
				<button
					on:click={() => showVisionClarification = false}
					class="text-white hover:text-white/80 transition-colors p-2 rounded-lg hover:bg-white/10"
					aria-label="Close vision clarification"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>

			<!-- Content -->
			<div class="flex-1 overflow-hidden relative">
				<!-- Loading Overlay -->
				{#if isProcessingVisionClarification}
					<div class="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
						<div class="bg-gray-800 border border-purple-500 rounded-xl p-8 text-center shadow-2xl">
							<div class="w-16 h-16 mx-auto mb-4 rounded-full bg-purple-600 flex items-center justify-center animate-pulse">
								<div class="text-2xl">🎤</div>
							</div>
							<div class="text-white text-lg font-semibold mb-2">Processing...</div>
							<div class="text-purple-300 text-sm mb-4">Your council is preparing thoughtful questions</div>
							<div class="flex justify-center">
								<div class="flex space-x-1">
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 0ms;"></div>
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 150ms;"></div>
									<div class="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 300ms;"></div>
								</div>
							</div>
						</div>
					</div>
				{/if}

				<div class="absolute inset-0 top-0 left-0 right-0 bottom-0 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800" style="margin-top: 88px;">
					{#if !visionClarificationSession}
						<!-- Introduction Screen -->
						<div class="text-center space-y-6 py-8">
							<div class="w-20 h-20 mx-auto rounded-full bg-purple-600 flex items-center justify-center text-3xl mb-6">
								🎤
							</div>
							<h2 class="text-2xl font-bold text-white">Welcome to Vision Clarification</h2>
							<p class="text-gray-300 max-w-2xl mx-auto leading-relaxed">
								Your council is ready to conduct a thoughtful interview to help clarify and enhance your vision. 
								Through their unique perspectives and expertise, they'll ask probing questions to help you create a more specific, actionable S.M.A.R.T. objective.
							</p>
							
							<!-- Current Vision Display -->
							<div class="bg-gray-700 rounded-xl p-6 border border-gray-600 max-w-2xl mx-auto text-left">
								<h3 class="text-lg font-semibold text-white mb-3">Your Current Vision:</h3>
								<p class="text-gray-200 mb-4 italic">"{ritualSession?.wish_statement}"</p>
								<h4 class="text-md font-semibold text-white mb-2">Your Values:</h4>
								<div class="flex flex-wrap gap-2">
									{#each (ritualSession?.declared_values || []) as value}
										<span class="bg-purple-600 text-white px-3 py-1 rounded-full text-sm">✦ {value}</span>
									{/each}
								</div>
							</div>

							<!-- Action Buttons -->
							<div class="flex gap-4 justify-center">
								<button
									on:click={startVisionClarification}
									disabled={isProcessingVisionClarification}
									class="btn btn--primary btn--lg"
								>
									Begin Council Interview
								</button>
								<button
									on:click={skipVisionClarification}
									class="bg-gray-600 hover:bg-gray-500 text-white px-8 py-3 rounded-lg font-semibold transition-colors"
								>
									Skip Interview
								</button>
							</div>
						</div>

					{:else if enhancedVision}
						<!-- Enhanced Vision Results -->
						<div class="space-y-6">
							<div class="text-center mb-8">
								<div class="w-16 h-16 mx-auto rounded-full bg-green-600 flex items-center justify-center text-2xl mb-4">
									✨
								</div>
								<h2 class="text-2xl font-bold text-white">Enhanced S.M.A.R.T. Vision</h2>
								<p class="text-gray-300">Your council has helped clarify your vision into a structured, actionable objective.</p>
							</div>

							<div class="bg-gray-700 rounded-xl p-6 border border-gray-600 space-y-6 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
								<!-- S.M.A.R.T. Breakdown -->
								<div class="grid md:grid-cols-2 gap-6">
									<div>
										<h3 class="text-lg font-semibold text-white mb-2 flex items-center gap-2">
											<span class="text-green-400">S</span> Specific
										</h3>
										<p class="text-gray-200 text-sm">{enhancedVision.specific}</p>
									</div>
									<div>
										<h3 class="text-lg font-semibold text-white mb-2 flex items-center gap-2">
											<span class="text-blue-400">M</span> Measurable
										</h3>
										<ul class="text-gray-200 text-sm space-y-1">
											{#each enhancedVision.measurable as measure}
												<li>• {measure}</li>
											{/each}
										</ul>
									</div>
									<div>
										<h3 class="text-lg font-semibold text-white mb-2 flex items-center gap-2">
											<span class="text-yellow-400">A</span> Achievable
										</h3>
										<p class="text-gray-200 text-sm">{enhancedVision.achievable}</p>
									</div>
									<div>
										<h3 class="text-lg font-semibold text-white mb-2 flex items-center gap-2">
											<span class="text-purple-400">R</span> Relevant
										</h3>
										<p class="text-gray-200 text-sm">{enhancedVision.relevant}</p>
									</div>
									<div class="md:col-span-2">
										<h3 class="text-lg font-semibold text-white mb-2 flex items-center gap-2">
											<span class="text-red-400">T</span> Time-bound
										</h3>
										<p class="text-gray-200 text-sm">{enhancedVision.timeBound}</p>
									</div>
								</div>

								<!-- Additional Context -->
								<div class="border-t border-gray-600 pt-6 grid md:grid-cols-2 gap-6">
									<div>
										<h4 class="font-semibold text-white mb-2">Success Metrics</h4>
										<ul class="text-gray-200 text-sm space-y-1">
											{#each enhancedVision.successMetrics as metric}
												<li>• {metric}</li>
											{/each}
										</ul>
									</div>
									<div>
										<h4 class="font-semibold text-white mb-2">Key Assumptions</h4>
										<ul class="text-gray-200 text-sm space-y-1">
											{#each enhancedVision.assumptions as assumption}
												<li>• {assumption}</li>
											{/each}
										</ul>
									</div>
								</div>

								<div>
									<h4 class="font-semibold text-white mb-2">Future State Vision</h4>
									<p class="text-gray-200 text-sm italic">"{enhancedVision.futureState}"</p>
								</div>
							</div>

							<!-- Action Buttons - Fixed at Bottom -->
							<div class="bg-gray-800 border-t border-gray-700 p-6">
								<div class="flex gap-4 justify-center max-w-5xl mx-auto">
									<button
										on:click={proceedWithEnhancedVision}
										class="bg-green-600 hover:bg-green-700 text-white px-8 py-3 rounded-lg font-semibold transition-colors shadow-lg"
									>
										Proceed with Enhanced Vision
									</button>
									<button
										on:click={() => {
											enhancedVision = null;
											visionClarificationSession = null;
											currentQuestionIndex = 0;
											showCouncilDeliberation = false;
											councilDeliberations = [];
											deliberationMessages = [];
										}}
										class="bg-gray-600 hover:bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold transition-colors shadow-lg"
									>
										Start Over
									</button>
								</div>
							</div>
						</div>

					{:else}
						<!-- Interview in Progress or Council Deliberation -->
						{@const currentPhaseData = visionClarificationSession.phases[0]}
						{@const currentQuestion = currentPhaseData?.questions[currentQuestionIndex]}
						{@const advisor = advisors.find(a => a.id === currentQuestion?.advisorId)}
						
						<!-- Debug info -->
						{#if currentQuestion}
							<div class="text-xs text-gray-400 mb-2 p-2 bg-gray-800 rounded">
								Debug: Question advisorId="{currentQuestion.advisorId}", 
								Found advisor: {advisor?.name || 'NOT FOUND'}, 
								Available advisor IDs: {advisors.map(a => a.id).join(', ')}, 
								Advisor count: {advisors.length}, 
								Advisor names: {advisors.map(a => a.name).join(', ')}
							</div>
						{/if}
						
						<div class="space-y-6">
							<!-- Progress Indicator -->
							<div class="bg-gray-700 rounded-lg p-4 border border-gray-600">
								<div class="flex items-center justify-between mb-2">
									<span class="text-white font-semibold">
										{#if showCouncilDeliberation}
											Council Deliberation
										{:else}
											Interview Questions
										{/if}
									</span>
									<span class="text-gray-300 text-sm">
										{#if showCouncilDeliberation}
											Synthesizing insights...
										{:else}
											Question {currentQuestionIndex + 1} of {currentPhaseData?.questions.length || 0}
										{/if}
									</span>
								</div>
								<div class="w-full bg-gray-600 rounded-full h-2">
									<div 
										class="bg-purple-600 h-2 rounded-full transition-all duration-300" 
										style="width: {showCouncilDeliberation ? '100%' : ((currentQuestionIndex + 1) / (currentPhaseData?.questions.length || 1)) * 80}%"
									></div>
								</div>
							</div>

							{#if showCouncilDeliberation}
								<!-- Council Deliberation -->
								<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
									<div class="flex items-center gap-4 mb-6">
										<div class="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-xl">
											💭
										</div>
										<div>
											<h3 class="text-white font-semibold">Council Deliberation</h3>
											<p class="text-gray-300 text-sm">Your council shares their insights about your responses</p>
										</div>
									</div>

									{#if deliberationMessages.length > 0}
										<div class="space-y-4 max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 pr-2 pb-4">
											{#each deliberationMessages as message}
												<div class="bg-gray-800 rounded-lg p-4 border-l-4 border-indigo-500">
													<div class="flex items-center gap-2 mb-2">
														<div class="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-xs font-bold text-white">
															{message.advisor.charAt(0)}
														</div>
														<span class="text-indigo-300 font-medium text-sm">{message.advisor}</span>
													</div>
													<p class="text-white text-sm leading-relaxed">
														{message.displayContent || message.content}
														{#if message.isTyping}
															<span class="animate-pulse">|</span>
														{/if}
													</p>
												</div>
											{/each}
										</div>

										<!-- Next Button - Show after all typing is complete -->
										{#if !isDeliberating && deliberationMessages.every(msg => !msg.isTyping)}
											<div class="flex justify-center mt-6 pt-4 border-t border-gray-600">
												<button
													on:click={synthesizeEnhancedVision}
													disabled={isProcessingVisionClarification}
													class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed shadow-lg flex items-center gap-2"
												>
													<span>✨</span>
													Create S.M.A.R.T. Vision
													<span>→</span>
												</button>
											</div>
										{:else}
											<!-- Debug info -->
											<div class="text-center mt-4 text-gray-400 text-xs">
												Debug: isDeliberating={isDeliberating}, 
												typingCount={deliberationMessages.filter(msg => msg.isTyping).length}
											</div>
										{/if}
									{:else if isDeliberating}
										<div class="bg-gray-800 rounded-lg p-4 border-l-4 border-indigo-500 text-center">
											<div class="flex items-center justify-center gap-2">
												<div class="w-4 h-4 rounded-full bg-indigo-500 animate-pulse"></div>
												<span class="text-white text-sm">Council is deliberating...</span>
											</div>
										</div>
									{:else if deliberationMessages.length > 0}
										<!-- Fallback Next Button - Show if deliberations exist but button didn't show above -->
										<div class="flex justify-center mt-6 pt-4 border-t border-gray-600">
											<button
												on:click={synthesizeEnhancedVision}
												disabled={isProcessingVisionClarification}
												class="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-8 py-3 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed shadow-lg flex items-center gap-2"
											>
												<span>✨</span>
												Create S.M.A.R.T. Vision
												<span>→</span>
											</button>
										</div>
									{/if}
								</div>

							{:else if currentQuestion && advisor}
								<!-- Current Question -->
								<div class="bg-gray-700 rounded-xl p-6 border border-gray-600">
									<!-- Advisor Info -->
									<div class="flex items-center gap-4 mb-6">
										<div class="w-12 h-12 rounded-full bg-purple-600 flex items-center justify-center text-xl">
											🧙‍♂️
										</div>
										<div>
											<h3 class="text-white font-semibold">{advisor.name}</h3>
											<p class="text-gray-300 text-sm capitalize">{advisor.type} • {advisor.lens}</p>
										</div>
									</div>

									<!-- Question -->
									<div class="bg-gray-800 rounded-lg p-4 border-l-4 border-purple-500 mb-6">
										<p class="text-white leading-relaxed">{currentQuestion.question}</p>
									</div>

									<!-- Response Input -->
									<div class="space-y-4">
										<label class="block text-white font-medium" for="user-response-input">Your Response:</label>
										<textarea
											id="user-response-input"
											bind:value={userResponseInput}
											placeholder="Share your thoughts and insights..."
											class="w-full bg-gray-600 border border-gray-500 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
											rows="4"
										></textarea>
										
										<div class="flex gap-3">
											<button
												on:click={submitResponse}
												disabled={!userResponseInput.trim() || isProcessingVisionClarification}
												class="btn btn--primary btn--lg"
											>
												{currentQuestionIndex < (currentPhaseData?.questions.length || 0) - 1 ? 'Next Question' : 'Begin Council Deliberation'}
											</button>
											<button
												on:click={skipVisionClarification}
												class="bg-gray-600 hover:bg-gray-500 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
											>
												Skip Interview
											</button>
										</div>
									</div>
								</div>

								<!-- Previous Questions & Responses -->
								{#if currentQuestionIndex > 0}
									<div class="bg-gray-700/50 rounded-xl p-6 border border-gray-600">
										<h4 class="text-white font-semibold mb-4">Previous Conversation</h4>
										<div class="space-y-4 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800 pr-2 pb-4">
											{#each visionClarificationSession.phases[0].questions as question, questionIndex}
												{@const questionAdvisor = advisors.find(a => a.id === question.advisorId)}
												{@const response = visionClarificationSession.phases[0].responses.find(r => r.questionId === question.id)}
												
												{#if response && questionIndex < currentQuestionIndex}
													<div class="border-l-2 border-gray-600 pl-4">
														<div class="text-sm text-gray-300 mb-1">
														<strong>{questionAdvisor?.name}:</strong> {question.question}
														</div>
														<div class="text-sm text-white bg-gray-800 rounded p-2">
														<strong>You:</strong> {response.response}
													</div>
												</div>
											{/if}
										{/each}
									</div>
								</div>
							{/if}
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Custom scrollbar styling for vision clarification modal */
	.scrollbar-thin::-webkit-scrollbar {
		width: 6px;
	}

	.scrollbar-thin::-webkit-scrollbar-track {
		background: #374151;
		border-radius: 3px;
	}

	.scrollbar-thin::-webkit-scrollbar-thumb {
		background: #4B5563;
		border-radius: 3px;
	}

	.scrollbar-thin::-webkit-scrollbar-thumb:hover {
		background: #6B7280;
	}

	/* Firefox scrollbar styling */
	.scrollbar-thin {
		scrollbar-width: thin;
		scrollbar-color: #4B5563 #374151;
	}
</style> 