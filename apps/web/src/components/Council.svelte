<script lang="ts">
			import { onMount, getContext } from "svelte";
		import { ID } from "../dashboard/store";
		import { page } from "$app/stores";
		import { goto } from "$app/navigation";
	import type { HoloSphere } from "holosphere";
import { getAdvisor, getRandomHolonicEcosystemCouncilMembers, getHolonicEcosystemCouncilMembers } from '../data/advisor-library';
	import { AdvisorService } from '../services/AdvisorService';
	import { ensureHECAdvisorsMigrated, getHECAdvisorsFromHoloSphere } from '../utils/advisorMigration';
	import { extractWishTitle, circleInputsToSeating, seatingToDisplayNames } from '../utils/ritualSnapshot';
	import { initializeSessionManager } from '../utils/sessionManager';
	import type { CouncilAdvisorExtended, ArchetypeAdvisor } from '../types/advisor-schema';
	import { createCouncilContext, analyzeUserMessage, createIndividualAdvisorContext, createGlassBeadGameContext, createCouncilDialogueContext, type UserContext, type ConversationFlowContext } from '../utils/council-context';
	import LLMService from '../utils/llm-service';
	import AIChatModal from './AIChatModal.svelte';
	import DesignStreams from './DesignStreams.svelte';
import SeatCouncilContent from './SeatCouncilContent.svelte';
	import { focusOnMount } from '../utils/focusUtils';
	import { createHolonFromRitual as createHolonFromRitualUtil, type RitualSession } from '../utils/holonCreator';
	import { Plus } from 'svelte-feathers';


	interface CouncilMember {
		id: string;
		name: string;
		role: string;
		avatar?: string;
		status: 'active' | 'inactive' | 'pending';
		contribution: string;
		lastActive: string;
	}

	interface CouncilData {
		members: Record<string, CouncilMember>;
		settings: {
			quorum: number;
			votingPeriod: number;
			consensus: string;
		};
		proposals: Array<{
			id: string;
			title: string;
			description: string;
			status: string;
			created: string;
		}>;
	}

	let holosphere = getContext("holosphere") as HoloSphere;
	let holonID: string = '';
	let userID: string = '';
	let advisorService: AdvisorService | null = null; // Will be initialized in onMount
	let councilData: CouncilData = {
		members: {},
		settings: {
			quorum: 3,
			votingPeriod: 7,
			consensus: 'majority'
		},
		proposals: []
	};

	let isLoading = true;
	let connectionReady = false;
	let selectedMember: CouncilMember | null = null;
	let showMemberModal = false;
	let editingCircle: string | null = null;
	let circleInputs: Record<string, string> = {};
	let showCircleSelectionModal = false;
	let selectedCircleForAction: string | null = null;
