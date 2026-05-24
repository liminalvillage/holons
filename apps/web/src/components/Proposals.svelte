<script lang="ts">
    import { onMount, getContext } from "svelte";
    import { ID } from "../dashboard/store";
    import type { HoloSphere } from "holosphere";
    import ProposalChart from './ProposalChart.svelte';
    import FeatureToolbar from './shared/FeatureToolbar.svelte';
    import Modal from './shared/Modal.svelte';
    import ItemCard from './shared/ItemCard.svelte';
    import GenericImportModal from './shared/GenericImportModal.svelte';
    import { nameMap, resolveHologramSource, extractHolonIdFromSoul, resolveName, resolvedName } from '$lib/stores/nameResolver';
    import { loadFilters, saveFilters } from '$lib/util/persistedFilters';
    import { showFederated, showHolograms, passesLensFilters } from '$lib/stores/lensFilters';
    import SourceBadge from './shared/SourceBadge.svelte';
    import TitleBar from './shared/TitleBar.svelte';
    import { CheckSquare } from 'svelte-feathers';
    import {
        PROPOSAL_LENS,
        createAndSaveProposal,
        agree as coreAgree,
        block as coreBlock,
        type Proposal,
    } from '@holons/core/council';

    const holosphere = getContext("holosphere") as HoloSphere;

    $: currentHolonID = $ID;
    let proposals: Record<string, Proposal> = {};
    let unsubscribeFromProposals: (() => void) | null = null;

    // Per-feature filters (search). Federation/hologram toggles are global —
    // see $lib/stores/lensFilters.
    let filters = loadFilters('proposals', {
        searchQuery: '',
    });
    $: saveFilters('proposals', filters);

    $: sortedProposals = Object.values(proposals)
        .filter(p => p.type === "proposal")
        .filter((p) => {
            if (!passesLensFilters(p, $showHolograms, $showFederated)) return false;
            const q = filters.searchQuery.trim().toLowerCase();
            if (q && !`${p.title} ${p.description}`.toLowerCase().includes(q)) return false;
            return true;
        })
        .sort((a, b) => {
            const dateComparison = b.date - a.date;
            if (dateComparison === 0) {
                return (b.participants || []).length - (a.participants || []).length;
            }
            return dateComparison;
        });

    onMount(() => {
        const idUnsubscribe = ID.subscribe((value) => {
            if (value !== currentHolonID) {
                currentHolonID = value;
                subscribeToProposals(currentHolonID);
            } else if (value && !unsubscribeFromProposals) {
                currentHolonID = value;
                subscribeToProposals(currentHolonID);
            }
        });

        return () => {
            idUnsubscribe();
            if (unsubscribeFromProposals) unsubscribeFromProposals();
        };
    });

    function subscribeToProposals(holonIdToSubscribe: string | null): void {
        if (unsubscribeFromProposals) {
            unsubscribeFromProposals();
            unsubscribeFromProposals = null;
        }

        proposals = {};

        if (!holosphere || !holonIdToSubscribe) return;

        if ($showFederated) {
            fetchFederatedProposals(holonIdToSubscribe);
            return;
        }

        try {
            const subscription = holosphere.subscribe(
                holonIdToSubscribe,
                PROPOSAL_LENS,
                (newItem: Proposal | null, key?: string) => {
                    if (!key) return;

                    if (newItem && newItem.type === "proposal") {
                        proposals[key] = newItem;
                        proposals = proposals;
                    } else if (!newItem && proposals[key]) {
                        delete proposals[key];
                        proposals = proposals;
                    }
                }
            );
            unsubscribeFromProposals = subscription.unsubscribe;
        } catch (error) {
            console.error("Failed to subscribe to proposals:", error);
        }
    }

    async function fetchFederatedProposals(holonIdToFetch: string): Promise<void> {
        try {
            const federatedData = await holosphere.getFederated(holonIdToFetch, PROPOSAL_LENS, {
                includeLocal: true,
                includeFederated: true,
                resolveReferences: true,
                aggregate: false
            });

            const newStore: Record<string, Proposal> = {};
            if (Array.isArray(federatedData)) {
                federatedData.forEach((item: any, index: number) => {
                    if (item && item.type === "proposal" && item.id) {
                        const key = item.key || item.id || `fed_${index}`;
                        const processed: any = { ...item };
                        if (item._federation) processed._federation = item._federation;
                        if (item._hologram) processed._hologram = item._hologram;
                        newStore[key] = processed as Proposal;
                    }
                });
            }
            proposals = newStore;
        } catch (error) {
            console.error("Failed to fetch federated proposals:", error);
        }
    }

    let lastProposalsFedFlag = $showFederated;
    $: if (currentHolonID && holosphere && $showFederated !== lastProposalsFedFlag) {
        lastProposalsFedFlag = $showFederated;
        subscribeToProposals(currentHolonID);
    }

    // Thin facades over @holons/core/council. The holosphere instance
    // satisfies the ProposalStore shape (put / get / subscribe / delete).
    function addProposal(title: string, description: string): void {
        if (!currentHolonID) return;
        void createAndSaveProposal(holosphere as any, currentHolonID, {
            title,
            description,
            creator: 'Dashboard User',
        });
    }

    function toggleBlock(proposalId: string): void {
        if (!currentHolonID) return;
        void coreBlock(holosphere as any, currentHolonID, proposalId, 'current-user');
    }

    function toggleAgree(proposalId: string): void {
        if (!currentHolonID) return;
        void coreAgree(holosphere as any, currentHolonID, proposalId, 'current-user');
    }

    let showAddDialog = false;
    let newTitle = "";
    let newDescription = "";

    function handleSubmit() {
        if (newTitle.trim() && newDescription.trim()) {
            addProposal(newTitle.trim(), newDescription.trim());
            newTitle = "";
            newDescription = "";
            showAddDialog = false;
        }
    }

    let showImportModal = false;

    function handleImport(event: CustomEvent<any[]>) {
        if (!currentHolonID) return;
        const items = event.detail;
        for (const raw of items) {
            const item = raw ?? {};
            const title = String(item.title ?? item.name ?? item.text ?? '').trim();
            const description = String(item.description ?? item.body ?? '').trim();
            if (!title) continue;
            addProposal(title, description || title);
        }
        showImportModal = false;
    }

    function hologramSource(p: Proposal): string {
        const soul = p._hologram?.soul;
        if (!soul) return p._hologram?.sourceHolon ?? '';
        resolveHologramSource(soul);
        const holonId = extractHolonIdFromSoul(soul);
        if (!holonId) return '';
        return $nameMap[holonId] ?? holonId.slice(0, 8);
    }

    function hologramHolonId(p: Proposal): string {
        const soul = p._hologram?.soul;
        if (soul) {
            const id = extractHolonIdFromSoul(soul);
            if (id) return id;
        }
        return p._hologram?.sourceHolon ?? '';
    }

    function federationSource(p: Proposal): string {
        const origin = p._federation?.origin;
        if (!origin) return '';
        resolveName(origin);
        return resolvedName(origin, $nameMap);
    }
