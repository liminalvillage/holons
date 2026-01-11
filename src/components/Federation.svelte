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
    import { shortenNpub } from "../lib/capabilities/lensCapability";
    import {
        pendingFederationRequests,
        incomingRequests,
        createIncomingRequest,
        createOutgoingRequest,
        type PendingRequest
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
        npub?: string;
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

    // QR Scanner
    let showQRScanner = false;

    // Track expanded cards
    let expandedCards: Set<string> = new Set();

    // Subscriptions
    let idUnsubscribe: (() => void) | undefined;
    let federationSubscription: any = null;
    let dmUnsubscribe: (() => void) | undefined;

    onMount(() => {
        pendingFederationRequests.init();

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

                    const name = federationInfo.partnerNames?.[holonId] || holonId;
                    let pubKey: string | undefined;
                    let npub: string | undefined;

                    if (/^[0-9a-fA-F]{64}$/.test(holonId)) {
                        pubKey = holonId;
                        npub = nostrUtils.hexToNpub(holonId);
                    }

                    tempHolons.push({ id: holonId, name, pubKey, npub, status: 'connected', lensConfig });
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
                const result = await handshake.initiateFederationHandshake(holosphere, $nostrPrivateKey, {
                    partnerPubKey: newPartnerHexPubKey,
                    holonId: currentHolonId,
                    holonName: ourHolonName,
                    lensConfig: { inbound: [], outbound: [] }
                });

                if (result.success && result.requestId) {
                    const outgoing = createOutgoingRequest(
                        result.requestId, $nostrPublicKey, ourNpub,
                        currentHolonId, ourHolonName,
                        newPartnerHexPubKey, newPartnerNpub || nostrUtils.hexToNpub(newPartnerHexPubKey),
                        { inbound: [], outbound: [] }, []
                    );
                    pendingFederationRequests.add(outgoing);
                    showSuccess('Federation request sent');
                } else {
                    error = result.error || 'Failed to send request';
                    return;
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
        if (!holosphere || !currentHolonId) return;

        // Optimistic update - immediately update local state
        const idx = federatedHolons.findIndex(h => h.id === holonId);
        if (idx >= 0) {
            federatedHolons[idx] = {
                ...federatedHolons[idx],
                lensConfig: { inbound, outbound }
            };
            federatedHolons = [...federatedHolons];
        }

        try {
            await holosphere.federateHolon(currentHolonId, holonId, {
                lensConfig: { inbound, outbound }
            });
            // No reload needed - optimistic update already applied
        } catch (err) {
            console.error('Lens update error:', err);
            // Revert on error
            await loadFederationData();
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

    function closeAddDialog() {
        showAddDialog = false;
        newPartnerNpub = '';
        newPartnerHexPubKey = '';
        npubError = '';
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
        try {
            dmUnsubscribe = handshake.subscribeToFederationDMs(holosphere, $nostrPrivateKey, $nostrPublicKey, {
                onRequest: handleIncomingRequest,
                onResponse: handleFederationResponse
            });
        } catch (err) {
            console.error('DM subscription error:', err);
        }
    }

    async function handleIncomingRequest(request: any, senderPubKey: string) {
        if (pendingFederationRequests.hasPendingForPubKey(senderPubKey)) return;
        const pending = createIncomingRequest(
            request.requestId, senderPubKey, request.senderNpub,
            request.senderHolonId, request.senderHolonName,
            request.lensConfig, request.capabilities, request.message
        );
        pendingFederationRequests.add(pending);
        showSuccess(`Request from ${request.senderHolonName}`);
    }

    async function handleFederationResponse(response: any, senderPubKey: string) {
        const request = pendingFederationRequests.getById(response.requestId);
        if (!request) return;

        if (response.status === 'accepted') {
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
        if (!request || !holosphere || !$nostrPrivateKey || !currentHolonId) return;

        saving = true;
        try {
            const ourName = await getHolonName(currentHolonId);
            await handshake.acceptFederationRequest(holosphere, $nostrPrivateKey, request.senderPubKey, {
                requestId,
                holonId: currentHolonId,
                holonName: ourName,
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
            await handshake.rejectFederationRequest(holosphere, $nostrPrivateKey, request.senderPubKey, {
                requestId, reason: 'Declined'
            });
            pendingFederationRequests.updateStatus(requestId, 'rejected');
            showSuccess('Request declined');
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to decline';
        } finally {
            saving = false;
        }
    }

    // Stats
    $: totalPartners = federatedHolons.length;
    $: connectedCount = federatedHolons.filter(h => h.status === 'connected').length;
    $: pendingCount = $incomingRequests.length;
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
                    <strong>{pendingCount}</strong> pending
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

    <!-- Pending requests -->
    {#if $incomingRequests.length > 0}
        <div class="federation__section" transition:slide>
            <h3 class="federation__section-title">
                Pending Requests
                <span class="federation__badge">{$incomingRequests.length}</span>
            </h3>
            <div class="federation__requests">
                {#each $incomingRequests as request (request.id)}
                    <div class="federation__request" transition:slide>
                        <div class="federation__request-info">
                            <div class="federation__request-avatar">
                                {request.senderHolonName?.charAt(0)?.toUpperCase() || '?'}
                            </div>
                            <div class="federation__request-details">
                                <span class="federation__request-name">{request.senderHolonName}</span>
                                <span class="federation__request-npub">{shortenNpub(request.senderNpub)}</span>
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

    /* Requests */
    .federation__requests {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2, 0.5rem);
    }

    .federation__request {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-3, 0.75rem);
        padding: var(--spacing-3, 0.75rem);
        background: var(--color-bg-primary, #111827);
        border-radius: var(--radius-md, 0.375rem);
        border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .federation__request-info {
        display: flex;
        align-items: center;
        gap: var(--spacing-3, 0.75rem);
    }

    .federation__request-avatar {
        width: 36px;
        height: 36px;
        border-radius: var(--radius-md, 0.375rem);
        background: linear-gradient(135deg, #f59e0b, #d97706);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: bold;
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
</style>