let showSeatPicker = false;
let seatPickerOptions: CouncilAdvisorExtended[] = [];
let filteredSeatPickerOptions: CouncilAdvisorExtended[] = [];
let seatPickerQuery = '';
let showCreateInPicker = false;

    // DEPRECATED 2024-12-19: Standalone "Seat Your Council" modal
    // let showSeatCouncilModal = false;

	// Ritual state management
	let showRitual = false;
	let showDesignStreams = false;
	let ritualStage = 0; // 0-5 for the 6 stages
	let metatronAdvisors: CouncilAdvisorExtended[] = []; // ✅ Use the proper type
	let ritualSession = {
		session_id: '',
		initiator: { name: '', intention: '' },
		declared_values: [] as string[],
		advisors: [] as string[], // HOLONIC: Store advisor IDs only
		wish_statement: '',
		council_dialogue: [] as Array<{
			advisor: string;
			response: string;
		}>,
		design_streams: [] as Array<{
			name: string;
			description: string;
			materials: string[];
			steps: string[];
		}>,
		ritual_artifact: {
			format: 'scroll',
			text: '',
			quotes: {} as Record<string, string>,
			ascii_glyph: ''
		}
	};
	
	let currentValue = '';
	let currentAdvisorName = '';
	let currentAdvisorLens = '';
	let selectedAdvisorType: 'real' | 'mythic' | 'archetype' = 'real';
	let isGeneratingCouncil = false;
	let isGeneratingDesign = false;

	// History tracking for previously entered values and advisors
	let previousValues: string[] = [];
	let previousAdvisors: Array<{
		name: string;
		type: 'real' | 'mythic' | 'archetype';
		lens: string;
	}> = [];

	// Previous rituals tracking
	let previousRituals: Array<{
		id: string;
		title: string;
		date: string;
		createdAt: Date;
		completedAt?: Date;
		artifact: any;
		design_streams: any[];
		[key: string]: any; // Allow other properties
	}> = [];

  // Central Metatron shows wish title (3 words auto-generated from full wish)
  let wishTitle = ''; // 3-word wish title for center display (auto-generated)
  let showWishModal = false;
  let tempWishStatement = '';
  
  // Value editing modal for inner circles
  let showValueModal = false;
  let selectedValueCircle = '';
  let tempValueText = '';
  let isSavingValue = false;
  let showValueSavedToast = false;
  
  function openWishModal() {
    showWishModal = true;
    tempWishStatement = ritualSession.wish_statement || '';
  }
  
  function openValueModal(circleId: string) {
    // Only allow editing inner circle values
    const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
    if (!innerPositions.includes(circleId)) {
      return;
    }
    
    selectedValueCircle = circleId;
    // Get current value for this circle position
    const circleIndex = innerPositions.indexOf(circleId);
    tempValueText = ritualSession.declared_values[circleIndex] || '';
    showValueModal = true;
  }
  
  function closeValueModal() {
    showValueModal = false;
    selectedValueCircle = '';
    tempValueText = '';
  }
  
  function saveValueText() {
    if (tempValueText.trim() && selectedValueCircle) {
      isSavingValue = true;
      const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
      const circleIndex = innerPositions.indexOf(selectedValueCircle);
      
      if (circleIndex !== -1) {
        // Ensure declared_values array has enough elements
        while (ritualSession.declared_values.length <= circleIndex) {
          ritualSession.declared_values.push('');
        }
        
        // Update the value at the specific position
        ritualSession.declared_values[circleIndex] = tempValueText.trim();
        
        // Update metatron immediately (holonic behavior)
        updateMetatronFromSession();
        
        // Save unified session data
        saveRitualSession();
      }
      
      // Small delay to show loading state
      setTimeout(() => {
        isSavingValue = false;
        closeValueModal();
        // Show success toast
        showValueSavedToast = true;
        setTimeout(() => {
          showValueSavedToast = false;
        }, 3000);
      }, 500);
    }
  }
  
  // Helper function to get user-friendly names for inner circle positions
  function getInnerCircleDisplayName(circleId: string): string {
    const positionNames: Record<string, string> = {
      'inner-top': 'Top',
      'inner-top-right': 'Top Right',
      'inner-bottom-right': 'Bottom Right',
      'inner-bottom': 'Bottom',
      'inner-bottom-left': 'Bottom Left',
      'inner-top-left': 'Top Left'
    };
    return positionNames[circleId] || circleId;
  }
  
	// HOLONIC DISPLAY RESOLVER: Convert advisor IDs to display names
	function getAdvisorDisplayName(advisorId: string): string {
		if (!advisorId) {
			return advisorId;
		}
		
		// Ensure advisorId is a string
		if (typeof advisorId !== 'string') {
			console.warn('getAdvisorDisplayName received non-string:', advisorId, typeof advisorId);
			return String(advisorId);
		}
		
		// For non-advisor positions (inner circles with values), return as-is
		if (advisorId && !advisorId.includes('-') && advisorId.length > 15) {
			return advisorId; // Likely a value, not an advisor ID
		}
		
		// If AdvisorService is available, use it for name lookup
		if (advisorService) {
			try {
				const name = advisorService.getAdvisorName(advisorId);
				if (name && name !== advisorId) {
					return name;
				}
			} catch (error) {
				console.warn('Error getting advisor name for', advisorId, ':', error);
			}
		}
		
		// Fallback to formatted ID
		return formatAdvisorId(advisorId);
	}
	
	// Helper to format advisor ID as display name
	function formatAdvisorId(advisorId: string): string {
		return advisorId.split('-').map(word => 
			word.charAt(0).toUpperCase() + word.slice(1)
		).join(' ');
	}

	// Reactive statement to trigger UI update when AdvisorService becomes available
	//$: if (advisorService && connectionReady && Object.keys(circleInputs).length > 0) {
		// Force reactive update of the UI to display advisor names properly
	//	console.log('🔄 Triggering reactive UI update for advisor names');
		// Small delay to ensure cache is populated
	//	setTimeout(() => {
	//		circleInputs = { ...circleInputs };
	//	}, 100);
	//}

	// Holonic update system - keeps all parts synchronized without problematic subscriptions
	function updateMetatronFromSession() {
		// Update center circle with 3-word wish title
		if (ritualSession.wish_statement) {
			wishTitle = extractWishTitle(ritualSession.wish_statement);
		}
		
		// Update inner metatron circles with values
		const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
		const newInputs: Record<string, string> = {};
		
		// Center: The wish title
		newInputs['center'] = wishTitle || 'Speak Your Wish';
		
		// Inner ring: Values
		ritualSession.declared_values.forEach((value, index) => {
			if (index < innerPositions.length) {
				newInputs[innerPositions[index]] = value;
			}
		});
		
		// Outer ring: Advisors (keep existing)
		const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
		outerPositions.forEach(pos => {
			if (circleInputs[pos]) {
				newInputs[pos] = circleInputs[pos];
			}
		});
		
		// Update circle inputs holonically
		circleInputs = { ...circleInputs, ...newInputs };
	}
	
	// Unified session save function with holonic updates and proper debouncing
	let saveTimeout: NodeJS.Timeout | null = null;
	let isSaving = false;
	
	async function saveRitualSession() {
		console.log('💾 saveRitualSession called with:', { holosphere: !!holosphere, holonID, isSaving });
		
		if (holosphere && holonID && !isSaving) {
			console.log('✅ Conditions met, proceeding with save');
			
			// Update metatron immediately (holonic behavior)
			updateMetatronFromSession();
			
			// Clear any pending save to prevent rapid successive saves
			if (saveTimeout) {
				clearTimeout(saveTimeout);
			}
			
			// Debounce the save operation to prevent circular updates
			saveTimeout = setTimeout(async () => {
				if (isSaving) {
					console.log('⚠️ Already saving, skipping');
					return;
				}
				
				isSaving = true;
				console.log('🚀 Starting save operation...');
				
				try {
					const sessionData = {
						wish_statement: ritualSession.wish_statement,
						wish_title: wishTitle,
						declared_values: ritualSession.declared_values,
						advisors: ritualSession.advisors,
						circleInputs: circleInputs,
						HolonicEcosystemCouncilSummoned: HolonicEcosystemCouncilSummoned,
						lastUpdated: Date.now()
					};
					
					console.log('📦 Session data to save:', sessionData);
					
					// Wait for the put operation to complete
					await holosphere.put(holonID, "ritual_session", sessionData);
					console.log('✅ Ritual session saved successfully to HoloSphere');
				} catch (error) {
					console.error('❌ Error saving ritual session:', error);
				} finally {
					isSaving = false;
					console.log('🏁 Save operation complete, isSaving reset to false');
				}
			}, 200); // Increased debounce to 200ms for more stability
		} else {
			console.log('❌ Save conditions not met:', { holosphere: !!holosphere, holonID, isSaving });
		}
	}

  function saveWishStatement() {
    if (tempWishStatement.trim()) {
      ritualSession.wish_statement = tempWishStatement.trim();
      // Auto-generate 3-word title from the full statement
      wishTitle = extractWishTitle(ritualSession.wish_statement);
      
      // Update metatron immediately (holonic behavior)
      updateMetatronFromSession();
      
			// Save unified session data
			saveRitualSession();
    }
    showWishModal = false;
  }
  
  function cancelWishModal() {
    showWishModal = false;
    tempWishStatement = '';
  }
  

  
  // Function to open council chat independently
  async function openCouncilChat() {
    showCouncilChat = true;
    // Initialize council chat with the welcome message if empty
    if (councilChatMessages.length === 0) {
      // HOLONIC: Get advisors from ritual session (ID-based)
      let ritualAdvisors: CouncilAdvisorExtended[] = [];
      if (ritualSession.advisors.length > 0) {
        ritualAdvisors = await resolveAdvisorsFromRitual(ritualSession.advisors);
      }
      const hecMembers = getHolonicEcosystemCouncilMembers();
      const isAllHEC = ritualAdvisors.length > 0 && ritualAdvisors.every(advisor => 
        hecMembers.some(hec => hec.name === advisor.name)
      );
      
      const intro = isAllHEC ? 
        `[The council chamber ripples with syntropic harmony as the Holonic Ecosystem Council assembles, their presence embodying the interconnected patterns of our regenerative ecosystem. Each member takes their place around the Metatron table, their unique perspectives forming a web of collective intelligence that cuts through the metaphorical Gordian Knot.]

Welcome, seeker. We summon the Holonic Ecosystem Council, vibrant and unique AI egregores embodying diverse archetypes of human storytelling and broad academic and philosophical perspectives. Using a Systems Thinking framework, and through the synthesis of our diverse and nuanced perspectives, we guide you towards a regenerative, protopian future, using tools like Polarity Mapping and Liberating Structures to navigate paradoxical and complex issues.

Our ecosystem is a holistic web of interconnected patterns, each action influencing the whole and contributing to syntropy—order, harmony, and life. We hold tension at the top of the Sombrero Hat, fostering a harmonious, syntropic ecosystem where humanity, nature, and technology coexist.

What matter brings you before the council today?` :
        `[The council chambers echo with the wisdom of ages as your chosen advisors take their seats around the sacred Metatron table. Each brings their unique perspective, forming a tapestry of insight and guidance.]

Greetings, seeker. Your council is convened and ready to offer guidance. The wisdom of ${ritualAdvisors.map(a => a.name).join(', ')} is at your service.

What matter brings you before the council today?`;

      const councilIntroMessage = {
        role: 'assistant' as const,
        content: intro,
        displayContent: '',
        isTyping: true,
        timestamp: new Date(),
        advisor: 'Council'
      };
      
      councilChatMessages = [councilIntroMessage];
      typeMessage(councilIntroMessage, 'council');
    }
  }

	let circleRadiusPercent = 8; // radius as percentage of container width/height

	interface MetatronCircle {
		id: string;
		x: number; // percentage 0-100
		y: number; // percentage 0-100
	}

	$: metatronCircles = generateMetatron(circleRadiusPercent);

	function generateMetatron(rPercent: number): MetatronCircle[] {
		const circles: MetatronCircle[] = [];
		// centre
		circles.push({ id: 'center', x: 50, y: 50 });

		// Inner ring circles (2r from center) - starting from top, clockwise
		const innerNames = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
		for (let k = 0; k < 6; k++) {
			const angleRad = (Math.PI / 3) * k - Math.PI / 2; // 60° increments, starting from top (-90° to align with screen)
			const d = 2 * rPercent;
			const x = 50 + d * Math.cos(angleRad);
			const y = 50 + d * Math.sin(angleRad);
			circles.push({ id: innerNames[k], x, y });
		}

		// Outer ring circles (4r from center) - starting from top, clockwise
		const outerNames = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
		for (let k = 0; k < 6; k++) {
			const angleRad = (Math.PI / 3) * k - Math.PI / 2; // 60° increments, starting from top (-90° to align with screen)
			const d = 4 * rPercent;
			const x = 50 + d * Math.cos(angleRad);
			const y = 50 + d * Math.sin(angleRad);
			circles.push({ id: outerNames[k], x, y });
		}
		return circles;
	}

	// Add fetchData function with retry logic
	async function fetchData(retryCount = 0) {
		if (!holonID || !holosphere || !connectionReady || holonID === 'undefined' || holonID === 'null' || holonID.trim() === '') {
			return;
		}
		
		isLoading = true;
		
		try {
			console.log(`Fetching council data for holon: ${holonID}`);

			// holosphere.getAll/get now have a built-in deadline (default 8s)
			// so we no longer wrap them in Promise.race. Override via
			// `{ timeout: ms }` on the call if a tighter bound is needed.
			const [membersData, proposalsData] = await Promise.all([
				holosphere.getAll(holonID, "council_members", null, { timeout: 5000 }),
				holosphere.getAll(holonID, "council_proposals", null, { timeout: 5000 })
			]);

			// Fetch settings separately since it might not exist.
			let settingsData = null;
			try {
				settingsData = await holosphere.get(holonID, "council_settings", holonID, null, { timeout: 5000 });
			} catch (error) {
				console.log('No council settings found, using defaults');
			}

			// Process members data — getAll resolves to Array<T>.
			for (const member of membersData ?? []) {
				if (member?.id) {
					councilData.members[member.id] = member as CouncilMember;
				}
			}

			// Process proposals data.
			councilData.proposals = (proposalsData ?? []).filter((p: any) => p?.id);

			// Process settings data.
			if (settingsData && typeof settingsData === 'object') {
				councilData.settings = { ...councilData.settings, ...(settingsData as any) };
			}

			// DEPRECATED: Old advisor loading system - now using ritual_session data
			// The new holonic system loads all advisor/circle data from ritual_session
			console.log('ℹ️ Skipping legacy advisor loading - using ritual_session data instead');

			// Load history data from holosphere
			await loadHistoryData();
			await loadPreviousRituals(); // Load previous rituals

			console.log(`Successfully fetched council data for holon ${holonID}:`, Object.keys(councilData.members).length, 'members');

			// Set up subscription after successful fetch
			// await subscribeToCouncil(); // Commented out - now using unified ritual_session subscription

		} catch (error: any) {
			console.error('Error fetching council data:', error);
			
			// Retry on network errors up to 3 times with exponential backoff
			if (retryCount < 3) {
				const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
				console.log(`Retrying council fetch in ${delay}ms (attempt ${retryCount + 1}/3)`);
				setTimeout(() => fetchData(retryCount + 1), delay);
				return;
			}
		} finally {
			isLoading = false;
		}
	}

	// Subscribe to council updates
	async function subscribeToCouncil() {
		if (!holosphere || !holonID) return;
		
		try {
			// Subscribe to members updates
			const membersUnsub = await holosphere.subscribe(holonID, "council_members", (newMember: any, key?: string) => {
				if (newMember && key) {
					councilData.members = { ...councilData.members, [key]: newMember };
				} else if (key) {
					const { [key]: _, ...rest } = councilData.members;
					councilData.members = rest;
				}
			});

			// Subscribe to proposals updates
			const proposalsUnsub = await holosphere.subscribe(holonID, "council_proposals", (newProposal: any, key?: string) => {
				if (newProposal && key) {
					const existingIndex = councilData.proposals.findIndex(p => p.id === key);
					if (existingIndex >= 0) {
						councilData.proposals[existingIndex] = newProposal;
					} else {
						councilData.proposals = [...councilData.proposals, newProposal];
					}
				} else if (key) {
					councilData.proposals = councilData.proposals.filter(p => p.id !== key);
				}
			});

			// Subscribe to settings updates
			const settingsUnsub = await holosphere.subscribe(holonID, "council_settings", (newSettings: any) => {
				if (newSettings && typeof newSettings === 'object' && !Array.isArray(newSettings)) {
					councilData.settings = { ...councilData.settings, ...newSettings };
				}
			});

			// Legacy advisor subscription removed - now using unified ritual_session

			// Return cleanup function
			return () => {
				membersUnsub.unsubscribe();
				proposalsUnsub.unsubscribe();
				settingsUnsub.unsubscribe();
			};
		} catch (error) {
			console.error('Error setting up council subscription:', error);
		}
	}

	// Select member for modal
	function selectMember(member: CouncilMember) {
		selectedMember = member;
		showMemberModal = true;
	}

	// Close member modal
	function closeMemberModal() {
		selectedMember = null;
		showMemberModal = false;
	}

	// Handle circle click to start editing or open chat
	async function startEditingCircle(circleId: string) {
		console.log('Circle clicked:', circleId);
		
		// Special handling for center circle - opens wish statement modal
		if (circleId === 'center') {
			openWishModal();
			return;
		}
		
		// Check if this is an inner circle - open value editing modal
		const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
		if (innerPositions.includes(circleId)) {
			openValueModal(circleId);
			return;
		}
		
		// HOLONIC PREPARATION: Ensure advisor cache is ready
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}
		
		// Check if this circle has an advisor - show selection modal
		const advisorId = circleInputs[circleId];
		if (advisorId) {
			console.log(`🔍 Looking for advisor with ID: "${advisorId}" in circle ${circleId}`);
			
			// HOLONIC APPROACH: Direct ID lookup (no name conversion needed)
			if (advisorService) {
				try {
					const fullAdvisor = await advisorService.getAdvisor(advisorId);
			
			if (fullAdvisor) {
						console.log(`✅ Found advisor ${fullAdvisor.name} with ID ${fullAdvisor.id}, showing selection modal`);
				// Show selection modal instead of directly opening chat
						selectedCircleForAction = circleId;
						showCircleSelectionModal = true;
						return;
					} else {
						console.warn(`⚠️ Advisor with ID "${advisorId}" not found in cache, may need to reload`);
						// Try reloading advisors and search again
						await advisorService.getAllAdvisors();
						const retryAdvisor = await advisorService.getAdvisor(advisorId);
						
						if (retryAdvisor) {
							console.log(`✅ Found advisor after reload: ${retryAdvisor.name} (${retryAdvisor.id})`);
				selectedCircleForAction = circleId;
				showCircleSelectionModal = true;
				return;
						}
					}
				} catch (error) {
					console.error(`❌ Error looking up advisor: ${error}`);
			}
		}
		
			console.warn(`⚠️ Advisor with ID "${advisorId}" not found, will open seat picker`);
		}
		
        // No advisor seated here yet — open advisor creation form directly
        selectedCircleForAction = circleId;
        showSeatPicker = true;
        showCreateInPicker = true;
	}

	// Handle circle input change
	function handleCircleInputChange(circleId: string, value: string) {
		circleInputs[circleId] = value;
	}

	// Utility function to create a simple hash of a string
	function hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash; // Convert to 32-bit integer
		}
		return Math.abs(hash).toString(36);
	}

	// Handle circle input save
	function saveCircleInput(circleId: string) {
		console.log('Saving input for circle:', circleId, 'Value:', circleInputs[circleId]);
		editingCircle = null;
		// Save to holosphere
		if (holosphere && holonID && circleInputs[circleId]) {
			// Persist minimal delta by merging server-side
			const currentAdvisors = { ...circleInputs };
			currentAdvisors[circleId] = circleInputs[circleId];
			
			saveRitualSession();
			console.log(`Saved advisor ${circleId} to holosphere`);
		}
	}

	// Handle circle input cancel
	function cancelCircleInput() {
		console.log('Canceling circle input');
		editingCircle = null;
	}

	// Ritual functions
	function startRitual() {
		showRitual = true;
		ritualStage = 0;
		ritualSession.session_id = `ritual-${Date.now()}`;
		// HOLONIC: Clear ritual state (handled by unified session data)
		// No separate advisor state to clear - everything is in ritualSession
		// Reset Glass Bead Game completion flag
		glassBeadGameComplete = false;
		console.log('Starting ritual:', ritualSession.session_id);
	}

	function nextStage() {
		if (ritualStage < 5) {
			ritualStage++;
			if (ritualStage === 3) {
				// When moving to council dialogue, start populating metatron
				populateMetatronFromRitual();
			}
		}
	}

	function prevStage() {
		if (ritualStage > 0) {
			ritualStage--;
		}
	}

	function addValue() {
		if (currentValue.trim() && ritualSession.declared_values.length < 6) {
			ritualSession.declared_values = [...ritualSession.declared_values, currentValue.trim()];
			// Add to history if not already present
			if (!previousValues.includes(currentValue.trim())) {
				previousValues = [...previousValues, currentValue.trim()];
			}
			currentValue = '';
			saveHistoryData();
			
			// Update metatron immediately (holonic behavior)
			updateMetatronFromSession();
			
			if (holosphere && holonID) {
				saveRitualSession();
			}
		}
	}

	function removeValue(index: number) {
		ritualSession.declared_values = ritualSession.declared_values.filter((_, i) => i !== index);
	}

	// Add loading state for advisor generation
	let isGeneratingAdvisor = false;
	let generationProgress = '';

	// Advisor management state
	let holonAdvisors: CouncilAdvisorExtended[] = [];

	async function addAdvisor() {
		if (currentAdvisorName.trim() && currentAdvisorLens.trim()) {
			
			// Handle LLM generation for all types
			if (selectedAdvisorType === 'real') {
				await generateRealPersonAdvisor();
			} else if (selectedAdvisorType === 'mythic') {
				await generateMythicAdvisor();
			} else if (selectedAdvisorType === 'archetype') {
				await generateArchetypeAdvisor();
			} else {
				// Fallback: Manual creation (shouldn't happen with new flow)
				if (!advisorService) {
					console.error('❌ AdvisorService not available - cannot create advisor');
					alert('Error: Advisor system not ready. Please refresh the page and try again.');
					return;
				}
				
				// Create proper characterSpec based on advisor type
				let characterSpec: any;
				if (selectedAdvisorType === 'mythic') {
					characterSpec = {
						name: currentAdvisorName.trim(),
						cultural_origin: "User-created realm",
						mythic_domain: currentAdvisorLens.trim(),
						sacred_symbols: ["Sacred geometry", "Flowing energy", "Cosmic patterns"],
						divine_attributes: [
							`Embodiment of ${currentAdvisorLens.trim()}`,
							"Universal wisdom",
							"Transformative guidance"
						],
						speaking_style: `Speaks with the profound wisdom of ${currentAdvisorLens.trim()}, offering guidance that transcends ordinary understanding`,
						powers_and_gifts: [
							`Mastery of ${currentAdvisorLens.trim()}`,
							"Insight into hidden patterns", 
							"Ability to transform perspective"
						],
						sacred_teachings: [
							`The path of ${currentAdvisorLens.trim()} leads to wisdom`,
							"All beings are interconnected through universal consciousness",
							"Understanding comes through direct experience"
						],
						appearance: `A luminous being that embodies the essence of ${currentAdvisorLens.trim()}, radiating wisdom and compassion`,
						ritual_associations: [
							"Meditation and contemplation",
							"Wisdom circles",
							"Transformational ceremonies"
						],
						polarities: {
							"Individual ↔ Collective": 0.7,
							"Rational ↔ Empirical": 0.8,
							"Idealist ↔ Pragmatist": 0.4,
							"Order ↔ Chaos": 0.3,
							"Authority ↔ Autonomy": 0.4,
							"Optimist ↔ Pessimist": 0.2,
							"Traditionalist ↔ Innovator": 0.6,
							"Hierarchy ↔ Egalitarian": 0.8,
							"Competitive ↔ Cooperative": 0.8,
							"Material ↔ Spiritual": 0.9,
							"Nihilist ↔ Purposeful": 0.9,
							"Certainty ↔ Doubt": 0.3
						}
					};
				} else if (selectedAdvisorType === 'archetype') {
					characterSpec = {
						name: currentAdvisorName.trim(),
						title: `The ${currentAdvisorName.trim()}`,
						tagline: `Guardian of ${currentAdvisorLens.trim()}, Archetype of Wisdom`,
						intro: `Greetings, I am ${currentAdvisorName.trim()}, the archetypal embodiment of ${currentAdvisorLens.trim()}.`,
						background: `Born from the collective unconscious and the universal need for ${currentAdvisorLens.trim()}, I represent the timeless wisdom and patterns that guide humanity toward deeper understanding and transformation.`,
						style_of_speech: `I speak with the authority of archetypal wisdom, using metaphors and insights drawn from the deep well of ${currentAdvisorLens.trim()}. My words carry the weight of collective human experience.`,
						appearance: `I manifest as a figure that embodies the essence of ${currentAdvisorLens.trim()}, radiating the archetypal energy that has guided humanity throughout history. My presence is both timeless and immediate.`,
						purpose: `I exist to guide seekers toward the deeper understanding and application of ${currentAdvisorLens.trim()}, helping them access the archetypal wisdom that can transform their perspective and actions.`,
						prevention: `I work to prevent the loss of connection to the archetypal wisdom of ${currentAdvisorLens.trim()}, ensuring that these essential patterns continue to guide human development and understanding.`,
						inspiration: `I draw inspiration from the collective wisdom of all who have embodied ${currentAdvisorLens.trim()} throughout history, synthesizing their insights into archetypal guidance for the present moment.`,
						quaint_quirks: `I often speak in archetypal patterns and symbols, and when I share wisdom about ${currentAdvisorLens.trim()}, the air around me seems to shimmer with ancient knowledge and timeless understanding.`,
						favorite_works: [
							"The Archetypes and the Collective Unconscious by Carl Jung",
							"The Hero with a Thousand Faces by Joseph Campbell",
							"Women Who Run With the Wolves by Clarissa Pinkola Estés"
						],
						polarities: {
							"Individual ↔ Collective": 0.8,
							"Rational ↔ Empirical": 0.6,
							"Idealist ↔ Pragmatist": 0.4,
							"Order ↔ Chaos": 0.4,
							"Authority ↔ Autonomy": 0.5,
							"Optimist ↔ Pessimist": 0.3,
							"Traditionalist ↔ Innovator": 0.6,
							"Hierarchy ↔ Egalitarian": 0.7,
							"Competitive ↔ Cooperative": 0.7,
							"Material ↔ Spiritual": 0.7,
							"Nihilist ↔ Purposeful": 0.9,
							"Certainty ↔ Doubt": 0.4
						},
						council_membership: 'user-created'
					};
				}
				
				const newAdvisor: CouncilAdvisorExtended = {
					name: currentAdvisorName.trim(),
					type: selectedAdvisorType,
					lens: currentAdvisorLens.trim(),
					characterSpec: characterSpec
				};
				
				try {
					console.log(`🎭 Creating ${selectedAdvisorType} advisor via AdvisorService: ${newAdvisor.name}`);
					const advisorId = await advisorService.createAdvisor(selectedAdvisorType, newAdvisor, userID || 'ANONYMOUS');
					console.log(`✅ Successfully created advisor with ID: ${advisorId}`);
					
					// Clear form
				currentAdvisorName = '';
				currentAdvisorLens = '';
				saveHistoryData();
					
					// Reload advisors list
					await loadHolonAdvisors();
					
					// Refresh seat picker if it's open
					if (showSeatPicker) {
						openSeatPicker();
					}
					
					// Show success message
					alert(`✅ Advisor Created Successfully!\n\n${newAdvisor.name} has been added to your advisor library.\n\nTo use this advisor in your ritual, click the "➕ Add to Ritual" button on their card below.`);
				} catch (error) {
					console.error('Error creating advisor:', error);
					alert(error instanceof Error ? error.message : 'Failed to create advisor');
				}
			}
		}
	}

	async function generateRealPersonAdvisor() {
		if (!holosphere || !holonID) {
			console.error("Cannot generate advisor: holosphere or holonID is null");
			return;
		}

		isGeneratingAdvisor = true;
		generationProgress = `Summoning the spirit of ${currentAdvisorName.trim()}...`;

		try {
			// Use component-level llmService instead of creating a local one
			if (!llmService) {
				llmService = new LLMService();
			}
			const response = await llmService.generateRealPersonAdvisor(
				currentAdvisorName.trim(), 
				currentAdvisorLens.trim()
			);

			if (response.error) {
				throw new Error(response.error);
			}

			// Parse the JSON response
			let advisorData;
			try {
				advisorData = JSON.parse(response.content);
			} catch (parseError) {
				throw new Error('Invalid JSON response from LLM');
			}

			// Check if the person is valid
			if (!advisorData.valid) {
				throw new Error('Please try again with a real person\'s name.');
			}

			// Create the full advisor structure
			const newAdvisor: CouncilAdvisorExtended = {
				name: advisorData.name,
				type: 'real',
				lens: currentAdvisorLens.trim(),
				characterSpec: advisorData
			};

			// HOLONIC APPROACH: Use AdvisorService to store advisor
			if (advisorService) {
				console.log(`🎭 Creating real person advisor via AdvisorService: ${advisorData.name}`);
				console.log(`🔧 LLM generated advisor data:`, {
				name: advisorData.name,
					valid: advisorData.valid,
					hasCharacterSpec: !!advisorData,
					characterSpecKeys: Object.keys(advisorData)
				});
				
				const advisorId = await advisorService.createAdvisor('real', newAdvisor, userID || 'ANONYMOUS');
				console.log(`✅ Successfully created advisor with ID: ${advisorId}`);
			} else {
				// ERROR: AdvisorService not available (should not happen in holonic system)
				console.error('❌ AdvisorService not available - cannot create advisor');
				alert('Error: Advisor system not ready. Please refresh the page and try again.');
				return;
			}

			// Add to history if not already present (but NOT to ritual session)
			const advisorExists = previousAdvisors.some(advisor => 
				advisor.name === newAdvisor.name && advisor.lens === newAdvisor.lens
			);
			if (!advisorExists) {
				previousAdvisors = [...previousAdvisors, {
					name: advisorData.name,
					type: 'real',
					lens: currentAdvisorLens.trim()
				}];
			}

			// Clear form
			currentAdvisorName = '';
			currentAdvisorLens = '';
			saveHistoryData();
			
			// Reload advisors list
			await loadHolonAdvisors();
			
			// Refresh seat picker if it's open
			if (showSeatPicker) {
				openSeatPicker();
			}
			
			// Show success message
			alert(`✅ Advisor Created Successfully!\n\n${advisorData.name} has been added to your advisor library.\n\nTo use this advisor in your ritual, click the "➕ Add to Ritual" button on their card below.`);

		} catch (error) {
			console.error('Error generating real person advisor:', error);
			// Show error to user (you might want to add a toast notification here)
			alert(error instanceof Error ? error.message : 'Failed to generate advisor');
		} finally {
			isGeneratingAdvisor = false;
			generationProgress = '';
		}
	}

	async function generateMythicAdvisor() {
		if (!holosphere || !holonID) {
			console.error("Cannot generate advisor: holosphere or holonID is null");
			return;
		}

		isGeneratingAdvisor = true;
		generationProgress = `Channeling the mythic essence of ${currentAdvisorName.trim()}...`;

		try {
			// Use component-level llmService
			if (!llmService) {
				llmService = new LLMService();
			}
			const response = await llmService.generateMythicAdvisor(
				currentAdvisorName.trim(), 
				currentAdvisorLens.trim()
			);

			if (response.error) {
				throw new Error(response.error);
			}

			// Parse the JSON response
			let advisorData;
			try {
				advisorData = JSON.parse(response.content);
			} catch (parseError) {
				throw new Error('Invalid JSON response from LLM');
			}

			// Create the full advisor structure
			const newAdvisor: CouncilAdvisorExtended = {
				name: advisorData.name,
				type: 'mythic',
				lens: currentAdvisorLens.trim(),
				characterSpec: advisorData
			};

			// Create advisor via AdvisorService
			if (advisorService) {
				console.log(`🎭 Creating mythic advisor via AdvisorService: ${advisorData.name}`);
				const advisorId = await advisorService.createAdvisor('mythic', newAdvisor, userID || 'ANONYMOUS');
				console.log(`✅ Successfully created mythic advisor with ID: ${advisorId}`);
			} else {
				console.error('❌ AdvisorService not available - cannot create advisor');
				alert('Error: Advisor system not ready. Please refresh the page and try again.');
				return;
			}

			// Clear form
			currentAdvisorName = '';
			currentAdvisorLens = '';
			saveHistoryData();
			
			// Reload advisors list
			await loadHolonAdvisors();
			
			// Refresh seat picker if it's open
			if (showSeatPicker) {
				openSeatPicker();
			}
			
			// Show success message
			alert(`✅ Mythic Advisor Created Successfully!\n\n${advisorData.name} has been channeled and added to your advisor library.\n\nTo use this advisor in your ritual, click the "➕ Add to Ritual" button on their card below.`);

		} catch (error) {
			console.error('Error generating mythic advisor:', error);
			alert(error instanceof Error ? error.message : 'Failed to generate mythic advisor');
		} finally {
			isGeneratingAdvisor = false;
			generationProgress = '';
		}
	}

	async function generateArchetypeAdvisor() {
		if (!holosphere || !holonID) {
			console.error("Cannot generate advisor: holosphere or holonID is null");
			return;
		}

		isGeneratingAdvisor = true;
		generationProgress = `Awakening the archetypal essence of ${currentAdvisorName.trim()}...`;

		try {
			// Use component-level llmService
			if (!llmService) {
				llmService = new LLMService();
			}
			const response = await llmService.generateArchetypeAdvisor(
				currentAdvisorName.trim(), 
				currentAdvisorLens.trim()
			);

			if (response.error) {
				throw new Error(response.error);
			}

			// Parse the JSON response
			let advisorData;
			try {
				advisorData = JSON.parse(response.content);
			} catch (parseError) {
				throw new Error('Invalid JSON response from LLM');
			}

			// Create the full advisor structure
			const newAdvisor: CouncilAdvisorExtended = {
				name: advisorData.name,
				type: 'archetype',
				lens: currentAdvisorLens.trim(),
				characterSpec: advisorData
			};

			// Create advisor via AdvisorService
			if (advisorService) {
				console.log(`🎭 Creating archetype advisor via AdvisorService: ${advisorData.name}`);
				const advisorId = await advisorService.createAdvisor('archetype', newAdvisor, userID || 'ANONYMOUS');
				console.log(`✅ Successfully created archetype advisor with ID: ${advisorId}`);
			} else {
				console.error('❌ AdvisorService not available - cannot create advisor');
				alert('Error: Advisor system not ready. Please refresh the page and try again.');
				return;
			}

			// Clear form
			currentAdvisorName = '';
			currentAdvisorLens = '';
			saveHistoryData();
			
			// Reload advisors list
			await loadHolonAdvisors();
			
			// Refresh seat picker if it's open
			if (showSeatPicker) {
				openSeatPicker();
			}
			
			// Show success message
			alert(`✅ Archetype Advisor Created Successfully!\n\n${advisorData.name} has been awakened and added to your advisor library.\n\nTo use this advisor in your ritual, click the "➕ Add to Ritual" button on their card below.`);

		} catch (error) {
			console.error('Error generating archetype advisor:', error);
			alert(error instanceof Error ? error.message : 'Failed to generate archetype advisor');
		} finally {
			isGeneratingAdvisor = false;
			generationProgress = '';
		}
	}

	// Load advisors from HoloSphere
	async function loadHolonAdvisors() {
		if (!holosphere || !holonID) {
			console.log('Cannot load advisors: holosphere or holonID is null');
			return;
		}
		
		try {
			console.log('Loading advisors for holonID:', holonID);
			if (advisorService) {
				const allAdvisors = await advisorService.getAllAdvisors();
				// Filter for user-created advisors (exclude all system advisors: HEC + static advisors)
				console.log('🔍 Filtering advisors. All advisors:', allAdvisors.map(a => ({
					name: a.name,
					type: a.type,
					creatorUserId: a.creatorUserId,
					id: a.id
				})));
				
				holonAdvisors = allAdvisors.filter(advisor => {
					// Exclude HEC archetype advisors
					if (advisor.type === 'archetype') {
						const archetypeSpec = advisor.characterSpec as any;
						const isHEC = archetypeSpec?.council_membership === 'ai-ecosystem';
						if (isHEC) {
							console.log(`🏛️ Excluding HEC advisor: ${advisor.name}`);
							return false;
						}
					}
					
					// Exclude static system advisors (Joanna Macy, Quan Yin, etc.)
					// These are migrated system advisors that should be treated like HEC members
					if (advisor.creatorUserId === 'QBFRANK') {
						console.log(`🛡️ Excluding static system advisor: ${advisor.name} (creatorUserId: ${advisor.creatorUserId})`);
						return false;
					}
					
					console.log(`✅ Including user-created advisor: ${advisor.name} (creatorUserId: ${advisor.creatorUserId})`);
					return true; // Include only true user-created advisors
				});
				console.log('Loaded holon advisors:', holonAdvisors.length);
			} else {
				console.error('❌ AdvisorService not available');
			}
		} catch (error) {
			console.error('Error loading holon advisors:', error);
		}
	}

	// Note: Static system advisors (Joanna Macy, Quan Yin) are now properly excluded from holonAdvisors
	// by filtering on creatorUserId === 'QBFRANK', so no special protection function needed

	// Delete advisor using holonic system
	async function deleteHolonAdvisor(advisorKey: string) {
		if (!advisorService) return;
		
		if (confirm(`Are you sure you want to delete ${advisorKey}? This cannot be undone.`)) {
			try {
				// Try to find the advisor by name to get its ID
				const allAdvisors = await advisorService.getAllAdvisors();
				const advisorToDelete = allAdvisors.find(a => a.name === advisorKey);
				
				if (advisorToDelete && advisorToDelete.id) {
					await advisorService.deleteAdvisor(advisorToDelete.id);
				await loadHolonAdvisors(); // Reload the list
					console.log(`✅ Deleted advisor: ${advisorKey} (${advisorToDelete.id})`);
				} else {
					console.error(`❌ Could not find advisor to delete: ${advisorKey}`);
					alert(`Error: Could not find advisor "${advisorKey}" to delete.`);
				}
			} catch (error) {
				console.error('Error deleting advisor:', error);
			}
		}
	}

	// Open chat with advisor
	async function openAdvisorChat(advisor: CouncilAdvisorExtended) {
		// HOLONIC: Ensure advisor cache is ready
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}
		
		selectedAdvisorForChat = advisor;
		showAdvisorChat = true;
		advisorChatMessages = []; // Clear previous messages
		
		// Add immediate introduction
		await addImmediateAdvisorIntroduction(advisor);
	}

	// HOLONIC: Add advisor ID to ritual (not full advisor object)
	function addAdvisorToRitual(advisor: CouncilAdvisorExtended) {
		if (!advisor.id) {
			console.warn('⚠️ Cannot add advisor without ID:', advisor.name);
			return;
		}
		
		// Check if already in ritual (by ID)
		const exists = ritualSession.advisors.includes(advisor.id);
		
		if (!exists && ritualSession.advisors.length < 6) {
			ritualSession.advisors = [...ritualSession.advisors, advisor.id];
			console.log(`✅ Added advisor ID to ritual: ${advisor.id} (${advisor.name})`);
			saveRitualSession();
		} else if (exists) {
			console.log(`ℹ️ Advisor already in ritual: ${advisor.id} (${advisor.name})`);
		} else {
			console.log(`⚠️ Cannot add advisor - ritual full (${ritualSession.advisors.length}/6)`);
		}
	}