</script>

<div class="w-full bg-gray-800 py-6 px-6 rounded-3xl">
    <TitleBar
        holonName={resolvedName(currentHolonID ?? undefined, $nameMap, null, 'Proposals')}
        holonId={currentHolonID}
        showLensFilters
        title="Proposals"
        icon={CheckSquare}
    />

    <FeatureToolbar
        onAdd={() => (showAddDialog = true)}
        addLabel="Add Proposal"
        onImport={() => (showImportModal = true)}
        importLabel="Import"
        bind:searchQuery={filters.searchQuery}
        searchPlaceholder="Search proposals…"
    />

    <div class="mt-4">
        <ProposalChart
            proposals={Object.values(proposals) as any}
            quorum={5}
        />
    </div>

    <div class="space-y-3 mt-6">
        {#each sortedProposals as proposal (proposal.id)}
            <ItemCard>
                <div class="flex justify-between items-start mb-2 gap-3">
                    <h3 class="text-lg font-semibold text-white flex-1 min-w-0">
                        {proposal.title}
                        <SourceBadge item={proposal} currentHolonId={currentHolonID} lensRoute="proposals" />
                    </h3>
                    <div class="flex gap-2 flex-shrink-0">
                        <button
                            on:click|stopPropagation={() => toggleBlock(proposal.id)}
                            class="px-3 py-1 rounded-full {proposal.stoppers?.includes('current-user')
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-gray-600 hover:bg-gray-500'} text-white text-sm"
                        >
                            {proposal.stoppers?.includes('current-user') ? 'Blocked' : 'Block'}
                        </button>
                        <button
                            on:click|stopPropagation={() => toggleAgree(proposal.id)}
                            class="px-3 py-1 rounded-full {(proposal.participants || []).includes('current-user')
                                ? 'bg-green-600 hover:bg-green-700'
                                : 'bg-gray-600 hover:bg-gray-500'} text-white text-sm"
                            disabled={proposal.stoppers?.includes('current-user')}
                        >
                            {(proposal.participants || []).includes('current-user') ? 'Agreed' : 'Agree'}
                        </button>
                    </div>
                </div>
                <p class="text-gray-300 mb-3 leading-relaxed">{proposal.description}</p>
                <div class="w-full bg-gray-600 rounded-full h-2.5">
                    <div
                        class="bg-{proposal.stoppers?.length ? 'red' : 'indigo'}-600 h-2.5 rounded-full"
                        style="width: {((proposal.participants || []).length / 10) * 100}%"
                    ></div>
                </div>
                <div class="flex justify-between text-sm text-gray-400 mt-2">
                    <div class="flex gap-4">
                        <span>{(proposal.participants || []).length} agreements</span>
                        {#if proposal.stoppers?.length}
                            <span class="text-red-400">{proposal.stoppers.length} stoppers</span>
                        {/if}
                    </div>
                    <span>Created {new Date(proposal.date * 1000).toLocaleDateString()}</span>
                </div>
            </ItemCard>
        {/each}

        {#if sortedProposals.length === 0}
            <div class="empty-state">
                <h3 class="empty-state__title">
                    {Object.keys(proposals).length === 0 ? 'No proposals yet' : 'No proposals match filters'}
                </h3>
                <p class="empty-state__description">
                    {Object.keys(proposals).length === 0 ? 'Click "New Proposal" to start one' : 'Try adjusting the search or toggles above'}
                </p>
            </div>
        {/if}
    </div>
</div>

<Modal bind:open={showAddDialog} title="New Proposal" size="md">
    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
        <div>
            <label for="proposal-title" class="block text-sm font-medium text-gray-300 mb-2">Title</label>
            <input
                id="proposal-title"
                type="text"
                bind:value={newTitle}
                placeholder="Proposal title"
                class="w-full px-3 py-2 rounded-md bg-gray-700 text-white placeholder-gray-400 border-gray-600"
                required
            />
        </div>
        <div>
            <label for="proposal-description" class="block text-sm font-medium text-gray-300 mb-2">Description</label>
            <textarea
                id="proposal-description"
                bind:value={newDescription}
                placeholder="Proposal description"
                class="w-full px-3 py-2 rounded-md bg-gray-700 text-white placeholder-gray-400 border-gray-600 h-32"
                required
            ></textarea>
        </div>
        <div class="flex justify-end gap-2 pt-2">
            <button type="button" on:click={() => (showAddDialog = false)} class="btn btn--secondary">Cancel</button>
            <button type="submit" class="btn btn--primary" disabled={!newTitle.trim() || !newDescription.trim()}>Submit</button>
        </div>
    </form>
</Modal>

<GenericImportModal
    bind:open={showImportModal}
    title="Import Proposals"
    itemNoun="proposals"
    helpText="Paste a JSON array of proposals or one proposal per line. Required: title."
    sampleJson={`[
  {
    "title": "Adopt new meeting cadence",
    "description": "Switch from weekly to bi-weekly all-hands."
  },
  {
    "title": "Open-source the design library"
  }
]`}
    on:import={handleImport}
    on:close={() => (showImportModal = false)}
/>
