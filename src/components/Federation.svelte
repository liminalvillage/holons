<script lang="ts">
    import { onMount, onDestroy, getContext } from "svelte";
    import { fade, fly, slide } from "svelte/transition";
    import { flip } from "svelte/animate";
    import { goto } from "$app/navigation";
    import type { HoloSphere } from "holosphere";
    import { List, Globe, Trash2, X, Loader, ArrowDown, ArrowUp, AlertCircle, CheckCircle } from "svelte-feathers";
    import { ID, walletAddress } from "../dashboard/store";
    import { addVisitedHolon } from "../utils/localStorage";
    import {
        nameMap,
        resolvedName,
        resolveName,
        forceRefreshHolonName
    } from "$lib/stores/nameResolver";
    import TitleBar from "./shared/TitleBar.svelte";
    import FeatureToolbar from "./shared/FeatureToolbar.svelte";

    const holosphere = getContext("holosphere") as HoloSphere;

    $: holonName = resolvedName($ID ?? undefined, $nameMap, null, 'Federation');

    const ALL_LENSES = [
        'quests', 'offers', 'tags', 'expenses',
        'announcements', 'users', 'shopping', 'recurring',
        'library', 'roles', 'checklists'
    ];

    const LENS_ICONS: Record<string, string> = {
        quests: '🎯',
        offers: '🤝',
        tags: '🏷️',
        expenses: '💰',
        announcements: '📢',
        users: '👥',
        shopping: '🛒',
        recurring: '🔄',
        library: '📚',
        roles: '🎭',
        checklists: '✅'
    };

    function lensIcon(lens: string): string {
        return LENS_ICONS[lens.toLowerCase()] || '📦';
    }

    function normalizeLens(name: string): string {
        return name.toLowerCase();
    }

    function hasLens(lens: string, list: string[]): boolean {
        const n = normalizeLens(lens);
        return list.some(l => normalizeLens(l) === n);
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
        partnerNames?: Record<string, string>;
        timestamp: number;
    }

    interface FederatedHolon {
        id: string;
        name: string;
        bidirectional: boolean;
        lensConfig: { inbound: string[]; outbound: string[] };
    }

    let currentHolonId = '';
    let federationInfo: FederationInfo | null = null;
    let federatedHolons: FederatedHolon[] = [];
    let loading = true;
    let saving = false;
    let showAddDialog = false;
    let newHolonId = '';
    let searchQuery = '';
    let viewMode: 'list' | 'network' = 'list';

    let toast: { kind: 'success' | 'error'; message: string } | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    let idStoreUnsubscribe: (() => void) | undefined;
    let federationSubscription: { unsubscribe: () => void } | null = null;

    onMount(() => {
        idStoreUnsubscribe = ID.subscribe(async (newId) => {
            if ((newId || '') !== currentHolonId) {
                federationSubscription?.unsubscribe();
                federationSubscription = null;

                currentHolonId = newId || '';
                if (currentHolonId) {
                    await loadFederationData();
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
        idStoreUnsubscribe?.();
        federationSubscription?.unsubscribe();
        if (toastTimer) clearTimeout(toastTimer);
    });

    async function subscribeFederationChanges() {
        if (!holosphere || !currentHolonId) return;
        try {
            // Federation lives in the global `federation` table keyed by holon ID,
            // not the per-holon `federation` lens — must use subscribeGlobal so the
            // initial cache hit AND subsequent updates both refresh the UI.
            federationSubscription = await holosphere.subscribeGlobal(
                'federation',
                currentHolonId,
                async () => loadFederationData()
            );
        } catch (err) {
            console.warn('Failed to subscribe to federation changes:', err);
        }
    }

    async function loadFederationData() {
        if (!holosphere || !currentHolonId) return;
        loading = true;
        try {
            federationInfo = await holosphere.getFederation(currentHolonId);

            if (!federationInfo) {
                federatedHolons = [];
                return;
            }

            const seen = new Set<string>();
            const result: FederatedHolon[] = [];
            const inboundSet  = new Set(federationInfo.inbound  || []);
            const outboundSet = new Set(federationInfo.outbound || []);

            const pushHolon = async (holonId: string) => {
                if (seen.has(holonId)) return;
                seen.add(holonId);
                const cfg = federationInfo!.lensConfig?.[holonId] ?? { inbound: [], outbound: [] };
                const lensConfig = { inbound: cfg.inbound ?? [], outbound: cfg.outbound ?? [] };
                const bidirectional = inboundSet.has(holonId) && outboundSet.has(holonId);
                let name = federationInfo!.partnerNames?.[holonId] ?? holonId;
                try {
                    name = await forceRefreshHolonName(holosphere, holonId);
                } catch {
                    /* fall back to id / partnerName */
                }
                result.push({ id: holonId, name, bidirectional, lensConfig });
                resolveName(holonId);
            };

            // `federated` is the canonical partner list; iterate it to render one card per partner.
            for (const id of federationInfo.federated || []) {
                await pushHolon(id);
            }

            federatedHolons = result;
            setTimeout(() => repairLensConfigs(), 100);
        } catch (err) {
            console.error('Federation load error:', err);
            showToast('error', err instanceof Error ? err.message : 'Failed to load federation data');
        } finally {
            loading = false;
        }
    }

    async function addFederation() {
        const target = newHolonId.trim();
        if (!target || !holosphere || !currentHolonId) return;
        if (target === currentHolonId) {
            showToast('error', 'Cannot federate a holon with itself');
            return;
        }
        if (federatedHolons.some(h => h.id === target)) {
            showToast('error', 'Already federated');
            return;
        }

        saving = true;
        try {
            const ok = await holosphere.federate(
                currentHolonId, target, null, null, true,
                { inbound: [], outbound: [] }
            );
            if (ok) {
                showAddDialog = false;
                newHolonId = '';
                await new Promise(r => setTimeout(r, 300));
                await loadFederationData();
                showToast('success', 'Federation created');
            } else {
                showToast('error', 'Failed to create federation');
            }
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Failed to create federation');
        } finally {
            saving = false;
        }
    }

    async function removeFederation(holonId: string) {
        if (!holosphere || !currentHolonId) return;
        saving = true;
        try {
            const ok = await holosphere.unfederateHolon(currentHolonId, holonId);
            if (ok) {
                await new Promise(r => setTimeout(r, 300));
                await loadFederationData();
                showToast('success', 'Federation removed');
            } else {
                showToast('error', 'Failed to remove federation');
            }
        } catch (err) {
            showToast('error', err instanceof Error ? err.message : 'Failed to remove federation');
        } finally {
            saving = false;
        }
    }

    async function updateLensConfig(holonId: string, inbound: string[], outbound: string[]) {
        if (!holosphere || !currentHolonId) return;
        saving = true;
        try {
            const ok = await holosphere.federate(
                currentHolonId, holonId, null, null, true,
                { inbound, outbound }
            );
            if (ok) {
                await new Promise(r => setTimeout(r, 300));
                await loadFederationData();
            }
        } catch (err) {
            console.error('Lens config update error:', err);
            showToast('error', 'Failed to update lens');
        } finally {
            saving = false;
        }
    }

    async function toggleInboundLens(holon: FederatedHolon, lens: string) {
        if (saving) return;
        const isOn = hasLens(lens, holon.lensConfig.inbound);
        const next = isOn
            ? holon.lensConfig.inbound.filter(l => normalizeLens(l) !== normalizeLens(lens))
            : [...holon.lensConfig.inbound, normalizeLens(lens)];
        await updateLensConfig(holon.id, next, holon.lensConfig.outbound);
    }

    async function toggleOutboundLens(holon: FederatedHolon, lens: string) {
        if (saving) return;
        const isOn = hasLens(lens, holon.lensConfig.outbound);
        const next = isOn
            ? holon.lensConfig.outbound.filter(l => normalizeLens(l) !== normalizeLens(lens))
            : [...holon.lensConfig.outbound, normalizeLens(lens)];
        await updateLensConfig(holon.id, holon.lensConfig.inbound, next);
    }

    async function repairLensConfigs() {
        if (!federatedHolons.length) return;
        let dirty = false;
        for (let i = 0; i < federatedHolons.length; i++) {
            const h = federatedHolons[i];
            if (!h.lensConfig.inbound.length && !h.lensConfig.outbound.length) {
                try {
                    const refreshed = await holosphere.getFederatedConfig(currentHolonId, h.id);
                    if (refreshed) {
                        federatedHolons[i].lensConfig = refreshed;
                        dirty = true;
                    }
                } catch {
                    /* skip */
                }
            }
        }
        if (dirty) federatedHolons = [...federatedHolons];
    }

    function showToast(kind: 'success' | 'error', message: string) {
        toast = { kind, message };
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (toast = null), 3000);
    }

    function closeAddDialog() {
        showAddDialog = false;
        newHolonId = '';
    }

    function navigateToHolon(holonId: string) {
        ID.set(holonId);
        if ($walletAddress) {
            forceRefreshHolonName(holosphere, holonId)
                .then(name => addVisitedHolon($walletAddress, holonId, name, 'federation'))
                .catch(() => { /* non-fatal */ });
        }
        goto(`/${holonId}/dashboard`);
    }

    function displayNameOf(h: FederatedHolon): string {
        return $nameMap[h.id] || h.name || h.id;
    }

    $: filteredHolons = (() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return federatedHolons;
        return federatedHolons.filter(h => {
            const name = displayNameOf(h).toLowerCase();
            return name.includes(q) || h.id.toLowerCase().includes(q);
        });
    })();

    $: totalFederations = federatedHolons.length;
    $: activeLenses = federatedHolons.reduce((acc, h) => {
        h.lensConfig.inbound.forEach(l => acc.add(normalizeLens(l)));
        h.lensConfig.outbound.forEach(l => acc.add(normalizeLens(l)));
        return acc;
    }, new Set<string>()).size;
</script>

<TitleBar title="Federation" holonName={holonName} />

<div class="federation-page">
    <FeatureToolbar
        onAdd={currentHolonId && !saving ? () => (showAddDialog = true) : null}
        addLabel="Add Federation"
        addDisabled={!currentHolonId || saving}
        bind:searchQuery
        searchPlaceholder="Search federations…"
        bind:viewMode
        viewModes={[
            { value: 'list', icon: List, label: 'List view' },
            { value: 'network', icon: Globe, label: 'Network view' }
        ]}
    />

    {#if !loading && currentHolonId && totalFederations > 0}
        <div class="stats">
            <span><strong>{totalFederations}</strong> federation{totalFederations === 1 ? '' : 's'}</span>
            <span class="stats__divider">·</span>
            <span><strong>{activeLenses}</strong> active lens{activeLenses === 1 ? '' : 'es'}</span>
        </div>
    {/if}

    {#if loading}
        <div class="empty-state">
            <Loader size="32" class="spin" />
            <p>Loading federation data…</p>
        </div>
    {:else if !currentHolonId}
        <div class="empty-state">
            <Globe size="40" />
            <h3>No holon selected</h3>
            <p>Pick a holon to configure federation.</p>
        </div>
    {:else if totalFederations === 0}
        <div class="empty-state">
            <Globe size="40" />
            <h3>No federations yet</h3>
            <p>Add another holon to start sharing data.</p>
            <button
                type="button"
                class="primary-btn"
                on:click={() => (showAddDialog = true)}
                aria-label="Add Federation"
                title="Add Federation"
            >
                Add Federation
            </button>
        </div>
    {:else if viewMode === 'list'}
        {#if filteredHolons.length === 0}
            <div class="empty-state empty-state--small">
                <p>No federations match "{searchQuery}"</p>
            </div>
        {:else}
            <div class="card-grid">
                {#each filteredHolons as holon (holon.id)}
                    {@const name = displayNameOf(holon)}
                    <div
                        class="fed-card"
                        animate:flip={{ duration: 300 }}
                        in:fly={{ y: 16, duration: 250 }}
                        out:fly={{ y: -16, duration: 150 }}
                    >
                        <header class="fed-card__head">
                            <div class="fed-card__avatar">
                                {(typeof name === 'string' && name.length > 0) ? name.charAt(0).toUpperCase() : '?'}
                            </div>
                            <div class="fed-card__title">
                                <button
                                    type="button"
                                    class="fed-card__name"
                                    on:click={() => navigateToHolon(holon.id)}
                                    title="Open {name}"
                                >
                                    {name}
                                </button>
                                <div class="fed-card__id" title={holon.id}>{holon.id}</div>
                            </div>
                            <button
                                type="button"
                                class="icon-btn icon-btn--danger"
                                on:click={() => removeFederation(holon.id)}
                                title="Remove federation"
                                aria-label="Remove federation with {name}"
                                disabled={saving}
                            >
                                <Trash2 size="16" />
                            </button>
                        </header>

                        <div class="lens-list">
                            <div class="lens-list__head">
                                <span>Lens</span>
                                <span class="lens-list__col" title="Inbound — receive from this holon">
                                    <ArrowDown size="12" /> In
                                </span>
                                <span class="lens-list__col" title="Outbound — send to this holon">
                                    <ArrowUp size="12" /> Out
                                </span>
                            </div>
                            {#each ALL_LENSES as lens}
                                {@const isIn = hasLens(lens, holon.lensConfig.inbound)}
                                {@const isOut = hasLens(lens, holon.lensConfig.outbound)}
                                <div class="lens-row">
                                    <span class="lens-row__name">
                                        <span class="lens-row__icon">{lensIcon(lens)}</span>
                                        <span>{lens}</span>
                                    </span>
                                    <button
                                        type="button"
                                        class="toggle"
                                        class:toggle--on={isIn}
                                        class:toggle--in={isIn}
                                        on:click={() => toggleInboundLens(holon, lens)}
                                        disabled={saving}
                                        aria-pressed={isIn}
                                        aria-label="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
                                        title="{isIn ? 'Disable' : 'Enable'} inbound {lens}"
                                    >
                                        <span class="toggle__dot"></span>
                                    </button>
                                    <button
                                        type="button"
                                        class="toggle"
                                        class:toggle--on={isOut}
                                        class:toggle--out={isOut}
                                        on:click={() => toggleOutboundLens(holon, lens)}
                                        disabled={saving}
                                        aria-pressed={isOut}
                                        aria-label="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
                                        title="{isOut ? 'Disable' : 'Enable'} outbound {lens}"
                                    >
                                        <span class="toggle__dot"></span>
                                    </button>
                                </div>
                            {/each}
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    {:else}
        <!-- Network View -->
        <div class="network-card">
            <svg viewBox="0 0 800 600" class="network-svg" aria-label="Federation network">
                <defs>
                    <pattern id="net-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#374151" stroke-width="0.5" opacity="0.3"/>
                    </pattern>
                    <filter id="net-glow">
                        <feGaussianBlur stdDeviation="3" result="b"/>
                        <feMerge>
                            <feMergeNode in="b"/>
                            <feMergeNode in="SourceGraphic"/>
                        </feMerge>
                    </filter>
                </defs>
                <rect width="100%" height="100%" fill="url(#net-grid)"/>

                {#each filteredHolons as holon, index}
                    {@const angle = (index / Math.max(filteredHolons.length, 1)) * 2 * Math.PI - Math.PI/2}
                    {@const x = 400 + Math.cos(angle) * 200}
                    {@const y = 300 + Math.sin(angle) * 200}
                    <line
                        x1="400" y1="300" x2={x} y2={y}
                        stroke={holon.bidirectional ? '#10B981' : '#6B7280'}
                        stroke-width={holon.bidirectional ? '3' : '2'}
                        stroke-dasharray={holon.bidirectional ? 'none' : '5,5'}
                        opacity="0.6"
                    />
                {/each}

                <g>
                    <circle cx="400" cy="300" r="38" fill="#4F46E5" stroke="#818CF8" stroke-width="3"
                        style="filter: url(#net-glow)" />
                    <text x="400" y="305" text-anchor="middle" fill="white" font-size="18" font-weight="bold">⬢</text>
                </g>

                {#each filteredHolons as holon, index}
                    {@const angle = (index / Math.max(filteredHolons.length, 1)) * 2 * Math.PI - Math.PI/2}
                    {@const x = 400 + Math.cos(angle) * 200}
                    {@const y = 300 + Math.sin(angle) * 200}
                    {@const name = displayNameOf(holon)}
                    {@const nodeColor = holon.bidirectional ? '#10B981' : '#6B7280'}
                    <g class="net-node" on:click={() => navigateToHolon(holon.id)}
                       on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && navigateToHolon(holon.id)}
                       role="button" tabindex="0" aria-label="Open {name}">
                        <circle cx={x} cy={y} r="28" fill={nodeColor} stroke="white" stroke-width="2"
                            style="filter: url(#net-glow)" />
                        <text x={x} y={y + 5} text-anchor="middle" fill="white" font-size="14" font-weight="bold" class="net-node__letter">
                            {(typeof name === 'string' && name.length > 0) ? name.charAt(0).toUpperCase() : '?'}
                        </text>
                        <text x={x} y={y + 48} text-anchor="middle" fill="#d1d5db" font-size="11" font-weight="500" class="net-node__label">
                            {name.length > 18 ? name.slice(0, 17) + '…' : name}
                        </text>
                    </g>
                {/each}

                <g class="net-legend" transform="translate(16, 16)">
                    <rect width="160" height="64" rx="8" fill="rgba(0,0,0,0.55)" stroke="#374151"/>
                    <circle cx="14" cy="22" r="4" fill="#10B981"/>
                    <text x="24" y="26" fill="#d1d5db" font-size="11">Bidirectional</text>
                    <circle cx="14" cy="46" r="4" fill="#6B7280"/>
                    <text x="24" y="50" fill="#d1d5db" font-size="11">Notify only</text>
                </g>
            </svg>
        </div>
    {/if}
</div>

<!-- Add Federation Dialog -->
{#if showAddDialog}
    <div
        class="modal-backdrop"
        on:click={(e) => e.target === e.currentTarget && closeAddDialog()}
        on:keydown={(e) => e.key === 'Escape' && closeAddDialog()}
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        transition:fade={{ duration: 150 }}
    >
        <div class="modal" transition:fly={{ y: -24, duration: 200 }}>
            <header class="modal__head">
                <h2>Add Federation</h2>
                <button type="button" class="icon-btn" on:click={closeAddDialog} aria-label="Close dialog">
                    <X size="18" />
                </button>
            </header>

            <form on:submit|preventDefault={addFederation} class="modal__body">
                <label class="field">
                    <span class="field__label">Holon ID</span>
                    <input
                        type="text"
                        bind:value={newHolonId}
                        placeholder="e.g. -1002352632800 or npub1…"
                        class="field__input"
                        required
                    />
                </label>

                <p class="modal__hint">
                    Creates a bidirectional link. Enable specific lenses (inbound/outbound) on the federation card after it's created.
                </p>

                <div class="modal__actions">
                    <button type="button" class="ghost-btn" on:click={closeAddDialog} disabled={saving}>
                        Cancel
                    </button>
                    <button type="submit" class="primary-btn" disabled={saving || !newHolonId.trim()}>
                        {#if saving}
                            <Loader size="14" class="spin" />
                            <span>Creating…</span>
                        {:else}
                            <span>Add Federation</span>
                        {/if}
                    </button>
                </div>
            </form>
        </div>
    </div>
{/if}

<!-- Toast -->
{#if toast}
    <div
        class="toast toast--{toast.kind}"
        transition:fly={{ y: -16, duration: 200 }}
        role="status"
        aria-live="polite"
    >
        {#if toast.kind === 'success'}
            <CheckCircle size="16" />
        {:else}
            <AlertCircle size="16" />
        {/if}
        <span>{toast.message}</span>
    </div>
{/if}

<style>
    .federation-page {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        max-width: 1400px;
        margin: 0 auto;
    }

    .stats {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0 0.25rem;
        color: #9ca3af;
        font-size: 0.875rem;
    }
    .stats strong {
        color: #fff;
        font-weight: 600;
    }
    .stats__divider {
        color: #4b5563;
    }

    /* ─── Empty / loading states ───────────────────────────── */
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
        padding: 4rem 1rem;
        text-align: center;
        color: #9ca3af;
    }
    .empty-state--small {
        padding: 2rem 1rem;
    }
    .empty-state h3 {
        margin: 0;
        font-size: 1.125rem;
        font-weight: 600;
        color: #e5e7eb;
    }
    .empty-state p {
        margin: 0;
        font-size: 0.875rem;
    }
    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ─── Buttons ──────────────────────────────────────────── */
    .primary-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 0.5rem;
        background: #4f46e5;
        color: #fff;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 150ms ease;
    }
    .primary-btn:hover:not(:disabled) {
        background: #4338ca;
    }
    .primary-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .ghost-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.5rem 1rem;
        background: transparent;
        border: 1px solid #4b5563;
        border-radius: 0.5rem;
        color: #d1d5db;
        font-size: 0.875rem;
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease;
    }
    .ghost-btn:hover:not(:disabled) {
        background: #374151;
        border-color: #6b7280;
    }
    .ghost-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: transparent;
        border: none;
        border-radius: 0.375rem;
        color: #9ca3af;
        cursor: pointer;
        transition: background-color 150ms ease, color 150ms ease;
    }
    .icon-btn:hover:not(:disabled) {
        background: #374151;
        color: #fff;
    }
    .icon-btn--danger:hover:not(:disabled) {
        background: rgba(127, 29, 29, 0.4);
        color: #fca5a5;
    }
    .icon-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ─── Federation cards ─────────────────────────────────── */
    .card-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
    }
    @media (min-width: 768px) {
        .card-grid { grid-template-columns: repeat(2, 1fr); }
    }
    @media (min-width: 1280px) {
        .card-grid { grid-template-columns: repeat(3, 1fr); }
    }

    .fed-card {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 0.75rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.875rem;
        transition: border-color 150ms ease;
    }
    .fed-card:hover {
        border-color: #4b5563;
    }

    .fed-card__head {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }
    .fed-card__avatar {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border-radius: 9999px;
        background: linear-gradient(135deg, #6366f1, #4338ca);
        color: #fff;
        font-weight: 700;
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(79, 70, 229, 0.25);
    }
    .fed-card__title {
        flex: 1;
        min-width: 0;
    }
    .fed-card__name {
        all: unset;
        cursor: pointer;
        display: block;
        font-weight: 600;
        color: #fff;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
    }
    .fed-card__name:hover {
        color: #818cf8;
    }
    .fed-card__id {
        font-size: 0.7rem;
        color: #6b7280;
        font-family: ui-monospace, SFMono-Regular, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 0.125rem;
    }

    /* ─── Lens list ────────────────────────────────────────── */
    .lens-list {
        background: #111827;
        border: 1px solid #374151;
        border-radius: 0.5rem;
        overflow: hidden;
    }
    .lens-list__head {
        display: grid;
        grid-template-columns: 1fr 56px 56px;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #9ca3af;
        background: rgba(255, 255, 255, 0.02);
        border-bottom: 1px solid #374151;
    }
    .lens-list__col {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.25rem;
    }

    .lens-row {
        display: grid;
        grid-template-columns: 1fr 56px 56px;
        gap: 0.5rem;
        align-items: center;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid rgba(55, 65, 81, 0.5);
    }
    .lens-row:last-child {
        border-bottom: none;
    }
    .lens-row__name {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.875rem;
        color: #e5e7eb;
        text-transform: capitalize;
    }
    .lens-row__icon {
        font-size: 1rem;
    }

    /* ─── Toggle pills ─────────────────────────────────────── */
    .toggle {
        position: relative;
        width: 36px;
        height: 20px;
        border: 1px solid #4b5563;
        border-radius: 9999px;
        background: #1f2937;
        cursor: pointer;
        padding: 0;
        margin: 0 auto;
        transition: background-color 150ms ease, border-color 150ms ease;
    }
    .toggle:hover:not(:disabled) {
        border-color: #6b7280;
    }
    .toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }
    .toggle__dot {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 9999px;
        background: #6b7280;
        transition: transform 150ms ease, background-color 150ms ease;
    }
    .toggle--on .toggle__dot {
        transform: translateX(16px);
        background: #fff;
    }
    .toggle--on.toggle--in {
        background: #4f46e5;
        border-color: #4f46e5;
    }
    .toggle--on.toggle--out {
        background: #10b981;
        border-color: #10b981;
    }

    /* ─── Network view ─────────────────────────────────────── */
    .network-card {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 0.75rem;
        padding: 1rem;
    }
    .network-svg {
        width: 100%;
        height: auto;
        max-height: 70vh;
        background: linear-gradient(135deg, #0f172a, #1f2937);
        border-radius: 0.5rem;
    }
    .net-node {
        cursor: pointer;
        transition: opacity 150ms ease;
    }
    .net-node:hover {
        opacity: 0.85;
    }
    .net-node:focus-visible {
        outline: 2px solid #818cf8;
        outline-offset: 2px;
    }

    /* ─── Modal ────────────────────────────────────────────── */
    .modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        z-index: 50;
    }
    .modal {
        background: #1f2937;
        border: 1px solid #374151;
        border-radius: 0.75rem;
        width: 100%;
        max-width: 28rem;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.4);
    }
    .modal__head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #374151;
    }
    .modal__head h2 {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
        color: #fff;
    }
    .modal__body {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 1.25rem;
    }
    .modal__hint {
        margin: 0;
        font-size: 0.8rem;
        color: #9ca3af;
        line-height: 1.4;
    }
    .modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
    }

    .field {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }
    .field__label {
        font-size: 0.8rem;
        font-weight: 500;
        color: #d1d5db;
    }
    .field__input {
        background: #111827;
        border: 1px solid #4b5563;
        border-radius: 0.5rem;
        padding: 0.55rem 0.75rem;
        color: #fff;
        font-size: 0.875rem;
        transition: border-color 150ms ease;
    }
    .field__input:focus {
        outline: none;
        border-color: #6366f1;
    }
    .field__input::placeholder {
        color: #6b7280;
    }

    /* ─── Toast ────────────────────────────────────────────── */
    .toast {
        position: fixed;
        top: 1rem;
        right: 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 1rem;
        border-radius: 0.5rem;
        font-size: 0.875rem;
        z-index: 60;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.4);
    }
    .toast--success {
        background: #064e3b;
        border: 1px solid #10b981;
        color: #d1fae5;
    }
    .toast--error {
        background: #7f1d1d;
        border: 1px solid #ef4444;
        color: #fee2e2;
    }
</style>