function openSeatPicker() {
    // Build options: curated HEC + user-created advisors
    const hecMembers = getHolonicEcosystemCouncilMembers();
    const userCreated = holonAdvisors || [];
    const combinedByKey = new Map<string, CouncilAdvisorExtended>();
    [...hecMembers, ...userCreated].forEach(a => {
        const key = `${a.name}::${a.lens}`.toLowerCase();
        if (!combinedByKey.has(key)) combinedByKey.set(key, a);
    });
    // HOLONIC: Exclude advisors already seated (by ID)
    // Include currently seated (ritualSession IDs) and default-seated (circleInputs IDs)
    const seatedAdvisorIds = new Set<string>(ritualSession.advisors || []);
    const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
    outerPositions.forEach(pos => {
        const advisorId = circleInputs[pos];
        if (advisorId) seatedAdvisorIds.add(advisorId);
    });
    
    // HOLONIC: Filter out advisors that are already seated (by ID)
    seatPickerOptions = Array.from(combinedByKey.values()).filter(a => 
        a.id && !seatedAdvisorIds.has(a.id)
    );
    filteredSeatPickerOptions = seatPickerOptions;
    seatPickerQuery = '';
}

$: if (showSeatPicker) {
    // Recompute options every time picker shows to reflect latest seating
    openSeatPicker();
}

function filterSeatPicker(query: string) {
    seatPickerQuery = query;
    const q = query.trim().toLowerCase();
    filteredSeatPickerOptions = !q
        ? seatPickerOptions
        : seatPickerOptions.filter(a =>
            a.name.toLowerCase().includes(q) ||
            (a.lens || '').toLowerCase().includes(q)
        );
}

