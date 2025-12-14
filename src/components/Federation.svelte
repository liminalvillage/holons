<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, fly } from "svelte/transition";
    import { flip } from "svelte/animate";
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
    import ExpirationPicker from "./ExpirationPicker.svelte";
    import {
        type LensCapabilityToken,
        type ExpirationPreset,
        type Direction,
        shortenNpub,
        getExpirationTimestamp,
        formatExpiration,
        getExpirationDescription,
        isCapabilityValid,
        generateCapabilityId,
        generateNonce,
        getPermissionsForDirection,
        createCapabilityRecord
    } from "../lib/capabilities/lensCapability";
    import {
        type FederationRequestDM,
        type FederationResponseDM
    } from "../lib/federation/nostrDM";
    import {
        pendingFederationRequests,
        federationNotifications,
        incomingRequests,
        createIncomingRequest,
        createOutgoingRequest,
        type PendingRequest
    } from "../lib/stores/federationRequests";

    const dispatch = createEventDispatcher();
    const holosphere = getContext("holosphere") as HoloSphere;

    // Default small set of commonly federated lenses
    const DEFAULT_AVAILABLE_LENSES = ['quests', 'offers', 'announcements'];
    
    // All possible lenses that could be federated
    const ALL_POSSIBLE_LENSES = [
        'quests', 'offers', 'tags', 'expenses', 
        'announcements', 'users', 'shopping', 'recurring'
    ];
    
    // User-configurable available lenses (starts with all possible lenses)
    let availableLenses: string[] = [...ALL_POSSIBLE_LENSES];
    let customLenses: string[] = [];
    let showAddCustomLens = false;
    let newCustomLens = '';
    
    // Helper function to normalize lens names for comparison
    function normalizeLensName(lensName: string): string {
        return lensName.toLowerCase();
    }
    
    // Helper function to check if a lens is in a lens array (case-insensitive)
    function isLensInArray(lens: string, lensArray: string[] | undefined): boolean {
        if (!lensArray || !Array.isArray(lensArray)) return false;
        const normalizedLens = normalizeLensName(lens);
        return lensArray.some(l => normalizeLensName(l) === normalizedLens);
    }

    // Helper function to get canonical lens name (always lowercase)
    function getCanonicalLensName(lensName: string): string {
        return lensName.toLowerCase();
    }

    interface FederationInfo {
        id: string;
        name: string;
        federated: string[];
        inbound: string[];
        outbound: string[];
        lensConfig?: Record<string, {
            inbound: string[];
            outbound: string[];
            timestamp: number;
        }>;
        partnerNames?: Record<string, string>;  // Maps partner pubkey/id to their holon name from handshake
        timestamp: number;
    }

    interface FederatedHolon {
        id: string;
        name: string;
        pubKey?: string;  // Nostr public key (hex format)
        npub?: string;    // Nostr public key (npub format)
        status: 'connected' | 'pending' | 'rejected' | 'error';
        pendingRequestId?: string;  // Track which federation request this corresponds to
        lensConfig: {
            inbound: string[];
            outbound: string[];
        };
        capabilities?: Record<string, {
            inbound?: LensCapabilityToken;
            outbound?: LensCapabilityToken;
        }>;
    }

    let currentHolonId: string = '';
    let holonName: string = 'Federation';
    let federationInfo: FederationInfo | null = null;
    let federatedHolons: FederatedHolon[] = [];
    let loading = true;
    let saving = false;
    let showAddDialog = false;
    let newHolonId = '';
    let newHolonName = '';
    // Remove modal state and logic
    // Remove: let selectedHolon: FederatedHolon | null = null;
    let error = '';
    let success = '';
    let showNetworkView = false;

    // Nostr pubkey input for federation
    let newPartnerNpub = '';
    let newPartnerHexPubKey = '';
    let npubValidationError = '';

    // QR Scanner
    let showQRScanner = false;

    // Expiration selection
    let selectedExpiration: ExpirationPreset = 'permanent';
    let customExpirationDate = '';
    let showExpirationPicker = false;
    let pendingLensGrant: {
        holonId: string;
        pubKey: string;
        lensName: string;
        direction: Direction;
    } | null = null;

    // Capability tracking per partner
    let partnerCapabilities: Map<string, Record<string, { inbound?: LensCapabilityToken; outbound?: LensCapabilityToken }>> = new Map();

    // Subscribe to current holon ID
    let idStoreUnsubscribe: (() => void) | undefined;
    let federationSubscription: any = null;
    let dmUnsubscribe: (() => void) | undefined;

    onMount(() => {
        // Initialize pending federation requests store
        pendingFederationRequests.init();

        idStoreUnsubscribe = ID.subscribe(async (newId) => {
            if (newId !== currentHolonId) {
                // Unsubscribe from previous federation data
                if (federationSubscription) {
                    federationSubscription.unsubscribe();
                    federationSubscription = null;
                }

                currentHolonId = newId || '';
                if (currentHolonId) {
                    await loadFederationData();
                    // Subscribe to federation data changes
                    await subscribeFederationChanges();
                    // Load holon name for TitleBar
                    const name = await fetchHolonName(holosphere, currentHolonId);
                    holonName = name || 'Federation';
                } else {
                    federationInfo = null;
                    federatedHolons = [];
                    loading = false;
                }
            }
        });

        // Subscribe to federation DMs if we have a private key
        if ($nostrPrivateKey && $nostrPublicKey) {
            subscribeToDMs();
        }
    });

    onDestroy(() => {
        if (idStoreUnsubscribe) {
            idStoreUnsubscribe();
        }
        if (federationSubscription) {
            federationSubscription.unsubscribe();
        }
        if (dmUnsubscribe) {
            dmUnsubscribe();
        }
    });

    // Helper to validate holon ID
    const isValidHolonId = (id: string | undefined | null): id is string =>
        !!id && id !== 'undefined' && id !== 'null' && id.trim() !== '';

    // Reactive block: when page ID changes (different holon), reload federation data
    $: if ($page.params.id && $page.params.id !== currentHolonId && isValidHolonId($page.params.id) && holosphere) {
        // Unsubscribe from previous federation data
        if (federationSubscription) {
            federationSubscription.unsubscribe();
            federationSubscription = null;
        }

        currentHolonId = $page.params.id;
        ID.set(currentHolonId);
        loading = true;
        loadFederationData().then(() => {
            subscribeFederationChanges();
        });
    }

    async function subscribeFederationChanges() {
        if (!holosphere || !currentHolonId) return;

        try {
            // Subscribe to the global federation data for this holon
            // Use subscribeGlobal to subscribe to global table path: appname/federation/holonId
            federationSubscription = await holosphere.subscribeGlobal(
                'federation',
                currentHolonId,
                async (data, itemId) => {
                    console.log('Federation data changed:', data, itemId);
                    // Reload federation data when changes occur
                    await loadFederationData();
                },
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
            // Get federation info
            federationInfo = await holosphere.getFederation(currentHolonId);
            console.log('Federation info loaded:', federationInfo);
            
            if (federationInfo) {
                // Build federated holons list using a temporary array
                const tempHolons: FederatedHolon[] = [];

                // Process federated list (all federated holons)
                const federatedList = federationInfo.federated || [];

                for (const holonId of federatedList) {
                    const rawLensConfig = federationInfo.lensConfig?.[holonId];
                    const lensConfig = {
                        inbound: Array.isArray(rawLensConfig?.inbound) ? rawLensConfig.inbound : [],
                        outbound: Array.isArray(rawLensConfig?.outbound) ? rawLensConfig.outbound : []
                    };

                    console.log(`Lens config for ${holonId}:`, lensConfig);

                    // Use partner name from handshake (stored in partnerNames) - we can't read their settings
                    const holonName = federationInfo.partnerNames?.[holonId] || holonId;

                    // Check if holonId is a valid Nostr public key (hex format)
                    let pubKey: string | undefined;
                    let npub: string | undefined;
                    if (/^[0-9a-fA-F]{64}$/.test(holonId)) {
                        pubKey = holonId;
                        npub = nostrUtils.hexToNpub(holonId);
                    }

                    const federatedHolon: FederatedHolon = {
                        id: holonId,
                        name: holonName,
                        pubKey,
                        npub,
                        status: 'connected',
                        lensConfig
                    };

                    tempHolons.push(federatedHolon);
                }

                // Assign to trigger reactivity in Svelte 5
                federatedHolons = tempHolons;

                // Load capabilities for all partners with pubKeys (in parallel)
                const capabilityLoads = tempHolons
                    .filter(h => h.pubKey)
                    .map(h => loadPartnerCapabilities(h.pubKey!));
                await Promise.all(capabilityLoads);

                console.log('Final federated holons:', federatedHolons);
            } else {
                federatedHolons = [];
                console.log('No federation info found');
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to load federation data';
            console.error('Federation load error:', err);
        } finally {
            loading = false;
        }
    }

    async function addFederation() {
        // Determine the federation target: prefer npub/hex pubkey, fallback to holon ID
        let federationTarget = '';

        if (newPartnerHexPubKey) {
            // Use the validated hex public key as the federation target
            federationTarget = newPartnerHexPubKey;
        } else if (newHolonId.trim()) {
            // Fallback to holon ID for backward compatibility
            federationTarget = newHolonId.trim();
        }

        if (!federationTarget || !holosphere || !currentHolonId) return;

        saving = true;
        error = '';

        try {
            const ourHolonName = await getHolonName(currentHolonId);

            // If federating with a Nostr pubkey, use the handshake protocol
            if (newPartnerHexPubKey && $nostrPrivateKey && $nostrPublicKey) {
                const ourNpub = nostrUtils.hexToNpub($nostrPublicKey);

                // Use holosphere2's handshake - creates local record AND sends DM in one atomic operation
                const result = await handshake.initiateFederationHandshake(holosphere, $nostrPrivateKey, {
                    partnerPubKey: newPartnerHexPubKey,
                    holonId: currentHolonId,
                    holonName: ourHolonName,
                    lensConfig: { inbound: [], outbound: [] }
                });

                if (result.success && result.requestId) {
                    // Track as outgoing request
                    const outgoingRequest = createOutgoingRequest(
                        result.requestId,
                        $nostrPublicKey,
                        ourNpub,
                        currentHolonId,
                        ourHolonName,
                        newPartnerHexPubKey,
                        newPartnerNpub || nostrUtils.hexToNpub(newPartnerHexPubKey),
                        { inbound: [], outbound: [] },
                        []
                    );
                    pendingFederationRequests.add(outgoingRequest);
                    showSuccess('Federation request sent - waiting for partner to accept');
                } else {
                    error = result.error || 'Failed to initiate federation handshake';
                    return;
                }
            } else {
                // Fallback: just create local federation record (no DM for non-Nostr targets)
                const success = await holosphere.federateHolon(
                    currentHolonId,
                    federationTarget,
                    { lensConfig: { inbound: [], outbound: [] } }
                );

                if (!success) {
                    error = 'Failed to create federation';
                    return;
                }
                showSuccess('Federation created successfully');
            }

            showAddDialog = false;
            newHolonId = '';
            newHolonName = '';
            newPartnerNpub = '';
            newPartnerHexPubKey = '';
            npubValidationError = '';
            selectedExpiration = 'permanent';
            customExpirationDate = '';

            // Wait a bit for changes to propagate
            await new Promise(resolve => setTimeout(resolve, 300));

            // Force reload of federation data
            await loadFederationData();
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to create federation';
            console.error('Federation creation error:', err);
        } finally {
            saving = false;
        }
    }

    async function removeFederation(holonId: string) {
        console.log('removeFederation called with holonId:', holonId);

        if (!holosphere || !currentHolonId) {
            console.log('Early return: missing holosphere or currentHolonId', { holosphere: !!holosphere, currentHolonId });
            return;
        }

        saving = true;
        error = '';

        try {
            console.log('Calling holosphere.unfederateHolon...', { currentHolonId, holonId });
            const success = await holosphere.unfederateHolon(currentHolonId, holonId);
            console.log('unfederateHolon result:', success);

            if (success) {
                console.log('Federation removed successfully, reloading data...');

                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
                showSuccess('Federation removed successfully');
            } else {
                console.error('unfederateHolon returned false');
                error = 'Failed to remove federation';
            }
        } catch (err) {
            console.error('Federation removal error:', err);
            error = err instanceof Error ? err.message : 'Failed to remove federation';
        } finally {
            saving = false;
        }
    }

    async function updateLensConfig(holonId: string, inboundLenses: string[], outboundLenses: string[]) {
        if (!holosphere || !currentHolonId) return;

        saving = true;

        try {
            // Re-federate with updated lens config
            const success = await holosphere.federateHolon(
                currentHolonId,
                holonId,
                {
                    lensConfig: { inbound: inboundLenses, outbound: outboundLenses }
                }
            );

            if (success) {
                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
            }
        } catch (err) {
            console.error('Lens config update error:', err);
        } finally {
            saving = false;
        }
    }

    async function getHolonName(holonId: string): Promise<string> {
        if (!holonId || !holosphere) return 'Unknown';

        try {
            // Get settings for this holon (no dataId - gets all settings)
            const settings = await holosphere.get(holonId, 'settings');

            // Settings might be an array (readAll returns array) or single object
            if (Array.isArray(settings)) {
                // Find the first settings object with a name
                const settingsObj = settings.find((s: any) => s?.name);
                if (settingsObj?.name) {
                    return settingsObj.name;
                }
            } else if (settings && settings.name) {
                return settings.name;
            }
        } catch (error) {
            console.warn(`Could not fetch settings name for holon ${holonId}:`, error);
        }

        // Fallback to holon ID
        return holonId;
    }

    function showSuccess(message: string) {
        success = message;
        setTimeout(() => {
            success = '';
        }, 3000);
    }

    function getLensIcon(lens: string): string {
        const normalizedLens = normalizeLensName(lens);
        const icons: Record<string, string> = {
            'quests': '🎯',
            'offers': '🤝',
            'tags': '🏷️',
            'expenses': '💰',
            'announcements': '📢',
            'users': '👥',
            'shopping': '🛒',
            'recurring': '🔄'
        };
        return icons[normalizedLens] || '📦';
    }

    function getStatusColor(status: string): string {
        switch (status) {
            case 'connected': return 'text-green-400';
            case 'pending': return 'text-yellow-400';
            case 'error': return 'text-red-400';
            default: return 'text-gray-400';
        }
    }

    function closeDialog() {
        showAddDialog = false;
        newHolonId = '';
        newHolonName = '';
        newPartnerNpub = '';
        newPartnerHexPubKey = '';
        npubValidationError = '';
        selectedExpiration = 'permanent';
        customExpirationDate = '';
        error = '';
    }

    function navigateToHolon(holonId: string) {
        ID.set(holonId);
        
        // Track this visit if wallet is connected
        if ($walletAddress) {
            addVisitedHolonToSeparateList(holonId);
        }
        
        goto(`/${holonId}/dashboard`);
    }

    async function addVisitedHolonToSeparateList(holonId: string) {
        if (!$walletAddress) return;
        
        try {
            const holonName = await fetchHolonName(holosphere, holonId);
            
            // Use the centralized function to add visited holon
            addVisitedHolon($walletAddress, holonId, holonName, 'federation');
            
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

    // ============================================================================
    // Nostr Public Key Validation
    // ============================================================================

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

    function handleQRScan(event: CustomEvent<{ decodedText: string }>) {
        const scannedText = event.detail.decodedText;

        // Check if it's a Nostr URI
        if (scannedText.startsWith('nostr:')) {
            newPartnerNpub = scannedText.replace('nostr:', '');
        } else if (scannedText.startsWith('npub1') || /^[0-9a-fA-F]{64}$/.test(scannedText)) {
            newPartnerNpub = scannedText;
        } else {
            // Try to parse as JSON (might be a Harvest federation invite)
            try {
                const parsed = JSON.parse(scannedText);
                if (parsed.npub) newPartnerNpub = parsed.npub;
                if (parsed.pubKey) newPartnerNpub = parsed.pubKey;
                if (parsed.holonId) newHolonId = parsed.holonId;
            } catch {
                error = 'QR code does not contain a valid Nostr public key';
            }
        }

        validateNpub();
        showQRScanner = false;
    }

    // ============================================================================
    // Capability Grant/Revoke Functions
    // ============================================================================

    async function grantLensCapability(
        recipientPubKey: string,
        holonId: string,
        lensName: string,
        direction: Direction,
        expiration: ExpirationPreset,
        customExpiration?: string
    ): Promise<boolean> {
        if (!holosphere || !currentHolonId) return false;

        const permissions = getPermissionsForDirection(direction);
        const expiresAt = getExpirationTimestamp(expiration, customExpiration);
        const expiresIn = expiresAt ? expiresAt - Date.now() : 365 * 24 * 60 * 60 * 1000;

        try {
            // Get issuer's public key
            const issuerPubKey = holosphere.client?.publicKey;
            if (!issuerPubKey) {
                error = 'No public key available';
                return false;
            }

            // Issue the capability token using holosphere
            const token = await holosphere.issueCapability(
                permissions,
                { holonId, lensName },
                recipientPubKey,
                {
                    issuerKey: $nostrPrivateKey,
                    expiresIn
                }
            );

            // Create capability record
            const capabilityRecord: LensCapabilityToken = {
                id: generateCapabilityId(issuerPubKey, recipientPubKey, holonId, lensName, direction),
                type: 'lens_capability',
                issuerPubKey,
                recipientPubKey,
                holonId,
                lensName,
                permissions,
                direction,
                issuedAt: Date.now(),
                expiresAt,
                expirationPreset: expiration,
                nonce: generateNonce(),
                signature: typeof token === 'string' ? token : ''
            };

            // Store in global lens_capabilities table
            try {
                await holosphere.writeGlobal('lens_capabilities', capabilityRecord);
                console.log('Capability stored in global table:', capabilityRecord.id);
            } catch (storeErr) {
                console.warn('Failed to store capability in global table, using local storage:', storeErr);
                // Fallback to localStorage
                const stored = localStorage.getItem('lens_capabilities') || '{}';
                const caps = JSON.parse(stored);
                caps[capabilityRecord.id] = capabilityRecord;
                localStorage.setItem('lens_capabilities', JSON.stringify(caps));
            }

            // Update local tracking
            updatePartnerCapabilities(recipientPubKey, lensName, direction, capabilityRecord);

            showSuccess(`${direction === 'inbound' ? 'Read' : 'Write'} capability granted for ${lensName}`);
            return true;
        } catch (err) {
            error = `Failed to grant capability: ${err instanceof Error ? err.message : 'Unknown error'}`;
            console.error('Grant capability error:', err);
            return false;
        }
    }

    async function revokeLensCapability(
        recipientPubKey: string,
        holonId: string,
        lensName: string,
        direction: Direction
    ): Promise<boolean> {
        if (!holosphere) return false;

        const issuerPubKey = holosphere.client?.publicKey;
        if (!issuerPubKey) return false;

        const capabilityId = generateCapabilityId(issuerPubKey, recipientPubKey, holonId, lensName, direction);

        try {
            // Mark as revoked in global table
            try {
                const existing = await holosphere.getGlobal('lens_capabilities', capabilityId);
                if (existing) {
                    existing.revokedAt = Date.now();
                    await holosphere.writeGlobal('lens_capabilities', existing);
                }
            } catch (globalErr) {
                console.warn('Failed to revoke in global table:', globalErr);
            }

            // Also update localStorage
            try {
                const stored = localStorage.getItem('lens_capabilities') || '{}';
                const caps = JSON.parse(stored);
                if (caps[capabilityId]) {
                    caps[capabilityId].revokedAt = Date.now();
                    localStorage.setItem('lens_capabilities', JSON.stringify(caps));
                }
            } catch (localErr) {
                console.warn('Failed to revoke in localStorage:', localErr);
            }

            // Remove from local tracking
            removePartnerCapability(recipientPubKey, lensName, direction);

            showSuccess(`${direction === 'inbound' ? 'Read' : 'Write'} capability revoked for ${lensName}`);
            return true;
        } catch (err) {
            error = `Failed to revoke capability: ${err instanceof Error ? err.message : 'Unknown error'}`;
            console.error('Revoke capability error:', err);
            return false;
        }
    }

    function updatePartnerCapabilities(
        pubKey: string,
        lensName: string,
        direction: Direction,
        capability: LensCapabilityToken
    ) {
        const existing = partnerCapabilities.get(pubKey) || {};
        if (!existing[lensName]) {
            existing[lensName] = {};
        }
        existing[lensName][direction] = capability;
        partnerCapabilities.set(pubKey, existing);
        partnerCapabilities = new Map(partnerCapabilities); // Trigger reactivity
    }

    function removePartnerCapability(pubKey: string, lensName: string, direction: Direction) {
        const existing = partnerCapabilities.get(pubKey);
        if (existing && existing[lensName]) {
            delete existing[lensName][direction];
            partnerCapabilities.set(pubKey, existing);
            partnerCapabilities = new Map(partnerCapabilities);
        }
    }

    function getCapabilityForLens(
        pubKey: string | undefined,
        lensName: string,
        direction: Direction
    ): LensCapabilityToken | null {
        if (!pubKey) return null;
        const partnerCaps = partnerCapabilities.get(pubKey);
        if (!partnerCaps || !partnerCaps[lensName]) return null;
        const cap = partnerCaps[lensName][direction];
        return cap && isCapabilityValid(cap) ? cap : null;
    }

    async function loadPartnerCapabilities(pubKey: string) {
        if (!pubKey) return;

        const issuerPubKey = holosphere?.client?.publicKey;
        if (!issuerPubKey) {
            console.warn('No issuer public key available');
            return;
        }

        const caps: Record<string, { inbound?: LensCapabilityToken; outbound?: LensCapabilityToken }> = {};

        try {
            // Try to load from holosphere global table first
            let allCaps: Record<string, any> | any[] | null = null;

            if (holosphere && typeof holosphere.getAllGlobal === 'function') {
                allCaps = await holosphere.getAllGlobal('lens_capabilities');
            }

            // Also check localStorage as fallback/supplement
            const localStored = localStorage.getItem('lens_capabilities');
            if (localStored) {
                const localCaps = JSON.parse(localStored);
                if (!allCaps) {
                    allCaps = localCaps;
                } else if (typeof allCaps === 'object' && !Array.isArray(allCaps)) {
                    // Merge local with global
                    allCaps = { ...allCaps, ...localCaps };
                }
            }

            if (!allCaps || typeof allCaps !== 'object') {
                console.log('No capabilities found');
                return;
            }

            const capValues = Array.isArray(allCaps) ? allCaps : Object.values(allCaps);

            for (const cap of capValues as LensCapabilityToken[]) {
                if (!cap || typeof cap !== 'object') continue;
                if (cap.type !== 'lens_capability') continue;

                if (cap.issuerPubKey === issuerPubKey &&
                    cap.recipientPubKey === pubKey &&
                    !cap.revokedAt &&
                    isCapabilityValid(cap)) {
                    if (!caps[cap.lensName]) {
                        caps[cap.lensName] = {};
                    }
                    caps[cap.lensName][cap.direction] = cap;
                    console.log(`Loaded capability for ${cap.lensName} (${cap.direction}):`, cap.expiresAt ? new Date(cap.expiresAt).toLocaleDateString() : 'permanent');
                }
            }

            partnerCapabilities.set(pubKey, caps);
            partnerCapabilities = new Map(partnerCapabilities);
            console.log('Partner capabilities loaded for', pubKey.slice(0, 8), ':', Object.keys(caps));
        } catch (err) {
            console.warn('Failed to load partner capabilities:', err);
        }
    }

    // ============================================================================
    // Lens Toggle with Capability Support
    // ============================================================================

    async function toggleLensCapability(
        federatedHolonId: string,
        lensName: string,
        direction: Direction,
        currentlyEnabled: boolean
    ) {
        // Get the partner's public key
        const partner = federatedHolons.find(h => h.id === federatedHolonId);

        if (currentlyEnabled) {
            // Revoke capability if partner has pubKey
            if (partner?.pubKey) {
                await revokeLensCapability(partner.pubKey, currentHolonId, lensName, direction);
            }

            // Update lens config
            const newInbound = direction === 'inbound'
                ? partner?.lensConfig.inbound.filter(l => normalizeLensName(l) !== normalizeLensName(lensName)) || []
                : partner?.lensConfig.inbound || [];
            const newOutbound = direction === 'outbound'
                ? partner?.lensConfig.outbound.filter(l => normalizeLensName(l) !== normalizeLensName(lensName)) || []
                : partner?.lensConfig.outbound || [];

            await updateLensConfig(federatedHolonId, newInbound, newOutbound);
        } else {
            // If partner has pubKey, show expiration picker
            if (partner?.pubKey) {
                pendingLensGrant = {
                    holonId: federatedHolonId,
                    pubKey: partner.pubKey,
                    lensName,
                    direction
                };
                showExpirationPicker = true;
            } else {
                // No pubKey, just update lens config without capability token
                const newInbound = direction === 'inbound'
                    ? [...(partner?.lensConfig.inbound || []), getCanonicalLensName(lensName)]
                    : partner?.lensConfig.inbound || [];
                const newOutbound = direction === 'outbound'
                    ? [...(partner?.lensConfig.outbound || []), getCanonicalLensName(lensName)]
                    : partner?.lensConfig.outbound || [];

                await updateLensConfig(federatedHolonId, newInbound, newOutbound);
            }
        }
    }

    async function confirmLensGrant(event: CustomEvent<{ preset: ExpirationPreset; customDate?: string }>) {
        if (!pendingLensGrant) return;

        const { holonId, pubKey, lensName, direction } = pendingLensGrant;
        const { preset, customDate } = event.detail;

        const success = await grantLensCapability(
            pubKey,
            currentHolonId,
            lensName,
            direction,
            preset,
            customDate
        );

        if (success) {
            // Update lens config
            const partner = federatedHolons.find(h => h.id === holonId);
            if (partner) {
                const newInbound = direction === 'inbound'
                    ? [...partner.lensConfig.inbound, getCanonicalLensName(lensName)]
                    : partner.lensConfig.inbound;
                const newOutbound = direction === 'outbound'
                    ? [...partner.lensConfig.outbound, getCanonicalLensName(lensName)]
                    : partner.lensConfig.outbound;

                await updateLensConfig(holonId, newInbound, newOutbound);
            }
        }

        showExpirationPicker = false;
        pendingLensGrant = null;
        selectedExpiration = 'permanent';
        customExpirationDate = '';
    }

    function cancelLensGrant() {
        showExpirationPicker = false;
        pendingLensGrant = null;
        selectedExpiration = 'permanent';
        customExpirationDate = '';
    }

    // ============================================================================
    // Nostr DM Federation Protocol
    // ============================================================================

    function subscribeToDMs() {
        if (!holosphere || !$nostrPrivateKey || !$nostrPublicKey) return;

        try {
            // Use holosphere2's handshake subscription
            dmUnsubscribe = handshake.subscribeToFederationDMs(
                holosphere,
                $nostrPrivateKey,
                $nostrPublicKey,
                {
                    onRequest: handleIncomingFederationRequest,
                    onResponse: handleFederationResponse
                }
            );
            console.log('Subscribed to federation DMs');
        } catch (err) {
            console.error('Failed to subscribe to federation DMs:', err);
        }
    }

    async function handleIncomingFederationRequest(
        request: FederationRequestDM,
        senderPubKey: string
    ) {
        console.log('Received federation request from:', senderPubKey.substring(0, 8) + '...');

        // Check if we already have this request
        if (pendingFederationRequests.hasPendingForPubKey(senderPubKey)) {
            console.log('Already have pending request from this pubkey');
            return;
        }

        // Create incoming request record
        const pendingRequest = createIncomingRequest(
            request.requestId,
            senderPubKey,
            request.senderNpub,
            request.senderHolonId,
            request.senderHolonName,
            request.lensConfig,
            request.capabilities,
            request.message
        );

        // Add to store
        pendingFederationRequests.add(pendingRequest);
        showSuccess(`Federation request received from ${request.senderHolonName}`);
    }

    async function handleFederationResponse(
        response: FederationResponseDM,
        senderPubKey: string
    ) {
        console.log('Received federation response:', response.status, 'from:', senderPubKey.substring(0, 8) + '...');

        // Find the outgoing request this response is for
        const request = pendingFederationRequests.getById(response.requestId);
        if (!request) {
            console.warn('Received response for unknown request:', response.requestId);
            return;
        }

        if (response.status === 'accepted') {
            // Update request status
            pendingFederationRequests.updateStatus(response.requestId, 'accepted');

            // Create the actual federation record now that it's accepted
            // Store the responder's name so we can display it without reading their settings
            if (holosphere && currentHolonId) {
                await holosphere.federateHolon(currentHolonId, senderPubKey, {
                    lensConfig: response.lensConfig || { inbound: [], outbound: [] },
                    partnerName: response.responderHolonName
                });
            }

            // Update the federation status to connected
            federatedHolons = federatedHolons.map(h =>
                h.pendingRequestId === response.requestId
                    ? { ...h, status: 'connected' as const, pendingRequestId: undefined }
                    : h
            );

            showSuccess(`Federation accepted by ${response.responderHolonName || 'partner'}`);
            await loadFederationData();
        } else {
            // Update request status
            pendingFederationRequests.updateStatus(response.requestId, 'rejected');

            // Update the federation status
            federatedHolons = federatedHolons.map(h =>
                h.pendingRequestId === response.requestId
                    ? { ...h, status: 'rejected' as const }
                    : h
            );

            showSuccess(`Federation rejected by ${response.responderHolonName || 'partner'}`);
        }
    }

    async function acceptFederationRequest(requestId: string) {
        const pendingRequest = pendingFederationRequests.getById(requestId);
        if (!pendingRequest || !$nostrPrivateKey) return;

        saving = true;
        try {
            const ourHolonName = await getHolonName(currentHolonId);

            // Use holosphere2's handshake - creates local record AND sends response in one atomic operation
            const result = await handshake.acceptFederationRequest(holosphere, $nostrPrivateKey, {
                request: { requestId: pendingRequest.id },
                senderPubKey: pendingRequest.senderPubKey,
                holonId: currentHolonId,
                holonName: ourHolonName,
                lensConfig: { inbound: [], outbound: [] }
            });

            if (result.success) {
                // Update request status
                pendingFederationRequests.updateStatus(requestId, 'accepted');
                // Reload federation data
                await loadFederationData();
                showSuccess('Federation accepted');
            } else {
                error = result.error || 'Failed to accept federation';
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to accept federation';
            console.error('Accept federation error:', err);
        } finally {
            saving = false;
        }
    }

    async function rejectFederationRequest(requestId: string) {
        const pendingRequest = pendingFederationRequests.getById(requestId);
        if (!pendingRequest || !$nostrPrivateKey) return;

        saving = true;
        try {
            // Use holosphere2's handshake to send rejection
            const result = await handshake.rejectFederationRequest(holosphere, $nostrPrivateKey, {
                requestId: pendingRequest.id,
                senderPubKey: pendingRequest.senderPubKey
            });

            if (result.success) {
                // Update request status and remove
                pendingFederationRequests.updateStatus(requestId, 'rejected');
                showSuccess('Federation request rejected');
            } else {
                error = result.error || 'Failed to reject federation';
            }
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to reject federation';
            console.error('Reject federation error:', err);
        } finally {
            saving = false;
        }
    }

    $: totalFederations = federatedHolons.length;
    $: activeLenses = federatedHolons.reduce((acc, holon) => {
        if (holon && holon.lensConfig && Array.isArray(holon.lensConfig.inbound)) {
            holon.lensConfig.inbound.forEach(lens => acc.add(lens));
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
                    class="flex-1 lg:flex-none bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-4 py-2 rounded-lg transition-all flex items-center justify-center space-x-2 text-white font-medium shadow-lg shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
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

    <!-- Status Messages (floating) -->
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
                    <div class="text-xl font-bold text-white">{$incomingRequests.length}</div>
                    <div class="text-xs text-gray-400">Pending</div>
                </div>
            </div>
        </div>
    {/if}

    <!-- Main Content Container -->
    <div class="bg-gray-800/50 rounded-2xl border border-gray-700/50 min-h-[500px]">
        <div class="p-6">

            <!-- Incoming Federation Requests -->
            {#if $incomingRequests.length > 0}
                <div class="mb-6" transition:slide>
                    <div class="flex items-center gap-2 mb-4">
                        <div class="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                            <svg class="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"></path>
                            </svg>
                        </div>
                        <h3 class="text-base font-semibold text-white">Pending Requests</h3>
                        <span class="bg-amber-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">
                            {$incomingRequests.length}
                        </span>
                    </div>

                    <div class="space-y-3">
                        {#each $incomingRequests as request (request.id)}
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
                                            {#if request.lensConfig.outbound.length > 0}
                                                <div class="flex flex-wrap gap-1 mt-1.5">
                                                    {#each request.lensConfig.outbound.slice(0, 3) as lens}
                                                        <span class="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">{lens}</span>
                                                    {/each}
                                                    {#if request.lensConfig.outbound.length > 3}
                                                        <span class="text-xs text-amber-400">+{request.lensConfig.outbound.length - 3} more</span>
                                                    {/if}
                                                </div>
                                            {/if}
                                        </div>
                                    </div>

                                    <!-- Message (if any) -->
                                    {#if request.message}
                                        <div class="hidden sm:block w-px h-10 bg-amber-500/30"></div>
                                        <div class="flex-1 max-w-xs">
                                            <p class="text-amber-200/80 text-sm italic line-clamp-2">"{request.message}"</p>
                                        </div>
                                    {/if}

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

                                <!-- Timestamp -->
                                <div class="mt-3 pt-3 border-t border-amber-500/20 flex items-center justify-between text-xs text-gray-500">
                                    <span>Received {new Date(request.timestamp).toLocaleDateString()}</span>
                                    <span>{new Date(request.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                </div>
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
                                <div class="w-8 h-8 rounded-lg bg-gray-600/30"></div>
                            </div>
                            <div class="space-y-2">
                                <div class="h-3 bg-gray-600/30 rounded w-full"></div>
                                <div class="h-3 bg-gray-600/30 rounded w-3/4"></div>
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
                <!-- Illustration -->
                <div class="relative mb-8">
                    <div class="w-24 h-24 rounded-full bg-gradient-to-br from-purple-500/20 to-indigo-500/20 flex items-center justify-center">
                        <svg class="w-12 h-12 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                        </svg>
                    </div>
                    <!-- Decorative dots -->
                    <div class="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-blue-500/30"></div>
                    <div class="absolute -bottom-1 -left-3 w-3 h-3 rounded-full bg-purple-500/30"></div>
                    <div class="absolute top-1/2 -right-6 w-2 h-2 rounded-full bg-indigo-500/30"></div>
                </div>

                <h3 class="text-xl font-semibold text-white mb-2">Start Federating</h3>
                <p class="text-gray-400 text-center max-w-md mb-8">
                    Connect with other holons to share data and collaborate. Federation enables real-time data sync across communities.
                </p>

                <div class="flex flex-col sm:flex-row gap-3">
                    <button
                        on:click={() => showAddDialog = true}
                        class="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 px-6 py-3 rounded-xl transition-all inline-flex items-center justify-center gap-2 text-white font-medium shadow-lg shadow-purple-500/25"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                        </svg>
                        Add Federation Partner
                    </button>
                    <button
                        on:click={() => {/* TODO: Show help/docs */}}
                        class="px-6 py-3 rounded-xl transition-all inline-flex items-center justify-center gap-2 text-gray-300 font-medium border border-gray-600 hover:border-gray-500 hover:bg-gray-700/50"
                    >
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        Learn More
                    </button>
                </div>
            </div>
        {:else}
            {#if !showNetworkView}
                <!-- Federation List -->
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                    {#each federatedHolons as holon (holon.id)}
                        <div
                            class="group bg-gray-700/30 rounded-xl border border-gray-600/30 hover:border-purple-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/5 overflow-hidden"
                            animate:flip={{ duration: 300 }}
                            in:fly={{ y: 20, duration: 300 }}
                            out:fly={{ y: -20, duration: 200 }}
                        >
                        <!-- Card Header with gradient -->
                        <div class="bg-gradient-to-r from-gray-700/50 to-gray-800/50 p-4 border-b border-gray-600/30">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-3 min-w-0 flex-1">
                                    <!-- Avatar -->
                                    <div class="relative flex-shrink-0">
                                        <div class="w-11 h-11 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                            {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                                        </div>
                                        <!-- Status indicator -->
                                        <div class={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-gray-700 ${holon.status === 'connected' ? 'bg-green-500' : holon.status === 'pending' ? 'bg-amber-500' : 'bg-gray-500'}`}></div>
                                    </div>
                                    <!-- Info -->
                                    <div class="min-w-0 flex-1">
                                        <button
                                            on:click={() => navigateToHolon(holon.id)}
                                            class="font-semibold text-white truncate hover:text-purple-400 transition-colors text-left block w-full text-sm"
                                            title="Navigate to {holon.name || holon.id}"
                                        >
                                            {holon.name || holon.id}
                                        </button>
                                        {#if holon.npub}
                                            <button
                                                class="text-xs text-gray-400 font-mono hover:text-purple-400 transition-colors flex items-center gap-1 mt-0.5"
                                                title="Copy npub"
                                                on:click|stopPropagation={() => {
                                                    navigator.clipboard.writeText(holon.npub || '');
                                                    showSuccess('Copied npub');
                                                }}
                                            >
                                                {shortenNpub(holon.npub)}
                                                <svg class="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                                </svg>
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                                <!-- Delete button -->
                                <button
                                    on:click={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeFederation(holon.id);
                                    }}
                                    class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-all p-1.5 rounded-lg hover:bg-red-500/10"
                                    title="Remove Federation"
                                    aria-label="Remove federation with {holon.name || holon.id}"
                                    disabled={saving}
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Lens Configuration - Compact Grid -->
                        <div class="p-4">
                            <div class="flex items-center justify-between mb-3">
                                <span class="text-xs font-medium text-gray-400 uppercase tracking-wider">Data Sharing</span>
                                <div class="flex items-center gap-3 text-xs text-gray-500">
                                    <span class="flex items-center gap-1">
                                        <svg class="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                                        </svg>
                                        In
                                    </span>
                                    <span class="flex items-center gap-1">
                                        <svg class="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                                        </svg>
                                        Out
                                    </span>
                                </div>
                            </div>

                            {#if availableLenses.length > 0}
                                <div class="grid grid-cols-2 gap-2">
                                    {#each availableLenses.slice(0, 6) as lens}
                                        {@const isInbound = isLensInArray(lens, holon.lensConfig.inbound)}
                                        {@const isOutbound = isLensInArray(lens, holon.lensConfig.outbound)}
                                        <div class="bg-gray-600/20 rounded-lg p-2 flex items-center justify-between gap-2">
                                            <div class="flex items-center gap-2 min-w-0">
                                                <span class="text-sm">{getLensIcon(lens)}</span>
                                                <span class="text-xs text-gray-300 capitalize truncate">{lens}</span>
                                            </div>
                                            <div class="flex items-center gap-1.5 flex-shrink-0">
                                                <!-- Inbound toggle -->
                                                <button
                                                    class="w-5 h-5 rounded flex items-center justify-center transition-all {isInbound ? 'bg-blue-500 text-white' : 'bg-gray-600/50 text-gray-500 hover:bg-gray-600'}"
                                                    disabled={saving}
                                                    title={isInbound ? 'Receiving data' : 'Not receiving'}
                                                    on:click={() => toggleLensCapability(holon.id, lens, 'inbound', isInbound)}
                                                >
                                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                                                    </svg>
                                                </button>
                                                <!-- Outbound toggle -->
                                                <button
                                                    class="w-5 h-5 rounded flex items-center justify-center transition-all {isOutbound ? 'bg-green-500 text-white' : 'bg-gray-600/50 text-gray-500 hover:bg-gray-600'}"
                                                    disabled={saving}
                                                    title={isOutbound ? 'Sharing data' : 'Not sharing'}
                                                    on:click={() => toggleLensCapability(holon.id, lens, 'outbound', isOutbound)}
                                                >
                                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                                {#if availableLenses.length > 6}
                                    <p class="text-xs text-gray-500 text-center mt-2">+{availableLenses.length - 6} more lenses</p>
                                {/if}
                            {:else}
                                <div class="text-center py-4 text-gray-500 text-xs">
                                    No lenses configured
                                </div>
                            {/if}
                        </div>


                        </div>
                    {/each}
                </div>
            {:else}
                <!-- Network View -->
                <div class="bg-gray-800 rounded-xl p-6 border border-gray-700">
                    <div class="text-center mb-6">
                        <h3 class="text-lg font-semibold text-white mb-2">Federation Network</h3>
                        <p class="text-gray-400 text-sm">Interactive visualization of holon connections</p>
                    </div>
                    
                    <div class="flex justify-center">
                        <svg width="800" height="600" class="rounded-lg bg-gradient-to-br from-gray-900 to-gray-800 border border-gray-600">
                            <!-- Background Grid -->
                            <defs>
                                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" stroke-width="0.5" opacity="0.3"/>
                                </pattern>
                                <filter id="glow">
                                    <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                                    <feMerge> 
                                        <feMergeNode in="coloredBlur"/>
                                        <feMergeNode in="SourceGraphic"/>
                                    </feMerge>
                                </filter>
                            </defs>
                            
                            <rect width="100%" height="100%" fill="url(#grid)"/>
                            
                            <!-- Connection Lines -->
                            {#each federatedHolons as holon, index}
                                {@const angle = (index / federatedHolons.length) * 2 * Math.PI - Math.PI/2}
                                {@const radius = 200}
                                {@const x = 400 + Math.cos(angle) * radius}
                                {@const y = 300 + Math.sin(angle) * radius}
                                
                                <!-- Connection Line -->
                                <line 
                                    x1="400" 
                                    y1="300" 
                                    x2={x} 
                                    y2={y} 
                                    stroke={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '#10B981' : '#6B7280'}
                                    stroke-width={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '3' : '2'}
                                    stroke-dasharray={(holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? 'none' : '5,5'}
                                    opacity="0.7"
                                    class="transition-all duration-300"
                                />
                            {/each}
                            
                            <!-- Current Holon (Center) -->
                            <g class="current-holon">
                                <circle 
                                    cx="400" 
                                    cy="300" 
                                    r="40" 
                                    fill="#3B82F6" 
                                    stroke="#60A5FA" 
                                    stroke-width="3"
                                    class="cursor-pointer hover:fill-blue-500 transition-all duration-300"
                                    on:click={() => navigateToHolon(currentHolonId)}
                                    on:keydown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            navigateToHolon(currentHolonId);
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                    aria-label="Navigate to current holon"
                                    style="filter: url(#glow)"
                                />
                                <text 
                                    x="400" 
                                    y="300" 
                                    text-anchor="middle" 
                                    dy="0.35em" 
                                    fill="white" 
                                    font-size="18" 
                                    font-weight="bold"
                                    class="pointer-events-none"
                                >
                                    ⬢
                                </text>
                                <text 
                                    x="400" 
                                    y="350" 
                                    text-anchor="middle" 
                                    fill="white" 
                                    font-size="12" 
                                    font-weight="600"
                                    class="pointer-events-none"
                                >
                                    Current
                                </text>
                            </g>
                            
                            <!-- Federated Holons -->
                            {#each federatedHolons as holon, index}
                                {@const angle = (index / federatedHolons.length) * 2 * Math.PI - Math.PI/2}
                                {@const radius = 200}
                                {@const x = 400 + Math.cos(angle) * radius}
                                {@const y = 300 + Math.sin(angle) * radius}
                                {@const nodeColor = (holon.lensConfig.inbound.length > 0 && holon.lensConfig.outbound.length > 0) ? '#10B981' : '#6B7280'}
                                
                                <g class="federated-holon">
                                    <!-- Main Node -->
                                    <circle 
                                        cx={x} 
                                        cy={y} 
                                        r="30" 
                                        fill={nodeColor}
                                        stroke="white"
                                        stroke-width="2"
                                        class="cursor-pointer hover:r-35 transition-all duration-300"
                                        on:click={() => navigateToHolon(holon.id)}
                                        on:keydown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                navigateToHolon(holon.id);
                                            }
                                        }}
                                        role="button"
                                        tabindex="0"
                                        aria-label="Navigate to {holon.name || holon.id}"
                                        style="filter: url(#glow)"
                                    />
                                    
                                    <!-- Avatar Letter -->
                                    <text 
                                        x={x} 
                                        y={y} 
                                        text-anchor="middle" 
                                        dy="0.35em" 
                                        fill="white" 
                                        font-size="16" 
                                        font-weight="bold"
                                        class="pointer-events-none"
                                    >
                                        {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                                    </text>
                                    
                                    <!-- Status Indicator -->
                                    <circle 
                                        cx={x + 20} 
                                        cy={y - 20} 
                                        r="6" 
                                        fill={holon.status === 'connected' ? '#10B981' : holon.status === 'pending' ? '#F59E0B' : '#EF4444'}
                                        stroke="white"
                                        stroke-width="2"
                                        class="pointer-events-none"
                                    />
                                    
                                    <!-- Lens Count Badge -->
                                    {#if holon.lensConfig.inbound.length > 0}
                                        <circle
                                            cx={x - 20}
                                            cy={y + 20}
                                            r="8"
                                            fill="#3B82F6"
                                            stroke="white"
                                            stroke-width="1"
                                            class="pointer-events-none"
                                        />
                                        <text
                                            x={x - 20}
                                            y={y + 20}
                                            text-anchor="middle"
                                            dy="0.35em"
                                            fill="white"
                                            font-size="10"
                                            font-weight="bold"
                                            class="pointer-events-none"
                                        >
                                            {holon.lensConfig.inbound.length}
                                        </text>
                                    {/if}
                                </g>
                                
                                <!-- Holon Name Label -->
                                <text 
                                    x={x} 
                                    y={y + 50} 
                                    text-anchor="middle" 
                                    fill="white" 
                                    font-size="11" 
                                    font-weight="500"
                                    class="pointer-events-none"
                                >
                                    {holon.name || holon.id}
                                </text>
                            {/each}
                            
                            <!-- Legend -->
                            <g class="legend" transform="translate(20, 20)">
                                <rect x="0" y="0" width="180" height="120" fill="rgba(0,0,0,0.8)" stroke="#374151" stroke-width="1" rx="8"/>
                                <text x="10" y="20" fill="white" font-size="12" font-weight="bold">Network Legend</text>
                                
                                <circle cx="15" cy="40" r="4" fill="#10B981"/>
                                <text x="25" y="40" dy="0.35em" fill="white" font-size="10">Bidirectional</text>
                                
                                <circle cx="15" cy="60" r="4" fill="#6B7280"/>
                                <text x="25" y="60" dy="0.35em" fill="white" font-size="10">Notify Only</text>
                                
                                <circle cx="15" cy="80" r="4" fill="#10B981"/>
                                <text x="25" y="80" dy="0.35em" fill="white" font-size="10">Connected</text>
                                
                                <circle cx="15" cy="100" r="4" fill="#3B82F6"/>
                                <text x="25" y="100" dy="0.35em" fill="white" font-size="10">Lens Count</text>
                            </g>
                            
                            <!-- Stats -->
                            <g class="stats" transform="translate(600, 20)">
                                <rect x="0" y="0" width="160" height="80" fill="rgba(0,0,0,0.8)" stroke="#374151" stroke-width="1" rx="8"/>
                                <text x="10" y="20" fill="white" font-size="12" font-weight="bold">Network Stats</text>
                                
                                <text x="10" y="40" fill="#60A5FA" font-size="10">Connections:</text>
                                <text x="120" y="40" fill="white" font-size="10" font-weight="bold">{federatedHolons.length}</text>
                                
                                <text x="10" y="60" fill="#10B981" font-size="10">Active Lenses:</text>
                                <text x="120" y="60" fill="white" font-size="10" font-weight="bold">{activeLenses}</text>
                            </g>
                        </svg>
                    </div>
                    
                    {#if federatedHolons.length === 0}
                        <div class="text-center mt-6">
                            <div class="bg-gray-700 rounded-lg p-8 border border-gray-600">
                                <div class="text-6xl mb-4">🌐</div>
                                <h4 class="text-xl font-semibold text-white mb-2">No Network Connections</h4>
                                <p class="text-gray-400">Create your first federation to see the network visualization</p>
                            </div>
                        </div>
                    {/if}
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
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                closeDialog();
            }
        }}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div 
            class="bg-gray-800 rounded-xl p-6 w-full max-w-md"
            transition:fly={{ y: -50, duration: 300 }}
        >
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Federation</h2>
                <button 
                    on:click={closeDialog}
                    class="text-gray-400 hover:text-white transition-colors"
                    aria-label="Close dialog"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addFederation} class="space-y-4">
                <!-- Nostr Public Key Input -->
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
                            class="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg transition-colors flex items-center justify-center"
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

                <!-- OR divider -->
                <div class="relative">
                    <div class="absolute inset-0 flex items-center">
                        <div class="w-full border-t border-gray-600"></div>
                    </div>
                    <div class="relative flex justify-center text-sm">
                        <span class="px-2 bg-gray-800 text-gray-400">OR use Holon ID</span>
                    </div>
                </div>

                <!-- Holon ID Input (fallback) -->
                <div>
                    <label for="holonId" class="block text-sm font-medium text-gray-300 mb-2">
                        Holon ID (legacy)
                    </label>
                    <input
                        id="holonId"
                        type="text"
                        bind:value={newHolonId}
                        placeholder="Enter holon ID..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={!!newPartnerHexPubKey}
                    />
                    <p class="text-gray-500 text-xs mt-1">Use this for backward compatibility with non-Nostr holons</p>
                </div>

                <!-- Default Expiration Selection -->
                <div>
                    <p class="block text-sm font-medium text-gray-300 mb-2">
                        Default Capability Expiration
                    </p>
                    <ExpirationPicker
                        bind:selectedPreset={selectedExpiration}
                        bind:customDate={customExpirationDate}
                        showModal={false}
                    />
                </div>

                <div class="bg-blue-900/30 border border-blue-700 rounded-lg p-3">
                    <div class="flex items-start space-x-2">
                        <svg class="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <div class="text-sm text-blue-300">
                            <p class="font-medium mb-1">Federation with Capability Tokens</p>
                            <p>Using a Nostr public key enables per-lens capability tokens with configurable expiration. You can grant or revoke read/write access for each lens independently.</p>
                        </div>
                    </div>
                </div>

                <div class="flex space-x-3 pt-4">
                    <button
                        type="button"
                        on:click={closeDialog}
                        class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
                        disabled={saving}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                        disabled={saving || (!newPartnerHexPubKey && !newHolonId.trim())}
                    >
                        {#if saving}
                            <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                            </svg>
                        {/if}
                        <span>{saving ? 'Creating...' : 'Create Federation'}</span>
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
        on:keydown={(e) => {
            if (e.key === 'Escape') {
                showAddCustomLens = false;
            }
        }}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 200 }}
    >
        <div 
            class="bg-gray-800 rounded-xl p-6 w-full max-w-sm"
            transition:fly={{ y: -50, duration: 300 }}
        >
            <div class="flex items-center justify-between mb-6">
                <h2 class="text-xl font-semibold text-white">Add Custom Lens</h2>
                <button 
                    on:click={() => showAddCustomLens = false}
                    class="text-gray-400 hover:text-white transition-colors"
                    aria-label="Close custom lens dialog"
                >
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <form on:submit|preventDefault={addCustomLens} class="space-y-4">
                <div>
                    <label for="customLensName" class="block text-sm font-medium text-gray-300 mb-2">
                        Lens Name *
                    </label>
                    <input 
                        id="customLensName"
                        type="text" 
                        bind:value={newCustomLens}
                        placeholder="Enter lens name..."
                        class="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        required

                    />
                </div>

                <div class="bg-purple-900/30 border border-purple-700 rounded-lg p-3">
                    <div class="flex items-start space-x-2">
                        <svg class="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <div class="text-sm text-purple-300">
                            <p class="font-medium mb-1">Custom Lens</p>
                            <p>Add a custom lens type for federation. Use descriptive names like "Events", "Projects", etc.</p>
                        </div>
                    </div>
                </div>

                {#if customLenses.length > 0}
                    <div>
                        <h3 class="text-sm font-medium text-gray-300 mb-2">Custom Lenses</h3>
                        <div class="space-y-1">
                            {#each customLenses as lens}
                                <div class="flex items-center justify-between p-2 bg-gray-700 rounded text-sm">
                                    <span class="text-gray-300">{lens}</span>
                                    <button 
                                        type="button"
                                        on:click={() => removeCustomLens(lens)}
                                        class="text-red-400 hover:text-red-300 transition-colors"
                                        title="Remove custom lens"
                                        aria-label="Remove custom lens {lens}"
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <div class="flex space-x-3 pt-4">
                    <button
                        type="button"
                        on:click={() => showAddCustomLens = false}
                        class="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!newCustomLens.trim()}
                    >
                        Add Lens
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- QR Scanner Modal -->
<QRScanner
    bind:showScanner={showQRScanner}
    on:scan={handleQRScan}
    on:close={() => showQRScanner = false}
/>

<!-- Expiration Picker Modal for Lens Grant -->
<ExpirationPicker
    bind:selectedPreset={selectedExpiration}
    bind:customDate={customExpirationDate}
    showModal={showExpirationPicker}
    on:select={confirmLensGrant}
    on:cancel={cancelLensGrant}
/>