<script lang="ts">
    import { onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, fly } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { nostrUtils } from "holosphere";
    import { ID, walletAddress } from "../dashboard/store";
    import { nostrPrivateKey, nostrPublicKey } from "../lib/stores/nostr";
    import { fetchHolonName } from "../utils/holonNames";
    import { addVisitedHolon } from "../utils/localStorage";
    import TitleBar from "./shared/TitleBar.svelte";
    import QRScanner from "./QRScanner.svelte";
    import FederatedHolonCard from "./federation/FederatedHolonCard.svelte";
    import {
        type Direction,
        shortenNpub,
    } from "../lib/capabilities/lensCapability";
    import {
        ALL_LENSES,
        COMMON_LENSES,
    } from "../lib/federation/lensUtils";
    import { getFederationService, type FederationService } from "../services/FederationService";
    import type { FederationPartner, FederationLens, LensConfig } from "../types/federation";

    const holosphere = getContext("holosphere") as HoloSphere;

    // User-configurable available lenses
    let availableLenses: string[] = [...ALL_LENSES];
    let customLenses: string[] = [];
    let showAddCustomLens = false;
    let newCustomLens = '';

    // UI State
    let currentHolonId: string = '';
    let holonName: string = 'Federation';
    let loading = true;
    let saving = false;
    let showAddDialog = false;
    let showNetworkView = false;
    let error = '';
    let success = '';

    // Partner input
    let newPartnerNpub = '';
    let newPartnerHexPubKey = '';
    let npubValidationError = '';

    // QR Scanner
    let showQRScanner = false;

    // Lens grant pending state
    let pendingLensGrant: {
        holonId: string;
        pubKey: string;
        lensName: string;
        direction: Direction;
    } | null = null;

    // Send request modal state
    let showSendRequestModal = false;
    let retrievePastData = false;
    let pendingSendPartnerId: string | null = null;

    // Federation Service - handles all business logic (new simplified API)
    let federationService: FederationService | null = null;

    // Reactive state from federation service
    let federatedHolons: FederationPartner[] = [];
    let incomingRequests: any[] = []; // Pending requests (incoming DMs are no longer used)

    // Accept request expansion state (UI only)
    let expandedRequestId: string | null = null;
    let acceptSelectedInbound: Set<string> = new Set();
    let acceptSelectedOutbound: Set<string> = new Set();

    // Store subscriptions
    let idStoreUnsubscribe: (() => void) | undefined;

    // Subscribe to federation state changes
    let stateUnsubscribe: (() => void) | undefined;

    function subscribeToFederationState() {
        if (!federationService) return;

        stateUnsubscribe = federationService.getState().subscribe(state => {
            // Preserve local draft partners when merging with service state
            const draftPartners = federatedHolons.filter(h => h.status === 'draft');
            const servicePartners = state.partners || [];

            // Merge: service partners + draft partners (that aren't already in service)
            const draftIds = new Set(draftPartners.map(p => p.pubKey || p.id));
            const filteredServicePartners = servicePartners.filter(p => !draftIds.has(p.pubKey) && !draftIds.has(p.id));
            federatedHolons = [...filteredServicePartners, ...draftPartners];

            incomingRequests = state.pendingRequests?.filter((r: any) => r.direction === 'incoming') || [];
            loading = state.loading;
            if (state.error) {
                error = state.error;
            }
        });
    }

    async function initializeFederationService(holonId: string) {
        // Get singleton federation service
        federationService = getFederationService();

        if (!federationService || !holosphere || !holonId) {
            loading = false;
            return;
        }

        // Set the current holon context
        federationService.setCurrentHolon(holonId);

        // Subscribe to state
        subscribeToFederationState();

        // Initialize if not already done
        try {
            await federationService.init();
        } catch (err) {
            console.warn('Federation service init error:', err);
        }

        // Load holon name for TitleBar
        const name = await fetchHolonName(holosphere, holonId);
        holonName = name || 'Federation';
        loading = false;
    }

    onMount(() => {
        idStoreUnsubscribe = ID.subscribe(async (newId) => {
            if (newId !== currentHolonId) {
                currentHolonId = newId || '';
                if (currentHolonId) {
                    await initializeFederationService(currentHolonId);
                } else {
                    federatedHolons = [];
                    incomingRequests = [];
                    loading = false;
                }
            }
        });
    });

    onDestroy(() => {
        if (idStoreUnsubscribe) {
            idStoreUnsubscribe();
        }
        if (stateUnsubscribe) {
            stateUnsubscribe();
        }
    });

    // Helper to validate holon ID
    const isValidHolonId = (id: string | undefined | null): id is string =>
        !!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

    // Reactive block: when page ID changes
    $: if ($page.params.id && $page.params.id !== currentHolonId && isValidHolonId($page.params.id) && holosphere) {
        currentHolonId = $page.params.id;
        ID.set(currentHolonId);
        initializeFederationService(currentHolonId);
    }

    // ===========================================================================
    // Event Handlers - Delegate to Federation Service (new simplified API)
    // ===========================================================================

    function validateNpub() {
        if (!newPartnerNpub.trim()) {
            npubValidationError = '';
            newPartnerHexPubKey = '';
            return;
        }

        const result = nostrUtils.parseNpubOrHex(newPartnerNpub);
        if (result.valid && result.hexPubKey) {
            npubValidationError = '';
            newPartnerHexPubKey = result.hexPubKey;
        } else {
            npubValidationError = result.error || 'Invalid public key';
            newPartnerHexPubKey = '';
        }
    }

    async function addFederation() {
        if (!newPartnerHexPubKey || !federationService) return;

        saving = true;
        error = '';

        try {
            // Create draft partner - user will configure lenses on the card before linking
            const draftPartner: FederationPartner = {
                id: newPartnerHexPubKey,
                pubKey: newPartnerHexPubKey,
                status: 'draft',
                lensConfig: {
                    inbound: [],  // Empty - user configures on card
                    outbound: [...COMMON_LENSES]  // Start with common lenses selected
                },
                createdAt: Date.now()
            };

            // Add to local state as draft (not yet linked)
            federatedHolons = [...federatedHolons, draftPartner];

            showSuccess('Draft partner added - configure sharing and click "Establish Link"');
            closeDialog();
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to add partner';
        } finally {
            saving = false;
        }
    }

    async function handleToggleLens(holonId: string, lens: string, direction: Direction, currentlyEnabled: boolean) {
        // Get current partner
        const partnerIndex = federatedHolons.findIndex(h => h.pubKey === holonId || h.id === holonId);
        if (partnerIndex === -1) return;

        const partner = federatedHolons[partnerIndex];

        // For connected partners, inbound is read-only (they control what they share)
        if (partner.status === 'connected' && direction === 'inbound') {
            return;
        }

        // Build updated lens config
        const newLensConfig: LensConfig = {
            inbound: [...partner.lensConfig.inbound],
            outbound: [...partner.lensConfig.outbound]
        };

        const enabled = !currentlyEnabled;
        if (enabled) {
            if (!newLensConfig[direction].includes(lens)) {
                newLensConfig[direction].push(lens);
            }
        } else {
            newLensConfig[direction] = newLensConfig[direction].filter(l => l !== lens);
        }

        // For draft partners, just update local state (both inbound requests and outbound)
        if (partner.status === 'draft') {
            federatedHolons = federatedHolons.map((h, i) =>
                i === partnerIndex ? { ...h, lensConfig: newLensConfig } : h
            );
            return;
        }

        // For connected partners, update outbound via the API
        if (!federationService) return;

        try {
            if (!enabled) {
                // Revoke the outbound lens
                await federationService.unlink(holonId, { lensName: lens });
            } else {
                // Grant new outbound lens
                await federationService.link(holonId, { inbound: [], outbound: [lens] });
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to update sharing';
        }
    }

    function initiateSendFederationRequest(holonId: string) {
        // With new API, federation is immediate - no DM handshake needed
        // This now shows confirmation before federating
        pendingSendPartnerId = holonId;
        retrievePastData = true; // Default to true for propagating existing data
        showSendRequestModal = true;
    }

    async function confirmSendFederationRequest() {
        if (!pendingSendPartnerId || !federationService) {
            showSendRequestModal = false;
            pendingSendPartnerId = null;
            return;
        }

        saving = true;
        error = '';

        try {
            // Find the partner to get their lens config
            const partner = federatedHolons.find(h => h.id === pendingSendPartnerId || h.pubKey === pendingSendPartnerId);
            if (!partner?.lensConfig) {
                throw new Error('Partner configuration not found');
            }

            // V2 API: Use link() for direct capability grant (only outbound - what we share)
            // Inbound is just a request/wish list - partner decides what they share
            await federationService.link(pendingSendPartnerId, {
                inbound: [],  // We don't control inbound
                outbound: partner.lensConfig.outbound
            });

            // Update local state to mark as connected
            federatedHolons = federatedHolons.map(h =>
                (h.id === pendingSendPartnerId || h.pubKey === pendingSendPartnerId)
                    ? { ...h, status: 'connected' as const }
                    : h
            );

            showSuccess('Federation link established');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to establish federation link';
        } finally {
            saving = false;
            showSendRequestModal = false;
            pendingSendPartnerId = null;
        }
    }

    function cancelSendFederationRequest() {
        showSendRequestModal = false;
        pendingSendPartnerId = null;
        retrievePastData = false;
    }

    async function removeFederation(holonId: string) {
        const partner = federatedHolons.find(h => h.id === holonId || h.pubKey === holonId);

        // V2: For draft partners, just remove from local state
        if (partner?.status === 'draft') {
            federatedHolons = federatedHolons.filter(h => h.id !== holonId && h.pubKey !== holonId);
            showSuccess('Draft partner removed');
            return;
        }

        if (!federationService) return;

        saving = true;
        error = '';

        try {
            // V2 API: Use unlink() to revoke all capabilities
            await federationService.unlink(holonId);
            federatedHolons = federatedHolons.filter(h => h.id !== holonId && h.pubKey !== holonId);
            showSuccess('Federation link removed');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to remove federation link';
        } finally {
            saving = false;
        }
    }

    async function acceptFederationRequest(requestId: string) {
        if (!federationService) return;

        const request = incomingRequests.find(r => r.id === requestId);
        if (!request) {
            error = 'Request not found';
            return;
        }

        saving = true;
        error = '';

        try {
            // First, add the partner to our federation registry
            await federationService.addFederatedHolosphere(request.senderPubKey, {
                alias: request.senderHolonName
            });

            // Store inbound capabilities for each lens they're sharing with us
            // Their outbound (what they share) = our inbound (what we receive)
            const lensesToAccept = acceptSelectedInbound.size > 0
                ? Array.from(acceptSelectedInbound)
                : (request.lensConfig?.outbound || []);

            for (const lens of lensesToAccept) {
                await federationService.storeInboundCapability(request.senderPubKey, {
                    token: request.capabilityToken,
                    scope: { holonId: request.senderHolonId, lensName: lens },
                    permissions: ['read']
                });
            }

            // Optionally issue our own capabilities for lenses we want to share back
            if (acceptSelectedOutbound.size > 0) {
                await federationService.link(request.senderPubKey, {
                    inbound: [],
                    outbound: Array.from(acceptSelectedOutbound)
                });
            }

            // Remove from pending requests
            incomingRequests = incomingRequests.filter(r => r.id !== requestId);

            showSuccess('Federation request accepted');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to accept federation request';
        } finally {
            saving = false;
            expandedRequestId = null;
            acceptSelectedInbound = new Set();
            acceptSelectedOutbound = new Set();
        }
    }

    async function rejectFederationRequest(requestId: string) {
        // With new API, rejection just means not federating
        showSuccess('Federation request ignored');
        // Remove from local state
        incomingRequests = incomingRequests.filter(r => r.id !== requestId);
    }

    // V2: Lens grants are automatic - capabilities are permanent, revocation-based
    function clearPendingLensGrant() {
        pendingLensGrant = null;
    }

    // ===========================================================================
    // UI Helpers
    // ===========================================================================

    function showSuccess(message: string) {
        success = message;
        setTimeout(() => { success = ''; }, 3000);
    }

    function closeDialog() {
        showAddDialog = false;
        newPartnerNpub = '';
        newPartnerHexPubKey = '';
        npubValidationError = '';
        error = '';
    }

    function navigateToHolon(holonId: string) {
        ID.set(holonId);
        if ($walletAddress) {
            addVisitedHolonToSeparateList(holonId);
        }
        goto(`/${holonId}/dashboard`);
    }

    async function addVisitedHolonToSeparateList(holonId: string) {
        if (!$walletAddress) return;
        try {
            const name = await fetchHolonName(holosphere, holonId);
            addVisitedHolon($walletAddress, holonId, name, 'federation');
        } catch (err) {
            console.warn('Failed to add visited holon:', err);
        }
    }

    function addCustomLens() {
        const lensName = newCustomLens.trim().toLowerCase();
        if (lensName && !availableLenses.includes(lensName) && !customLenses.includes(lensName)) {
            customLenses = [...customLenses, lensName];
            availableLenses = [...availableLenses, lensName];
            newCustomLens = '';
            showAddCustomLens = false;
        }
    }

    function removeCustomLens(lens: string) {
        customLenses = customLenses.filter(l => l !== lens);
        availableLenses = availableLenses.filter(l => l !== lens);
    }

    function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
        const scannedText = event.detail.decodedText;

        if (scannedText.startsWith('nostr:')) {
            newPartnerNpub = scannedText.replace('nostr:', '');
        } else if (scannedText.startsWith('npub1') || /^[0-9a-fA-F]{64}$/.test(scannedText)) {
            newPartnerNpub = scannedText;
        } else {
            try {
                const parsed = JSON.parse(scannedText);
                if (parsed.npub) newPartnerNpub = parsed.npub;
                if (parsed.pubKey) newPartnerNpub = parsed.pubKey;
            } catch {
                error = 'QR code does not contain a valid Nostr public key';
            }
        }

        validateNpub();
        showQRScanner = false;
    }

    // Computed values
    $: totalFederations = federatedHolons.length;
    $: activeLenses = federatedHolons.reduce((acc, holon) => {
        if (holon?.lensConfig?.inbound) {
            holon.lensConfig.inbound.forEach((lens: string) => acc.add(lens));
        }
        return acc;
    }, new Set<string>()).size;