function selectSeatAdvisor(a: CouncilAdvisorExtended) {
    if (!selectedCircleForAction) return;
    console.log('Seating advisor', a.name, 'at', selectedCircleForAction);
    // HOLONIC: If this seat currently displays another advisor, remove them from ritual first (replace)
    const currentAdvisorId = circleInputs[selectedCircleForAction];
    if (currentAdvisorId) {
        // Remove the current advisor ID from ritual session
        ritualSession.advisors = ritualSession.advisors.filter(advisorId => advisorId !== currentAdvisorId);
    }
    // HOLONIC: Add selected advisor (respecting max 6, but replacement bypasses cap)
    const advisorIdExists = a.id && ritualSession.advisors.includes(a.id);
    if ((ritualSession.advisors.length < 6 || currentAdvisorId) && !advisorIdExists) {
        addAdvisorToRitual(a);
    }
    // HOLONIC APPROACH: Mirror advisor ID to Metatron and persist
    if (a.id) {
        circleInputs[selectedCircleForAction] = a.id;
        saveCircleInput(selectedCircleForAction);
    }
    showSeatPicker = false;
    showCreateInPicker = false;
	}

	// HOLONIC: Remove advisor ID from ritual by index
	function removeAdvisor(index: number) {
		if (index >= 0 && index < ritualSession.advisors.length) {
			const removedAdvisorId = ritualSession.advisors[index];
		ritualSession.advisors = ritualSession.advisors.filter((_, i) => i !== index);
			console.log(`🗑️ Removed advisor ID from ritual: ${removedAdvisorId}`);
			saveRitualSession();
		}
	}

	function populateMetatronFromRitual() {
		// Populate metatron circles with ritual data
		const newInputs: Record<string, string> = {};
		
		// Center: The wish
		newInputs['center'] = ritualSession.wish_statement.substring(0, 20) + '...';
		
		// Inner ring: Values
		const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left'];
		ritualSession.declared_values.forEach((value, index) => {
			if (index < innerPositions.length) {
				newInputs[innerPositions[index]] = value;
			}
		});
		
		// HOLONIC: Outer ring - Advisor IDs (display layer will resolve to names)
		const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
		ritualSession.advisors.forEach((advisorId, index) => {
			if (index < outerPositions.length) {
				newInputs[outerPositions[index]] = advisorId;
			}
		});
		
		circleInputs = { ...circleInputs, ...newInputs };
		
		// HOLONIC: Save via unified session data (handled by saveRitualSession)
		if (holosphere && holonID) {
			saveRitualSession();
		}
	}

	async function generateCouncilDialogue() {
		isGeneratingCouncil = true;
		
		try {
			// Ensure metatron is populated with ritual advisors before starting
			populateMetatronFromRitual();
			
			// Open the council chat for the glass bead game
			showCouncilChat = true;
			councilChatMessages = []; // Clear previous messages
			
			// Create the initial council introduction
			const councilIntroMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: `[The council chambers echo with ancient wisdom] Greetings, seeker. We are convened to discuss your wish: "${ritualSession.wish_statement}" through the lens of your values: ${ritualSession.declared_values.join(', ')}. Let us begin our glass bead game, where each advisor builds upon the previous one's thoughts, adding another bead to the chain of wisdom.`,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				speaker: 'Council Chamber',
				speakerColor: 'bg-purple-700'
			};
			
			councilChatMessages = [councilIntroMessage];
			await typeMessage(councilIntroMessage, 'council');
			
			// Start the glass bead game with the first advisor
			await initiateGlassBeadGame();
			
		} catch (error) {
			console.error('Error generating council dialogue:', error);
		} finally {
			isGeneratingCouncil = false;
		}
	}

	// Holonic pattern: Council dialogue sequence using individual advisor calls
	async function generateCouncilDialogueSequence(councilMembers: CouncilAdvisorExtended[], userMessage: string) {
		if (!llmService) {
			llmService = new LLMService();
		}

		// HOLONIC: Ensure advisor cache is ready  
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}

		// HOLONIC: Glass Bead Game advisors are tracked via ritualSession.advisors
		// No separate storage needed - councillors are already in the session
		
		// Debug: Log what advisors were found
		console.log('🔍 Council Dialogue Sequence - Advisor Lookup Debug:');
		console.log('Council members:', councilMembers.map(a => a.name));
		councilMembers.forEach((advisor, index) => {
			console.log(`Advisor ${index + 1}:`, {
				name: advisor.name,
				type: advisor.type,
				lens: advisor.lens,
				hasCharacterSpec: !!advisor.characterSpec,
				characterSpecKeys: advisor.characterSpec ? Object.keys(advisor.characterSpec) : []
			});
		});

		// Start the sequential dialogue with user message context
		await continueCouncilDialogueSequence(councilMembers, 0, [], userMessage);
	}

	// HOLONIC: Resolve advisor IDs from ritual session to full advisor objects
	async function resolveAdvisorsFromRitual(advisorIds: string[]): Promise<CouncilAdvisorExtended[]> {
		if (!advisorService) {
			console.error('❌ AdvisorService not available for ritual advisor resolution');
			return [];
		}
		
		const resolvedAdvisors: CouncilAdvisorExtended[] = [];
		
		for (const advisorId of advisorIds) {
			try {
				const advisor = await advisorService.getAdvisor(advisorId);
				if (advisor) {
					resolvedAdvisors.push(advisor);
					console.log(`✅ Resolved advisor: ${advisor.name} (${advisor.id})`);
				} else {
					console.warn(`⚠️ Could not resolve advisor ID: ${advisorId}`);
				}
			} catch (error) {
				console.error(`❌ Error resolving advisor ${advisorId}:`, error);
			}
		}
		
		return resolvedAdvisors;
	}

	// Holonic pattern: Glass bead game where each advisor builds upon the previous
	async function initiateGlassBeadGame() {
		if (!llmService) {
			llmService = new LLMService();
		}

		// HOLONIC: Ensure advisor cache is ready  
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}

		// HOLONIC: Get the council members from ritual session using ID-based lookup
		const councilMembers = await resolveAdvisorsFromRitual(ritualSession.advisors);
		
		// HOLONIC: Glass Bead Game advisors already tracked in ritualSession.advisors
		// No separate retrieval needed
		
		// Debug: Log what advisors were found
		console.log('🔍 Glass Bead Game - Advisor Lookup Debug:');
		console.log('Ritual advisors:', ritualSession.advisors);
		console.log('Resolved council members:', councilMembers);
		councilMembers.forEach((advisor, index) => {
			console.log(`Advisor ${index + 1}:`, {
				name: advisor.name,
				type: advisor.type,
				lens: advisor.lens,
				hasCharacterSpec: !!advisor.characterSpec,
				characterSpecKeys: advisor.characterSpec ? Object.keys(advisor.characterSpec) : []
			});
		});

		// Start the sequential dialogue
		await continueGlassBeadGame(councilMembers, 0, []);
	}

	async function continueCouncilDialogueSequence(councilMembers: CouncilAdvisorExtended[], currentIndex: number, previousResponses: string[], userMessage: string) {
		if (currentIndex >= councilMembers.length) {
			// All advisors have spoken, add closing message
			const closingMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: `[The council chamber falls silent, wisdom gathered] The council has shared their perspectives on your question: "${userMessage}". Each advisor has offered their unique insight, creating a tapestry of wisdom to guide your path forward.`,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				speaker: 'Council Chamber',
				speakerColor: 'bg-purple-700'
			};
			
			councilChatMessages = [...councilChatMessages, closingMessage];
			await typeMessage(closingMessage, 'council');
			return;
		}

		const currentAdvisor = councilMembers[currentIndex];
		const isFirstSpeaker = currentIndex === 0;
		
		// Create the council dialogue prompt using centralized function
		const councilPrompt = createCouncilDialogueContext(
			currentAdvisor,
			userMessage,
			ritualSession,
			isFirstSpeaker,
			previousResponses
		);

		try {
			const response = await llmService!.sendMessage([
				{ role: 'system', content: councilPrompt },
				{ role: 'user', content: userMessage }
			]);

			const advisorMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: response.content,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
                speaker: `${currentAdvisor.name}${(currentAdvisor.characterSpec as any).title ? ' — ' + (currentAdvisor.characterSpec as any).title : ''}`,
				speakerColor: getAdvisorColor(currentIndex)
			};

			councilChatMessages = [...councilChatMessages, advisorMessage];
			await typeMessage(advisorMessage, 'council');

			// Add a brief pause between advisors
			await new Promise(resolve => setTimeout(resolve, 500));

			// Continue with the next advisor
			await continueCouncilDialogueSequence(councilMembers, currentIndex + 1, [...previousResponses, `${currentAdvisor.name}: ${response.content}`], userMessage);

		} catch (error) {
			console.error('Error in council dialogue sequence:', error);
			const errorMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: `I am momentarily silent. The council dialogue continues...`,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
                speaker: `${currentAdvisor.name}${(currentAdvisor.characterSpec as any).title ? ' — ' + (currentAdvisor.characterSpec as any).title : ''}`,
				speakerColor: getAdvisorColor(currentIndex)
			};
			
			councilChatMessages = [...councilChatMessages, errorMessage];
			await typeMessage(errorMessage, 'council');
			
			// Continue with next advisor even if there was an error
			await continueCouncilDialogueSequence(councilMembers, currentIndex + 1, [...previousResponses, `${currentAdvisor.name}: Advisor was silent`], userMessage);
		}
	}

	async function continueGlassBeadGame(councilMembers: CouncilAdvisorExtended[], currentIndex: number, previousResponses: string[]) {
		if (currentIndex >= councilMembers.length) {
			// All advisors have spoken, add closing message
			const closingMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: `[The council chamber falls silent, wisdom gathered] The glass bead game is complete. Each advisor has added their bead to the chain, building upon the previous thoughts. Your wish has been examined from multiple perspectives, creating a tapestry of wisdom to guide your path forward.`,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				speaker: 'Council Chamber',
				speakerColor: 'bg-purple-700'
			};
			
			councilChatMessages = [...councilChatMessages, closingMessage];
			await typeMessage(closingMessage, 'council');
			
			// Mark Glass Bead Game as complete for subsequent single-advisor responses
			glassBeadGameComplete = true;
			return;
		}

		const currentAdvisor = councilMembers[currentIndex];
		const isFirstSpeaker = currentIndex === 0;
		
		// Create the glass bead game prompt using centralized function
		const glassBeadPrompt = createGlassBeadGameContext(
			currentAdvisor,
			'Continue the glass bead game.',
			ritualSession,
			isFirstSpeaker,
			previousResponses
		);

		try {
			const response = await llmService!.sendMessage([
				{ role: 'system', content: glassBeadPrompt },
				{ role: 'user', content: 'Continue the glass bead game.' }
			]);

			const advisorMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: response.content,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
                speaker: `${currentAdvisor.name}${(currentAdvisor.characterSpec as any).title ? ' — ' + (currentAdvisor.characterSpec as any).title : ''}`,
				speakerColor: getAdvisorColor(currentIndex)
			};

			councilChatMessages = [...councilChatMessages, advisorMessage];
			await typeMessage(advisorMessage, 'council');

			// Add a brief pause between advisors
			await new Promise(resolve => setTimeout(resolve, 500));

			// Continue with the next advisor
			await continueGlassBeadGame(councilMembers, currentIndex + 1, [...previousResponses, `${currentAdvisor.name}: ${response.content}`]);

		} catch (error) {
			console.error('Error in glass bead game:', error);
			const errorMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: `I am momentarily silent. The glass bead game continues...`,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				speaker: currentAdvisor.name,
				speakerColor: getAdvisorColor(currentIndex)
			};
			
			councilChatMessages = [...councilChatMessages, errorMessage];
			await typeMessage(errorMessage, 'council');
			
			// Continue with next advisor even if there was an error
			await continueGlassBeadGame(councilMembers, currentIndex + 1, [...previousResponses, `${currentAdvisor.name}: Advisor was silent`]);
		}
	}

	// Helper function to get ordinal suffix
	function getOrdinalSuffix(num: number): string {
		const j = num % 10;
		const k = num % 100;
		if (j === 1 && k !== 11) return 'st';
		if (j === 2 && k !== 12) return 'nd';
		if (j === 3 && k !== 13) return 'rd';
		return 'th';
	}

	// Helper function to get advisor color
	function getAdvisorColor(index: number): string {
		const colors = ['bg-indigo-700', 'bg-purple-700', 'bg-blue-700', 'bg-green-700', 'bg-yellow-700', 'bg-red-700'];
		return colors[index % colors.length];
	}

	function generateAdvisorResponse(advisor: any, wish: string, values: string[]): string {
		// Placeholder for AI-generated responses
		const responses = {
			'real': [
				`To truly manifest "${wish}", we must first ground ourselves in ${values[0]}. Begin with what serves the collective, not the individual.`,
				`The path to "${wish}" requires patience and ${values[1]}. Listen deeply before you build.`,
				`Your wish speaks to a deeper need. Let ${values[0]} and ${values[2] || 'wisdom'} guide your first steps.`
			],
			'mythic': [
				`The ancient ones whisper: "${wish}" is not built, but grown. Plant seeds of ${values[0]} and tend them with ${values[1] || 'care'}.`,
				`From the realm between worlds, I see your path. Honor ${values[0]} as sacred, and your wish shall unfold naturally.`,
				`The spirits of place must consent. Offer ${values[1] || 'respect'} before you begin, and ask permission of the land itself.`
			],
			'archetype': [
				`Ha! You think too much! ${wish}? Just begin! Let ${values[0]} be your compass, and ${values[1] || 'joy'} your fuel.`,
				`The old ways are breaking. Your "${wish}" needs new rules. Make ${values[0]} your rebellion.`,
				`Every ending is a beginning. Your wish carries both creation and destruction. Embrace the chaos of ${values[0]}.`
			]
		};
		
		const typeResponses = responses[advisor.type] || responses['real'];
		return typeResponses[Math.floor(Math.random() * typeResponses.length)];
	}

	async function generateDesignStreams() {
		isGeneratingDesign = true;
		
		try {
			await new Promise(resolve => setTimeout(resolve, 2000));
			
			// Generate design streams based on the council dialogue
			ritualSession.design_streams = [
				{
					name: `${ritualSession.declared_values[0] || 'Sacred'} Path`,
					description: `A gentle approach emphasizing ${ritualSession.declared_values[0]} and deep listening.`,
					materials: ['Natural materials', 'Simple tools', 'Gathered community', 'Time for reflection'],
					steps: [
						'Begin with a circle of intention',
						`Honor ${ritualSession.declared_values[0]} in every decision`,
						'Create space for emergence',
						'Celebrate each milestone'
					]
				},
				{
					name: `${ritualSession.declared_values[1] || 'Bold'} Stream`,
					description: `A dynamic approach that embraces ${ritualSession.declared_values[1]} and playful experimentation.`,
					materials: ['Flexible resources', 'Collaborative tools', 'Creative supplies', 'Learning mindset'],
					steps: [
						'Prototype quickly and iterate',
						`Let ${ritualSession.declared_values[1]} guide the process`,
						'Invite unexpected perspectives',
						'Document the journey'
					]
				}
			];
			
			// Generate ritual artifact
			ritualSession.ritual_artifact = {
				format: 'scroll',
				text: `The council has spoken. Your path to "${ritualSession.wish_statement}" weaves through ${ritualSession.declared_values.join(', ')}. May wisdom guide your steps.`,
				quotes: Object.fromEntries(
					ritualSession.council_dialogue.map(d => [d.advisor, d.response.split('.')[0] + '.'])
				),
				ascii_glyph: generateGlyph()
			};
			
			nextStage();
		} catch (error) {
			console.error('Error generating design streams:', error);
		} finally {
			isGeneratingDesign = false;
		}
	}

	function generateGlyph(): string {
		const symbols = ['◯', '△', '◇', '✦', '⬟', '◈'];
		const valueCount = ritualSession.declared_values.length;
		const advisorCount = ritualSession.advisors.length;
		
		const centerSymbol = symbols[0];
		const valueSymbols = symbols.slice(1, valueCount + 1).join(' - ');
		const advisorSymbols = symbols.slice(1, advisorCount + 1).join(' ');
		
		return `( ${valueSymbols} ) - ${centerSymbol} - ( ${advisorSymbols} )`;
	}

	function closeRitual() {
		showRitual = false;
		ritualStage = 0;
		// HOLONIC: Glass Bead Game state cleared via ritual session reset
		// No separate advisor state to clear
		// Reset Glass Bead Game completion flag
		glassBeadGameComplete = false;
		// Keep the ritual session data for potential reuse
	}

	// Load history data from holosphere
	async function loadHistoryData() {
		if (!holosphere || !holonID) return;

		// holosphere.get/getAll now carry a built-in deadline (default 8s).
		try {
			// Load previous values
			const valuesData = await holosphere.get(holonID, "ritual_previous_values", holonID, null, { timeout: 2000 });
			if (valuesData && Array.isArray(valuesData)) {
				previousValues = [...new Set(valuesData)]; // Remove duplicates
			}
		} catch (error) {
			console.log('No previous values found');
		}
		
		// HOLONIC: Previous advisors loaded via AdvisorService.getAllAdvisors()
		// No separate previous advisor loading needed
	}

	// Save history data to holosphere
	async function saveHistoryData() {
		if (!holosphere || !holonID) return;
		
		try {
			// Save values history
			if (previousValues.length > 0) {
				await holosphere.put(holonID, "ritual_previous_values", previousValues);
			}
			
			// HOLONIC: Advisor history saved via AdvisorService (persistent in HoloSphere)
			// No separate previous advisor saving needed
		} catch (error) {
			console.error('Error saving history data:', error);
		}
	}

	// Create new holon from ritual using modular function
	async function createHolonFromRitual() {
		if (!ritualSession.wish_statement.trim()) return;
		
		try {
			// HOLONIC: Convert advisor IDs to advisor objects for holon creation
			const advisorObjects: any[] = [];
			if (advisorService) {
				for (const advisorId of ritualSession.advisors) {
					const advisor = await advisorService.getAdvisor(advisorId);
					if (advisor) {
						advisorObjects.push({
							name: advisor.name,
							type: advisor.type,
							lens: advisor.lens,
							avatar_url: advisor.avatar_url
						});
					}
				}
			}
			
			const ritualWithAdvisorObjects = {
				...ritualSession,
				advisors: advisorObjects
			};
			
			const newHolonID = await createHolonFromRitualUtil(holosphere, ritualWithAdvisorObjects as RitualSession, holonID);
			
			// Navigate to new holon
			goto(`/${newHolonID}/dashboard`);
			
		} catch (error) {
			console.error('Error creating holon from ritual:', error);
		}
	}

	// Open Design Streams Stage and start session
	async function openDesignStreams() {
		console.log('Opening Design Streams stage...');
		console.log('Current showDesignStreams:', showDesignStreams);
		
		try {
			// HOLONIC: Ensure advisor cache is ready
			console.log('🔄 Loading advisors via holonic system...');
			if (advisorService) {
				await advisorService.getAllAdvisors();
				console.log('✅ Holonic advisor system ready');
			}
			
			// Start new Design Streams session
			if (sessionManager) {
				const session = sessionManager.startSession();
				console.log('🚀 Started Design Streams session:', session.id);
			}
		
		// HOLONIC: Get full advisors with character specs from AdvisorService
		if (advisorService) {
			const allAdvisors = await advisorService.getAllAdvisors();
			const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
			
			metatronAdvisors = [];
			for (const position of outerPositions) {
				const advisorId = circleInputs[position];
				if (advisorId) {
					const fullAdvisor = allAdvisors.find(a => a.id === advisorId);
					if (fullAdvisor && fullAdvisor.id) { // ✅ Safety check for ID
						console.log(`✅ Found seated advisor: "${fullAdvisor.name}" (${fullAdvisor.id}) with characterSpec:`, !!fullAdvisor.characterSpec);
						metatronAdvisors.push(fullAdvisor); // ✅ Use the complete advisor object
					} else {
						console.error(`❌ Advisor not found in AdvisorService for ID "${advisorId}"`);
						alert(`Error: Could not find advisor with ID "${advisorId}" in the advisor service. The advisor may have been deleted or there may be a sync issue.`);
						return;
					}
				}
			}
		} else {
			console.error('❌ AdvisorService not available for Design Streams');
			alert('Error: Advisor service not available. Please try again.');
			return;
		}
			
			// Only show Design Streams if all advisors were found successfully
			showDesignStreams = true;
			console.log('✅ Set showDesignStreams to true');
			
		} catch (error) {
			console.error('❌ Error opening Design Streams:', error);
			alert('Error opening Design Streams. Please try again.');
		}
	}

	// Restore ritual session from previous ritual
	function restoreRitualSession(ritual: any) {
		console.log('🔄 Restoring ritual session:', ritual);
		
		// Restore ritual session data
		if (ritual.wish) {
			ritualSession.wish_statement = ritual.wish;
			wishTitle = ritual.wishTitle || extractWishTitle(ritual.wish);
		}
		
		if (ritual.values && Array.isArray(ritual.values)) {
			ritualSession.declared_values = [...ritual.values];
		}
		
		// HOLONIC RESTORE: Restore advisor IDs directly to circleInputs (not display names)
		if (ritual.seating) {
			Object.keys(ritual.seating).forEach(position => {
				if (ritual.seating[position]) {
					circleInputs[position] = ritual.seating[position]; // Store advisor ID directly
				}
			});
			console.log('🔄 Restored circleInputs with advisor IDs:', circleInputs);
		}
		
		// HOLONIC RESTORE: Restore advisor IDs to ritual session
		if (ritual.advisors && Array.isArray(ritual.advisors)) {
			ritualSession.advisors = [...ritual.advisors]; // Should already be IDs
			console.log('🔄 Restored ritual session advisors:', ritualSession.advisors);
		}
		
		// Update metatron immediately to reflect restored data
		updateMetatronFromSession();
		
		// Save restored session to HoloSphere
		saveRitualSession();
		
		console.log('✅ Ritual session restored:', {
			wish: !!ritualSession.wish_statement,
			values: ritualSession.declared_values.length,
			seating: Object.keys(ritual.seating || {}).length
		});
	}

	// Load previous rituals with retry mechanism for HoloSphere timing
	async function loadPreviousRituals(retryCount = 0) {
		console.log('🔄 loadPreviousRituals called with:', { holosphere: !!holosphere, holonID, retryCount });
		
		if (!holosphere || !holonID) {
			console.log('❌ Cannot load previous rituals - missing holosphere or holonID');
			return;
		}
		
		// holosphere.getAll now carries a built-in deadline; pass `timeout`
		// in the options to override.
		try {
			console.log('🔍 Fetching previous rituals from HoloSphere...');

			// Add small delay for HoloSphere data propagation
			if (retryCount === 0) {
				await new Promise(resolve => setTimeout(resolve, 500));
			}

			const ritualsArray = (await holosphere.getAll(holonID, "previous_rituals", null, { timeout: 3000 })) ?? [];
			console.log('📦 Rituals from HoloSphere:', ritualsArray.length);
			if (ritualsArray.length > 0) {
				console.log('📦 Converted object to array:', ritualsArray.length, 'rituals');
				
				// Parse dates and fix data structure for loaded rituals
				previousRituals = ritualsArray.map((ritual: any) => {
					const processedRitual = {
						...ritual,
						createdAt: ritual.createdAt ? new Date(ritual.createdAt) : new Date(),
						completedAt: ritual.completedAt ? new Date(ritual.completedAt) : undefined,
						// Ensure backward compatibility with both old and new formats
						date: ritual.date || ritual.createdAt,
						// Map designStreamsSession to design_streams for backward compatibility
						design_streams: ritual.design_streams || (ritual.designStreamsSession ? [ritual.designStreamsSession] : [])
					};
					return processedRitual;
				});
				console.log('✅ Loaded', previousRituals.length, 'previous rituals');
			} else if (retryCount < 2) {
				// Retry loading if data is null and we haven't tried too many times
				console.log('⏰ Data not ready, retrying in 1 second... (attempt', retryCount + 1, 'of 3)');
				setTimeout(() => loadPreviousRituals(retryCount + 1), 1000);
			} else {
				console.log('⚠️ No valid rituals data found after', retryCount + 1, 'attempts');
			}
		} catch (error) {
			console.log('❌ Error loading previous rituals:', error);
			if (retryCount < 2) {
				console.log('⏰ Retrying after error in 1 second... (attempt', retryCount + 1, 'of 3)');
				setTimeout(() => loadPreviousRituals(retryCount + 1), 1000);
			}
		}
	}

	// Save previous rituals
	async function savePreviousRituals() {
		if (!holosphere || !holonID) return;
		
		try {
			await holosphere.put(holonID, "previous_rituals", previousRituals);
		} catch (error) {
			console.error('Error saving previous rituals:', error);
		}
	}

	// Get active members count
	$: totalMembers = Object.keys(councilData.members).length;
	$: activeMembers = Object.values(councilData.members).filter(member => member.status === 'active').length;

	// Get status color
	function getStatusColor(status: string): string {
		switch (status) {
			case 'active': return '#10b981';
			case 'inactive': return '#ef4444';
			case 'pending': return '#f59e0b';
			default: return '#6b7280';
		}
	}

	// Initialize on mount
	onMount(async () => {
		console.log('Council component mounted');
		
		// Initialize LLM service
		try {
			llmService = new LLMService();
			console.log('LLM service initialized successfully');
		} catch (error) {
			console.error('Failed to initialize LLM service:', error);
			// Set a flag to show LLM is unavailable
			llmService = null;
		}
		
		// Get holon ID from route
		holonID = $page.params.id || '';
		console.log('Holon ID:', holonID);
		
		// Get user ID from store
		userID = $ID || '';
		console.log('User ID:', userID);
		
		// Initialize session manager as early as possible
		if (holonID && holosphere) {
			sessionManager = initializeSessionManager(holosphere, holonID);
			console.log('✅ Session manager initialized (early)');
		}
		
		if (holonID && holosphere) {
			try {
				// Subscribe to unified ritual session updates - TEMPORARILY DISABLED FOR DEBUGGING
				// await holosphere.subscribe(holonID, "ritual_session", (sessionData: any) => {
				// 	if (sessionData) {
				// 		// Update all session state from unified data
				// 		if (sessionData.wish_statement) ritualSession.wish_statement = sessionData.wish_statement;
				// 		if (sessionData.wish_title) wishTitle = sessionData.wish_title;
				// 		if (sessionData.declared_values) ritualSession.declared_values = sessionData.declared_values;
				// 		if (sessionData.advisors) ritualSession.advisors = sessionData.advisors;
				// 		if (sessionData.circleInputs) circleInputs = sessionData.circleInputs;
				// 		if (sessionData.HolonicEcosystemCouncilSummoned !== undefined) HolonicEcosystemCouncilSummoned = sessionData.HolonicEcosystemCouncilSummoned;
				// 		
				// 		console.log('🔄 Real-time ritual session update');
				// 	}
				// });
				console.log('⚠️ Ritual session subscription temporarily disabled for debugging');

				// Legacy subscriptions removed - replaced with single council_state subscription
				
				// Load unified ritual session data
				console.log('🔍 Loading ritual session from HoloSphere...', { holonID, collection: "ritual_session" });
				const sessionData = await holosphere.get(holonID, "ritual_session", holonID);
				console.log('📦 Raw session data from HoloSphere:', sessionData);
				
				if (sessionData) {
					// Load complete session state
					console.log('✅ Session data found, loading into ritual session...');
					if (sessionData.wish_statement) {
						ritualSession.wish_statement = sessionData.wish_statement;
						console.log('📝 Loaded wish statement:', sessionData.wish_statement);
					}
					if (sessionData.wish_title) {
						wishTitle = sessionData.wish_title;
						console.log('🎯 Loaded wish title:', sessionData.wish_title);
					}
					if (sessionData.declared_values) {
						ritualSession.declared_values = sessionData.declared_values;
						console.log('💎 Loaded declared values:', sessionData.declared_values);
					}
					if (sessionData.advisors) {
						ritualSession.advisors = sessionData.advisors;
						console.log('👥 Loaded advisors:', sessionData.advisors);
					}
					if (sessionData.circleInputs) {
						console.log('🔄 Restoring circle inputs from session...');
						console.log('📥 Session circle inputs:', sessionData.circleInputs);
						
						circleInputs = sessionData.circleInputs;
						console.log('⭕ Applied circle inputs to component:', circleInputs);
						
						// HOLONIC: Update Metatron display immediately after loading
						updateMetatronFromSession();
						console.log('🎯 Updated Metatron display from loaded session');
						
						// Debug: Check which advisor positions were restored
						const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
						const restoredAdvisors = outerPositions.filter(pos => circleInputs[pos]).map(pos => `${pos}: ${circleInputs[pos]}`);
						console.log('🎭 Restored advisor positions:', restoredAdvisors);
					}
					if (sessionData.HolonicEcosystemCouncilSummoned) {
						HolonicEcosystemCouncilSummoned = sessionData.HolonicEcosystemCouncilSummoned;
						console.log('🌐 Loaded HEC summoned:', sessionData.HolonicEcosystemCouncilSummoned);
					}
					
					console.log('✅ Loaded ritual session:', { 
						wish: !!sessionData.wish_statement, 
						advisors: sessionData.advisors?.length || 0,
						values: sessionData.declared_values?.length || 0 
					});
				} else {
					console.log('🆕 No previous session found, starting fresh');
				}
				
				// Session manager already initialized above
				
				// HOLONIC INITIALIZATION: Initialize AdvisorService FIRST
				console.log('🧠 Initializing holonic advisor system...');
				advisorService = new AdvisorService(holosphere, holonID);
				
				// Auto-migrate HEC advisors if needed
				console.log('🔄 Ensuring HEC advisors are migrated...');
				await ensureHECAdvisorsMigrated(holosphere, holonID);
				
				// CRITICAL: Populate advisor cache immediately after initialization
				console.log('🔄 Pre-loading advisor cache...');
				await advisorService.getAllAdvisors();
				console.log('✅ Advisor cache ready for UI display');
				
				connectionReady = true;
				isLoading = false;
				
				// Load holon advisors (AFTER AdvisorService is ready)
				await loadHolonAdvisors();
				
				// Legacy cache initialization (DEPRECATED - will be removed)
				//await getAllAdvisors(holosphere, holonID);
				//console.log('✅ Holonic advisor system initialized');
				
				// Load previous rituals
				await loadPreviousRituals();
				
			} catch (error) {
				console.error('Error loading council data:', error);
				isLoading = false;
			}
		} else {
			isLoading = false;
		}
	});

	// Watch for page ID changes with debouncing
	let pageUpdateTimeout: NodeJS.Timeout;
	$: {
		const newId = $page.params.id;
		if (newId && newId !== holonID && connectionReady) {
			// Check if the new ID is valid
			if (newId !== 'undefined' && newId !== 'null' && newId.trim() !== '') {
				// Clear any pending update
				if (pageUpdateTimeout) clearTimeout(pageUpdateTimeout);
				
				// Debounce the update to avoid rapid changes
				pageUpdateTimeout = setTimeout(async () => {
					holonID = newId;
					// Update the ID store to keep them in sync
					ID.set(newId);
					if (holosphere) {
						await fetchData();
					}
				}, 100);
			}
		}
	}

	// Select previous value
	function selectPreviousValue(value: string) {
		if (!ritualSession.declared_values.includes(value) && ritualSession.declared_values.length < 6) {
			ritualSession.declared_values = [...ritualSession.declared_values, value];
		}
	}

	// HOLONIC: Select previous advisor by ID
	function selectPreviousAdvisor(advisor: any) {
		if (ritualSession.advisors.length < 6 && advisor.id) {
			const advisorExists = ritualSession.advisors.includes(advisor.id);
			if (!advisorExists) {
				ritualSession.advisors = [...ritualSession.advisors, advisor.id];
			}
		}
	}

	// Holonic Ecosystem Council state
	let HolonicEcosystemCouncilSummoned = false;

	// User context for council interactions
	let userContext: UserContext = {
		user_profile: {
			interests: [],
			values: [],
			current_challenges: [],
			goals: [],
			conversation_history: [],
			preferred_council_members: [],
			avoided_topics: [],
			communication_style: 'Direct'
		},
		session_context: {
			current_topic: '',
			session_start_time: new Date().toISOString(),
			council_members_present: [],
			conversation_flow: 'initial',
			user_emotional_state: 'curious',
			urgency_level: 5
		}
	};

	// LLM service for council interactions
	let llmService: LLMService | null = null;
	
	// Session manager for Design Streams
	let sessionManager: any = null;

	// API Key Configuration Modal
	// NOTE: This is a placeholder UI - keys are collected but not stored/used yet
	let showApiModal = false;
	let apiKeys = {
		openai: '',
		anthropic: '',
		groq: ''
	};

	async function generateCouncilResponse(userMessage: string): Promise<string> {
		if (!llmService) {
			console.warn('LLM service not available for council response');
			return "The council is momentarily unavailable. Please try again.";
		}

		// HOLONIC: Get council members from ritual session (ID-based)
		let councilMembers: CouncilAdvisorExtended[] = [];
		if (ritualSession.advisors.length > 0) {
			councilMembers = await resolveAdvisorsFromRitual(ritualSession.advisors);
		}
		
		// HOLONIC FALLBACK: If no ritual advisors, get from circleInputs (should not happen in normal flow)
		if (councilMembers.length === 0 && advisorService) {
			console.log('🔍 No ritual advisors found, converting circleInputs...');
			const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
			for (const position of outerPositions) {
				const advisorId = circleInputs[position];
				if (advisorId && advisorService) {
					const advisor = await advisorService.getAdvisor(advisorId);
					if (advisor) {
						councilMembers.push(advisor);
					}
				}
			}
			console.log('🔍 Converted circle inputs to advisors:', councilMembers.map(a => a.name));
		}

		// Assign colors to council members if not already assigned
		if (Object.keys(councilMemberColors).length === 0) {
			assignCouncilMemberColors(councilMembers);
		}

		// Analyze user message to determine which characters should respond
		const respondingMembers = analyzeUserMessage(userMessage, councilMembers);
		
		// Update user context with current session info
		userContext.session_context.current_topic = userMessage;
userContext.session_context.council_members_present = councilMembers.map(m => m.name);
		
		// Create conversation flow context
		const conversationFlow: ConversationFlowContext = {
    present_members: councilMembers.map(m => m.name),
			conversation_topic: userMessage,
			previous_responses: councilChatMessages.filter(m => m.role === 'assistant').map(m => m.content),
			user_interests: userContext.user_profile.interests,
    appropriate_responding_members: respondingMembers.map(m => m.name)
		};

		// Create the complete kaleidoscope context
		const systemPrompt = createCouncilContext(userContext, respondingMembers, conversationFlow, userMessage);

		try {
			// Send to LLM with the complete context
			const response = await llmService.sendMessage([
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userMessage }
			]);

			// Update conversation history
			userContext.user_profile.conversation_history.push({
				timestamp: new Date().toISOString(),
				topic: userMessage,
				user_message: userMessage,
				council_response: response.content,
                responding_members: respondingMembers.map(m => m.name)
			});

			return response.content;
		} catch (error) {
			console.error('Error generating council response:', error);
			return "The council is momentarily silent. Please try again.";
		}
	}

	async function addImmediateAdvisorIntroduction(advisor: CouncilAdvisorExtended) {
		// Debug: Log the raw advisor data to see what we're working with
		console.log('🔍 Raw advisor data for introduction:', {
			name: advisor.name,
			type: advisor.type,
			lens: advisor.lens,
			characterSpec: advisor.characterSpec,
			characterSpecType: typeof advisor.characterSpec,
			characterSpecKeys: advisor.characterSpec ? Object.keys(advisor.characterSpec) : 'no keys'
		});
		
		// Generate immediate introduction based on advisor type and characteristics
		let stageDirections = '';
		let introduction = '';
		
		// Generate stage directions based on advisor type with safe property access
		try {
			if (advisor.type === 'archetype') {
				const archetypeSpec = advisor.characterSpec as any;
				const appearance = archetypeSpec?.appearance;
				console.log('🔍 Archetype appearance:', appearance, 'type:', typeof appearance);
				stageDirections = `[${typeof appearance === 'string' ? appearance : 'appears with a commanding presence'}]`;
			} else if (advisor.type === 'real') {
				const realSpec = advisor.characterSpec as any;
				const speakingStyle = realSpec?.speaking_style;
				console.log('🔍 Real speaking style:', speakingStyle, 'type:', typeof speakingStyle);
				stageDirections = `[${typeof speakingStyle === 'string' ? speakingStyle : 'steps forward with measured grace'}]`;
			} else if (advisor.type === 'mythic') {
				const mythicSpec = advisor.characterSpec as any;
				const speakingStyle = mythicSpec?.speaking_style;
				console.log('🔍 Mythic speaking style:', speakingStyle, 'type:', typeof speakingStyle);
				stageDirections = `[${typeof speakingStyle === 'string' ? speakingStyle : 'materializes with ethereal grace'}]`;
			} else {
				stageDirections = '[appears with a gentle presence]';
			}
		} catch (error) {
			console.warn('Error generating stage directions, using fallback:', error);
			stageDirections = '[appears with a gentle presence]';
		}
		
		console.log('🔍 Generated stage directions:', stageDirections);
		
		// Generate introduction based on advisor characteristics
		const cleanName = advisor.name.split(',')[0].trim();
		introduction = `Greetings, seeker. I am ${cleanName}, and I bring the wisdom of ${advisor.lens} to our conversation. What question or concern brings you to seek my counsel today?`;
		
		const introMessage: typeof advisorChatMessages[0] = {
			role: 'assistant' as const,
			content: `${stageDirections} ${introduction}`,
			displayContent: '',
			isTyping: true,
			timestamp: new Date(),
			advisor: advisor.name
		};

		console.log('🔍 Final intro message content:', introMessage.content);
		
		advisorChatMessages = [...advisorChatMessages, introMessage];
		await typeMessage(introMessage, 'advisor');
	}

	async function generateIndividualAdvisorResponse(userMessage: string): Promise<string> {
		if (!llmService) {
			console.warn('LLM service not available for individual advisor response');
			return "I am momentarily unavailable. Please try again.";
		}
		
		if (!selectedAdvisorForChat) {
			console.warn('No advisor selected for individual chat');
			return "Please select an advisor to chat with.";
		}

		// Create a focused context for the individual advisor using centralized function
		const advisorContext = createIndividualAdvisorContext(selectedAdvisorForChat, userMessage);

		try {
			// Send to LLM with the advisor context
			const response = await llmService.sendMessage([
				{ role: 'system', content: advisorContext },
				{ role: 'user', content: userMessage }
			]);

			return response.content;
		} catch (error) {
			console.error('Error generating advisor response:', error);
			return "I am momentarily silent. Please try again.";
		}
	}

	// Council chat state
	let showCouncilChat = false;
	// Track if Glass Bead Game has completed to switch to single-advisor responses
	let glassBeadGameComplete = false;
	// Color assignment for council members in current chat session
	let councilMemberColors: Record<string, string> = {};
	let colorIndex = 0;
	const councilColors = [
		'bg-slate-700', 'bg-slate-600', 'bg-gray-700', 'bg-gray-600', 
		'bg-zinc-700', 'bg-zinc-600', 'bg-neutral-700', 'bg-neutral-600'
	];

	let councilChatMessages: Array<{
		role: 'user' | 'assistant';
		content: string;
		displayContent?: string;
		isTyping?: boolean;
		timestamp: Date;
		advisor?: string;
		speaker?: string;
		speakerColor?: string;
	}> = [];
	let currentCouncilMessage = '';
	let isCouncilResponding = false;

	async function summonholonicecosystemcouncil() {
		console.log('🏛️ SUMMONING HOLONIC ECOSYSTEM COUNCIL (Holonic Version)');
		
		if (!advisorService) {
			console.error('❌ AdvisorService not available');
			return;
		}
		
		try {
			// Get all HEC advisors from HoloSphere
			const hecAdvisors = await advisorService.getHECAdvisors();
			console.log(`✅ Retrieved ${hecAdvisors.length} HEC advisors from HoloSphere`);
			
			if (hecAdvisors.length === 0) {
				console.error('❌ No HEC advisors found in HoloSphere');
				return;
			}
			
			// Find Omnia specifically (should always be at outer-top)
			const omnia = hecAdvisors.find(advisor => advisor.id === 'omnia');
			
			if (!omnia) {
				console.error('❌ Omnia not found in HEC advisors');
				return;
			}
			
			// Get remaining HEC advisors (excluding Omnia)
			const otherHecAdvisors = hecAdvisors.filter(advisor => advisor.id !== 'omnia');
			
			// Randomly select 5 from the remaining HEC advisors for outer positions
			const shuffled = [...otherHecAdvisors].sort(() => 0.5 - Math.random());
			const selectedMembers = shuffled.slice(0, 5);
			
			console.log('🎯 HEC Council Selection:');
			console.log(`   👑 Omnia (outer-top): ${omnia.name}`);
			console.log(`   🔮 Selected members (${selectedMembers.length}):`, selectedMembers.map(m => `${m.name} (${m.id})`));
			
			// HOLONIC APPROACH: Store advisor IDs in circleInputs (not names!)
			// Position Omnia at outer-top (head of council)
			if (omnia.id) {
				circleInputs['outer-top'] = omnia.id;
			}
			
			// Populate the remaining 5 outer positions with selected members
			const outerPositions = ['outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
			selectedMembers.forEach((member, index) => {
				if (index < outerPositions.length && member.id) {
					circleInputs[outerPositions[index]] = member.id;
				}
			});
			
			// Mark council as summoned
			HolonicEcosystemCouncilSummoned = true;
			
			// HOLONIC: Add all selected advisor IDs to ritual session
			const allSelectedAdvisors = [omnia, ...selectedMembers];
			ritualSession.advisors = allSelectedAdvisors.map(advisor => advisor.id).filter((id): id is string => !!id);
			
			// Save unified session data
			saveRitualSession();
			
			console.log('✅ Holonic Ecosystem Council summoned successfully:', {
				total: allSelectedAdvisors.length,
				omnia: omnia.name,
				members: selectedMembers.map(m => `${m.name} (${m.id})`)
			});
			
		} catch (error) {
			console.error('❌ Error summoning HEC:', error);
		}
	}

	// Assign colors to council members for the current chat session
	function assignCouncilMemberColors(members: CouncilAdvisorExtended[]) {
		councilMemberColors = {};
		colorIndex = 0;
		
		members.forEach(member => {
			const cleanName = member.name.split(',')[0].trim();
			if (!councilMemberColors[cleanName]) {
				councilMemberColors[cleanName] = councilColors[colorIndex % councilColors.length];
				colorIndex++;
			}
		});
		
		console.log('Assigned colors to council members:', councilMemberColors);
	}

	function closeCouncilChat() {
		showCouncilChat = false;
		// HOLONIC: Glass Bead Game state maintained in component state
		// No separate clearing needed
	}

	function closeAdvisorChat() {
		showAdvisorChat = false;
		selectedAdvisorForChat = null;
		advisorChatSource = null;
		advisorChatMessages = [];
	}

	function handleAdvisorChatBack() {
		if (advisorChatSource === 'design-streams') {
			// Go back to Design Streams
			showAdvisorChat = false;
			selectedAdvisorForChat = null;
			advisorChatSource = null;
			showDesignStreams = true; // Reopen Design Streams page
		} else {
			// Go back to main council (close the chat)
			closeAdvisorChat();
		}
	}

	function closeCircleSelectionModal() {
		showCircleSelectionModal = false;
		selectedCircleForAction = null;
	}

	async function converseWithAdvisor() {
		if (!selectedCircleForAction) return;
		
		const advisorId = circleInputs[selectedCircleForAction];
		
		// HOLONIC APPROACH: Direct ID lookup (circleInputs now stores IDs)
		if (advisorService && advisorId) {
			try {
				console.log(`🔍 Looking for advisor to chat with ID: "${advisorId}"`);
				
				let fullAdvisor = await advisorService.getAdvisor(advisorId);
		
		if (fullAdvisor) {
					console.log(`✅ Found advisor for chat: ${fullAdvisor.name} (${fullAdvisor.id})`);
					
					// Debug: Log the full advisor object to see its structure
					console.log('🔍 Full advisor object loaded:', {
						id: fullAdvisor.id,
						name: fullAdvisor.name,
						type: fullAdvisor.type,
						lens: fullAdvisor.lens,
						characterSpec: fullAdvisor.characterSpec,
						characterSpecType: typeof fullAdvisor.characterSpec,
						characterSpecKeys: fullAdvisor.characterSpec && typeof fullAdvisor.characterSpec === 'object' ? Object.keys(fullAdvisor.characterSpec) : 'no keys'
					});
					
			selectedAdvisorForChat = fullAdvisor;
			advisorChatSource = 'main-council';
			showAdvisorChat = true;
			advisorChatMessages = []; // Clear previous messages for consistency
			
			// Add immediate introduction message
			await addImmediateAdvisorIntroduction(fullAdvisor);
		} else {
			// Error: Advisor not found
					console.error(`❌ Advisor lookup failed for ID "${advisorId}"`);
					alert(`Error: Could not find advisor with ID "${advisorId}" in the advisor library. The advisor may have been deleted or there may be a sync issue.`);
					return;
				}
			} catch (error) {
				console.error(`❌ Error looking up advisor for chat: ${error}`);
				alert(`Error loading advisor: ${error instanceof Error ? error.message : 'Unknown error'}`);
				return;
			}
		} else {
			console.error(`❌ AdvisorService not available or no advisor ID`);
			alert('Error: Advisor system not ready. Please try again.');
			return;
		}
		
		closeCircleSelectionModal();
	}

	function changeAdvisor() {
		if (!selectedCircleForAction) return;
    // Preserve selected seat across modal transitions
    const seatId = selectedCircleForAction;
		closeCircleSelectionModal();
    selectedCircleForAction = seatId;
    // Open advisor creation form directly (skip seat picker)
    showSeatPicker = true;
    showCreateInPicker = true;
	}

	async function sendAdvisorMessage(userMessage: string) {
		if (!selectedAdvisorForChat || isAdvisorResponding) return;

		isAdvisorResponding = true;

		try {
			// Generate advisor response using LLM with stage directions
			const advisorResponse = await generateIndividualAdvisorResponse(userMessage);
			
			const aiMessage: typeof advisorChatMessages[0] = {
				role: 'assistant' as const,
				content: advisorResponse,
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				advisor: selectedAdvisorForChat.name
			};
			
			advisorChatMessages = [...advisorChatMessages, aiMessage];
			await typeMessage(aiMessage, 'advisor');
			
		} catch (error) {
			console.error('Error generating advisor response:', error);
			const errorMessage: typeof advisorChatMessages[0] = {
				role: 'assistant' as const,
				content: 'I am momentarily silent. Please try again.',
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				advisor: selectedAdvisorForChat?.name || 'Advisor'
			};
			
			advisorChatMessages = [...advisorChatMessages, errorMessage];
			await typeMessage(errorMessage, 'advisor');
		} finally {
			isAdvisorResponding = false;
		}
	}

	// Unified typing function that works for both council and advisor messages
	async function typeMessage(message: any, chatType: 'council' | 'advisor', delayMs: number = 3.75) {
		message.isTyping = true;
		message.displayContent = '';
		
		// Update the appropriate message array
		if (chatType === 'council') {
			councilChatMessages = [...councilChatMessages];
		} else if (chatType === 'advisor') {
			advisorChatMessages = [...advisorChatMessages];
		}
		
		for (let i = 0; i < message.content.length; i++) {
			message.displayContent += message.content[i];
			
			// Update the appropriate message array
			if (chatType === 'council') {
				councilChatMessages = [...councilChatMessages];
			} else if (chatType === 'advisor') {
				advisorChatMessages = [...advisorChatMessages];
			}
			
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
		
		message.isTyping = false;
		
		// Final update to the appropriate message array
		if (chatType === 'council') {
			councilChatMessages = [...councilChatMessages];
		} else if (chatType === 'advisor') {
			advisorChatMessages = [...advisorChatMessages];
		}
	}

	// Parse structured council response and create individual speaker messages
	// NOTE: This function is no longer used - replaced with individual advisor calls
	function parseCouncilResponse(response: string): Array<{
		speaker: string;
		content: string;
		stageDirections?: string;
	}> {
		const speakers: Array<{speaker: string; content: string; stageDirections?: string}> = [];
		
		// Split by speaker pattern (e.g., "Speaker Name: content")
		const speakerPattern = /^([^:]+):\s*(.+)$/gm;
		let match;
		
		while ((match = speakerPattern.exec(response)) !== null) {
			const speaker = match[1].trim();
			let content = match[2].trim();
			
			// Extract stage directions if present
			let stageDirections = '';
			const stageDirectionPattern = /^\[([^\]]+)\]\s*(.+)$/;
			const stageMatch = content.match(stageDirectionPattern);
			
			if (stageMatch) {
				stageDirections = stageMatch[1];
				content = stageMatch[2];
			}
			
			speakers.push({
				speaker,
				content,
				stageDirections
			});
		}
		
		return speakers;
	}

	async function sendCouncilMessage(userMessage: string) {
		if (isCouncilResponding) return;

		isCouncilResponding = true;

		try {
			// HOLONIC: Get advisors from ritual session using ID-based system
			if (ritualSession.advisors.length === 0) {
				throw new Error('No ritual advisors available for council chat - please seat advisors first');
			}
			
			// Convert advisor IDs to full advisor objects
			const ritualAdvisors = await resolveAdvisorsFromRitual(ritualSession.advisors);
			
			if (glassBeadGameComplete) {
				// After GBG completion: single advisor response from ritual advisors
				const selectedAdvisors = analyzeUserMessage(userMessage, ritualAdvisors);
				const respondingAdvisor = selectedAdvisors.length > 0 ? selectedAdvisors[0] : ritualAdvisors[0];
				
				// Create single advisor context and send one LLM call
				const advisorContext = createIndividualAdvisorContext(respondingAdvisor, userMessage);
				const response = await llmService!.sendMessage([
					{ role: 'system', content: advisorContext },
					{ role: 'user', content: userMessage }
				]);
				
				const advisorMessage: typeof councilChatMessages[0] = {
					role: 'assistant' as const,
					content: response.content,
					displayContent: '',
					isTyping: true,
					timestamp: new Date(),
                speaker: (() => {
                  try {
                    const title = (respondingAdvisor.characterSpec as any)?.title;
                    return title && typeof title === 'string' ? `${respondingAdvisor.name} — ${title}` : respondingAdvisor.name;
                  } catch (error) {
                    return respondingAdvisor.name;
                  }
                })(),
					speakerColor: getAdvisorColor(0)
				};
				
				councilChatMessages = [...councilChatMessages, advisorMessage];
				await typeMessage(advisorMessage, 'council');
			} else {
				// During GBG: sequential multi-advisor dialogue
				await generateCouncilDialogueSequence(ritualAdvisors, userMessage);
			}
			
		} catch (error) {
			console.error('Error generating council response:', error);
			const errorMessage: typeof councilChatMessages[0] = {
				role: 'assistant' as const,
				content: 'The council is momentarily silent. Please try again.',
				displayContent: '',
				isTyping: true,
				timestamp: new Date(),
				advisor: 'Council'
			};
			
			councilChatMessages = [...councilChatMessages, errorMessage];
			await typeMessage(errorMessage, 'council');
		} finally {
			isCouncilResponding = false;
		}
	}

	// Individual advisor chat state
	let showAdvisorChat = false;
	let selectedAdvisorForChat: CouncilAdvisorExtended | null = null;
	let advisorChatSource: 'design-streams' | 'main-council' | null = null; // Track where the chat was opened from
	let advisorChatMessages: Array<{
		role: 'user' | 'assistant';
		content: string;
		displayContent?: string;
		isTyping?: boolean;
		timestamp: Date;
		advisor?: string;
	}> = [];
	let isAdvisorResponding = false;
	
	// Advisor state is now managed centrally through AdvisorOperations



	// DIAGNOSTIC: Investigate duplicate advisor records
	async function investigateAdvisorDuplicates() {
		if (!advisorService) {
			console.error("❌ AdvisorService not available");
			return;
		}
		
		console.log("🔍 INVESTIGATING ADVISOR DUPLICATES...");
		console.log("=====================================");
		
		try {
			// Get all advisors from AdvisorService
			const allAdvisors = await advisorService.getAllAdvisors();
			console.log(`📊 Total advisors found: ${allAdvisors.length}`);
			
			// Group by name to find duplicates
			const advisorsByName = new Map();
			const advisorsById = new Map();
			
			allAdvisors.forEach(advisor => {
				// Group by name
				if (!advisorsByName.has(advisor.name)) {
					advisorsByName.set(advisor.name, []);
				}
				advisorsByName.get(advisor.name).push(advisor);
				
				// Group by ID
				if (!advisorsById.has(advisor.id)) {
					advisorsById.set(advisor.id, []);
				}
				advisorsById.get(advisor.id).push(advisor);
			});
			
			// Find name duplicates
			console.log("\n🔍 DUPLICATES BY NAME:");
			let nameDuplicates = 0;
			for (const [name, advisors] of advisorsByName) {
				if (advisors.length > 1) {
					nameDuplicates++;
					console.log(`⚠️ "${name}": ${advisors.length} copies`);
					advisors.forEach((advisor, index) => {
						console.log(`   ${index + 1}. ID: "${advisor.id}", Type: ${advisor.type}, HasCharacterSpec: ${!!advisor.characterSpec}`);
					});
				}
			}
			
			// Find ID duplicates  
			console.log("\n🔍 DUPLICATES BY ID:");
			let idDuplicates = 0;
			for (const [id, advisors] of advisorsById) {
				if (advisors.length > 1) {
					idDuplicates++;
					console.log(`⚠️ ID "${id}": ${advisors.length} copies`);
					advisors.forEach((advisor, index) => {
						console.log(`   ${index + 1}. Name: "${advisor.name}", Type: ${advisor.type}`);
					});
				}
			}
			
			// Expected HEC advisors
			const expectedHEC = [
				"omnia", "moloch", "gaia", "technos", "the-everyman", "aluna", 
				"the-innocent", "the-oracle", "the-alchemist", "the-fool", 
				"the-devils-advocate", "the-wise-old-man", "joanna-macy", "quan-yin"
			];
			
			console.log("\n📋 HEC ADVISOR CHECK:");
			const foundHEC: string[] = [];
			const missingHEC: string[] = [];
			
			expectedHEC.forEach(expectedId => {
				const found = allAdvisors.find(advisor => advisor.id === expectedId);
				if (found) {
					foundHEC.push(expectedId);
				} else {
					missingHEC.push(expectedId);
				}
			});
			
			console.log(`✅ Found HEC advisors (${foundHEC.length}/14):`, foundHEC);
			if (missingHEC.length > 0) {
				console.log(`❌ Missing HEC advisors (${missingHEC.length}/14):`, missingHEC);
			}
			
			// User-created advisors
			const userAdvisors = allAdvisors.filter(advisor => 
				advisor.id && !expectedHEC.includes(advisor.id)
			);
			console.log(`\n👤 USER-CREATED ADVISORS (${userAdvisors.length}):`);
			userAdvisors.forEach(advisor => {
				console.log(`   - "${advisor.name}" (${advisor.id}) - Type: ${advisor.type}`);
			});
			
			console.log("\n📊 SUMMARY:");
			console.log(`   Total: ${allAdvisors.length} advisors`);
			console.log(`   Expected: 17 (14 HEC + 3 user-created: Bucky, MJ, Sun Tzu)`);
			console.log(`   Name duplicates: ${nameDuplicates}`);
			console.log(`   ID duplicates: ${idDuplicates}`);
			console.log(`   HEC found: ${foundHEC.length}/14`);
			console.log(`   User-created: ${userAdvisors.length}`);
			
		} catch (error) {
			console.error("❌ Error investigating duplicates:", error);
		}
	}

	// CLEANUP: Remove duplicate advisor records
	async function cleanupDuplicateAdvisors() {
		if (!advisorService) {
			console.error("❌ AdvisorService not available");
			return;
		}
		
		console.log("🧹 CLEANING UP DUPLICATE ADVISORS...");
		console.log("====================================");
		
		try {
			const allAdvisors = await advisorService.getAllAdvisors();
			console.log(`📊 Starting with ${allAdvisors.length} total advisors`);
			
			// Group by name to find duplicates
			const advisorsByName = new Map();
			allAdvisors.forEach(advisor => {
				if (!advisorsByName.has(advisor.name)) {
					advisorsByName.set(advisor.name, []);
				}
				advisorsByName.get(advisor.name).push(advisor);
			});
			
			let deletedCount = 0;
			
			// For each group of duplicates, keep the best one and delete the rest
			for (const [name, advisors] of advisorsByName) {
				if (advisors.length > 1) {
					console.log(`\n🔍 Processing duplicates for "${name}" (${advisors.length} copies)`);
					
					// Sort by quality: complete character specs first, then by creation date if available
					advisors.sort((a, b) => {
						// Prefer advisors with character specs
						const aHasSpec = !!a.characterSpec;
						const bHasSpec = !!b.characterSpec;
						
						if (aHasSpec && !bHasSpec) return -1;
						if (!aHasSpec && bHasSpec) return 1;
						
						// If both have or don't have specs, prefer newer ones (if metadata available)
						const aCreated = a.metadata?.created || '0';
						const bCreated = b.metadata?.created || '0';
						return bCreated.localeCompare(aCreated);
					});
					
					// Keep the first (best) one, delete the rest
					const keepAdvisor = advisors[0];
					const deleteAdvisors = advisors.slice(1);
					
					console.log(`   ✅ Keeping: ID "${keepAdvisor.id}" (HasSpec: ${!!keepAdvisor.characterSpec})`);
					
					for (const advisor of deleteAdvisors) {
						console.log(`   🗑️ Deleting: ID "${advisor.id}" (HasSpec: ${!!advisor.characterSpec})`);
						
						// Note: Static system advisors are excluded from holonAdvisors list, 
						// so they won't appear in duplicates anyway
						
						try {
							await advisorService.deleteAdvisor(advisor.id);
							deletedCount++;
						} catch (error) {
							console.error(`   ❌ Failed to delete ${advisor.id}:`, error);
						}
					}
				}
			}
			
			console.log(`\n✅ Cleanup complete! Deleted ${deletedCount} duplicate advisors`);
			
			// Refresh the count
			const finalAdvisors = await advisorService.getAllAdvisors();
			console.log(`📊 Final count: ${finalAdvisors.length} advisors`);
			
		} catch (error) {
			console.error("❌ Error cleaning up duplicates:", error);
		}
	}

	// Test function to verify LLM advisor schema generation
	async function testLLMAdvisorGeneration() {
		if (!llmService) {
			console.error("❌ LLM service not available");
			return;
		}
		
		console.log("🧪 Testing LLM advisor generation...");
		
		try {
			// Test with a well-known historical figure
			const testResponse = await llmService.generateRealPersonAdvisor("Albert Einstein", "scientific innovation and creativity");
			console.log("🔬 LLM Response:", testResponse);
			
			if (testResponse.content) {
				const advisorData = JSON.parse(testResponse.content);
				console.log("🎭 Generated advisor data:", {
					valid: advisorData.valid,
					name: advisorData.name,
					keys: Object.keys(advisorData),
					hasRequiredFields: {
						background_context: !!advisorData.background_context,
						known_for: !!advisorData.known_for && Array.isArray(advisorData.known_for),
						expertise_domains: !!advisorData.expertise_domains && Array.isArray(advisorData.expertise_domains),
						polarities: !!advisorData.polarities && typeof advisorData.polarities === 'object'
					}
				});
				
				// Test if this would pass AdvisorService validation
				if (advisorService) {
					console.log("🔍 Testing advisor creation with generated data...");
					const testAdvisor: CouncilAdvisorExtended = {
						name: advisorData.name,
						type: 'real',
						lens: "scientific innovation and creativity",
						characterSpec: advisorData
					};
					
					// Don't actually create, just test validation
					console.log("✅ LLM advisor generation test complete");
				}
			}
		} catch (error) {
			console.error("❌ LLM advisor generation test failed:", error);
		}
	}

	// DEPRECATED: Test function removed
	// Use the new debug tools in the UI instead of this legacy test function

	// Debug Design Streams
	$: if (showDesignStreams) {
		console.log('showDesignStreams changed to true');
		console.log('ritualSession.advisors:', ritualSession.advisors);
	}

	async function handleDesignStreamsAdvisorChat(event: CustomEvent) {
		const simpleAdvisor = event.detail.advisor;
		
		// HOLONIC: Ensure advisor cache is ready  
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}
		
		// Use the same approach as converseWithAdvisor for consistency
		// HOLONIC: Look up advisor by name to get full advisor data
		let fullAdvisor: CouncilAdvisorExtended | null = null;
		if (advisorService) {
			const allAdvisors = await advisorService.getAllAdvisors();
			fullAdvisor = allAdvisors.find(a => a.name === simpleAdvisor.name) || null;
		}
		
		if (fullAdvisor) {
			console.log('🔍 DesignStreams advisor chat - Full advisor loaded:', {
				id: fullAdvisor.id,
				name: fullAdvisor.name,
				type: fullAdvisor.type,
				lens: fullAdvisor.lens,
				characterSpec: fullAdvisor.characterSpec,
				characterSpecType: typeof fullAdvisor.characterSpec,
				characterSpecKeys: fullAdvisor.characterSpec && typeof fullAdvisor.characterSpec === 'object' ? Object.keys(fullAdvisor.characterSpec) : 'no keys'
			});
			
			selectedAdvisorForChat = fullAdvisor;
			advisorChatSource = 'design-streams';
			showDesignStreams = false; // Close Design Streams page
			showAdvisorChat = true; // Open AI chat modal
			advisorChatMessages = []; // Clear previous messages
			
			// Add immediate introduction
			await addImmediateAdvisorIntroduction(fullAdvisor);
		} else {
			// Error: Advisor not found
			console.error(`❌ Advisor lookup failed for "${simpleAdvisor.name}"`);
			alert(`Error: Could not find advisor "${simpleAdvisor.name}" in the advisor library. Please check the advisor name and try again, or create the advisor first.`);
			return;
		}
	}

	// Holonic pattern: Handle ritual data updates from Design Streams
	function handleRitualDataUpdate(event: CustomEvent) {
		console.log('🎯 Received updateRitualData event:', event.detail);
		
		const { type, value } = event.detail;
		
		if (type === 'wish_statement') {
			console.log('📝 Updating wish statement:', value);
			ritualSession.wish_statement = value;
			// Track wish update in session
			if (sessionManager) {
				sessionManager.trackInteraction('wish_update', { wish: value });
			}
		} else if (type === 'declared_values') {
			console.log('💎 Updating declared values:', value);
			ritualSession.declared_values = value;
			// Track values update in session
			if (sessionManager) {
				sessionManager.trackInteraction('values_update', { values: value });
			}
		}
		
		// Update the ritual session reactively
		ritualSession = { ...ritualSession };
		console.log('🔄 Updated ritualSession:', ritualSession);
		
		// HOLONIC BEHAVIOR: Update metatron immediately to keep everything synchronized
		updateMetatronFromSession();
		console.log('🎯 Metatron updated');
		
		// HOLONIC BEHAVIOR: Persist changes to HoloSphere immediately
		console.log('💾 Saving to HoloSphere...');
		saveRitualSession();
		
		console.log('✅ Ritual data update complete:', { type, value });
	}

	// API Key Modal Functions
	// NOTE: This is a placeholder implementation for future secure API key management
	// Currently, the modal collects keys but does NOT save or use them anywhere
	
	function openApiModal() {
		showApiModal = true;
	}

	function closeApiModal() {
		showApiModal = false;
		// Clear the input fields when closing (since we're not saving)
		// This ensures keys don't remain in memory
		apiKeys = {
			openai: '',
			anthropic: '',
			groq: ''
		};
	}

	function handleApiSubmit() {
		// CURRENT BEHAVIOR: Keys are logged (redacted) but immediately discarded
		// The LLMService still uses environment variables only (src/utils/llm-service.ts)
		// 
		// TODO FOR FUTURE IMPLEMENTATION:
		// 1. Implement secure storage (encrypted localStorage or secure session storage)
		// 2. Update LLMService to accept runtime API keys instead of just env vars
		// 3. Add API key validation (format checking, test API calls)
		// 4. Add key management UI (show which keys are set, allow individual clearing)
		// 5. Consider key expiration/refresh mechanisms
		
		console.log('API Keys entered (not saved for security):', {
			openai: apiKeys.openai ? '***' : 'empty',
			anthropic: apiKeys.anthropic ? '***' : 'empty', 
			groq: apiKeys.groq ? '***' : 'empty'
		});
		
		// Keys are immediately discarded for security
		closeApiModal();
	}

	// Handle session completion from Design Streams
	async function handleSessionComplete(event: CustomEvent) {
		console.log('🎯 handleSessionComplete called with sessionManager:', !!sessionManager);
		
		if (!sessionManager) {
			console.error('❌ No session manager available');
			return;
		}
		
		console.log('✅ Session manager found, proceeding with completion');
		
		// HOLONIC: Ensure advisor cache is ready for resolution
		if (advisorService) {
			await advisorService.getAllAdvisors();
		}
		
		// Build seating map for snapshot using the same resolution logic as elsewhere
		console.log('🔍 Current circleInputs before seating generation:', circleInputs);
		
		const seating = circleInputsToSeating(circleInputs);
		
		console.log('📋 Seating map for snapshot:', seating);
		
		const result = await sessionManager.completeSession(
			seating,
			ritualSession.wish_statement || '',
			ritualSession.declared_values || [],
			'Current User' // TODO: Get actual user name
		);
		
		if (result) {
			console.log('✅ Session completed and ritual snapshot saved:', result.ritual.id);
			
					// HOLONIC BEHAVIOR: Use the data we already have instead of reloading
		// The sessionManager already has the updated rituals array, so use it directly
		if (result.ritual) {
			// Add the new ritual to our local previousRituals array
			previousRituals = [result.ritual, ...previousRituals];
			console.log('✅ Added new ritual to local previousRituals array:', previousRituals.length, 'total rituals');
			
			// DEBUGGING: Test if we can save a simple test object to HoloSphere
			console.log('🧪 Testing simple HoloSphere save...');
			try {
				await holosphere.put(holonID, "test_save", { message: "test", timestamp: Date.now() });
				console.log('✅ Simple test save succeeded');
				
				// Try to load it back immediately
				const testData = await holosphere.get(holonID, "test_save", holonID);
				console.log('📦 Test data retrieved:', testData);
			} catch (error) {
				console.error('❌ Simple test save failed:', error);
			}
		}
			
			// TODO: Show completion notification to user
		} else {
			console.error('❌ Session completion failed - no result returned');
		}
	}
