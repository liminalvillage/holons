<script lang="ts">
    import { onMount, getContext } from "svelte";
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
	let editingWish = false;
	let editingValues = false;
	let tempWishStatement = '';
	let tempValues: string[] = [];

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
		editingWish = false;
		editingValues = false;
		tempWishStatement = '';
		tempValues = [];
	}

	function startEditingWish() {
		editingWish = true;
		tempWishStatement = ritualSession?.wish_statement || '';
	}

	function saveWishStatement() {
		// Dispatch event to update ritual session
		dispatch('updateRitualData', {
			type: 'wish_statement',
			value: tempWishStatement
		});
		editingWish = false;
	}

	function startEditingValues() {
		editingValues = true;
		tempValues = ritualSession?.declared_values ? [...ritualSession.declared_values] : [];
	}

	function addValue() {
		// Limit to 6 values to match metatron cube capacity
		if (tempValues.length < 6) {
			tempValues = [...tempValues, ''];
		}
	}

	function removeValue(index: number) {
		tempValues = tempValues.filter((_, i) => i !== index);
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
		editingValues = false;
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
		showTimelineMapping = true;
		showBackcastModal = false; // Close the backcast modal
		
        // Ensure 6 generations as default
		currentGenerations = 6;
		// Clear any previous user chat input
		userChatInput = '';
		
		if (!ritualSession?.wish_statement) {
			addTimelineMappingMessage('system', 'Please set your wish statement first before starting backcasting from the future.');
			return;
		}
		
		// Check if we have advisors available
		if (!advisors || advisors.length === 0) {
			addTimelineMappingMessage('system', 'Please add at least one advisor to your council before starting backcasting from the future.');
			return;
		}

		// Initialize LLM service if needed
		if (!llmService) {
			llmService = new LLMService();
		}

        // If a local draft exists, load it and skip re-initialization
        const restored = loadQuestTreeDraftFromLocal();
        if (restored) {
            addTimelineMappingMessage('system', '🗂️ Restored your previous quest tree draft from this device.');
            if (questTree && questTree.maxGenerations === 6) {
                addTimelineMappingMessage('system', '🔄 Quest tree has been upgraded to support 6 generations! You can now expand quests beyond generation 3.');
            }
            return;
        }

        // Get head advisor (first advisor in the list, or default)
		const headAdvisorName = advisors.length > 0 ? advisors[0].name : 'The Sage';
		
		// Create initial quest tree
		const config: GenerationConfig = {
			number: currentGenerations,
			branchingFactor: branchingFactor,
			inquiryDepth: 'medium'
		};

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
			wish_statement: ritualSession.wish_statement,
			declared_values: ritualSession.declared_values || []
		};
		
		questTree = createQuestTreeFromRitual(fullRitualSession, headAdvisorName, config);
		
		// Debug: Quest tree created with 6 generations
		
		addTimelineMappingMessage('system', buildActivationMessage({
			wish: ritualSession.wish_statement,
			values: ritualSession.declared_values || [],
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
			
			// Add completion message to chat
			addTimelineMappingMessage('system', '✅ **Session Completed**\n\nYour Design Streams session has been saved to Previous Rituals. You can return to this quest tree anytime by opening the saved ritual.');
			
			// Close after a short delay to let user read the message
			setTimeout(() => {
				if (onClose) {
					onClose();
				}
			}, 2000);
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
<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
	<!-- Modal Container -->
	<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
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
	<div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
		<!-- Modal Container -->
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] relative border border-gray-700 flex flex-col overflow-hidden">
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
	<div class="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
		<!-- Modal Container -->
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] relative border border-gray-700 flex flex-col overflow-hidden">
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
					<div class="flex items-center justify-between mb-4">
						<h4 class="text-lg font-bold text-white flex items-center gap-2">
							✨ Your Wish Statement
						</h4>
						{#if !editingWish}
							<button
								on:click={startEditingWish}
								class="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1 transition-colors"
							>
								📝 {ritualSession?.wish_statement ? 'Edit' : 'Add'}
							</button>
						{/if}
					</div>
					
					{#if editingWish}
						<div class="space-y-3">
							<textarea
								bind:value={tempWishStatement}
								placeholder="Describe your ideal future state in detail..."
								class="w-full bg-gray-600 border border-gray-500 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
								rows="4"
							></textarea>
							<div class="flex gap-2">
								<button
									on:click={saveWishStatement}
									class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
								>
									Save
								</button>
								<button
									on:click={() => editingWish = false}
									class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg text-sm transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else if ritualSession?.wish_statement}
						<div class="bg-gray-600 rounded-lg p-4 border-l-4 border-purple-500">
							<p class="text-gray-200 leading-relaxed">{ritualSession.wish_statement}</p>
						</div>
					{:else}
						<div class="bg-gray-600 rounded-lg p-4 border-l-4 border-gray-500 border-dashed">
							<p class="text-gray-400 italic">No wish statement defined. Click 'Add' to create one.</p>
						</div>
					{/if}
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
						{#if !editingValues}
							<button
								on:click={startEditingValues}
								class="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-1 transition-colors"
							>
								📝 {ritualSession?.declared_values?.length ? 'Edit' : 'Add'}
							</button>
						{/if}
					</div>
					
					{#if editingValues}
						<div class="space-y-3">
							<div class="space-y-2">
								{#each tempValues as value, index}
									<div class="flex gap-2 items-center">
										<input
											bind:value={tempValues[index]}
											placeholder="Enter a core value..."
											class="flex-1 bg-gray-600 border border-gray-500 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
										/>
										<button
											on:click={() => removeValue(index)}
											class="text-red-400 hover:text-red-300 p-2 transition-colors"
										>
											❌
										</button>
									</div>
								{/each}
							</div>
							<button
								on:click={addValue}
								disabled={tempValues.length >= 6}
								class="text-purple-400 hover:text-purple-300 disabled:text-gray-500 disabled:hover:text-gray-500 text-sm flex items-center gap-1 transition-colors"
							>
								➕ Add Value {tempValues.length >= 6 ? '(Max 6)' : ''}
							</button>
							<div class="flex gap-2">
								<button
									on:click={saveValues}
									class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm transition-colors"
								>
									Save
								</button>
								<button
									on:click={() => editingValues = false}
									class="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-lg text-sm transition-colors"
								>
									Cancel
								</button>
							</div>
						</div>
					{:else if ritualSession?.declared_values?.length}
						<div class="flex flex-wrap gap-2">
							{#each ritualSession.declared_values as value}
								<span class="bg-purple-600 text-white px-3 py-1 rounded-full text-sm border border-purple-500">
									{value}
								</span>
							{/each}
						</div>
					{:else}
						<div class="bg-gray-600 rounded-lg p-4 border-l-4 border-gray-500 border-dashed">
							<p class="text-gray-400 italic">No values declared. Click 'Add' to define your core values.</p>
						</div>
					{/if}
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
	<div class="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
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
			<div class="flex-1 overflow-hidden flex">
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
									<div class="bg-gray-700 rounded-lg p-3 text-white text-sm">
										Generating quests...
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
								placeholder="Ask questions or provide guidance to the backcasting process..."
								class="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
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
								class="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors disabled:cursor-not-allowed"
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
							<!-- Debug info -->
							<div class="mb-3 text-xs text-gray-500 text-center">
								Debug: {questTree.rootNodeIds.length} root quests, {Object.keys(questTree.nodes).length} total nodes
							</div>
							
							{#if pendingNewHolonId}
								<div class="mb-3 p-3 bg-gray-700 border border-gray-600 rounded-lg text-xs text-white">
									<div class="flex items-center justify-between">
										<span>New holon ready: {pendingNewHolonId}</span>
										<button 
											class="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 rounded text-xs transition-colors" 
											on:click={() => window.location.href = `/${pendingNewHolonId}`}
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
													class={getQuestNodeStyling(node.generation, node.childIds?.length > 0)}
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
													{#if node.generation > 1}
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
								<div class="text-gray-400 text-xs text-center p-4">
									🔄 Generating seed quests... Please wait.
								</div>
							{:else}
								<div class="text-gray-400 text-xs text-center p-4">
									🎯 Click "Generate Quests" to begin backcasting from the future
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
							<!-- Main Generate Quests Button -->
							<button
								on:click={() => showSaveMenu = !showSaveMenu}
								disabled={isSavingQuests}
								class="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-600 disabled:to-gray-600 text-white p-3 rounded-lg text-sm font-semibold text-center transition-all duration-200 disabled:cursor-not-allowed shadow-lg"
								aria-label="Generate Quests"
							>
								{isSavingQuests ? '🔄 Saving…' : '🎯 Generate Quests'}
							</button>
							
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
							
							<!-- Complete Session Button -->
							<button
								on:click={completeSession}
								class="w-full bg-green-600 hover:bg-green-700 text-white p-2 rounded-lg text-sm font-medium transition-colors border border-green-500 shadow-sm"
								title="Complete this Design Streams session and save to Previous Rituals"
							>
								✅ Complete Session
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if} 