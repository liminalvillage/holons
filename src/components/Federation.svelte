<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, getContext } from "svelte";
    import { fade, slide, fly } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { goto } from "$app/navigation";
    import type { HoloSphere } from "holosphere";
    import { ID, walletAddress } from "../dashboard/store";
    import { nostrPrivateKey } from "../lib/stores/nostr";
    import { fetchHolonName } from "../utils/holonNames";
    import { addVisitedHolon } from "../utils/localStorage";
    import QRScanner from "./QRScanner.svelte";
    import ExpirationPicker from "./ExpirationPicker.svelte";
    import {
        type LensCapabilityToken,
        type ExpirationPreset,
        type Direction,
        parseNpubOrHex,
        hexToNpub,
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
        timestamp: number;
    }

    interface FederatedHolon {
        id: string;
        name: string;
        pubKey?: string;  // Nostr public key (hex format)
        npub?: string;    // Nostr public key (npub format)
        status: 'connected' | 'pending' | 'error';
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

    onMount(() => {
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
                } else {
                    federationInfo = null;
                    federatedHolons = [];
                    loading = false;
                }
            }
        });
    });

    onDestroy(() => {
        if (idStoreUnsubscribe) {
            idStoreUnsubscribe();
        }
        if (federationSubscription) {
            federationSubscription.unsubscribe();
        }
    });

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

                    // Get actual holon name from settings
                    const holonName = await getHolonName(holonId);

                    // Check if holonId is a valid Nostr public key (hex format)
                    let pubKey: string | undefined;
                    let npub: string | undefined;
                    if (/^[0-9a-fA-F]{64}$/.test(holonId)) {
                        pubKey = holonId;
                        npub = hexToNpub(holonId);
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

                    // Load capabilities for this partner if they have a pubKey
                    if (pubKey) {
                        loadPartnerCapabilities(pubKey);
                    }
                }

                // Assign to trigger reactivity in Svelte 5
                federatedHolons = tempHolons;

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
            // Create federation with default lens config (empty arrays)
            const success = await holosphere.federateHolon(
                currentHolonId,
                federationTarget,
                {
                    lensConfig: { inbound: [], outbound: [] }
                }
            );

            if (success) {
                showAddDialog = false;
                newHolonId = '';
                newHolonName = '';
                newPartnerNpub = '';
                newPartnerHexPubKey = '';
                npubValidationError = '';
                selectedExpiration = 'permanent';
                customExpirationDate = '';

                // Wait a bit for GunDB to propagate the changes
                await new Promise(resolve => setTimeout(resolve, 300));

                // Force reload of federation data
                await loadFederationData();
                showSuccess('Federation created successfully');
            } else {
                error = 'Failed to create federation';
            }
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
            // Get settings for this holon
            const settings = await holosphere.get(holonId, 'settings', holonId);
            if (settings && settings.name) {
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

        const result = parseNpubOrHex(newPartnerNpub);
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
            await holosphere.writeGlobal('lens_capabilities', capabilityRecord);

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
            const existing = await holosphere.getGlobal('lens_capabilities', capabilityId);
            if (existing) {
                existing.revokedAt = Date.now();
                await holosphere.writeGlobal('lens_capabilities', existing);
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
        if (!holosphere || !pubKey) return;

        try {
            // Load capabilities from global table
            const allCaps = await holosphere.getAllGlobal('lens_capabilities');
            if (!allCaps) return;

            const issuerPubKey = holosphere.client?.publicKey;
            const caps: Record<string, { inbound?: LensCapabilityToken; outbound?: LensCapabilityToken }> = {};

            for (const cap of Object.values(allCaps) as LensCapabilityToken[]) {
                if (cap.issuerPubKey === issuerPubKey &&
                    cap.recipientPubKey === pubKey &&
                    !cap.revokedAt &&
                    isCapabilityValid(cap)) {
                    if (!caps[cap.lensName]) {
                        caps[cap.lensName] = {};
                    }
                    caps[cap.lensName][cap.direction] = cap;
                }
            }

            partnerCapabilities.set(pubKey, caps);
            partnerCapabilities = new Map(partnerCapabilities);
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

    $: totalFederations = federatedHolons.length;
    $: activeLenses = federatedHolons.reduce((acc, holon) => {
        if (holon && holon.lensConfig && Array.isArray(holon.lensConfig.inbound)) {
            holon.lensConfig.inbound.forEach(lens => acc.add(lens));
        }
        return acc;
    }, new Set<string>()).size;
</script>

<div class="space-y-8">
    <!-- Header Section -->
    <div class="bg-gradient-to-r from-gray-800 to-gray-700 py-8 px-8 rounded-3xl shadow-2xl">
        <div class="flex flex-col md:flex-row justify-between items-center">
            <div class="text-center md:text-left mb-4 md:mb-0">
                <h1 class="text-4xl font-bold text-white mb-2">Federation Configuration</h1>
                <p class="text-gray-300 text-lg">Manage data sharing between holons</p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <button 
                    on:click={() => showNetworkView = !showNetworkView}
                    class="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm"
                    title="Toggle network view"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zM13 12a1 1 0 11-2 0 1 1 0 012 0zM20 12a1 1 0 11-2 0 1 1 0 012 0z"></path>
                    </svg>
                    <span>{showNetworkView ? 'List View' : 'Network View'}</span>
                </button>
                <button 
                    on:click={() => showAddCustomLens = true}
                    class="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg transition-colors flex items-center space-x-2 text-sm"
                    title="Add custom lens"
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Lens</span>
                </button>
                <button 
                    on:click={() => showAddDialog = true}
                    class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors flex items-center space-x-2"
                    disabled={!currentHolonId || saving}
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Add Federation</span>
                </button>
            </div>
        </div>
    </div>

    <!-- Main Content Container -->
    <div class="bg-gray-800 rounded-3xl shadow-xl min-h-[600px]">
        <div class="p-8">

            <!-- Status Messages -->
            {#if error}
                <div class="bg-red-900/50 border border-red-700 rounded-lg p-4 mb-6" transition:slide>
                    <div class="flex items-center space-x-2">
                        <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-red-300">{error}</span>
                    </div>
                </div>
            {/if}

            {#if success}
                <div class="bg-green-900/50 border border-green-700 rounded-lg p-4 mb-6" transition:slide>
                    <div class="flex items-center space-x-2">
                        <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <span class="text-green-300">{success}</span>
                    </div>
                </div>
            {/if}

            <!-- Stats Section -->
            {#if !loading && currentHolonId && federatedHolons.length > 0}
                <div class="grid grid-cols-2 gap-4 mb-8">
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{totalFederations}</div>
                        <div class="text-sm text-gray-400">Federations</div>
                    </div>
                    <div class="bg-gray-700/50 rounded-2xl p-4 text-center">
                        <div class="text-2xl font-bold text-white mb-1">{activeLenses}</div>
                        <div class="text-sm text-gray-400">Active Lenses</div>
                    </div>
                </div>
            {/if}

        {#if loading}
            <!-- Loading State -->
            <div class="flex items-center justify-center py-20">
                <div class="text-center">
                    <svg class="animate-spin h-8 w-8 text-blue-400 mx-auto mb-4" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    <p class="text-gray-400">Loading federation data...</p>
                </div>
            </div>
        {:else if !currentHolonId}
            <!-- No Holon Selected -->
            <div class="text-center py-20">
                <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
                </svg>
                <h3 class="text-xl font-semibold text-gray-300 mb-2">No Holon Selected</h3>
                <p class="text-gray-500">Please select a holon to configure federation settings.</p>
            </div>
        {:else if federatedHolons.length === 0}
            <!-- Empty State -->
            <div class="text-center py-20">
                <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"></path>
                </svg>
                <h3 class="text-xl font-semibold text-gray-300 mb-2">No Federations Configured</h3>
                <p class="text-gray-500 mb-6">Start by creating your first federation to share data with other holons.</p>
                <button 
                    on:click={() => showAddDialog = true}
                    class="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg transition-colors inline-flex items-center space-x-2"
                >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
                    </svg>
                    <span>Create Federation</span>
                </button>
            </div>
        {:else}
            {#if !showNetworkView}
                <!-- Federation List -->
                <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                    {#each federatedHolons as holon (holon.id)}
                        <div 
                            class="bg-gray-800/50 rounded-xl p-6 border border-gray-700/50 hover:border-gray-600/50 transition-all duration-300 hover:shadow-xl hover:bg-gray-800/70 backdrop-blur-sm"
                            animate:flip={{ duration: 300 }}
                            in:fly={{ y: 20, duration: 300 }}
                            out:fly={{ y: -20, duration: 200 }}
                        >
                        <!-- Holon Header -->
                        <div class="flex items-center justify-between mb-6">
                            <div class="flex items-center space-x-3">
                                <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                    {(holon.name && typeof holon.name === 'string') ? holon.name.charAt(0).toUpperCase() : '?'}
                                </div>
                                <div class="flex-1 min-w-0">
                                    <button
                                        on:click={() => navigateToHolon(holon.id)}
                                        class="font-semibold text-white truncate hover:text-blue-400 transition-colors text-left block w-full"
                                        title="Navigate to {holon.name || holon.id}"
                                    >
                                        {holon.name || holon.id}
                                    </button>
                                    <div class="flex items-center gap-2 mt-1">
                                        <div class={`w-2 h-2 rounded-full ${getStatusColor(holon.status).replace('text-', 'bg-')} shadow-sm flex-shrink-0`}></div>
                                        <span class="text-xs text-gray-400 capitalize font-medium flex-shrink-0">{holon.status}</span>
                                    </div>
                                    {#if holon.npub}
                                        <div class="flex items-center gap-2 mt-1">
                                            <span class="text-xs text-purple-400 font-mono" title="Click to copy full npub">
                                                {shortenNpub(holon.npub)}
                                            </span>
                                            <button
                                                class="text-gray-500 hover:text-purple-400 transition-colors"
                                                title="Copy npub"
                                                on:click|stopPropagation={() => {
                                                    navigator.clipboard.writeText(holon.npub || '');
                                                    showSuccess('Copied npub to clipboard');
                                                }}
                                            >
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
                                                </svg>
                                            </button>
                                        </div>
                                    {/if}
                                </div>
                            </div>
                            <div class="flex items-center space-x-1">
                                <button 
                                    on:click={() => { }}
                                    class="text-gray-400 hover:text-blue-400 transition-colors p-2 rounded-lg hover:bg-blue-900/20"
                                    title="Configure Lenses"
                                    aria-label="Configure lenses for {holon.name || holon.id}"
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    </svg>
                                </button>
                                <button 
                                    on:click={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeFederation(holon.id);
                                    }}
                                    class="text-gray-400 hover:text-red-400 transition-colors p-2 rounded-lg hover:bg-red-900/20"
                                    title="Remove Federation"
                                    aria-label="Remove federation with {holon.name || holon.id}"
                                    disabled={saving}
                                >
                                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Lens Configuration Table -->
                        <div class="mt-4">
                            <h4 class="text-sm font-medium text-gray-300 mb-3 flex items-center">
                                <i class="fas fa-cog mr-2 text-purple-400"></i>
                                Lens Configuration
                            </h4>
                            
                            {#if availableLenses.length > 0}
                                <div class="bg-gray-700/30 rounded-lg border border-gray-600/50 overflow-hidden">
                                    <table class="w-full">
                                        <thead>
                                            <tr class="border-b border-gray-600/50">
                                                <th class="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    Lens
                                                </th>
                                                <th class="text-center py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    <div class="flex items-center justify-center space-x-1">
                                                        <i class="fas fa-download text-blue-400 text-xs"></i>
                                                        <span>Inbound</span>
                                                    </div>
                                                </th>
                                                <th class="text-center py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">
                                                    <div class="flex items-center justify-center space-x-1">
                                                        <i class="fas fa-upload text-green-400 text-xs"></i>
                                                        <span>Outbound</span>
                                                    </div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-gray-600/30">
                                            {#each availableLenses as lens}
                                                {@const isInbound = isLensInArray(lens, holon.lensConfig.inbound)}
                                                {@const isOutbound = isLensInArray(lens, holon.lensConfig.outbound)}
                                                {@const inboundCap = getCapabilityForLens(holon.pubKey, lens, 'inbound')}
                                                {@const outboundCap = getCapabilityForLens(holon.pubKey, lens, 'outbound')}
                                                <tr class="hover:bg-gray-700/20 transition-colors">
                                                    <td class="py-3 px-4">
                                                        <div class="flex items-center space-x-2">
                                                            <span class="text-lg">{getLensIcon(lens)}</span>
                                                            <span class="text-sm font-medium text-gray-300 capitalize">{lens}</span>
                                                        </div>
                                                    </td>
                                                    <td class="py-3 px-4 text-center">
                                                        <div class="flex items-center justify-center space-x-2">
                                                            <button
                                                                class="w-6 h-6 flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
                                                                disabled={saving}
                                                                aria-pressed={isInbound}
                                                                title={isInbound ? 'Revoke read access' : 'Grant read access'}
                                                                on:click={async (e) => {
                                                                    e.preventDefault();
                                                                    if (saving) return;
                                                                    await toggleLensCapability(holon.id, lens, 'inbound', isInbound);
                                                                }}
                                                            >
                                                                {#if isInbound}
                                                                    <div class="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                                                                        <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                                                        </svg>
                                                                    </div>
                                                                {:else}
                                                                    <div class="w-5 h-5 border border-gray-500 rounded-full bg-gray-700/50"></div>
                                                                {/if}
                                                            </button>
                                                            <!-- Capability status indicator for inbound -->
                                                            {#if inboundCap}
                                                                <span
                                                                    class="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400"
                                                                    title={getExpirationDescription(inboundCap.expiresAt)}
                                                                >
                                                                    {inboundCap.expiresAt ? formatExpiration(inboundCap.expiresAt) : '∞'}
                                                                </span>
                                                            {:else if isInbound && holon.pubKey}
                                                                <span class="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400" title="No capability token">
                                                                    !
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    </td>
                                                    <td class="py-3 px-4 text-center">
                                                        <div class="flex items-center justify-center space-x-2">
                                                            <button
                                                                class="w-6 h-6 flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 transition"
                                                                disabled={saving}
                                                                aria-pressed={isOutbound}
                                                                title={isOutbound ? 'Revoke write access' : 'Grant write access'}
                                                                on:click={async (e) => {
                                                                    e.preventDefault();
                                                                    if (saving) return;
                                                                    await toggleLensCapability(holon.id, lens, 'outbound', isOutbound);
                                                                }}
                                                            >
                                                                {#if isOutbound}
                                                                    <div class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                                                                        <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                                                                        </svg>
                                                                    </div>
                                                                {:else}
                                                                    <div class="w-5 h-5 border border-gray-500 rounded-full bg-gray-700/50"></div>
                                                                {/if}
                                                            </button>
                                                            <!-- Capability status indicator for outbound -->
                                                            {#if outboundCap}
                                                                <span
                                                                    class="text-xs px-1.5 py-0.5 rounded bg-green-900/50 text-green-400"
                                                                    title={getExpirationDescription(outboundCap.expiresAt)}
                                                                >
                                                                    {outboundCap.expiresAt ? formatExpiration(outboundCap.expiresAt) : '∞'}
                                                                </span>
                                                            {:else if isOutbound && holon.pubKey}
                                                                <span class="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400" title="No capability token">
                                                                    !
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    </td>
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {:else}
                                <div class="flex items-center justify-center py-6 px-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
                                    <span class="text-xs text-gray-500 flex items-center">
                                        <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                        </svg>
                                        No lenses available
                                    </span>
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
                    <label class="block text-sm font-medium text-gray-300 mb-2">
                        Default Capability Expiration
                    </label>
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