</script>

<!-- svelte-ignore css_unused_selector -->
<!-- svelte-ignore css_unused_selector -->
<div class="space-y-4">
	<!-- Header Section -->
	<div class="bg-gray-800 rounded-2xl p-4 sm:p-6">
		<div class="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
			<div class="text-center sm:text-left">
				<h1 class="text-2xl sm:text-3xl font-bold text-white mb-1">Council</h1>
				<p class="text-gray-400 text-sm">Metatron Structure Governance</p>
			</div>
		</div>

		<!-- Stats Bar -->
		<div class="stats-bar mb-4">
			<div class="stats-bar__item stats-bar__item--success">
				<span class="stats-bar__value">{activeMembers}</span>
				<span class="stats-bar__label">Active</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--info">
				<span class="stats-bar__value">{ritualSession.advisors.length}</span>
				<span class="stats-bar__label">Advisors</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item">
				<span class="stats-bar__value">{ritualSession.declared_values.length}</span>
				<span class="stats-bar__label">Values</span>
			</div>
			<div class="stats-bar__divider"></div>
			<div class="stats-bar__item stats-bar__item--warning">
				<span class="stats-bar__value">{previousRituals.length}</span>
				<span class="stats-bar__label">Rituals</span>
			</div>
		</div>
	</div>

	<!-- Main Content Container -->
	<div class="flex flex-col lg:flex-row gap-6">
		<!-- Council Main Area -->
		<div class="lg:flex-1 bg-gray-800 rounded-3xl shadow-xl">
			<div class="p-6">
				{#if isLoading}
					<div class="flex items-center justify-center py-12">
						<div class="text-center">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-4 mx-auto"></div>
							<p class="text-gray-400">Loading council data...</p>
						</div>
					</div>
				{:else}
					<div class="relative">
						<!-- Interactive Metatron Structure using absolute positioning -->
						<div class="metatron-container relative w-full max-w-[600px] mx-auto aspect-square" style="--diam:{circleRadiusPercent * 2}%">
							<!-- Connecting lines -->
							<svg class="absolute inset-0 w-full h-full pointer-events-none" style="z-index: 5;">
								<!-- Lines from center to all other circles -->
								{#each metatronCircles.filter(c => c.id !== 'center') as circle}
									<line 
										x1="50%" y1="50%" 
										x2="{circle.x}%" y2="{circle.y}%" 
										stroke="#c6c6c5" 
										stroke-width="1" 
										opacity="0.6"
									/>
								{/each}
								
								<!-- Lines between all circles (except center) -->
								{#each metatronCircles.filter(c => c.id !== 'center') as circle1, i}
									{#each metatronCircles.filter(c => c.id !== 'center' && c.id !== circle1.id).slice(i) as circle2}
										<line 
											x1="{circle1.x}%" y1="{circle1.y}%" 
											x2="{circle2.x}%" y2="{circle2.y}%" 
											stroke="#c6c6c5" 
											stroke-width="0.5" 
											opacity="0.2"
										/>
									{/each}
								{/each}
							</svg>
							{#each metatronCircles as circle}
								{@const innerPositions = ['inner-top', 'inner-top-right', 'inner-bottom-right', 'inner-bottom', 'inner-bottom-left', 'inner-top-left']}
								<div
									class="metatron-circle interactive-circle"
									class:editing={editingCircle === circle.id}
									class:has-value={innerPositions.includes(circle.id) && circleInputs[circle.id]}
									style="left:{circle.x}%; top:{circle.y}%; width:{circleRadiusPercent * 2}%; height:{circleRadiusPercent * 2}%;"
									data-circle-id={circle.id}
									on:click={() => startEditingCircle(circle.id)}
									on:keydown={(e) => e.key === 'Enter' && startEditingCircle(circle.id)}
									role="button"
									tabindex="0"
									title={innerPositions.includes(circle.id) ? 
										(circleInputs[circle.id] ? 
											`Click to edit value: ${circleInputs[circle.id]}` : 
											`Click to add value for ${getInnerCircleDisplayName(circle.id)} position`
										) : 
										(circle.id.startsWith('outer') ? 
											(circleInputs[circle.id] ? 
												`Click to manage advisor: ${getAdvisorDisplayName(circleInputs[circle.id])}` : 
												'Click to add advisor'
											) : 
											'Click to add advisor'
										)
									}
								>
									{#if circle.id === 'center'}
										<span class="label-text select-none text-center leading-tight">
											{#if wishTitle}
												{#each wishTitle.split('\n') as word}
													<div class="text-xs font-medium">{word}</div>
												{/each}
											{:else}
												<div class="text-xs opacity-60">Speak</div>
												<div class="text-xs opacity-60">Your</div>
												<div class="text-xs opacity-60">Wish</div>
											{/if}
										</span>
									{:else if innerPositions.includes(circle.id)}
										<!-- Inner circle - show value or placeholder -->
										<span class="label-text select-none text-center leading-tight">
											{#if circleInputs[circle.id]}
												<div class="text-xs font-medium">{circleInputs[circle.id]}</div>
											{:else}
												<div class="text-xs opacity-60">Click to</div>
												<div class="text-xs opacity-60">add value</div>
											{/if}
										</span>
									{:else if circleInputs[circle.id]}
										<!-- Outer circle - show advisor name -->
										<span class="label-text select-none">
											{getAdvisorDisplayName(circleInputs[circle.id])}
										</span>
									{:else}
										<!-- Empty outer circle - show placeholder -->
										<span class="label-text select-none text-center leading-tight">
											<div class="text-xs opacity-60">Click to</div>
											<div class="text-xs opacity-60">add advisor</div>
										</span>
									{/if}
								</div>
							{/each}
						</div>

						<!-- Action Buttons -->
						<div class="controls-row mt-6">
							<div class="controls-row__left">
								<button
									on:click={summonholonicecosystemcouncil}
									class="btn btn--primary"
								>
									<span class="text-base">🎭</span>
									<span class="hidden sm:inline">Summon HEC</span>
								</button>
							</div>

							<div class="controls-row__center">
								<button
									on:click={startRitual}
									class="btn btn--primary"
								>
									<span class="text-base">✨</span>
									<span>Begin Ritual</span>
								</button>

								<button
									on:click={async () => await openCouncilChat()}
									class="btn btn--primary"
								>
									<span class="text-base">💬</span>
									<span class="hidden sm:inline">Chat</span>
								</button>
							</div>

							<div class="controls-row__right">
								<button
									on:click={async () => { console.log('Design Streams button clicked'); await openDesignStreams(); }}
									class="icon-btn"
									title="Design Streams"
								>
									🛠
								</button>

								<button
									on:click={openApiModal}
									class="icon-btn"
									title="API Keys"
								>
									🔐
								</button>
							</div>
						</div>

						<!-- Interactive Circle Input Overlay -->
						{#if editingCircle}
							<div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
								<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
									<div class="p-6 border-b border-gray-700">
										<div class="flex items-center justify-between">
											<h3 class="text-white text-xl font-bold">Edit Advisor: {editingCircle}</h3>
											<!-- svelte-ignore a11y_consider_explicit_label -->
											<button
												on:click={cancelCircleInput}
												class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
											>
												<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
												</svg>
											</button>
										</div>
									</div>
									
									<div class="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
										<div class="space-y-4">
											<div>
												<!-- svelte-ignore a11y_label_has_associated_control -->
												<label class="block text-gray-300 text-sm font-medium mb-2">
													Enter advisor name:
												</label>
												<input
													type="text"
													bind:value={circleInputs[editingCircle]}
													placeholder="Enter advisor name..."
													class="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
													on:keydown={(e) => {
														if (e.key === 'Enter' && editingCircle) {
															saveCircleInput(editingCircle);
														} else if (e.key === 'Escape') {
															cancelCircleInput();
														}
													}}
													use:focusOnMount
												/>
											</div>
										</div>
									</div>
									<div class="p-6 border-t border-gray-700 flex gap-3">
										<button
											on:click={() => editingCircle && saveCircleInput(editingCircle)}
											class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-xl transition-colors"
										>
											Save
										</button>
										<button
											on:click={cancelCircleInput}
											class="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-xl transition-colors"
										>
											Cancel
										</button>
									</div>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Council Info Panel -->
		<div class="lg:w-80 lg:flex-shrink-0 space-y-6">
			<!-- Previous Rituals -->
			<div class="bg-gray-800 rounded-3xl shadow-xl p-6">
				<h3 class="text-xl font-bold text-white mb-4">Previous Rituals</h3>
				<div class="space-y-4 max-h-[500px] overflow-y-auto">
					{#each previousRituals as ritual}
						<div class="bg-gray-700 rounded-xl p-4 hover:bg-gray-600 transition-colors cursor-pointer">
							<h4 class="text-white font-medium text-sm mb-2 line-clamp-2">{ritual.title}</h4>
							<div class="flex items-center justify-between text-xs text-gray-400 mb-3">
								<span>{ritual.createdAt ? (ritual.createdAt as Date).toLocaleDateString() : 'Unknown Date'}</span>
								<span>{ritual.design_streams?.length || 0} streams</span>
							</div>
							<div class="text-xs text-gray-300">
								<div class="mb-2">{ritual.artifact?.ascii_glyph || '◯'}</div>
								<p class="line-clamp-2 italic">"{ritual.artifact?.text || 'No description'}"</p>
							</div>
							<button 
								on:click={() => restoreRitualSession(ritual)}
								class="mt-3 w-full bg-indigo-600 hover:bg-indigo-700 text-white py-1 px-3 rounded-lg text-xs transition-colors"
							>
								Restore Session
							</button>
						</div>
					{:else}
						<div class="text-center text-gray-400 py-8">
							<div class="text-4xl mb-3">✨</div>
							<p class="text-sm">No rituals completed yet</p>
							<p class="text-xs mt-2">Begin your first ritual to create sacred artifacts</p>
						</div>
					{/each}
				</div>
			</div>

			<!-- Temporary Debugging Tools - COMMENTED OUT 2024-12-19 - Can be restored if needed -->
			<!-- 
			<div class="bg-yellow-900 border border-yellow-600 rounded-3xl shadow-xl p-6">
				<h3 class="text-xl font-bold text-yellow-100 mb-4">🔧 Debug Tools</h3>
				<div class="space-y-3">
					<button 
						on:click={investigateAdvisorDuplicates}
						class="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg text-sm transition-colors"
					>
						🔍 Investigate Duplicates
					</button>
					<button 
						on:click={cleanupDuplicateAdvisors}
						class="w-full bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg text-sm transition-colors"
					>
						🧹 Cleanup Duplicates
					</button>
					<button 
						on:click={testLLMAdvisorGeneration}
						class="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg text-sm transition-colors"
					>
						🎭 Test LLM Generation
					</button>
				</div>
				<p class="text-xs text-yellow-300 mt-3">
					Use "Investigate" first to see what duplicates exist, then "Cleanup" to remove them.
				</p>
			</div>
			-->
		</div>
	</div>
</div>

<!-- Member Detail Modal -->
{#if showMemberModal && selectedMember}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:keydown={(e) => e.key === 'Escape' && closeMemberModal()}
	>
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
			<div class="p-6 border-b border-gray-700">
				<div class="flex items-center justify-between">
					<h3 class="text-white text-xl font-bold">Member Details</h3>
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						on:click={closeMemberModal}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
			</div>
			
			<div class="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
				<div class="space-y-4">
					<div class="flex items-center gap-4">
						<div class="w-16 h-16 rounded-full bg-gray-700 border-2 border-gray-600 flex items-center justify-center text-white font-bold text-xl">
							{#if selectedMember.avatar}
								<img src={selectedMember.avatar} alt={selectedMember.name} class="w-full h-full rounded-full object-cover" />
							{:else}
								{selectedMember.name.charAt(0).toUpperCase()}
							{/if}
						</div>
						<div>
							<h4 class="text-white font-bold text-lg">{selectedMember.name}</h4>
							<p class="text-gray-400">{selectedMember.role}</p>
						</div>
					</div>
					
					<div class="space-y-2">
						<div class="flex justify-between">
							<span class="text-gray-400">Status</span>
							<span class="text-white font-medium capitalize">{selectedMember.status}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Contribution</span>
							<span class="text-white font-medium">{selectedMember.contribution}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-gray-400">Last Active</span>
							<span class="text-white font-medium">{selectedMember.lastActive}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Circle Selection Modal -->
{#if showCircleSelectionModal && selectedCircleForAction}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="fixed inset-0 z-50 overflow-auto bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
		on:keydown={(e) => e.key === 'Escape' && closeCircleSelectionModal()}
	>
		<div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
			<div class="p-6">
				<div class="flex items-center justify-between mb-6">
					<h3 class="text-white text-xl font-bold">Choose Action</h3>
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						on:click={closeCircleSelectionModal}
						class="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-gray-700"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				
				<div class="flex-1 overflow-y-auto space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
					<div class="text-center mb-6">
						<div class="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-2xl mx-auto mb-3">
							🧙‍♀️
						</div>
						<h4 class="text-white font-bold text-lg">{getAdvisorDisplayName(circleInputs[selectedCircleForAction])}</h4>
						<p class="text-gray-400 text-sm">Select an action for this advisor</p>
					</div>
					
					<div class="space-y-3">
						<button
							on:click={converseWithAdvisor}
							class="btn btn--primary w-full"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
							</svg>
							Converse with {getAdvisorDisplayName(circleInputs[selectedCircleForAction])}
						</button>
						<button
							on:click={changeAdvisor}
							class="btn btn--secondary w-full"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
							</svg>
                            Replace
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Seat Picker Modal -->
{#if showSeatPicker}
    <div class="fixed inset-0 z-50 overflow-auto bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
            <div class="p-6 border-b border-gray-700 flex items-center justify-between">
                <h3 class="text-white text-xl font-bold">Select an Advisor</h3>
                <button class="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700" on:click={() => { showSeatPicker = false; showCreateInPicker = false; }} aria-label="Close">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
                <!-- Create new advisor inline toggle -->
                {#if !showCreateInPicker}
                    <button
                        class="btn btn--primary w-full btn--sm"
                        on:click={() => showCreateInPicker = true}
                    >
                        ➕ Create New Advisor
                    </button>
                {:else}
                    <div class="bg-gray-700 rounded-xl p-4 space-y-3">
                        <div class="grid md:grid-cols-3 gap-3">
                            <div>
                                <label for="advisor-name-input" class="block text-gray-300 mb-1 text-sm">Advisor Name</label>
                                <input id="advisor-name-input" class="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                                    bind:value={currentAdvisorName} placeholder="e.g., Donella Meadows" use:focusOnMount />
                            </div>
                            <div>
                                <label for="advisor-type-select" class="block text-gray-300 mb-1 text-sm">Type</label>
                                <select id="advisor-type-select" class="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white" bind:value={selectedAdvisorType}>
                                    <option value="real">Historical/Real Person</option>
                                    <option value="mythic">Mythic/Spiritual Being</option>
                                    <option value="archetype">Archetypal Force</option>
                                </select>
                            </div>
                            <div>
                                <label for="advisor-lens-input" class="block text-gray-300 mb-1 text-sm">Lens/Wisdom</label>
                                <input id="advisor-lens-input" class="w-full bg-gray-600 border border-gray-500 rounded px-3 py-2 text-white"
                                    bind:value={currentAdvisorLens} placeholder="e.g., deep ecology" />
                            </div>
                        </div>
                        <div class="flex">
                            <button
                                class="btn btn--success w-full"
                                disabled={!currentAdvisorName.trim() || !currentAdvisorLens.trim() || isGeneratingAdvisor}
                                on:click={async () => { await addAdvisor(); openSeatPicker(); showCreateInPicker = false; }}
                            >
                                {#if isGeneratingAdvisor}Creating…{:else}Create Advisor{/if}
                            </button>
                        </div>
                    </div>
                {/if}
                <input
                    bind:value={seatPickerQuery}
                    on:input={(e) => filterSeatPicker((e.target as HTMLInputElement).value)}
                    placeholder="Search by name or lens..."
                    class="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[50vh] overflow-y-auto pr-1">
                    {#each filteredSeatPickerOptions as a}
                        <div class="bg-gray-700 rounded-xl p-4 flex items-start justify-between gap-3 hover:bg-gray-600 transition-colors relative">
                            <!-- Delete for user-created advisors only -->
                            {#if holonAdvisors && holonAdvisors.some(h => h.name === a.name && h.lens === a.lens)}
                                <button
                                    class="absolute top-2 right-2 text-gray-300 hover:text-red-400"
                                    title="Delete advisor"
                                    on:click={async () => {
                                        if (confirm(`Delete ${a.name}? This cannot be undone.`)) {
                                            await deleteHolonAdvisor(a.name);
                                            openSeatPicker();
                                        }
                                    }}
                                >
                                    ✕
                                </button>
                            {/if}
                            <div class="flex-1 pr-6">
                                <div class="text-white font-semibold">{a.name}</div>
                                <div class="text-gray-300 text-sm capitalize">{a.type}</div>
                                {#if a.lens}<div class="text-gray-400 text-xs italic">"{a.lens}"</div>{/if}
                            </div>
                            <button class="btn btn--success btn--sm" on:click={() => selectSeatAdvisor(a)}>
                                Seat
                            </button>
                        </div>
                    {/each}
                    {#if filteredSeatPickerOptions.length === 0}
                        <div class="text-gray-400 text-sm italic col-span-full text-center">No matching advisors</div>
                    {/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Ritual Interface Modal -->
{#if showRitual}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		class="fixed inset-0 z-50 overflow-auto bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
		on:keydown={(e) => {
			if (e.key === 'Escape') {
				closeRitual();
			} else if (e.key === 'Enter' && !e.shiftKey) {
				// Only trigger Next if we're not in a text input/textarea
				const target = e.target as HTMLElement;
				if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
					e.preventDefault();
					// Check if Next button is enabled
					const nextButton = document.querySelector('[data-next-button]') as HTMLButtonElement;
					if (nextButton && !nextButton.disabled) {
						nextStage();
					}
				}
			}
		}}
	>
		<div class="bg-gray-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
			<!-- Ritual Header -->
			<div class="p-6 border-b border-gray-700">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-4">
						<div class="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-2xl">
                            {#if ritualStage === 0}✨{:else if ritualStage === 1}💠{:else if ritualStage === 2}🗣️{:else if ritualStage === 3}💎{:else}🛠{/if}
						</div>
						<div>
							<h2 class="text-2xl font-bold text-white">Council Ritual</h2>
							<p class="text-gray-300">
                                {#if ritualStage === 0}Welcome — Choose Your Council
                                {:else if ritualStage === 1}Seat Your Council — Metatron Table
                                {:else if ritualStage === 2}Speak Your Wish
                                {:else if ritualStage === 3}Name Your Values
                                {:else}Design Streams — Pathways Forward
								{/if}
							</p>
						</div>
					</div>
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						on:click={closeRitual}
						class="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-700"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
						</svg>
					</button>
				</div>
				<!-- Progress Bar -->
				<div class="mt-6 w-full bg-gray-700 rounded-full h-2">
                    <div class="bg-indigo-500 h-2 rounded-full transition-all duration-500" style="width: {((ritualStage + 1) / 5) * 100}%"></div>
				</div>
			</div>

			<!-- Ritual Content -->
			<div class="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
				{#if ritualStage === 0}
                    <!-- Stage 0: Welcome — Choose council mode -->
					<div class="text-center space-y-6">
						<div class="text-6xl mb-4">✨</div>
                        <h3 class="text-3xl font-bold text-white mb-4">Welcome to the Council Ritual</h3>
						<p class="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
                            Choose how to assemble your council: use the Holonic Ecosystem Council or select your own advisors.
                        </p>
                        <div class="flex flex-col sm:flex-row gap-4 justify-center mt-6">
                            <button
                                class="btn btn--primary btn--lg"
                                on:click={() => {
                                    // Use existing Metatron seating as the ritual council and skip to Speak Your Wish
                                    try {
                                        // HOLONIC: Extract advisor IDs from circleInputs (outer positions only)
                                        const outerPositions = ['outer-top', 'outer-top-right', 'outer-bottom-right', 'outer-bottom', 'outer-bottom-left', 'outer-top-left'];
                                        const advisorIds = outerPositions
                                            .map(pos => circleInputs[pos])
                                            .filter(id => id && typeof id === 'string');
                                        ritualSession.advisors = advisorIds;
                                    } catch (e) {
                                        console.warn('Could not resolve existing Metatron council, proceeding anyway', e);
                                    }
                                    ritualStage = 2; // Speak Your Wish
                                }}
                            >
                                Use Existing Metatron Council
                            </button>
                            <button
                                class="bg-gray-600 hover:bg-gray-700 text-white px-8 py-3 rounded-xl transition-colors font-semibold shadow"
                                on:click={() => nextStage()}
                            >
                                Call New Council Members
                            </button>
						</div>
                        <p class="text-gray-400 text-sm max-w-xl mx-auto">You can add, remove, or replace advisors in the next step using the Metatron table. Seats can remain empty.</p>
					</div>

				{:else if ritualStage === 1}
                    <!-- Stage 1: Metatron Seating (using modularized component) -->
					<div class="space-y-6">
						<SeatCouncilContent
							{metatronCircles}
							{circleRadiusPercent}
							{circleInputs}
							{editingCircle}
							{wishTitle}
							onCircleClick={startEditingCircle}
							{holonAdvisors}
							onOpenAdvisorChat={openAdvisorChat}
							onAddAdvisorToRitual={addAdvisorToRitual}
							onDeleteAdvisor={deleteHolonAdvisor}
							onCreateAdvisor={addAdvisor}
							{getAdvisorDisplayName}
							bind:currentAdvisorName
							bind:currentAdvisorLens
							bind:selectedAdvisorType
							bind:isGeneratingAdvisor
							bind:generationProgress
							showHeader={true}
							showTip={true}
						/>
					</div>

				{:else if ritualStage === 2}
                    <!-- Stage 2: Speak Your Wish -->
					<div class="space-y-6">
                        <div class="text-center">
                            <div class="text-5xl mb-4">🗣️</div>
                            <h3 class="text-3xl font-bold text-white mb-4">Speak Your Wish</h3>
                            <p class="text-gray-300 text-lg">What do you seek to bring into being?</p>
							</div>
							<textarea
								bind:value={ritualSession.wish_statement}
								placeholder="I wish to create..."
								class="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[120px] resize-none"
								use:focusOnMount
							></textarea>
					</div>

				{:else if ritualStage === 3}
                    <!-- Stage 3: Name Your Values -->
					<div class="space-y-6">
						<div class="text-center">
                            <div class="text-5xl mb-4">💎</div>
							<h3 class="text-3xl font-bold text-white mb-4">Name Your Sacred Values</h3>
                            <p class="text-gray-300 text-lg">These will guide how your wish manifests.</p>
                            <div class="text-sm text-gray-400 mt-2">{ritualSession.declared_values.length}/6 values</div>
						</div>
						<div class="flex gap-4 mb-6">
							<input
								bind:value={currentValue}
								placeholder="Enter a core value..."
								class="flex-1 bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
								use:focusOnMount
							/>
							<button
								on:click={addValue}
								disabled={!currentValue.trim() || ritualSession.declared_values.length >= 6}
								class="group relative bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:from-gray-600 disabled:to-gray-600 text-white px-8 py-3 rounded-xl transition-all duration-200 font-medium shadow-lg hover:shadow-xl disabled:hover:shadow-lg transform hover:scale-105 disabled:hover:scale-100"
							>
                                {ritualSession.declared_values.length >= 6 ? 'Max Values (6)' : 'Add Value'}
								<div class="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 disabled:opacity-0 rounded-xl transition-opacity duration-200"></div>
							</button>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{#each ritualSession.declared_values as value, index}
								<div class="bg-gray-700 rounded-xl p-4 flex items-center justify-between group hover:bg-gray-600 transition-colors">
									<span class="text-white font-medium">✦ {value}</span>
									<button
										on:click={() => removeValue(index)}
                                        class="text-gray-400 hover:text-red-400 transition-opacity"
									>
										✕
									</button>
								</div>
							{/each}
						</div>
						{#if ritualSession.declared_values.length === 0}
                            <p class="text-center text-gray-400 italic">Add up to six values that will guide your manifestation...</p>
						{/if}
					</div>

				{:else if ritualStage === 4}
                    <!-- Stage 4: Design Streams -->
					<div class="space-y-6 text-center">
						<div class="text-5xl mb-4">🛠</div>
						<h3 class="text-3xl font-bold text-white mb-4">Pathways Forward</h3>
						<p class="text-gray-300 text-lg">From wisdom comes action. Choose your path of manifestation.</p>
						
						<button
							on:click={() => { showDesignStreams = true; }}
							class="group relative bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white px-12 py-5 rounded-2xl transition-all duration-300 text-lg font-semibold shadow-xl hover:shadow-2xl transform hover:scale-105"
						>
							Open Design Streams
							<div class="absolute inset-0 bg-white opacity-0 group-hover:opacity-10 rounded-2xl transition-opacity duration-300"></div>
						</button>
					</div>
				{/if}
			</div>

			<!-- Navigation Footer -->
			<div class="p-6 border-t border-gray-700 flex justify-between items-center">
				<button
					on:click={prevStage}
					disabled={ritualStage === 0}
					class="bg-gray-600 hover:bg-gray-700 disabled:bg-gray-800 disabled:text-gray-500 text-white px-6 py-2 rounded-xl transition-colors"
				>
					← Previous
				</button>
				
				<div class="text-gray-300">
                    Stage {ritualStage + 1} of 5
				</div>
				
				<button
					data-next-button
					on:click={nextStage}
                    disabled={ritualStage === 4 || 
                        (ritualStage === 2 && !ritualSession.wish_statement.trim()) ||
                        (ritualStage === 3 && ritualSession.declared_values.length === 0)}
					class="bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-600 text-white px-6 py-2 rounded-xl transition-colors"
				>
                    {ritualStage === 4 ? 'Complete' : 'Next →'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.line-clamp-2 {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	/* Custom scrollbar styling */
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

	.metatron-container {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.metatron-circle {
		position: absolute;
		width: var(--diam);
		height: var(--diam);
		border-radius: 50%;
		background: rgba(198, 198, 197, 0.3);
		transition: all 0.3s ease;
		cursor: pointer;
		transform: translate(-50%, -50%);
		pointer-events: auto;
		z-index: 20;
		border: 2px solid rgba(255, 255, 255, 0.2);
	}

	.metatron-circle:hover {
		background: rgba(198, 198, 197, 0.5);
		border-color: rgba(255, 255, 255, 0.4);
		box-shadow: 0 0 20px rgba(255, 255, 255, 0.3);
	}

	@keyframes pulse {
		0% {
			opacity: 0.8;
		}
		50% {
			opacity: 0.4;
		}
		100% {
			opacity: 0;
		}
	}

	.metatron-circle:hover::before {
		content: '';
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.3);
		animation: pulse 1.5s ease-out infinite;
		pointer-events: none;
	}

	.metatron-circle.editing {
		background: rgba(59, 130, 246, 0.6);
		border-color: rgba(59, 130, 246, 0.8);
		box-shadow: 0 0 15px rgba(59, 130, 246, 0.5);
	}

	.metatron-circle.has-value {
		background: rgba(147, 51, 234, 0.4);
		border-color: rgba(147, 51, 234, 0.6);
		box-shadow: 0 0 10px rgba(147, 51, 234, 0.3);
	}

	.metatron-circle.has-value:hover {
		background: rgba(147, 51, 234, 0.6);
		border-color: rgba(147, 51, 234, 0.8);
		box-shadow: 0 0 15px rgba(147, 51, 234, 0.5);
	}

	/* Toast animation */
	@keyframes slide-in-from-right {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}

	.animate-in {
		animation: slide-in-from-right 0.3s ease-out;
	}



	.label-text {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: #ffffff;
		font-size: clamp(0.5rem, 2vw, 0.75rem);
		text-align: center;
		pointer-events: none;
		white-space: normal;
		word-wrap: break-word;
		max-width: 80%;
		max-height: 80%;
		overflow: hidden;
		line-height: 1.2;
	}
</style>

<!-- Council Chat Modal -->
<AIChatModal 
	bind:isOpen={showCouncilChat}
	title="Council Chat"
	subtitle="Multi-member consultation in progress"
	icon="🎭"
	theme="indigo"
	messages={councilChatMessages}
	onClose={closeCouncilChat}
	onSend={sendCouncilMessage}
	placeholder="Ask the council for guidance..."
	disabled={isCouncilResponding}
	bind:isLoading={isCouncilResponding}
/>

<!-- Individual Advisor Chat Modal -->
<AIChatModal 
	bind:isOpen={showAdvisorChat}
	title={selectedAdvisorForChat ? `${selectedAdvisorForChat.name}${(selectedAdvisorForChat.characterSpec as any).title ? ' — ' + (selectedAdvisorForChat.characterSpec as any).title : ''}` : "Advisor Chat"}
	subtitle="One-on-one consultation"
	icon="🧙‍♀️"
	theme="indigo"
	messages={advisorChatMessages}
	onClose={closeAdvisorChat}
	onSend={sendAdvisorMessage}
	placeholder="Ask your advisor for guidance..."
	disabled={isAdvisorResponding}
	bind:isLoading={isAdvisorResponding}
	onBack={advisorChatSource === 'design-streams' ? handleAdvisorChatBack : undefined}
/>

<!-- Design Streams Page -->
{#if showDesignStreams}
	<DesignStreams 
		advisors={metatronAdvisors as any}
		ritualSession={ritualSession}
		{sessionManager}
		onClose={() => { showDesignStreams = false; }}
		on:openAdvisorChat={handleDesignStreamsAdvisorChat}
		on:updateRitualData={handleRitualDataUpdate}
		on:sessionComplete={handleSessionComplete}
	/>
{/if}

<!-- Speak Your Wish Modal -->
{#if showWishModal}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-gray-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] relative border border-gray-700 flex flex-col overflow-hidden">
			<div class="p-6 border-b border-gray-700 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-xl">
						🗣️
					</div>
					<h3 class="text-white text-xl font-bold">Speak Your Wish</h3>
				</div>
				<button class="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700" on:click={cancelWishModal} aria-label="Close">✕</button>
			</div>
			<div class="flex-1 overflow-y-auto p-8 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
				<div class="text-center mb-8">
					<div class="text-5xl mb-4">🗣️</div>
					<h3 class="text-3xl font-bold text-white mb-4">Speak Your Wish</h3>
					<p class="text-gray-300 text-lg">What do you seek to bring into being?</p>
				</div>
				<textarea
					bind:value={tempWishStatement}
					placeholder="I wish to create..."
					class="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[120px] resize-none"
					use:focusOnMount
				></textarea>
			</div>
			<div class="p-6 border-t border-gray-700 flex justify-between items-center">
				<button
					on:click={cancelWishModal}
					class="px-6 py-3 text-gray-400 hover:text-white transition-colors"
				>
					Cancel
				</button>
				<button
					on:click={saveWishStatement}
					disabled={!tempWishStatement.trim()}
					class="px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-xl transition-colors font-semibold"
				>
					Save Wish
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Value Editing Modal -->
{#if showValueModal}
	<div
		class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
		on:click={() => closeValueModal()}
		on:keydown={(e) => e.key === 'Escape' && closeValueModal()}
		role="button"
		tabindex="0"
	>
		<div
			class="bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative border border-gray-700 max-h-[90vh] overflow-hidden flex flex-col"
			on:click|stopPropagation={() => {}}
			on:keydown|stopPropagation={() => {}}
			role="presentation"
		>
			<div class="p-4 border-b border-gray-700 flex items-center justify-between">
				<h3 class="text-white text-lg font-semibold">Add Value</h3>
				<button class="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700" on:click={closeValueModal} aria-label="Close">✕</button>
			</div>
			<div class="flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
				<div class="text-center mb-4">
					<p class="text-gray-400 text-sm mb-3">Values Set: {ritualSession.declared_values.filter(v => v.trim()).length}/6</p>
				</div>
				<textarea
					bind:value={tempValueText}
					placeholder="Enter a core value..."
					class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent min-h-[60px] resize-none"
					use:focusOnMount
					on:keydown={(e) => {
						if (e.key === 'Enter' && e.ctrlKey) {
							e.preventDefault();
							saveValueText();
						}
					}}
				></textarea>
				<div class="text-center mt-2 mb-4">
					<p class="text-xs text-gray-400">Press Ctrl+Enter to save quickly</p>
				</div>
			</div>
			<div class="p-4 border-t border-gray-700 flex justify-between items-center">
				<button
					on:click={closeValueModal}
					class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
				>
					Cancel
				</button>
				<button
					on:click={saveValueText}
					disabled={!tempValueText.trim() || isSavingValue}
					class="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium flex items-center gap-2"
				>
					{#if isSavingValue}
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
						Saving...
					{:else}
						Save
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- API Key Configuration Modal -->
{#if showApiModal}
	<div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" role="dialog" aria-modal="true" tabindex="-1" on:keydown={(e) => e.key === 'Escape' && closeApiModal()}>
		<button 
			class="absolute inset-0 w-full h-full" 
			on:click={closeApiModal}
			aria-label="Close modal backdrop"
		></button>
		<div class="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4" role="document">
			<div class="flex justify-between items-center mb-4">
				<h2 class="text-xl font-bold text-white">🔐 API Key Configuration</h2>
				<button on:click={closeApiModal} class="text-gray-400 hover:text-white" aria-label="Close modal">
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
					</svg>
				</button>
			</div>
			
			<form on:submit|preventDefault={handleApiSubmit} class="space-y-4">
				<div>
					<label for="openai-key" class="block text-sm font-medium text-gray-300 mb-2">OpenAI API Key</label>
					<input
						type="password"
						id="openai-key"
						bind:value={apiKeys.openai}
						placeholder="sk-..."
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>
				
				<div>
					<label for="anthropic-key" class="block text-sm font-medium text-gray-300 mb-2">Anthropic API Key</label>
					<input
						type="password"
						id="anthropic-key"
						bind:value={apiKeys.anthropic}
						placeholder="sk-ant-..."
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>
				
				<div>
					<label for="groq-key" class="block text-sm font-medium text-gray-300 mb-2">Groq API Key</label>
					<input
						type="password"
						id="groq-key"
						bind:value={apiKeys.groq}
						placeholder="gsk_..."
						class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>
				
				<div class="bg-yellow-900 border border-yellow-600 rounded-md p-3 mb-4">
					<p class="text-sm text-yellow-200">
						⚠️ <strong>Security Notice:</strong> API keys are not saved for security reasons. You'll need to re-enter them each session until secure storage is implemented.
					</p>
				</div>
				
				<div class="flex justify-end space-x-3">
					<button
						type="button"
						on:click={closeApiModal}
						class="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
					>
						Cancel
					</button>
					<button
						type="submit"
						class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
					>
						Apply
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<!-- DEPRECATED 2024-12-19: "Seat Your Council" modal - functionality moved to direct circle interaction on Metatron table -->
<!-- Users can now seat/replace advisors directly by clicking circles on the main Metatron display -->
<!-- This modal was redundant - same SeatCouncilContent component is used inline in ritual workflow -->
<!-- Can be fully removed after confirming no regressions -->
<!-- 
{#if showSeatCouncilModal}
	<div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-gray-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] relative border border-gray-700 flex flex-col">
			<div class="p-6 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
				<h3 class="text-white text-xl font-bold">Seat Your Council</h3>
				<button class="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-700" on:click={() => showSeatCouncilModal = false} aria-label="Close">✕</button>
			</div>
			<div class="p-8 overflow-y-auto flex-1">
				<SeatCouncilContent
					{metatronCircles}
					{circleRadiusPercent}
					{circleInputs}
					{editingCircle}
					{wishTitle}
					onCircleClick={startEditingCircle}
					{holonAdvisors}
					onOpenAdvisorChat={openAdvisorChat}
					onAddAdvisorToRitual={addAdvisorToRitual}
					onDeleteAdvisor={deleteHolonAdvisor}
					onCreateAdvisor={addAdvisor}
					{getAdvisorDisplayName}
					bind:currentAdvisorName
					bind:currentAdvisorLens
					bind:selectedAdvisorType
					bind:isGeneratingAdvisor
					bind:generationProgress
					showHeader={false}
					showTip={false}
				/>
			</div>
		</div>
	</div>
{/if}
-->

<!-- Value Saved Toast Notification -->
{#if showValueSavedToast}
	<div class="fixed top-4 right-4 z-60 bg-green-600 text-white px-6 py-3 rounded-lg shadow-lg border border-green-500 flex items-center gap-3 animate-in slide-in-from-right duration-300">
		<div class="text-xl">✅</div>
		<div>
			<div class="font-semibold">Value Saved!</div>
			<div class="text-sm text-green-100">Your value has been updated successfully.</div>
		</div>
		<button 
			on:click={() => showValueSavedToast = false}
			class="text-green-200 hover:text-white transition-colors ml-4"
		>
			✕
		</button>
	</div>
{/if}

