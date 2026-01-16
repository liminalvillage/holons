<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, fly } from "svelte/transition";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import type { HoloSphere } from "holosphere";
    import { handshake, nostrUtils } from "holosphere";
    import { ID, walletAddress } from "../dashboard/store";
    import { nostrPrivateKey, nostrPublicKey } from "../lib/stores/nostr";
    import { fetchHolonName } from "../utils/holonNames";
    import { addVisitedHolon } from "../utils/localStorage";
    import TitleBar from "./shared/TitleBar.svelte";
    import QRScanner from "./QRScanner.svelte";
    import FederatedHolonCard from "./federation/FederatedHolonCard.svelte";
    import { shortenPubKey } from "../lib/capabilities/lensCapability";
    import {
        pendingFederationRequests,
        incomingRequests,
        outgoingRequests,
        createIncomingRequest,
        createOutgoingRequest,
        pendingUpdates,
        incomingUpdates,
        outgoingUpdates,
        createIncomingUpdate,
        createOutgoingUpdate,
        type PendingRequest,
        type PendingUpdate
    } from "../lib/stores/federationRequests";

    const dispatch = createEventDispatcher();
    const holosphere = getContext("holosphere") as HoloSphere;

    // Available lenses for federation
    const AVAILABLE_LENSES = [
        'quests', 'offers', 'tags', 'expenses',
        'announcements', 'users', 'shopping', 'recurring'
    ];

    interface FederationInfo {
        id: string;
        name: string;
        federated: string[];
        lensConfig?: Record<string, { inbound: string[]; outbound: string[]; timestamp: number }>;
        partnerNames?: Record<string, string>;
        timestamp: number;
    }

    interface FederatedHolon {
        id: string;
        name: string;
        pubKey?: string;
        status: 'connected' | 'pending' | 'rejected' | 'error';
        lensConfig: { inbound: string[]; outbound: string[] };
    }

    // State
    let currentHolonId = '';
    let holonName = 'Federation';
    let federationInfo: FederationInfo | null = null;
    let federatedHolons: FederatedHolon[] = [];
    let loading = true;
    let saving = false;
    let error = '';
    let success = '';

    // Add dialog state
    let showAddDialog = false;
    let newPartnerNpub = '';
    let newPartnerHexPubKey = '';
    let npubError = '';
    let federationMessage = '';
    let selectedInboundLenses: string[] = [];
    let selectedOutboundLenses: string[] = [];

    // QR Scanner
    let showQRScanner = false;

    // Track expanded cards
    let expandedCards: Set<string> = new Set();

    // Subscriptions
    let idUnsubscribe: (() => void) | undefined;
    let federationSubscription: any = null;
    let dmUnsubscribe: (() => void) | undefined;

    onMount(() => {
        // Initialize with user's public key for scoped storage
        pendingFederationRequests.init($nostrPublicKey || undefined);
        pendingUpdates.init($nostrPublicKey || undefined);

        idUnsubscribe = ID.subscribe(async (newId) => {
            if (newId !== currentHolonId) {
                if (federationSubscription) {
                    federationSubscription.unsubscribe();
                    federationSubscription = null;
                }
                currentHolonId = newId || '';
                if (currentHolonId) {
                    await loadFederationData();
                    await subscribeFederationChanges();
                    const name = await fetchHolonName(holosphere, currentHolonId);
                    holonName = name || 'Federation';
                } else {
                    federationInfo = null;
                    federatedHolons = [];
                    loading = false;
                }
            }
        });

        if ($nostrPrivateKey && $nostrPublicKey) {
            subscribeToDMs();
        }
    });

    // Reactively subscribe to DMs when Nostr keys become available
    $: if (holosphere && $nostrPrivateKey && $nostrPublicKey && !dmUnsubscribe) {
        subscribeToDMs();
    }

    // Update request stores when user changes
    $: if ($nostrPublicKey) {
        pendingFederationRequests.setUser($nostrPublicKey);
        pendingUpdates.setUser($nostrPublicKey);
    }

    onDestroy(() => {
        idUnsubscribe?.();
        federationSubscription?.unsubscribe();
        dmUnsubscribe?.();
    });

    const isValidHolonId = (id: string | undefined | null): id is string =>
        !!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

    $: if ($page.params.id && $page.params.id !== currentHolonId && isValidHolonId($page.params.id) && holosphere) {
        if (federationSubscription) {
            federationSubscription.unsubscribe();
            federationSubscription = null;
        }
        currentHolonId = $page.params.id;
        ID.set(currentHolonId);
        loading = true;
        loadFederationData().then(() => subscribeFederationChanges());
    }

    async function subscribeFederationChanges() {
        if (!holosphere || !currentHolonId) return;
        try {
            federationSubscription = await holosphere.subscribeGlobal(
                'federation', currentHolonId,
                async () => { await loadFederationData(); },
                { realtimeOnly: true }
            );
        } catch (err) {
            console.warn('Failed to subscribe to federation changes:', err);
        }
    }

    async function loadFederationData() {
        if (!holosphere || !currentHolonId) return;

        loading = true;
        error = '';

        try {
            federationInfo = await holosphere.getFederation(currentHolonId);

            if (federationInfo) {
                const tempHolons: FederatedHolon[] = [];
                const federatedList = federationInfo.federated || [];

                for (const holonId of federatedList) {
                    const rawConfig = federationInfo.lensConfig?.[holonId];
                    const lensConfig = {
                        inbound: Array.isArray(rawConfig?.inbound) ? rawConfig.inbound : [],
                        outbound: Array.isArray(rawConfig?.outbound) ? rawConfig.outbound : []
                    };

                    // Always resolve holon name
                    const partnerName = federationInfo.partnerNames?.[holonId];
                    const name = partnerName && partnerName !== holonId
                        ? partnerName
                        : await fetchHolonName(holosphere, holonId);

                    let pubKey: string | undefined;

                    if (/^[0-9a-fA-F]{64}$/.test(holonId)) {
                        pubKey = holonId;
                    }

                    tempHolons.push({ id: holonId, name, pubKey, status: 'connected', lensConfig });
                }

                federatedHolons = tempHolons;
            } else {
                federatedHolons = [];
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to load federation data';
        } finally {
            loading = false;
        }
    }

    async function addFederation() {
        if (!newPartnerHexPubKey || !holosphere || !currentHolonId) return;

        saving = true;
        error = '';

        try {
            const ourHolonName = await getHolonName(currentHolonId);

            if ($nostrPrivateKey && $nostrPublicKey) {
                const ourNpub = nostrUtils.hexToNpub($nostrPublicKey);
                const lensConfig = {
                    inbound: selectedInboundLenses,
                    outbound: selectedOutboundLenses
                };

                // Use retry with exponential backoff for DM sends
                const result = await withRetry(async () => {
                    const res = await handshake.initiateFederationHandshake(holosphere, $nostrPrivateKey, {
                        partnerPubKey: newPartnerHexPubKey,
                        holonId: currentHolonId,
                        holonName: ourHolonName,
                        lensConfig,
                        message: federationMessage.trim() || undefined
                    });
                    if (!res.success) {
                        throw new Error(res.error || 'Failed to send request');
                    }
                    return res;
                }, 3, 1000);

                if (result.success && result.requestId) {
                    // Try to resolve recipient holon name
                    const recipientHolonName = await fetchHolonName(holosphere, newPartnerHexPubKey);
                    const outgoing = createOutgoingRequest(
                        result.requestId, $nostrPublicKey, ourNpub,
                        currentHolonId, ourHolonName,
                        newPartnerHexPubKey, newPartnerNpub || nostrUtils.hexToNpub(newPartnerHexPubKey),
                        lensConfig, [],
                        federationMessage.trim() || undefined,
                        recipientHolonName
                    );
                    pendingFederationRequests.add(outgoing);
                    showSuccess('Federation request sent');
                }
            } else {
                const success = await holosphere.federateHolon(currentHolonId, newPartnerHexPubKey, {
                    lensConfig: { inbound: [], outbound: [] }
                });
                if (!success) {
                    error = 'Failed to create federation';
                    return;
                }
                showSuccess('Federation created');
            }

            closeAddDialog();
            await new Promise(r => setTimeout(r, 300));
            await loadFederationData();
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to create federation';
        } finally {
            saving = false;
        }
    }

    async function removeFederation(holonId: string) {
        if (!holosphere || !currentHolonId) return;

        saving = true;
        try {
            const result = await holosphere.unfederateHolon(currentHolonId, holonId);
            if (result) {
                // Optimistic update
                federatedHolons = federatedHolons.filter(h => h.id !== holonId);
                expandedCards.delete(holonId);
                expandedCards = expandedCards;
                showSuccess('Federation removed');
                await new Promise(r => setTimeout(r, 300));
                await loadFederationData();
            } else {
                error = 'Failed to remove federation';
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to remove federation';
        } finally {
            saving = false;
        }
    }

    async function updateLensConfig(holonId: string, inbound: string[], outbound: string[]) {
        if (!holosphere || !currentHolonId || !$nostrPrivateKey) return;

        // Find the current federation
        const holon = federatedHolons.find(h => h.id === holonId);
        if (!holon) return;

        const currentLensConfig = holon.lensConfig;
        const newLensConfig = { inbound, outbound };

        // Check if there's actually a change
        const inboundChanged = JSON.stringify([...currentLensConfig.inbound].sort()) !== JSON.stringify([...newLensConfig.inbound].sort());
        const outboundChanged = JSON.stringify([...currentLensConfig.outbound].sort()) !== JSON.stringify([...newLensConfig.outbound].sort());

        if (!inboundChanged && !outboundChanged) {
            return; // No change
        }

        // Get the partner's public key (holonId should be the pubkey for federated holons)
        const partnerPubKey = holon.pubKey || holonId;

        // Check if we already have a pending update for this partner
        if (pendingUpdates.hasPendingForPartner(partnerPubKey)) {
            error = 'Already have a pending update for this partner';
            return;
        }

        saving = true;
        try {
            const ourName = await getHolonName(currentHolonId);

            // Send update request DM
            const result = await withRetry(async () => {
                const res = await handshake.requestFederationUpdate(holosphere, $nostrPrivateKey, {
                    partnerPubKey,
                    holonId: currentHolonId,
                    holonName: ourName,
                    newLensConfig
                });
                if (!res.success) {
                    throw new Error(res.error || 'Failed to send update request');
                }
                return res;
            }, 3, 1000);

            if (result.success && result.updateId) {
                // Track the pending update
                const pending = createOutgoingUpdate(
                    result.updateId,
                    partnerPubKey,
                    partnerPubKey, // Use pubKey instead of npub
                    holonId,
                    holon.name,
                    currentLensConfig,
                    newLensConfig
                );
                pendingUpdates.add(pending);
                showSuccess('Update request sent - awaiting approval');
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to send update request';
        } finally {
            saving = false;
        }
    }

    function handleToggleLens(event: CustomEvent<{ holonId: string; lens: string; direction: 'inbound' | 'outbound'; currentlyEnabled: boolean }>) {
        const { holonId, lens, direction, currentlyEnabled } = event.detail;
        const holon = federatedHolons.find(h => h.id === holonId);
        if (!holon) return;

        const normalizedLens = lens.toLowerCase();
        let newInbound = [...holon.lensConfig.inbound];
        let newOutbound = [...holon.lensConfig.outbound];

        if (direction === 'inbound') {
            if (currentlyEnabled) {
                newInbound = newInbound.filter(l => l.toLowerCase() !== normalizedLens);
            } else {
                newInbound.push(normalizedLens);
            }
        } else {
            if (currentlyEnabled) {
                newOutbound = newOutbound.filter(l => l.toLowerCase() !== normalizedLens);
            } else {
                newOutbound.push(normalizedLens);
            }
        }

        updateLensConfig(holonId, newInbound, newOutbound);
    }

    async function getHolonName(id: string): Promise<string> {
        if (!id || !holosphere) return 'Unknown';
        try {
            const settings = await holosphere.get(id, 'settings', id);
            return settings?.name || id;
        } catch { return id; }
    }

    function showSuccess(msg: string) {
        success = msg;
        setTimeout(() => success = '', 3000);
    }

    // Retry helper with exponential backoff
    async function withRetry<T>(
        fn: () => Promise<T>,
        maxAttempts = 3,
        baseDelay = 1000
    ): Promise<T> {
        let lastError: Error | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < maxAttempts) {
                    const delay = baseDelay * Math.pow(2, attempt - 1);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastError;
    }

    function closeAddDialog() {
        showAddDialog = false;
        newPartnerNpub = '';
        newPartnerHexPubKey = '';
        npubError = '';
        federationMessage = '';
        selectedInboundLenses = [];
        selectedOutboundLenses = [];
    }

    function validateNpub() {
        if (!newPartnerNpub.trim()) {
            npubError = '';
            newPartnerHexPubKey = '';
            return;
        }
        const result = nostrUtils.parseNpubOrHex(newPartnerNpub);
        if (result.valid && result.hexPubKey) {
            npubError = '';
            newPartnerHexPubKey = result.hexPubKey;
        } else {
            npubError = result.error || 'Invalid public key';
            newPartnerHexPubKey = '';
        }
    }

    function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
        const text = event.detail.decodedText;
        if (text.startsWith('nostr:')) {
            newPartnerNpub = text.replace('nostr:', '');
        } else if (text.startsWith('npub1') || /^[0-9a-fA-F]{64}$/.test(text)) {
            newPartnerNpub = text;
        }
        validateNpub();
        showQRScanner = false;
    }

    function navigateToHolon(holonId: string) {
        ID.set(holonId);
        if ($walletAddress) {
            fetchHolonName(holosphere, holonId).then(name => {
                addVisitedHolon($walletAddress, holonId, name || holonId, 'federation');
            });
        }
        goto(`/${holonId}/dashboard`);
    }

    function toggleCardExpanded(holonId: string) {
        if (expandedCards.has(holonId)) {
            expandedCards.delete(holonId);
        } else {
            expandedCards.add(holonId);
        }
        expandedCards = expandedCards;
    }

    // DM subscription for federation requests
    function subscribeToDMs() {
        if (!holosphere || !$nostrPrivateKey || !$nostrPublicKey) return;
        // Clean up existing subscription first
        if (dmUnsubscribe) {
            dmUnsubscribe();
            dmUnsubscribe = undefined;
        }
        console.log('Setting up federation DM subscription for pubkey:', $nostrPublicKey);
        try {
            // Get appname from holosphere config for persistent DM tracking
            const appname = holosphere.config?.appName || 'Holons';

            dmUnsubscribe = handshake.subscribeToFederationDMs(
                holosphere,
                $nostrPrivateKey,
                $nostrPublicKey,
                {
                    onRequest: (request: any, senderPubKey: string) => {
                        console.log('DM onRequest callback triggered:', request?.type, 'from:', senderPubKey?.slice(0, 8));
                        handleIncomingRequest(request, senderPubKey);
                    },
                    onResponse: (response: any, senderPubKey: string) => {
                        console.log('DM onResponse callback triggered:', response?.status, 'from:', senderPubKey?.slice(0, 8));
                        handleFederationResponse(response, senderPubKey);
                    },
                    onUpdate: (update: any, senderPubKey: string) => {
                        console.log('DM onUpdate callback triggered:', update?.updateId, 'from:', senderPubKey?.slice(0, 8));
                        handleIncomingUpdate(update, senderPubKey);
                    },
                    onUpdateResponse: (response: any, senderPubKey: string) => {
                        console.log('DM onUpdateResponse callback triggered:', response?.status, 'from:', senderPubKey?.slice(0, 8));
                        handleUpdateResponse(response, senderPubKey);
                    }
                },
                { appname } // Pass appname for persistent DM tracking
            );
            console.log('Federation DM subscription established with appname:', appname);
        } catch (err) {
            console.error('DM subscription error:', err);
        }
    }

    async function handleIncomingRequest(request: any, senderPubKey: string) {
        console.log('handleIncomingRequest called:', { requestId: request?.requestId, senderPubKey: senderPubKey?.slice(0, 8), myPubKey: $nostrPublicKey?.slice(0, 8) });

        // Ignore our own requests (echoed back from Nostr)
        if (senderPubKey === $nostrPublicKey) {
            console.log('Ignoring own request echo');
            return;
        }
        // Ignore if we already have a pending request from this pubkey
        if (pendingFederationRequests.hasPendingForPubKey(senderPubKey)) {
            console.log('Already have pending request from this pubkey');
            return;
        }

        console.log('Creating incoming request from:', request.senderHolonName);
        const pending = createIncomingRequest(
            request.requestId, senderPubKey, request.senderNpub,
            request.senderHolonId, request.senderHolonName,
            request.lensConfig, request.capabilities, request.message
        );
        pendingFederationRequests.add(pending);
        showSuccess(`Request from ${request.senderHolonName}`);
    }

    async function handleFederationResponse(response: any, senderPubKey: string) {
        console.log('Federation response received:', response, 'from:', senderPubKey);

        // Ignore our own responses (echoed back from Nostr)
        if (senderPubKey === $nostrPublicKey) {
            console.log('Ignoring own response echo');
            return;
        }

        const request = pendingFederationRequests.getById(response.requestId);
        if (!request) {
            console.log('No matching request found for response ID:', response.requestId);
            return;
        }

        console.log('Found matching request:', request);

        if (response.status === 'accepted') {
            // Process the response - this stores capabilities, registers holon, and receives holograms
            if (holosphere && currentHolonId && $nostrPrivateKey) {
                console.log('Processing federation response - storing capabilities and registering holon');

                // Get our inbound lenses to receive data from the responder
                const ourInboundLenses = request.lensConfig?.inbound || [];

                const result = await handshake.processFederationResponse(
                    holosphere,
                    response,
                    senderPubKey,
                    {
                        holonId: currentHolonId,
                        inboundLenses: ourInboundLenses
                    }
                );

                console.log('processFederationResponse result:', result);

                // Also store the federation relationship in holosphere (for UI display)
                // IMPORTANT: If using response.lensConfig, swap from responder's perspective to initiator's
                // Responder's outbound (what they share) = Initiator's inbound (what I receive)
                // Responder's inbound (what they receive) = Initiator's outbound (what I share)
                // If no response.lensConfig, use original request.lensConfig which is already initiator's perspective
                if (response.responderHolonId) {
                    const initiatorLensConfig = response.lensConfig
                        ? {
                            inbound: response.lensConfig.outbound || [],
                            outbound: response.lensConfig.inbound || []
                        }
                        : request.lensConfig;
                    console.log('Storing federation with holon:', response.responderHolonId, 'lensConfig:', initiatorLensConfig);
                    await holosphere.federateHolon(currentHolonId, response.responderHolonId, {
                        lensConfig: initiatorLensConfig,
                        partnerName: response.responderHolonName
                    });
                }
            }
            pendingFederationRequests.updateStatus(response.requestId, 'accepted');
            showSuccess('Federation accepted!');
            await loadFederationData();
        } else {
            pendingFederationRequests.updateStatus(response.requestId, 'rejected');
            showSuccess('Federation declined');
        }
    }

    async function acceptRequest(requestId: string) {
        const request = pendingFederationRequests.getById(requestId);
        // Only accept incoming requests (not our own outgoing requests)
        if (!request || request.type !== 'incoming' || !holosphere || !$nostrPrivateKey || !currentHolonId) return;

        saving = true;
        try {
            const ourName = await getHolonName(currentHolonId);
            // Use retry with exponential backoff for DM sends
            await withRetry(async () => {
                // Map PendingRequest to the format expected by handshake function
                const requestPayload = {
                    requestId: request.id,  // PendingRequest uses 'id', handshake expects 'requestId'
                    senderHolonId: request.senderHolonId,
                    senderHolonName: request.senderHolonName,
                    capabilities: request.capabilities || []
                };
                await handshake.acceptFederationRequest(holosphere, $nostrPrivateKey, {
                    request: requestPayload,
                    senderPubKey: request.senderPubKey,
                    holonId: currentHolonId,
                    holonName: ourName,
                    lensConfig: request.lensConfig
                });
            }, 3, 1000);

            // Actually store the federation relationship in holosphere
            await holosphere.federateHolon(currentHolonId, request.senderHolonId, {
                lensConfig: request.lensConfig
            });

            pendingFederationRequests.updateStatus(requestId, 'accepted');
            showSuccess('Federation accepted');
            await loadFederationData();
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to accept';
        } finally {
            saving = false;
        }
    }

    async function rejectRequest(requestId: string) {
        const request = pendingFederationRequests.getById(requestId);
        if (!request || !holosphere || !$nostrPrivateKey) return;

        saving = true;
        try {
            // Use retry with exponential backoff for DM sends
            await withRetry(async () => {
                await handshake.rejectFederationRequest(holosphere, $nostrPrivateKey, {
                    requestId,
                    senderPubKey: request.senderPubKey,
                    message: 'Declined'
                });
            }, 3, 1000);
            pendingFederationRequests.updateStatus(requestId, 'rejected');
            showSuccess('Request declined');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to decline';
        } finally {
            saving = false;
        }
    }

    // Handle incoming federation update (lens config change request)
    async function handleIncomingUpdate(update: any, senderPubKey: string) {
        console.log('handleIncomingUpdate called:', { updateId: update?.updateId, senderPubKey: senderPubKey?.slice(0, 8) });

        // Ignore our own updates
        if (senderPubKey === $nostrPublicKey) {
            console.log('Ignoring own update echo');
            return;
        }

        // Ignore if we already have a pending update from this pubkey
        if (pendingUpdates.hasPendingForPartner(senderPubKey)) {
            console.log('Already have pending update from this partner');
            return;
        }

        // Find the current federation to get current lens config
        const existingFederation = federatedHolons.find(h => h.pubKey === senderPubKey || h.id === senderPubKey);
        const currentLensConfig = existingFederation?.lensConfig || { inbound: [], outbound: [] };

        console.log('Creating incoming update from:', update.senderHolonName);
        const pending = createIncomingUpdate(
            update.updateId,
            senderPubKey,
            update.senderNpub,
            update.senderHolonId,
            update.senderHolonName,
            currentLensConfig,
            update.newLensConfig,
            update.message
        );
        pendingUpdates.add(pending);
        showSuccess(`Update request from ${update.senderHolonName}`);
    }

    // Handle federation update response
    async function handleUpdateResponse(response: any, senderPubKey: string) {
        console.log('Update response received:', response, 'from:', senderPubKey);

        // Ignore our own responses
        if (senderPubKey === $nostrPublicKey) {
            console.log('Ignoring own update response echo');
            return;
        }

        const update = pendingUpdates.getById(response.updateId);
        if (!update) {
            console.log('No matching update found for response ID:', response.updateId);
            return;
        }

        if (response.status === 'accepted') {
            // Apply the lens config change locally
            if (holosphere && currentHolonId) {
                await holosphere.federateHolon(currentHolonId, update.partnerPubKey, {
                    lensConfig: update.newLensConfig
                });
            }
            pendingUpdates.updateStatus(response.updateId, 'accepted');
            showSuccess('Update accepted!');
            await loadFederationData();
        } else {
            pendingUpdates.updateStatus(response.updateId, 'rejected');
            showSuccess('Update declined');
        }
    }

    // Accept a lens config update
    async function acceptUpdate(updateId: string) {
        const update = pendingUpdates.getById(updateId);
        if (!update || update.type !== 'incoming_update' || !holosphere || !$nostrPrivateKey || !currentHolonId) return;

        saving = true;
        try {
            await withRetry(async () => {
                await handshake.acceptFederationUpdate(holosphere, $nostrPrivateKey, {
                    updateId,
                    senderPubKey: update.partnerPubKey,
                    holonId: currentHolonId,
                    newLensConfig: update.newLensConfig
                });
            }, 3, 1000);

            pendingUpdates.updateStatus(updateId, 'accepted');
            showSuccess('Update accepted');
            await loadFederationData();
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to accept update';
        } finally {
            saving = false;
        }
    }

    // Reject a lens config update
    async function rejectUpdate(updateId: string) {
        const update = pendingUpdates.getById(updateId);
        if (!update || !holosphere || !$nostrPrivateKey) return;

        saving = true;
        try {
            await withRetry(async () => {
                await handshake.rejectFederationUpdate(holosphere, $nostrPrivateKey, {
                    updateId,
                    senderPubKey: update.partnerPubKey,
                    message: 'Declined'
                });
            }, 3, 1000);
            pendingUpdates.updateStatus(updateId, 'rejected');
            showSuccess('Update declined');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to decline update';
        } finally {
            saving = false;
        }
    }

    // Cancel an outgoing update request
    function cancelOutgoingUpdate(updateId: string) {
        pendingUpdates.remove(updateId);
        showSuccess('Update request cancelled');
    }

    // Stats
    $: totalPartners = federatedHolons.length;
    $: connectedCount = federatedHolons.filter(h => h.status === 'connected').length;
    $: pendingCount = $incomingRequests.length;
    $: outgoingCount = $outgoingRequests.length;
    $: incomingUpdateCount = $incomingUpdates.length;
    $: outgoingUpdateCount = $outgoingUpdates.length;

    // Cancel an outgoing request
    function cancelOutgoingRequest(requestId: string) {
        pendingFederationRequests.remove(requestId);
        showSuccess('Request cancelled');
    }
</script>

<div class="federation">
    <TitleBar {holonName} title="Federation" />

    <!-- Header with Add button -->
    <div class="federation__header">
        <div class="federation__stats">
            <span class="federation__stat">
                <strong>{totalPartners}</strong> partners
            </span>
            {#if pendingCount > 0}
                <span class="federation__stat federation__stat--pending">
                    <strong>{pendingCount}</strong> incoming
                </span>
            {/if}
            {#if outgoingCount > 0}
                <span class="federation__stat federation__stat--outgoing">
                    <strong>{outgoingCount}</strong> sent
                </span>
            {/if}
        </div>
        <button
            class="federation__add-btn"
            on:click={() => showAddDialog = true}
            disabled={!currentHolonId || saving}
        >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
            </svg>
            Add Partner
        </button>
    </div>

    <!-- Status messages -->
    {#if error}
        <div class="federation__toast federation__toast--error" transition:fly={{ y: -10 }}>
            <span>{error}</span>
            <button on:click={() => error = ''}>×</button>
        </div>
    {/if}

    {#if success}
        <div class="federation__toast federation__toast--success" transition:fly={{ y: -10 }}>
            <span>{success}</span>
        </div>
    {/if}

    <!-- Incoming Pending requests -->
    {#if $incomingRequests.length > 0}
        <div class="federation__section" transition:slide>
            <h3 class="federation__section-title">
                Incoming Requests
                <span class="federation__badge">{$incomingRequests.length}</span>
            </h3>
            <div class="federation__requests">
                {#each $incomingRequests as request (request.id)}
                    <div class="federation__request federation__request--incoming" transition:slide>
                        <div class="federation__request-info">
                            <div class="federation__request-avatar">
                                {request.senderHolonName?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div class="federation__request-details">
                                <span class="federation__request-name">{request.senderHolonName}</span>
                                <span class="federation__request-npub">{shortenPubKey(request.senderPubKey)}</span>
                                {#if request.lensConfig && (request.lensConfig.inbound?.length > 0 || request.lensConfig.outbound?.length > 0)}
                                    <span class="federation__request-lenses">
                                        {#if request.lensConfig.inbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--inbound" title="They want to receive">↓ {request.lensConfig.inbound.join(', ')}</span>
                                        {/if}
                                        {#if request.lensConfig.outbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--outbound" title="They want to share">↑ {request.lensConfig.outbound.join(', ')}</span>
                                        {/if}
                                    </span>
                                {/if}
                                {#if request.message}
                                    <span class="federation__request-message">"{request.message}"</span>
                                {/if}
                            </div>
                        </div>
                        <div class="federation__request-actions">
                            <button class="federation__request-btn federation__request-btn--reject" on:click={() => rejectRequest(request.id)} disabled={saving}>
                                Decline
                            </button>
                            <button class="federation__request-btn federation__request-btn--accept" on:click={() => acceptRequest(request.id)} disabled={saving}>
                                Accept
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Outgoing Pending requests -->
    {#if $outgoingRequests.length > 0}
        <div class="federation__section federation__section--outgoing" transition:slide>
            <h3 class="federation__section-title">
                Sent Requests
                <span class="federation__badge federation__badge--outgoing">{$outgoingRequests.length}</span>
            </h3>
            <div class="federation__requests">
                {#each $outgoingRequests as request (request.id)}
                    <div class="federation__request federation__request--outgoing" transition:slide>
                        <div class="federation__request-info">
                            <div class="federation__request-avatar federation__request-avatar--outgoing">
                                {(request.recipientHolonName || request.recipientPubKey || '?').charAt(0).toUpperCase()}
                            </div>
                            <div class="federation__request-details">
                                <span class="federation__request-name">{request.recipientHolonName || 'Unknown'}</span>
                                <span class="federation__request-npub">{shortenPubKey(request.recipientPubKey)}</span>
                                <span class="federation__request-status">Awaiting response...</span>
                                {#if request.message}
                                    <span class="federation__request-message">"{request.message}"</span>
                                {/if}
                            </div>
                        </div>
                        <div class="federation__request-actions">
                            <button class="federation__request-btn federation__request-btn--cancel" on:click={() => cancelOutgoingRequest(request.id)} disabled={saving}>
                                Cancel
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Incoming Update Requests (lens config changes) -->
    {#if $incomingUpdates.length > 0}
        <div class="federation__section federation__section--update" transition:slide>
            <h3 class="federation__section-title">
                Incoming Updates
                <span class="federation__badge federation__badge--update">{$incomingUpdates.length}</span>
            </h3>
            <div class="federation__requests">
                {#each $incomingUpdates as update (update.id)}
                    <div class="federation__request federation__request--update" transition:slide>
                        <div class="federation__request-info">
                            <div class="federation__request-avatar federation__request-avatar--update">
                                {update.partnerHolonName?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div class="federation__request-details">
                                <span class="federation__request-name">{update.partnerHolonName}</span>
                                <span class="federation__request-npub">{shortenPubKey(update.partnerPubKey)}</span>
                                <span class="federation__request-subtitle">Wants to change lens config:</span>
                                <div class="federation__update-diff">
                                    <div class="federation__update-from">
                                        <span class="federation__update-label">Current:</span>
                                        {#if update.currentLensConfig.inbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--inbound">↓ {update.currentLensConfig.inbound.join(', ')}</span>
                                        {/if}
                                        {#if update.currentLensConfig.outbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--outbound">↑ {update.currentLensConfig.outbound.join(', ')}</span>
                                        {/if}
                                        {#if !update.currentLensConfig.inbound?.length && !update.currentLensConfig.outbound?.length}
                                            <span class="federation__lens-tag">None</span>
                                        {/if}
                                    </div>
                                    <div class="federation__update-to">
                                        <span class="federation__update-label">New:</span>
                                        {#if update.newLensConfig.inbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--inbound">↓ {update.newLensConfig.inbound.join(', ')}</span>
                                        {/if}
                                        {#if update.newLensConfig.outbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--outbound">↑ {update.newLensConfig.outbound.join(', ')}</span>
                                        {/if}
                                        {#if !update.newLensConfig.inbound?.length && !update.newLensConfig.outbound?.length}
                                            <span class="federation__lens-tag">None</span>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="federation__request-actions">
                            <button class="federation__request-btn federation__request-btn--reject" on:click={() => rejectUpdate(update.id)} disabled={saving}>
                                Decline
                            </button>
                            <button class="federation__request-btn federation__request-btn--accept" on:click={() => acceptUpdate(update.id)} disabled={saving}>
                                Accept
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Outgoing Update Requests -->
    {#if $outgoingUpdates.length > 0}
        <div class="federation__section federation__section--outgoing-update" transition:slide>
            <h3 class="federation__section-title">
                Sent Updates
                <span class="federation__badge federation__badge--outgoing">{$outgoingUpdates.length}</span>
            </h3>
            <div class="federation__requests">
                {#each $outgoingUpdates as update (update.id)}
                    <div class="federation__request federation__request--outgoing" transition:slide>
                        <div class="federation__request-info">
                            <div class="federation__request-avatar federation__request-avatar--outgoing">
                                {update.partnerHolonName?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div class="federation__request-details">
                                <span class="federation__request-name">{update.partnerHolonName}</span>
                                <span class="federation__request-status">Awaiting approval for lens change...</span>
                                <div class="federation__update-diff">
                                    <div class="federation__update-from">
                                        <span class="federation__update-label">Current:</span>
                                        {#if update.currentLensConfig.inbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--inbound">↓ {update.currentLensConfig.inbound.join(', ')}</span>
                                        {/if}
                                        {#if update.currentLensConfig.outbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--outbound">↑ {update.currentLensConfig.outbound.join(', ')}</span>
                                        {/if}
                                    </div>
                                    <div class="federation__update-to">
                                        <span class="federation__update-label">Requested:</span>
                                        {#if update.newLensConfig.inbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--inbound">↓ {update.newLensConfig.inbound.join(', ')}</span>
                                        {/if}
                                        {#if update.newLensConfig.outbound?.length > 0}
                                            <span class="federation__lens-tag federation__lens-tag--outbound">↑ {update.newLensConfig.outbound.join(', ')}</span>
                                        {/if}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="federation__request-actions">
                            <button class="federation__request-btn federation__request-btn--cancel" on:click={() => cancelOutgoingUpdate(update.id)} disabled={saving}>
                                Cancel
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Main content -->
    <div class="federation__content">
        {#if loading}
            <div class="federation__loading">
                <div class="federation__spinner"></div>
                <span>Loading...</span>
            </div>
        {:else if !currentHolonId}
            <div class="federation__empty">
                <p>Select a holon to configure federation</p>
            </div>
        {:else if federatedHolons.length === 0}
            <div class="federation__empty">
                <div class="federation__empty-icon">🔗</div>
                <h3>No Partners Yet</h3>
                <p>Add a partner to start sharing data</p>
                <button class="federation__empty-btn" on:click={() => showAddDialog = true}>
                    Add Partner
                </button>
            </div>
        {:else}
            <div class="federation__grid">
                {#each federatedHolons as holon (holon.id)}
                    <FederatedHolonCard
                        {holon}
                        availableLenses={AVAILABLE_LENSES}
                        {saving}
                        expanded={expandedCards.has(holon.id)}
                        on:remove={(e) => removeFederation(e.detail.holonId)}
                        on:navigate={(e) => navigateToHolon(e.detail.holonId)}
                        on:toggleLens={handleToggleLens}
                    />
                {/each}
            </div>
        {/if}
    </div>
</div>

<!-- Add Partner Dialog -->
{#if showAddDialog}
    <div class="federation__dialog-backdrop" on:click={closeAddDialog} transition:fade={{ duration: 150 }}>
        <div class="federation__dialog" on:click|stopPropagation transition:fly={{ y: 20, duration: 200 }}>
            <div class="federation__dialog-header">
                <h3>Add Partner</h3>
                <button class="federation__dialog-close" on:click={closeAddDialog}>×</button>
            </div>

            <div class="federation__dialog-content">
                <div class="federation__field">
                    <label>Partner's Nostr Public Key</label>
                    <div class="federation__input-row">
                        <input
                            type="text"
                            placeholder="npub1... or hex key"
                            bind:value={newPartnerNpub}
                            on:input={validateNpub}
                        />
                        <button class="federation__qr-btn" on:click={() => showQRScanner = true} title="Scan QR">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"></path>
                            </svg>
                        </button>
                    </div>
                    {#if npubError}
                        <span class="federation__field-error">{npubError}</span>
                    {/if}
                    {#if newPartnerHexPubKey}
                        <span class="federation__field-success">Valid key</span>
                    {/if}
                </div>

                <div class="federation__field" style="margin-top: 1rem;">
                    <label>Message (optional)</label>
                    <textarea
                        class="federation__textarea"
                        placeholder="Add a note for the partner..."
                        bind:value={federationMessage}
                        rows="2"
                    ></textarea>
                </div>

                <!-- Lens Selection -->
                <div class="federation__lens-selection">
                    <div class="federation__lens-group">
                        <label class="federation__lens-group-label">
                            <span class="federation__lens-direction federation__lens-direction--receive">↓</span>
                            Receive (what you want from them)
                        </label>
                        <div class="federation__lens-chips">
                            {#each AVAILABLE_LENSES as lens}
                                <button
                                    type="button"
                                    class="federation__lens-chip"
                                    class:federation__lens-chip--selected={selectedInboundLenses.includes(lens)}
                                    on:click={() => {
                                        if (selectedInboundLenses.includes(lens)) {
                                            selectedInboundLenses = selectedInboundLenses.filter(l => l !== lens);
                                        } else {
                                            selectedInboundLenses = [...selectedInboundLenses, lens];
                                        }
                                    }}
                                >
                                    {lens}
                                </button>
                            {/each}
                        </div>
                    </div>

                    <div class="federation__lens-group">
                        <label class="federation__lens-group-label">
                            <span class="federation__lens-direction federation__lens-direction--share">↑</span>
                            Share (what you'll give them)
                        </label>
                        <div class="federation__lens-chips">
                            {#each AVAILABLE_LENSES as lens}
                                <button
                                    type="button"
                                    class="federation__lens-chip"
                                    class:federation__lens-chip--selected={selectedOutboundLenses.includes(lens)}
                                    on:click={() => {
                                        if (selectedOutboundLenses.includes(lens)) {
                                            selectedOutboundLenses = selectedOutboundLenses.filter(l => l !== lens);
                                        } else {
                                            selectedOutboundLenses = [...selectedOutboundLenses, lens];
                                        }
                                    }}
                                >
                                    {lens}
                                </button>
                            {/each}
                        </div>
                    </div>
                </div>
            </div>

            <div class="federation__dialog-actions">
                <button class="federation__btn federation__btn--secondary" on:click={closeAddDialog}>
                    Cancel
                </button>
                <button
                    class="federation__btn federation__btn--primary"
                    on:click={addFederation}
                    disabled={!newPartnerHexPubKey || saving}
                >
                    {saving ? 'Sending...' : 'Send Request'}
                </button>
            </div>
        </div>
    </div>
{/if}

<!-- QR Scanner -->
<QRScanner
    bind:showScanner={showQRScanner}
    on:scan={handleQRScan}
    on:close={() => showQRScanner = false}
/>

<style>
    .federation {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-4, 1rem);
    }

    .federation__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        background: var(--color-bg-secondary, #1f2937);
        border-radius: var(--radius-lg, 0.5rem);
        border: 1px solid var(--color-border, #374151);
    }

    .federation__stats {
        display: flex;
        gap: var(--spacing-4, 1rem);
    }

    .federation__stat {
        font-size: var(--font-size-sm, 0.875rem);
        color: var(--color-text-secondary, #d1d5db);
    }

    .federation__stat strong {
        color: var(--color-text-primary, #ffffff);
    }

    .federation__stat--pending {
        color: #f59e0b;
    }

    .federation__stat--outgoing {
        color: #60a5fa;
    }

    .federation__add-btn {
        display: flex;
        align-items: center;
        gap: var(--spacing-2, 0.5rem);
        padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
        background: var(--color-accent, #4f46e5);
        border: none;
        border-radius: var(--radius-md, 0.375rem);
        color: white;
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        cursor: pointer;
        transition: background-color 150ms ease;
    }

    .federation__add-btn:hover:not(:disabled) {
        background: var(--color-accent-dark, #4338ca);
    }

    .federation__add-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Toast messages */
    .federation__toast {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
        border-radius: var(--radius-md, 0.375rem);
        font-size: var(--font-size-sm, 0.875rem);
    }

    .federation__toast--error {
        background: rgba(239, 68, 68, 0.15);
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #fca5a5;
    }

    .federation__toast--success {
        background: rgba(34, 197, 94, 0.15);
        border: 1px solid rgba(34, 197, 94, 0.3);
        color: #86efac;
    }

    .federation__toast button {
        background: none;
        border: none;
        color: inherit;
        font-size: 1.25rem;
        cursor: pointer;
        opacity: 0.7;
    }

    /* Section */
    .federation__section {
        background: var(--color-bg-secondary, #1f2937);
        border-radius: var(--radius-lg, 0.5rem);
        border: 1px solid var(--color-border, #374151);
        padding: var(--spacing-4, 1rem);
    }

    .federation__section-title {
        display: flex;
        align-items: center;
        gap: var(--spacing-2, 0.5rem);
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-text-primary, #ffffff);
        margin-bottom: var(--spacing-3, 0.75rem);
    }

    .federation__badge {
        background: #f59e0b;
        color: white;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 9999px;
    }

    .federation__badge--outgoing {
        background: #3b82f6;
    }

    .federation__section--outgoing {
        border-color: rgba(59, 130, 246, 0.3);
    }

    /* Requests */
    .federation__requests {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__request {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--spacing-3, 0.75rem);
        padding: var(--spacing-3, 0.75rem);
        background: var(--color-bg-primary, #111827);
        border-radius: var(--radius-md, 0.375rem);
        border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .federation__request--outgoing {
        border-color: rgba(59, 130, 246, 0.2);
    }

    .federation__request-info {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-3, 0.75rem);
        flex: 1;
        min-width: 0;
    }

    .federation__request-avatar {
        width: 36px;
        height: 36px;
        min-width: 36px;
        border-radius: var(--radius-md, 0.375rem);
        background: linear-gradient(135deg, #f59e0b, #d97706);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
    }

    .federation__request-avatar--outgoing {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
    }

    .federation__request-details {
        display: flex;
        flex-direction: column;
    }

    .federation__request-name {
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        color: var(--color-text-primary, #ffffff);
    }

    .federation__request-npub {
        font-size: 10px;
        font-family: monospace;
        color: var(--color-text-muted, #6b7280);
    }

    .federation__request-status {
        font-size: 11px;
        color: #60a5fa;
        font-style: italic;
    }

    .federation__request-message {
        font-size: 11px;
        color: var(--color-text-muted, #6b7280);
        font-style: italic;
        margin-top: 2px;
    }

    .federation__request-lenses {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 4px;
    }

    .federation__lens-tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 4px;
        font-family: monospace;
    }

    .federation__lens-tag--inbound {
        background: rgba(34, 197, 94, 0.2);
        color: #86efac;
    }

    .federation__lens-tag--outbound {
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
    }

    .federation__request-actions {
        display: flex;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__request-btn {
        padding: var(--spacing-1, 0.25rem) var(--spacing-3, 0.75rem);
        border-radius: var(--radius-md, 0.375rem);
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        cursor: pointer;
        transition: all 150ms ease;
    }

    .federation__request-btn--reject {
        background: transparent;
        border: 1px solid rgba(239, 68, 68, 0.3);
        color: #f87171;
    }

    .federation__request-btn--reject:hover {
        background: rgba(239, 68, 68, 0.1);
    }

    .federation__request-btn--accept {
        background: #22c55e;
        border: none;
        color: white;
    }

    .federation__request-btn--accept:hover {
        background: #16a34a;
    }

    .federation__request-btn--cancel {
        background: transparent;
        border: 1px solid rgba(107, 114, 128, 0.3);
        color: #9ca3af;
    }

    .federation__request-btn--cancel:hover {
        background: rgba(107, 114, 128, 0.1);
    }

    .federation__request-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* Content */
    .federation__content {
        background: var(--color-bg-secondary, #1f2937);
        border-radius: var(--radius-lg, 0.5rem);
        border: 1px solid var(--color-border, #374151);
        min-height: 300px;
        padding: var(--spacing-4, 1rem);
    }

    .federation__loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-3, 0.75rem);
        padding: var(--spacing-8, 2rem);
        color: var(--color-text-muted, #6b7280);
    }

    .federation__spinner {
        width: 24px;
        height: 24px;
        border: 2px solid var(--color-border, #374151);
        border-top-color: var(--color-accent, #4f46e5);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .federation__empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-8, 2rem);
        text-align: center;
        color: var(--color-text-muted, #6b7280);
    }

    .federation__empty-icon {
        font-size: 3rem;
        margin-bottom: var(--spacing-4, 1rem);
    }

    .federation__empty h3 {
        font-size: var(--font-size-lg, 1.125rem);
        color: var(--color-text-primary, #ffffff);
        margin-bottom: var(--spacing-2, 0.5rem);
    }

    .federation__empty p {
        margin-bottom: var(--spacing-4, 1rem);
    }

    .federation__empty-btn {
        padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
        background: var(--color-accent, #4f46e5);
        border: none;
        border-radius: var(--radius-md, 0.375rem);
        color: white;
        font-weight: var(--font-weight-medium, 500);
        cursor: pointer;
    }

    .federation__grid {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-3, 0.75rem);
    }

    /* Dialog */
    .federation__dialog-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        padding: var(--spacing-4, 1rem);
    }

    .federation__dialog {
        background: var(--color-bg-secondary, #1f2937);
        border-radius: var(--radius-xl, 1rem);
        border: 1px solid var(--color-border, #374151);
        max-width: 400px;
        width: 100%;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }

    .federation__dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--spacing-4, 1rem);
        border-bottom: 1px solid var(--color-border, #374151);
    }

    .federation__dialog-header h3 {
        font-size: var(--font-size-lg, 1.125rem);
        font-weight: var(--font-weight-semibold, 600);
        color: var(--color-text-primary, #ffffff);
    }

    .federation__dialog-close {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        color: var(--color-text-muted, #6b7280);
        font-size: 1.25rem;
        cursor: pointer;
        border-radius: var(--radius-md, 0.375rem);
    }

    .federation__dialog-close:hover {
        background: var(--color-bg-tertiary, #374151);
    }

    .federation__dialog-content {
        padding: var(--spacing-4, 1rem);
    }

    .federation__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__field label {
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        color: var(--color-text-secondary, #d1d5db);
    }

    .federation__input-row {
        display: flex;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__field input {
        flex: 1;
        padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
        background: var(--color-bg-primary, #111827);
        border: 1px solid var(--color-border, #374151);
        border-radius: var(--radius-md, 0.375rem);
        color: var(--color-text-primary, #ffffff);
        font-size: var(--font-size-sm, 0.875rem);
    }

    .federation__field input:focus {
        outline: none;
        border-color: var(--color-accent, #4f46e5);
    }

    .federation__qr-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        background: #22c55e;
        border: none;
        border-radius: var(--radius-md, 0.375rem);
        color: white;
        cursor: pointer;
    }

    .federation__field-error {
        font-size: var(--font-size-xs, 0.75rem);
        color: #f87171;
    }

    .federation__field-success {
        font-size: var(--font-size-xs, 0.75rem);
        color: #86efac;
    }

    .federation__dialog-actions {
        display: flex;
        gap: var(--spacing-3, 0.75rem);
        padding: var(--spacing-4, 1rem);
        border-top: 1px solid var(--color-border, #374151);
    }

    .federation__btn {
        flex: 1;
        padding: var(--spacing-2, 0.5rem) var(--spacing-4, 1rem);
        border-radius: var(--radius-md, 0.375rem);
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        cursor: pointer;
        transition: all 150ms ease;
    }

    .federation__btn--secondary {
        background: transparent;
        border: 1px solid var(--color-border, #374151);
        color: var(--color-text-secondary, #d1d5db);
    }

    .federation__btn--secondary:hover {
        background: var(--color-bg-tertiary, #374151);
    }

    .federation__btn--primary {
        background: var(--color-accent, #4f46e5);
        border: none;
        color: white;
    }

    .federation__btn--primary:hover:not(:disabled) {
        background: var(--color-accent-dark, #4338ca);
    }

    .federation__btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .federation__textarea {
        width: 100%;
        padding: var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem);
        background: var(--color-bg-primary, #111827);
        border: 1px solid var(--color-border, #374151);
        border-radius: var(--radius-md, 0.375rem);
        color: var(--color-text-primary, #ffffff);
        font-size: var(--font-size-sm, 0.875rem);
        font-family: inherit;
        resize: vertical;
        min-height: 60px;
    }

    .federation__textarea:focus {
        outline: none;
        border-color: var(--color-accent, #4f46e5);
    }

    .federation__textarea::placeholder {
        color: var(--color-text-muted, #6b7280);
    }

    /* Lens Selection in Add Dialog */
    .federation__lens-selection {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-3, 0.75rem);
        margin-top: var(--spacing-4, 1rem);
        padding-top: var(--spacing-3, 0.75rem);
        border-top: 1px solid var(--color-border, #374151);
    }

    .federation__lens-group {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__lens-group-label {
        display: flex;
        align-items: center;
        gap: var(--spacing-2, 0.5rem);
        font-size: var(--font-size-sm, 0.875rem);
        font-weight: var(--font-weight-medium, 500);
        color: var(--color-text-secondary, #d1d5db);
    }

    .federation__lens-direction {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: var(--radius-sm, 0.25rem);
        font-size: 12px;
        font-weight: bold;
    }

    .federation__lens-direction--receive {
        background: rgba(34, 197, 94, 0.2);
        color: #86efac;
    }

    .federation__lens-direction--share {
        background: rgba(59, 130, 246, 0.2);
        color: #93c5fd;
    }

    .federation__lens-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-1, 0.25rem);
    }

    .federation__lens-chip {
        padding: 4px 10px;
        font-size: 11px;
        font-weight: var(--font-weight-medium, 500);
        background: var(--color-bg-primary, #111827);
        border: 1px solid var(--color-border, #374151);
        border-radius: var(--radius-full, 9999px);
        color: var(--color-text-muted, #6b7280);
        cursor: pointer;
        transition: all 150ms ease;
    }

    .federation__lens-chip:hover {
        border-color: var(--color-accent, #4f46e5);
        color: var(--color-text-secondary, #d1d5db);
    }

    .federation__lens-chip--selected {
        background: var(--color-accent, #4f46e5);
        border-color: var(--color-accent, #4f46e5);
        color: white;
    }

    .federation__lens-chip--selected:hover {
        background: var(--color-accent-dark, #4338ca);
        border-color: var(--color-accent-dark, #4338ca);
    }

    /* Update section styles */
    .federation__section--update {
        border-color: rgba(168, 85, 247, 0.3);
    }

    .federation__section--outgoing-update {
        border-color: rgba(59, 130, 246, 0.3);
    }

    .federation__badge--update {
        background: #a855f7;
    }

    .federation__request--update {
        border-color: rgba(168, 85, 247, 0.3);
    }

    .federation__request-avatar--update {
        background: linear-gradient(135deg, #a855f7, #7c3aed);
    }

    .federation__request-subtitle {
        font-size: 11px;
        color: var(--color-text-muted, #6b7280);
        margin-top: 2px;
    }

    .federation__update-diff {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 6px;
        padding: 8px;
        background: rgba(0, 0, 0, 0.2);
        border-radius: var(--radius-sm, 0.25rem);
    }

    .federation__update-from,
    .federation__update-to {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
    }

    .federation__update-label {
        font-size: 10px;
        font-weight: var(--font-weight-medium, 500);
        color: var(--color-text-muted, #6b7280);
        min-width: 50px;
    }
</style>