</script>

<div class="space-y-4">
    <TitleBar {holonName} title="Federation" />

    <!-- Controls Section -->
    <div class="bg-gray-800 rounded-2xl p-4 sm:p-6">
        <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-4">
            <div class="flex flex-wrap items-center gap-2 w-full lg:w-auto">
                <button
                    on:click={() => showNetworkView = !showNetworkView}
                    class="flex-1 lg:flex-none bg-gray-700/50 hover:bg-gray-600/50 border border-gray-600/50 px-3 py-2 rounded-lg transition-all flex items-center justify-center space-x-2 text-sm text-gray-200 font-medium hover:border-gray-500/50"
                    title="Toggle network view"
                >
                    {#if showNetworkView}
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
                        </svg>
                        <span>List</span>
                    {:else}
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"></path>
                        </svg>
                        <span>Network</span>
                    {/if}
                </button>
                <button
                    on:click={() => showAddCustomLens = true}
                    class="flex-1 lg:flex-none bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/50 px-3 py-2 rounded-lg transition-all flex items-center justify-center space-x-2 text-sm text-purple-300 font-medium hover:border-purple-400/50"
                    title="Add custom lens"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Lens</span>
                </button>
                <button
                    on:click={() => showAddDialog = true}
                    class="flex-1 lg:flex-none bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 px-4 py-2 rounded-lg transition-all flex items-center justify-center space-x-2 text-white font-medium shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    disabled={!currentHolonId || saving}
                    title={!currentHolonId ? 'Select a holon first' : 'Add new federation'}
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Partner</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Status Messages -->
    {#if error}
        <div class="fixed top-4 right-4 z-50 max-w-md" transition:fly={{ x: 100, duration: 300 }}>
            <div class="bg-red-900/95 border border-red-500/50 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
                <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
                        <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </div>
                    <div class="flex-1">
                        <p class="text-red-200 font-medium text-sm">Error</p>
                        <p class="text-red-300/80 text-sm mt-0.5">{error}</p>
                    </div>
                    <button on:click={() => error = ''} class="text-red-400 hover:text-red-300" aria-label="Dismiss error">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    {/if}

    {#if success}
        <div class="fixed top-4 right-4 z-50 max-w-md" transition:fly={{ x: 100, duration: 300 }}>
            <div class="bg-green-900/95 border border-green-500/50 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
                <div class="flex items-start gap-3">
                    <div class="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                        <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                    </div>
                    <div class="flex-1">
                        <p class="text-green-200 font-medium text-sm">Success</p>
                        <p class="text-green-300/80 text-sm mt-0.5">{success}</p>
                    </div>
                    <button on:click={() => success = ''} class="text-green-400 hover:text-green-300" aria-label="Dismiss success message">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Stats Bar -->
    {#if !loading && currentHolonId && federatedHolons.length > 0}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3" transition:slide>
            <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    </svg>
                </div>
                <div>
                    <div class="text-xl font-bold text-white">{totalFederations}</div>
                    <div class="text-xs text-gray-400">Partners</div>
                </div>
            </div>
            <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
                    </svg>
                </div>
                <div>
                    <div class="text-xl font-bold text-white">{activeLenses}</div>
                    <div class="text-xs text-gray-400">Active Lenses</div>
                </div>
            </div>
            <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </div>
                <div>
                    <div class="text-xl font-bold text-white">{federatedHolons.filter(h => h.status === 'connected').length}</div>
                    <div class="text-xs text-gray-400">Connected</div>
                </div>
            </div>
            <div class="bg-gray-800/80 rounded-xl p-4 border border-gray-700/50 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                </div>
                <div>
                    <div class="text-xl font-bold text-white">{incomingRequests.length}</div>
                    <div class="text-xs text-gray-400">Pending</div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Main Content Container -->
    <div class="bg-gray-800/50 rounded-2xl border border-gray-700/50 min-h-[500px]">
        <div class="p-6">

            <!-- Incoming Federation Requests -->
            {#if incomingRequests.length > 0}
                <div class="mb-6" transition:slide>
                    <div class="flex items-center gap-2 mb-4">
                        <div class="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                            <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                            </svg>
                        </div>
                        <h3 class="text-base font-semibold text-white">Pending Requests</h3>
                        <span class="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                            {incomingRequests.length}
                        </span>
                    </div>

                    <div class="space-y-3">
                        {#each incomingRequests as request (request.id)}
                            <div class="bg-gradient-to-r from-amber-900/20 to-orange-900/10 rounded-xl p-4 border border-amber-500/30 hover:border-amber-500/50 transition-all" transition:slide>
                                <div class="flex flex-col sm:flex-row sm:items-center gap-4">
                                    <!-- Avatar and Info -->
                                    <div class="flex items-center gap-3 flex-1 min-w-0">
                                        <div class="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-lg">
                                            {request.senderHolonName?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <div class="min-w-0 flex-1">
                                            <p class="text-white font-semibold truncate">{request.senderHolonName}</p>
                                            <p class="text-amber-300/70 text-xs font-mono truncate">{shortenNpub(request.senderNpub)}</p>
                                            {#if request.lensConfig?.outbound?.length > 0}
                                                <div class="flex items-center gap-1 mt-1.5">
                                                    <span class="text-xs text-green-400">Shares:</span>
                                                    <div class="flex flex-wrap gap-1">
                                                        {#each request.lensConfig.outbound.slice(0, 2) as lens}
                                                            <span class="text-xs bg-green-500/20 text-green-300 px-2 py-0.5 rounded-full">{lens}</span>
                                                        {/each}
                                                        {#if request.lensConfig.outbound.length > 2}
                                                            <span class="text-xs text-green-400">+{request.lensConfig.outbound.length - 2}</span>
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/if}
                                        </div>
                                    </div>

                                    <!-- Actions -->
                                    <div class="flex gap-2 flex-shrink-0">
                                        <button
                                            on:click={() => rejectFederationRequest(request.id)}
                                            disabled={saving}
                                            class="px-4 py-2.5 rounded-lg transition-all text-red-400 hover:text-white hover:bg-red-600 border border-red-500/50 hover:border-red-500 text-sm font-medium disabled:opacity-50"
                                        >
                                            Decline
                                        </button>
                                        <button
                                            on:click={() => {
                                                if (expandedRequestId === request.id) {
                                                    expandedRequestId = null;
                                                } else {
                                                    expandedRequestId = request.id;
                                                    acceptSelectedInbound = new Set(request.lensConfig?.outbound || []);
                                                    acceptSelectedOutbound = new Set(request.lensConfig?.inbound || []);
                                                }
                                            }}
                                            class="px-3 py-2.5 rounded-lg transition-all text-gray-400 hover:text-white hover:bg-gray-600 border border-gray-500/50 text-sm"
                                            title="Customize what to accept"
                                        >
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path>
                                            </svg>
                                        </button>
                                        <button
                                            on:click={() => acceptFederationRequest(request.id)}
                                            disabled={saving}
                                            class="px-5 py-2.5 rounded-lg transition-all bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white text-sm font-medium shadow-lg shadow-green-500/25 disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                                        >
                                            {#if saving}
                                                <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                                </svg>
                                            {:else}
                                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
                                                </svg>
                                            {/if}
                                            Accept
                                        </button>
                                    </div>
                                </div>

                                <!-- Expandable customization section -->
                                {#if expandedRequestId === request.id}
                                    <div class="mt-4 pt-4 border-t border-amber-500/30 space-y-4" transition:slide>
                                        <div>
                                            <p class="text-sm font-medium text-green-400 mb-2">Accept data from them:</p>
                                            <div class="flex flex-wrap gap-2">
                                                {#each request.lensConfig?.outbound || [] as lens}
                                                    <button
                                                        type="button"
                                                        on:click={() => {
                                                            if (acceptSelectedInbound.has(lens)) {
                                                                acceptSelectedInbound.delete(lens);
                                                            } else {
                                                                acceptSelectedInbound.add(lens);
                                                            }
                                                            acceptSelectedInbound = acceptSelectedInbound;
                                                        }}
                                                        class="px-3 py-1.5 rounded-full text-sm transition-all {acceptSelectedInbound.has(lens) ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}"
                                                    >
                                                        {lens}
                                                    </button>
                                                {/each}
                                            </div>
                                        </div>
                                        <div>
                                            <p class="text-sm font-medium text-blue-400 mb-2">Share your data with them:</p>
                                            <div class="flex flex-wrap gap-2">
                                                {#each request.lensConfig?.inbound || [] as lens}
                                                    <button
                                                        type="button"
                                                        on:click={() => {
                                                            if (acceptSelectedOutbound.has(lens)) {
                                                                acceptSelectedOutbound.delete(lens);
                                                            } else {
                                                                acceptSelectedOutbound.add(lens);
                                                            }
                                                            acceptSelectedOutbound = acceptSelectedOutbound;
                                                        }}
                                                        class="px-3 py-1.5 rounded-full text-sm transition-all {acceptSelectedOutbound.has(lens) ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}"
                                                    >
                                                        {lens}
                                                    </button>
                                                {/each}
                                            </div>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}

            {#if loading}
                <!-- Skeleton Loading State -->
                <div class="space-y-4 animate-pulse">
                    <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {#each [1, 2, 3] as _}
                            <div class="bg-gray-700/30 rounded-xl p-5 border border-gray-700/50">
                                <div class="flex items-center gap-3 mb-4">
                                    <div class="w-12 h-12 rounded-full bg-gray-600/50"></div>
                                    <div class="flex-1">
                                        <div class="h-4 bg-gray-600/50 rounded w-2/3 mb-2"></div>
                                        <div class="h-3 bg-gray-600/30 rounded w-1/2"></div>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                </div>
            {:else if !currentHolonId}
                <!-- No Holon Selected -->
                <div class="flex flex-col items-center justify-center py-16">
                    <div class="w-20 h-20 rounded-2xl bg-gray-700/50 flex items-center justify-center mb-6">
                        <svg class="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                        </svg>
                    </div>
                    <h3 class="text-xl font-semibold text-gray-300 mb-2">No Holon Selected</h3>
                    <p class="text-gray-500 text-center max-w-sm">Select a holon from the sidebar to configure its federation settings.</p>
                </div>
            {:else if federatedHolons.length === 0}
                <!-- Empty State -->
                <div class="flex flex-col items-center justify-center py-16">
                    <div class="relative mb-8">
                        <div class="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center">
                            <svg class="w-12 h-12 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                            </svg>
                        </div>
                    </div>
                    <h3 class="text-xl font-semibold text-white mb-2">Start Federating</h3>
                    <p class="text-gray-400 text-center max-w-md mb-8">
                        Connect with other holons to share data and collaborate.
                    </p>
                    <button
                        on:click={() => showAddDialog = true}
                        class="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 px-6 py-3 rounded-xl transition-all inline-flex items-center justify-center gap-2 text-white font-medium shadow-lg shadow-indigo-500/25"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                        </svg>
                        Add Federation Partner
                    </button>
                </div>
            {:else}
                {#if !showNetworkView}
                    <!-- Federation List -->
                    <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {#each federatedHolons as holon (holon.id)}
                            <FederatedHolonCard
                                {holon}
                                {availableLenses}
                                {saving}
                                on:navigate={(e) => navigateToHolon(e.detail.holonId)}
                                on:remove={(e) => removeFederation(e.detail.holonId)}
                                on:toggleLens={(e) => handleToggleLens(e.detail.holonId, e.detail.lens, e.detail.direction, e.detail.currentlyEnabled)}
                                on:copyPubKey={(e) => {
                                    navigator.clipboard.writeText(e.detail.pubKey);
                                    showSuccess('Copied public key');
                                }}
                                on:sendRequest={(e) => initiateSendFederationRequest(e.detail.holonId)}
                            />
                        {/each}
                    </div>
                {:else}
                    <!-- Network View (Simplified) -->
                    <div class="bg-gray-800 rounded-xl p-6 border border-gray-700">
                        <div class="text-center mb-6">
                            <h3 class="text-lg font-semibold text-white mb-2">Federation Network</h3>
                            <p class="text-gray-400 text-sm">Interactive visualization of holon connections</p>
                        </div>
                        <div class="flex justify-center">
                            <svg width="600" height="400" class="rounded-lg bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-600">
                                <!-- Current Holon (Center) -->
                                <circle cx="300" cy="200" r="30" fill="#3B82F6" stroke="#60A5FA" stroke-width="2" />
                                <text x="300" y="205" text-anchor="middle" fill="white" font-size="12">Current</text>

                                <!-- Federated Holons -->
                                {#each federatedHolons as holon, index}
                                    {@const angle = (index / federatedHolons.length) * 2 * Math.PI - Math.PI/2}
                                    {@const x = 300 + Math.cos(angle) * 120}
                                    {@const y = 200 + Math.sin(angle) * 120}
                                    <line x1="300" y1="200" x2={x} y2={y} stroke="#6B7280" stroke-width="1" />
                                    <circle cx={x} cy={y} r="20" fill={holon.status === 'connected' ? '#10B981' : '#F59E0B'} stroke="white" stroke-width="2" />
                                    <text x={x} y={y + 4} text-anchor="middle" fill="white" font-size="10">{holon.name?.charAt(0) || '?'}</text>
                                {/each}
                            </svg>
                        </div>
                    </div>
                {/if}
            {/if}
        </div>
    </div>
</div>

<!-- Add Federation Dialog -->
{#if showAddDialog}
    <div
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        on:click={(e) => e.target === e.currentTarget && closeDialog()}
        on:keydown={(e) => e.key === 'Escape' && closeDialog()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div class="bg-gray-800 rounded-xl p-6 w-full max-w-md" transition:fly={{ y: -50, duration: 300 }}>
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Federation</h2>
                <button on:click={closeDialog} class="text-gray-400 hover:text-white transition-colors" aria-label="Close dialog">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addFederation} class="space-y-4">
                <div>
                    <label for="partnerNpub" class="block text-sm font-medium text-gray-300 mb-2">
                        Partner's Nostr Public Key *
                    </label>
                    <div class="flex space-x-2">
                        <input
                            id="partnerNpub"
                            type="text"
                            bind:value={newPartnerNpub}
                            on:input={validateNpub}
                            placeholder="npub1... or hex public key"
                            class="flex-1 bg-gray-700 border rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            class:border-gray-600={!npubValidationError}
                            class:border-red-500={npubValidationError}
                        />
                        <button
                            type="button"
                            on:click={() => showQRScanner = true}
                            class="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg transition-colors"
                            title="Scan QR Code"
                        >
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path>
                            </svg>
                        </button>
                    </div>
                    {#if npubValidationError}
                        <p class="text-red-400 text-sm mt-1">{npubValidationError}</p>
                    {/if}
                    {#if newPartnerHexPubKey && !npubValidationError}
                        <p class="text-green-400 text-sm mt-1 flex items-center">
                            <svg class="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                            </svg>
                            Valid public key detected
                        </p>
                    {/if}
                </div>

                {#if newPartnerHexPubKey && !npubValidationError}
                    <div class="bg-gray-700/50 rounded-lg p-3 border border-gray-600/50">
                        <p class="text-sm text-gray-300">
                            A draft partner card will be created. You can configure which data to share before establishing the link.
                        </p>
                    </div>
                {/if}

                <div class="flex space-x-3 pt-4">
                    <button type="button" on:click={closeDialog} class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors" disabled={saving}>
                        Cancel
                    </button>
                    <button
                        type="submit"
                        class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={saving || !newPartnerHexPubKey}
                    >
                        {saving ? 'Adding...' : 'Add Partner'}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Add Custom Lens Dialog -->
{#if showAddCustomLens}
    <div
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        on:click={(e) => e.target === e.currentTarget && (showAddCustomLens = false)}
        on:keydown={(e) => e.key === 'Escape' && (showAddCustomLens = false)}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div class="bg-gray-800 rounded-xl p-6 w-full max-w-sm" transition:fly={{ y: -50, duration: 300 }}>
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Custom Lens</h2>
                <button on:click={() => showAddCustomLens = false} class="text-gray-400 hover:text-white transition-colors" aria-label="Close dialog">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addCustomLens} class="space-y-4">
                <div>
                    <label for="customLensName" class="block text-sm font-medium text-gray-300 mb-2">Lens Name *</label>
                    <input
                        id="customLensName"
                        type="text"
                        bind:value={newCustomLens}
                        placeholder="Enter lens name..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        required
                    />
                </div>

                <div class="flex space-x-3 pt-4">
                    <button type="button" on:click={() => showAddCustomLens = false} class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button type="submit" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={!newCustomLens.trim()}>
                        Add Lens
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- QR Scanner Modal -->
<QRScanner bind:showScanner={showQRScanner} on:scan={handleQRScan} on:close={() => showQRScanner = false} />

<!-- Send Federation Request Modal (V2: Direct Link) -->
{#if showSendRequestModal}
    <div
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        transition:fade={{ duration: 150 }}
        on:click|self={cancelSendFederationRequest}
        on:keydown={(e) => e.key === 'Escape' && cancelSendFederationRequest()}
        role="dialog"
        aria-modal="true"
    >
        <div class="bg-gray-800 rounded-xl p-6 w-full max-w-md mx-4 shadow-2xl border border-gray-700" transition:fly={{ y: -50, duration: 300 }}>
            <h3 class="text-lg font-semibold text-white mb-4">Send Federation Request</h3>

            <div class="mb-4 p-3 bg-gray-700/50 rounded-lg border border-gray-600">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
                        {holonName ? holonName.charAt(0).toUpperCase() : '?'}
                    </div>
                    <div>
                        <p class="text-xs text-gray-400">Sending from</p>
                        <p class="text-white font-medium">{holonName || 'Unknown Holon'}</p>
                    </div>
                </div>
            </div>

            <div class="mb-6">
                <label class="flex items-start gap-3 cursor-pointer group">
                    <div class="relative flex items-center justify-center mt-0.5">
                        <input type="checkbox" bind:checked={retrievePastData} class="sr-only" />
                        <div class="w-5 h-5 rounded border-2 transition-all {retrievePastData ? 'bg-blue-600 border-blue-600' : 'border-gray-500 group-hover:border-gray-400'}">
                            {#if retrievePastData}
                                <svg class="w-full h-full text-white p-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path>
                                </svg>
                            {/if}
                        </div>
                    </div>
                    <div>
                        <span class="text-white font-medium">Retrieve past data</span>
                        <p class="text-gray-400 text-sm mt-0.5">Request historical data from the partner</p>
                    </div>
                </label>
            </div>

            <div class="flex gap-3">
                <button type="button" on:click={cancelSendFederationRequest} class="flex-1 px-4 py-2.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors" disabled={saving}>
                    Cancel
                </button>
                <button
                    type="button"
                    on:click={confirmSendFederationRequest}
                    disabled={saving}
                    class="flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {#if saving}
                        <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                    {:else}
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                        </svg>
                    {/if}
                    Send Request
                </button>
            </div>
        </div>
    </div>
{/if}
