<script lang="ts">
    import { createEventDispatcher, onMount, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import type { HoloSphere } from "holosphere";
    import { nameMap, resolvedName, resolvedInitials } from '$lib/stores/nameResolver';
    import DisplayName from './shared/DisplayName.svelte';
    import { REAAggregator, ZERO_USER_AGGREGATES, type UserAggregates } from "@holons/core/scoring";
    import { classifyMarketItem } from "@holons/core/tasks";
    import { getEventStore } from "../lib/rea/eventStore";

    export let userId: string;
    export let holonId: string;
    export let userData: UserInfo | null = null;

    interface UserInfo {
        id: string;
        version: string;
        username: string;
        first_name: string;
        last_name?: string;
        participated: Record<string, any>;
        actions: any[];
        initiated: any[];
        received: number;
        sent: number;
        needs: string[];
        values: string[];
        appreciated: any[];
        completed: any[];
        collaboration: any[];
        hours: number;
        voice: number;
    }

    const dispatch = createEventDispatcher();
    const holosphere = getContext("holosphere") as HoloSphere;
    
    let user: UserInfo | null = null;
    let loading = true;
    let activeTab = 'overview';
    let selectedActionType = 'all';
    let aggregates: UserAggregates = { ...ZERO_USER_AGGREGATES };

    // REA event history for the user — populated by loadActivity().
    // One row per REA event written by/for this user (initiator, completer,
    // appreciator, time logger, etc.). The Activity tab reads from this
    // instead of the legacy flat user.actions / user.initiated / user.completed
    // arrays, which are no longer maintained.
    let activity: any[] = [];
    let activityLoaded = false;

    // This member's marketplace items (offers / requests / needs) — quests in
    // the `quests` lens classified by core and authored by this user.
    let marketItems: any[] = [];
    $: userOffers = marketItems.filter((m) => classifyMarketItem(m) === 'offer');
    $: userRequests = marketItems.filter((m) => {
        const kind = classifyMarketItem(m);
        return kind === 'request' || kind === 'need';
    });

    onMount(async () => {
        if (userData) {
            user = userData;
            loading = false;
        } else {
            await loadUserData();
        }
        // Name resolution is now automatic via resolvedName()
        await Promise.all([loadAggregates(), loadActivity(), loadMarketItems()]);
    });

    async function loadMarketItems() {
        if (!holosphere || !holonId || !userId) return;
        try {
            const quests = (await holosphere.getAll(holonId, "quests")) ?? [];
            marketItems = (quests as any[]).filter(
                (q) => classifyMarketItem(q) !== null && String(q?.initiator?.id) === String(userId),
            );
        } catch (error) {
            console.error("[User.svelte] Error loading marketplace items:", error);
            marketItems = [];
        }
    }

    async function loadUserData() {
        if (!holosphere || !holonId || !userId) {
            loading = false;
            return;
        }
        
        try {
            const userData = await holosphere.get(holonId, "users", userId);
            if (userData) {
                user = userData as UserInfo;
            }
        } catch (error) {
            console.error("Error loading user data:", error);
        } finally {
            loading = false;
        }
    }

    async function loadAggregates() {
        if (!holosphere || !holonId || !userId) return;
        try {
            const aggregator = new REAAggregator(getEventStore(holosphere));
            aggregates = await aggregator.getUserAggregates(String(holonId), String(userId));
        } catch (error) {
            console.error("[User.svelte] Error loading REA aggregates:", error);
        }
    }

    async function loadActivity() {
        if (!holosphere || !holonId || !userId) {
            activityLoaded = true;
            return;
        }
        try {
            const aggregator = new REAAggregator(getEventStore(holosphere));
            // Load every REA event for this user (no cap). The full feed
            // powers the derived stats and the export buttons; the visible
            // list still slices for display.
            activity = await aggregator.getUserActivityHistory(
                String(holonId),
                String(userId),
                null,
            );
        } catch (error) {
            console.error("[User.svelte] Error loading REA activity:", error);
            activity = [];
        } finally {
            activityLoaded = true;
        }
    }

    // Human-readable label for each REA event type the activity feed renders.
    function eventLabel(eventType: string | undefined): string {
        switch (eventType) {
            case 'quest:initiated':         return 'Initiated';
            case 'quest:completed':         return 'Completed';
            case 'quest:time_logged':       return 'Logged time';
            case 'appreciation:sent':       return 'Appreciation sent';
            case 'appreciation:received':   return 'Appreciation received';
            case 'expense:paid':            return 'Expense paid';
            case 'expense:share':           return 'Expense share';
            case 'transfer:direct':         return 'Transfer';
            case 'item:borrowed':           return 'Borrowed';
            case 'item:returned':           return 'Returned';
            case 'credit:issued':           return 'Credit issued';
            case 'credit:transfer':         return 'Credit transfer';
            default:                        return eventType || 'Event';
        }
    }

    // Whether the user was provider (acted) or receiver (received) on this event.
    function eventDirection(event: any): 'provider' | 'receiver' | 'self' {
        const p = String(event?.provider?.id ?? '');
        const r = String(event?.receiver?.id ?? '');
        const u = String(userId);
        if (p === u && r === u) return 'self';
        if (p === u) return 'provider';
        return 'receiver';
    }

    function eventDetail(event: any): string {
        const note = event?.context?.note;
        if (note) return String(note);
        const q = event?.resource?.quantity;
        const unit = event?.resource?.unit;
        if (q != null && unit) return `${q} ${unit}`;
        return '';
    }

    function closeModal() {
        dispatch('close');
    }

    function handleClickOutside(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            closeModal();
        }
    }

    function formatDate(timestamp: number) {
        return new Date(timestamp).toLocaleDateString();
    }


    $: stats = user ? [
        { label: 'Tasks Initiated', value: aggregates.initiated, color: 'text-blue-400' },
        { label: 'Tasks Completed', value: aggregates.completed, color: 'text-green-400' },
        { label: 'Appreciation Sent', value: aggregates.sent, color: 'text-purple-400' },
        { label: 'Appreciation Received', value: aggregates.received, color: 'text-orange-400' },
        { label: 'Hours Contributed', value: aggregates.hours, color: 'text-yellow-400' },
        { label: 'Collaboration Score', value: aggregates.collaboration, color: 'text-pink-400' }
    ] : [];

    // Unique REA event types present in the user's activity feed — feeds
    // the type filter dropdown in the Activity tab.
    $: actionTypes = ['all', ...Array.from(new Set(activity.map(e => e.eventType).filter(Boolean)))];

    // Filter REA events by the selected type.
    $: filteredActions = selectedActionType === 'all'
        ? activity
        : activity.filter(e => e.eventType === selectedActionType);

    // Bucket events by event type for the Initiated / Completed sections.
    $: initiatedEvents = activity.filter(e => e.eventType === 'quest:initiated');
    $: completedEvents = activity.filter(e => e.eventType === 'quest:completed');

    // ===================== Derived REA statistics =====================
    // Pure derivation off the loaded `activity` array. Everything below
    // recomputes when activity changes — no extra fetches.
    //
    // REA stance: every event has a Resource (what flowed), an Event (the
    // increment/decrement transaction), and Agents (provider + receiver).
    // From the user's perspective the resource either flowed IN (user is
    // receiver) or OUT (user is provider). appreciation:received is the
    // dual of appreciation:sent — including both would double-count the
    // economic exchange, so the analytics skip the :received dual.

    $: totalEvents = activity.length;

    // First / last event timestamps + unique-days-active.
    $: firstEventAt = activity.length
        ? Math.min(...activity.map(e => Number(e.timestamp) || 0))
        : 0;
    $: lastEventAt = activity.length
        ? Math.max(...activity.map(e => Number(e.timestamp) || 0))
        : 0;
    $: daysActive = (() => {
        const set = new Set<string>();
        for (const e of activity) {
            if (!e.timestamp) continue;
            set.add(new Date(e.timestamp).toISOString().slice(0, 10));
        }
        return set.size;
    })();

    // Drop the duplicate `appreciation:received` dual once; everything
    // resource-flow related uses this cleaned stream.
    $: nonDualEvents = activity.filter(e => e.eventType !== 'appreciation:received');

    // Resource ledger: for each (resource type, unit) bucket, count events
    // and sum quantities in vs out, from this user's perspective.
    // The signed `net` is the user's stock change in that resource over
    // the observed period (positive = accumulated; negative = expended).
    interface LedgerRow {
        type: string;
        unit: string;
        inCount: number;  inQty: number;
        outCount: number; outQty: number;
        net: number;
    }
    $: resourceLedger = (() => {
        const m = new Map<string, LedgerRow>();
        const uid = String(userId);
        for (const e of nonDualEvents) {
            const type = String(e.resource?.type ?? '');
            const unit = String(e.resource?.unit ?? '');
            if (!type && !unit) continue;
            const key = `${type}:${unit}`;
            const row = m.get(key) ?? { type, unit, inCount: 0, inQty: 0, outCount: 0, outQty: 0, net: 0 };
            const qty = Number(e.resource?.quantity) || 0;
            const p = String(e.provider?.id ?? '');
            const r = String(e.receiver?.id ?? '');
            if (p === uid && r !== uid) {
                row.outCount += 1; row.outQty += qty;
            } else if (r === uid && p !== uid) {
                row.inCount += 1;  row.inQty += qty;
            } else if (p === uid && r === uid) {
                // Self-event (rare). Treat as outflow only.
                row.outCount += 1; row.outQty += qty;
            }
            m.set(key, row);
        }
        return Array.from(m.values())
            .map(r => ({ ...r, net: r.inQty - r.outQty }))
            .sort((a, b) => (b.inCount + b.outCount) - (a.inCount + a.outCount));
    })();

    // Agent-role split: events the user authored vs. received, plus
    // self-issued events (provider === receiver). Pure event counts —
    // useful to see whether this user is a net producer or consumer.
    $: agentRoles = (() => {
        let provider = 0, receiver = 0, self = 0;
        const uid = String(userId);
        for (const e of nonDualEvents) {
            const p = String(e.provider?.id ?? '');
            const r = String(e.receiver?.id ?? '');
            if (p === uid && r === uid) self++;
            else if (p === uid) provider++;
            else if (r === uid) receiver++;
        }
        return { provider, receiver, self };
    })();

    // Counterparties: other agents this user transacted with. Tracks event
    // count and the set of distinct resource buckets exchanged. Excludes
    // synthetic 'external' receivers (used by expense:paid) since they're
    // an accounting placeholder, not a real agent. The 'holon' itself is
    // shown when it's the counterparty — the user contributing time to
    // the holon is a real economic relationship.
    interface Counterparty {
        id: string;
        name?: string;
        type?: string;
        events: number;
        resources: Set<string>;
    }
    $: counterparties = (() => {
        const m = new Map<string, Counterparty>();
        const uid = String(userId);
        for (const e of nonDualEvents) {
            const p = e.provider ?? {};
            const r = e.receiver ?? {};
            const partner = String(p.id) === uid ? r : p;
            const partnerId = String(partner.id ?? '');
            if (!partnerId || partnerId === uid) continue;
            if (partner.type === 'external') continue;
            const cur = m.get(partnerId) ?? {
                id: partnerId,
                name: partner.name,
                type: partner.type,
                events: 0,
                resources: new Set<string>(),
            };
            cur.events += 1;
            if (e.resource?.type) cur.resources.add(`${e.resource.type}:${e.resource.unit ?? ''}`);
            cur.name = partner.name || cur.name;
            cur.type = partner.type || cur.type;
            m.set(partnerId, cur);
        }
        return Array.from(m.values()).sort((a, b) => b.events - a.events).slice(0, 8);
    })();

    // Economic exchanges by quest: REA "duality" — for each quest the user
    // touched, what they provided vs. what they received. Lets you see at
    // a glance whether a contribution was reciprocated.
    interface QuestExchange {
        id: string;
        title: string;
        events: number;
        completed: boolean;
        provided: Array<{ resource: string; qty: number; count: number }>;
        received: Array<{ resource: string; qty: number; count: number }>;
    }
    $: questExchanges = (() => {
        const m = new Map<string, {
            id: string;
            title: string;
            events: number;
            completed: boolean;
            provided: Map<string, { qty: number; count: number }>;
            received: Map<string, { qty: number; count: number }>;
        }>();
        const uid = String(userId);
        for (const e of nonDualEvents) {
            const qid = e.context?.questId;
            if (!qid) continue;
            const cur = m.get(String(qid)) ?? {
                id: String(qid),
                title: String(e.context?.note || qid),
                events: 0,
                completed: false,
                provided: new Map(),
                received: new Map(),
            };
            cur.events += 1;
            if (e.context?.note) cur.title = String(e.context.note);
            if (e.eventType === 'quest:completed' && String(e.provider?.id) === uid) {
                cur.completed = true;
            }
            const key = resourceLabel(String(e.resource?.type ?? ''), String(e.resource?.unit ?? ''));
            const qty = Number(e.resource?.quantity) || 0;
            const p = String(e.provider?.id ?? '');
            const r = String(e.receiver?.id ?? '');
            const target = p === uid ? cur.provided : r === uid ? cur.received : null;
            if (target) {
                const slot = target.get(key) ?? { qty: 0, count: 0 };
                slot.qty += qty;
                slot.count += 1;
                target.set(key, slot);
            }
            m.set(String(qid), cur);
        }
        return Array.from(m.values())
            .map<QuestExchange>(q => ({
                ...q,
                provided: Array.from(q.provided.entries()).map(([resource, v]) => ({ resource, ...v })),
                received: Array.from(q.received.entries()).map(([resource, v]) => ({ resource, ...v })),
            }))
            .sort((a, b) => b.events - a.events)
            .slice(0, 8);
    })();

    // Activity cadence: events per calendar month, oldest → newest. Used
    // for the tiny text-bar histogram. Bounded to last 12 months so the
    // panel stays compact for long-running holons.
    $: activityByMonth = (() => {
        const counts = new Map<string, number>();
        for (const e of activity) {
            if (!e.timestamp) continue;
            const d = new Date(e.timestamp);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        const all = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        return all.slice(-12);
    })();
    $: activityMonthMax = activityByMonth.reduce((m, [, v]) => Math.max(m, v), 0);

    // Human-readable label for a (resource type, unit) bucket. money → unit
    // (currency code), time → 'hours', appreciation:kudos → 'kudos', etc.
    function resourceLabel(type: string, unit: string): string {
        if (!type) return unit;
        if (type === 'money')        return unit ? unit.toUpperCase() : 'money';
        if (type === 'time')         return unit || 'time';
        if (type === 'credit')       return 'credits';
        if (type === 'item')         return unit ? `item ${unit}` : 'item';
        if (type === 'appreciation') return unit || 'appreciation';
        return unit ? `${type}:${unit}` : type;
    }

    // Compact-number formatting for ledger quantities. Time/money use 2dp,
    // everything else falls back to integer-when-whole.
    function fmtQty(type: string, qty: number): string {
        if (!Number.isFinite(qty)) return '0';
        if (type === 'time' || type === 'money') return qty.toFixed(2);
        if (Number.isInteger(qty)) return String(qty);
        return qty.toFixed(2);
    }

    // ============================ Export =============================

    function downloadBlob(filename: string, mime: string, data: string) {
        const blob = new Blob([data], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function exportJSON() {
        const payload = {
            userId: String(userId),
            holonId: String(holonId),
            exportedAt: new Date().toISOString(),
            aggregates,
            stats: {
                totalEvents,
                firstEventAt: firstEventAt ? new Date(firstEventAt).toISOString() : null,
                lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
                daysActive,
                agentRoles,
                resourceLedger,
                counterparties: counterparties.map(c => ({
                    id: c.id, name: c.name, type: c.type, events: c.events,
                    resources: Array.from(c.resources),
                })),
                questExchanges,
                activityByMonth: Object.fromEntries(activityByMonth),
            },
            events: activity,
        };
        downloadBlob(
            `holon-${holonId}-user-${userId}-rea.json`,
            'application/json',
            JSON.stringify(payload, null, 2),
        );
    }

    // RFC-4180 CSV: double-quote each field, escape embedded quotes.
    function csvField(v: unknown): string {
        if (v == null) return '';
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        return `"${s.replace(/"/g, '""')}"`;
    }

    function exportCSV() {
        const header = [
            'id', 'timestamp', 'iso_time', 'event_type', 'status',
            'provider_id', 'provider_name', 'receiver_id', 'receiver_name',
            'resource_type', 'resource_unit', 'resource_quantity',
            'quest_id', 'item_id', 'expense_id', 'note',
        ];
        const lines = [header.join(',')];
        for (const e of activity) {
            lines.push([
                e.id,
                e.timestamp,
                e.timestamp ? new Date(e.timestamp).toISOString() : '',
                e.eventType,
                e.status,
                e.provider?.id,
                e.provider?.name,
                e.receiver?.id,
                e.receiver?.name,
                e.resource?.type,
                e.resource?.unit,
                e.resource?.quantity,
                e.context?.questId,
                e.context?.itemId,
                e.context?.expenseId,
                e.context?.note,
            ].map(csvField).join(','));
        }
        downloadBlob(
            `holon-${holonId}-user-${userId}-rea.csv`,
            'text/csv;charset=utf-8',
            lines.join('\n'),
        );
    }
</script>

<!-- Modal Backdrop -->
<div 
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
    on:click={handleClickOutside}
    on:keydown={(e) => e.key === 'Escape' && closeModal()}
    role="presentation"
    transition:fade={{ duration: 200 }}
>
    <!-- Modal Content -->
    <div 
        class="bg-gray-800 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
        transition:slide={{ duration: 300 }}
    >
        {#if loading}
            <div class="flex items-center justify-center py-20 text-gray-400">
                <svg class="animate-spin h-8 w-8 mr-3" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                <span>Loading user data...</span>
            </div>
        {:else if user}
            <!-- Header -->
            <div class="bg-gradient-to-r from-gray-700 to-gray-600 px-8 py-6">
                <div class="flex items-center justify-between">
                    <div class="flex items-center space-x-4">
                        <img
                            src={`https://telegram.holons.io/getavatar?user_id=${user.id}`}
                            alt={resolvedName(user.id, $nameMap, user)}
                            class="w-16 h-16 rounded-full object-cover border-2 border-gray-300"
                            on:error={(e) => {
                                // Fallback to initials if image fails to load
                                e.currentTarget.style.display = 'none';
                                e.currentTarget.nextElementSibling.style.display = 'flex';
                            }}
                        />
                        <div class="w-16 h-16 rounded-full bg-gray-500 flex items-center justify-center text-white text-xl font-bold" style="display: none;">
                            {resolvedInitials(user.id, $nameMap, user)}
                        </div>
                        <div>
                            <h1 class="text-3xl font-bold text-white">
                                <DisplayName id={user.id} {user} />
                            </h1>
                            <p class="text-gray-400 text-sm">{user.id?.length === 64 ? `${user.id.slice(0, 12)}...` : user.id}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <button
                            on:click={exportJSON}
                            disabled={!activityLoaded || activity.length === 0}
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
                            title="Download all REA events as JSON"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                            </svg>
                            JSON
                        </button>
                        <button
                            on:click={exportCSV}
                            disabled={!activityLoaded || activity.length === 0}
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-medium transition-colors"
                            title="Download all REA events as CSV"
                        >
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                            </svg>
                            CSV
                        </button>
                        <button
                            on:click={closeModal}
                            class="text-gray-400 hover:text-white transition-colors p-2"
                            aria-label="Close modal"
                        >
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Navigation Tabs -->
            <div class="border-b border-gray-700">
                <nav class="flex px-8">
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'overview' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'overview'}
                    >
                        Overview
                    </button>
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'activity' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'activity'}
                    >
                        Activity
                    </button>
                    <button 
                        class="px-6 py-4 text-sm font-medium transition-colors {activeTab === 'social' ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}"
                        on:click={() => activeTab = 'social'}
                    >
                        Social
                    </button>
                </nav>
            </div>

            <!-- Content -->
            <div class="overflow-y-auto max-h-[60vh] p-8">
                {#if activeTab === 'overview'}
                    <!-- Stats Grid -->
                    <div class="grid grid-cols-2 md:grid-cols-3 gap-6 mb-8">
                        {#each stats as stat}
                            <div class="bg-gray-700 rounded-xl p-6 text-center">
                                <div class="text-3xl font-bold {stat.color} mb-2">
                                    {stat.value}
                                </div>
                                <div class="text-gray-300 text-sm">
                                    {stat.label}
                                </div>
                            </div>
                        {/each}
                    </div>

                    <!-- Activity Snapshot (REA-derived) -->
                    <div class="bg-gray-700 rounded-xl p-6 mb-6">
                        <h3 class="text-xl font-semibold text-white mb-4">Activity Snapshot</h3>
                        {#if !activityLoaded}
                            <p class="text-gray-400 text-sm">Loading REA stats…</p>
                        {:else if totalEvents === 0}
                            <p class="text-gray-400 text-sm">No REA events recorded yet.</p>
                        {:else}
                            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                                <div>
                                    <div class="text-2xl font-bold text-white">{totalEvents}</div>
                                    <div class="text-xs text-gray-400 mt-1">Total events</div>
                                </div>
                                <div>
                                    <div class="text-2xl font-bold text-white">{daysActive}</div>
                                    <div class="text-xs text-gray-400 mt-1">Days active</div>
                                </div>
                                <div>
                                    <div class="text-sm font-semibold text-white">{firstEventAt ? formatDate(firstEventAt) : '—'}</div>
                                    <div class="text-xs text-gray-400 mt-1">First event</div>
                                </div>
                                <div>
                                    <div class="text-sm font-semibold text-white">{lastEventAt ? formatDate(lastEventAt) : '—'}</div>
                                    <div class="text-xs text-gray-400 mt-1">Last event</div>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- Resource ledger: inflow / outflow / net per resource bucket -->
                    {#if resourceLedger.length > 0}
                        <div class="bg-gray-700 rounded-xl p-6 mb-6">
                            <h3 class="text-lg font-semibold text-white mb-1">Resource Ledger</h3>
                            <p class="text-xs text-gray-400 mb-4">Per resource bucket — flows in (as receiver), flows out (as provider), and the net stock change.</p>
                            <div class="overflow-x-auto">
                                <table class="w-full text-sm">
                                    <thead>
                                        <tr class="text-gray-400 text-xs">
                                            <th class="text-left py-1 font-medium">Resource</th>
                                            <th class="text-right py-1 font-medium">In&nbsp;(qty)</th>
                                            <th class="text-right py-1 font-medium">In&nbsp;(evt)</th>
                                            <th class="text-right py-1 font-medium">Out&nbsp;(qty)</th>
                                            <th class="text-right py-1 font-medium">Out&nbsp;(evt)</th>
                                            <th class="text-right py-1 font-medium">Net</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each resourceLedger as row}
                                            <tr class="border-t border-gray-600">
                                                <td class="py-1.5 text-gray-200">{resourceLabel(row.type, row.unit)}</td>
                                                <td class="py-1.5 text-right text-green-300 font-mono">{fmtQty(row.type, row.inQty)}</td>
                                                <td class="py-1.5 text-right text-gray-400 font-mono text-xs">{row.inCount}</td>
                                                <td class="py-1.5 text-right text-red-300 font-mono">{fmtQty(row.type, row.outQty)}</td>
                                                <td class="py-1.5 text-right text-gray-400 font-mono text-xs">{row.outCount}</td>
                                                <td class="py-1.5 text-right font-mono font-semibold {row.net > 0 ? 'text-green-300' : row.net < 0 ? 'text-red-300' : 'text-gray-400'}">{fmtQty(row.type, row.net)}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    {/if}

                    <!-- Agent role split + Activity cadence -->
                    <div class="grid md:grid-cols-2 gap-6 mb-6">
                        {#if totalEvents > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-lg font-semibold text-white mb-1">Agent Role</h3>
                                <p class="text-xs text-gray-400 mb-4">Events authored by this user vs. events targeted at them.</p>
                                <div class="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <div class="text-2xl font-bold text-blue-300">{agentRoles.provider}</div>
                                        <div class="text-xs text-gray-400 mt-1">As provider</div>
                                    </div>
                                    <div>
                                        <div class="text-2xl font-bold text-orange-300">{agentRoles.receiver}</div>
                                        <div class="text-xs text-gray-400 mt-1">As receiver</div>
                                    </div>
                                    <div>
                                        <div class="text-2xl font-bold text-gray-300">{agentRoles.self}</div>
                                        <div class="text-xs text-gray-400 mt-1">Self-issued</div>
                                    </div>
                                </div>
                            </div>
                        {/if}

                        {#if activityByMonth.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-lg font-semibold text-white mb-1">Activity Cadence</h3>
                                <p class="text-xs text-gray-400 mb-4">Events per month (last {activityByMonth.length}).</p>
                                <div class="space-y-1">
                                    {#each activityByMonth as [month, count]}
                                        <div class="flex items-center gap-3 text-xs">
                                            <span class="text-gray-400 font-mono w-16 flex-shrink-0">{month}</span>
                                            <div class="flex-1 bg-gray-600 rounded-full h-2 overflow-hidden">
                                                <div
                                                    class="bg-blue-400 h-2 rounded-full"
                                                    style="width: {activityMonthMax > 0 ? (count / activityMonthMax) * 100 : 0}%"
                                                ></div>
                                            </div>
                                            <span class="text-gray-200 font-mono w-8 text-right flex-shrink-0">{count}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- Counterparties + Economic exchanges by quest -->
                    <div class="grid md:grid-cols-2 gap-6 mb-6">
                        {#if counterparties.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-lg font-semibold text-white mb-1">Counterparties</h3>
                                <p class="text-xs text-gray-400 mb-4">Agents on the other side of this user's events.</p>
                                <div class="space-y-2">
                                    {#each counterparties as c}
                                        <div class="flex items-center justify-between text-sm border-b border-gray-600 last:border-0 pb-2 last:pb-0">
                                            <div class="min-w-0 pr-3 flex-1">
                                                <div class="text-white truncate">
                                                    {resolvedName(c.id, $nameMap, null) || c.name || c.id}
                                                    {#if c.type === 'holon'}
                                                        <span class="ml-1 text-[10px] uppercase text-gray-400">holon</span>
                                                    {/if}
                                                </div>
                                                {#if c.resources.size > 0}
                                                    <div class="flex flex-wrap gap-1 mt-1">
                                                        {#each Array.from(c.resources) as r}
                                                            {@const [t, u] = r.split(':')}
                                                            <span class="text-[10px] bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">{resourceLabel(t, u)}</span>
                                                        {/each}
                                                    </div>
                                                {/if}
                                            </div>
                                            <span class="text-gray-300 font-mono text-xs whitespace-nowrap">{c.events} evt</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        {#if questExchanges.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-lg font-semibold text-white mb-1">Economic Exchanges</h3>
                                <p class="text-xs text-gray-400 mb-4">Per quest — what this user provided vs. received (REA duality).</p>
                                <div class="space-y-3">
                                    {#each questExchanges as q}
                                        <div class="border-b border-gray-600 last:border-0 pb-2 last:pb-0">
                                            <div class="flex items-center justify-between text-sm">
                                                <span class="text-white truncate pr-3" title={q.title}>{q.title}</span>
                                                {#if q.completed}
                                                    <span class="text-[10px] uppercase tracking-wide text-green-300">done</span>
                                                {/if}
                                            </div>
                                            <div class="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                                                <div>
                                                    <div class="text-gray-500 uppercase tracking-wide text-[9px]">Provided</div>
                                                    {#if q.provided.length === 0}
                                                        <div class="text-gray-500">—</div>
                                                    {:else}
                                                        {#each q.provided as p}
                                                            <div class="text-red-300 font-mono">{fmtQty(p.resource, p.qty)} {p.resource}</div>
                                                        {/each}
                                                    {/if}
                                                </div>
                                                <div>
                                                    <div class="text-gray-500 uppercase tracking-wide text-[9px]">Received</div>
                                                    {#if q.received.length === 0}
                                                        <div class="text-gray-500">—</div>
                                                    {:else}
                                                        {#each q.received as p}
                                                            <div class="text-green-300 font-mono">{fmtQty(p.resource, p.qty)} {p.resource}</div>
                                                        {/each}
                                                    {/if}
                                                </div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>

                    <!-- Quick Info -->
                    <div class="grid md:grid-cols-2 gap-6">
                        <!-- Personal Values -->
                        {#if user.values && user.values.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Values</h3>
                                <div class="flex flex-wrap gap-2">
                                    {#each user.values as value}
                                        <span class="bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
                                            {value}
                                        </span>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Voice / governance signals -->
                        <div class="bg-gray-700 rounded-xl p-6">
                            <h3 class="text-xl font-semibold text-white mb-4">Voice</h3>
                            <div class="space-y-3">
                                <div class="flex justify-between items-center">
                                    <span class="text-gray-300">Voice Credits</span>
                                    <span class="text-blue-400 font-semibold">{user.voice || 0}</span>
                                </div>
                                <p class="text-xs text-gray-500">Currency balances live in the Status table — see the score breakdown there.</p>
                            </div>
                        </div>
                    </div>
                {:else if activeTab === 'activity'}
                    <div class="space-y-6">
                        <!-- Recent REA Events -->
                        <div class="bg-gray-700 rounded-xl p-6">
                            <div class="flex justify-between items-center mb-4">
                                <h3 class="text-xl font-semibold text-white">Recent Activity</h3>
                                {#if activity.length > 0}
                                    <select
                                        bind:value={selectedActionType}
                                        class="bg-gray-600 text-white px-3 py-1 rounded-lg text-sm border border-gray-500 focus:border-blue-500 focus:outline-none"
                                    >
                                        {#each actionTypes as actionType}
                                            <option value={actionType}>
                                                {actionType === 'all' ? 'All Types' : eventLabel(actionType)}
                                            </option>
                                        {/each}
                                    </select>
                                {/if}
                            </div>
                            {#if !activityLoaded}
                                <div class="flex items-center justify-center py-6 text-gray-400 text-sm">
                                    <svg class="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                                    </svg>
                                    Loading activity…
                                </div>
                            {:else if activity.length === 0}
                                <div class="text-gray-400 text-center py-4 text-sm">
                                    No REA events recorded for this user yet.
                                </div>
                            {:else}
                                <div class="space-y-3 max-h-64 overflow-y-auto">
                                    {#each filteredActions.slice(0, 50) as event}
                                        {@const dir = eventDirection(event)}
                                        {@const detail = eventDetail(event)}
                                        <div class="flex items-center justify-between py-2 border-b border-gray-600 last:border-0">
                                            <div class="min-w-0 flex-1 pr-3">
                                                <span class="text-white font-medium">{eventLabel(event.eventType)}</span>
                                                {#if dir === 'receiver'}
                                                    <span class="ml-2 text-[10px] uppercase tracking-wide text-gray-400">received</span>
                                                {/if}
                                                {#if detail}
                                                    <div class="text-gray-300 text-sm truncate">{detail}</div>
                                                {/if}
                                            </div>
                                            {#if event.timestamp}
                                                <span class="text-gray-400 text-xs whitespace-nowrap">
                                                    {formatDate(event.timestamp)}
                                                </span>
                                            {/if}
                                        </div>
                                    {/each}
                                    {#if filteredActions.length === 0}
                                        <div class="text-gray-400 text-center py-4 text-sm">
                                            No events of this type.
                                        </div>
                                    {/if}
                                </div>
                                <div class="mt-3 text-xs text-gray-400 text-center">
                                    Showing {Math.min(filteredActions.length, 50)} of {filteredActions.length} events
                                </div>
                            {/if}
                        </div>

                        <!-- Initiated Tasks (from REA) -->
                        {#if initiatedEvents.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Initiated Tasks</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each initiatedEvents as event}
                                        <div class="bg-gray-600 rounded-lg p-3 flex justify-between items-center">
                                            <span class="text-white truncate pr-3">{event?.context?.note || event?.context?.questId || 'Task'}</span>
                                            {#if event.timestamp}
                                                <span class="text-gray-400 text-xs whitespace-nowrap">{formatDate(event.timestamp)}</span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Completed Tasks (from REA) -->
                        {#if completedEvents.length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Completed Tasks</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each completedEvents as event}
                                        <div class="bg-green-900 bg-opacity-50 rounded-lg p-3 flex justify-between items-center">
                                            <span class="text-green-300 truncate pr-3">{event?.context?.note || event?.context?.questId || 'Task'}</span>
                                            {#if event.timestamp}
                                                <span class="text-green-200/70 text-xs whitespace-nowrap">{formatDate(event.timestamp)}</span>
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {:else if activeTab === 'social'}
                    <div class="space-y-6">
                        <!-- Collaboration (REA signals) -->
                        <div class="bg-gray-700 rounded-xl p-6">
                            <h3 class="text-xl font-semibold text-white mb-1">Collaboration</h3>
                            <p class="text-xs text-gray-400 mb-4">Signals derived from quest event groupings — the same numbers the value equation weighs. Adjust the weights in the Status page to value teamwork, network size, activity, or team-size diversity.</p>
                            <div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                                <div class="bg-gray-600/40 rounded-lg p-3">
                                    <div class="text-2xl font-bold text-cyan-300">{aggregates.participation ?? 0}</div>
                                    <div class="text-[11px] text-gray-400 mt-1">Quests touched</div>
                                </div>
                                <div class="bg-gray-600/40 rounded-lg p-3">
                                    <div class="text-2xl font-bold text-fuchsia-300">{aggregates.coParticipants ?? 0}</div>
                                    <div class="text-[11px] text-gray-400 mt-1">Co-participants</div>
                                </div>
                                <div class="bg-gray-600/40 rounded-lg p-3">
                                    <div class="text-2xl font-bold text-amber-300">{aggregates.activity ?? 0}</div>
                                    <div class="text-[11px] text-gray-400 mt-1">Total events</div>
                                </div>
                                <div class="bg-gray-600/40 rounded-lg p-3">
                                    <div class="text-2xl font-bold text-lime-300">{(aggregates.groupSize ?? 0).toFixed(2)}</div>
                                    <div class="text-[11px] text-gray-400 mt-1">Avg group size</div>
                                </div>
                                <div class="bg-gray-600/40 rounded-lg p-3">
                                    <div class="text-2xl font-bold text-violet-300">{(aggregates.variance ?? 0).toFixed(2)}</div>
                                    <div class="text-[11px] text-gray-400 mt-1">Group-size variance</div>
                                </div>
                            </div>

                            {#if counterparties.length > 0}
                                <div class="mt-6">
                                    <h4 class="text-sm font-medium text-gray-300 mb-3">People worked with</h4>
                                    <div class="space-y-2">
                                        {#each counterparties as c}
                                            <div class="flex items-center justify-between text-sm border-b border-gray-600 last:border-0 pb-2 last:pb-0">
                                                <div class="min-w-0 pr-3 flex-1">
                                                    <div class="text-white truncate">
                                                        {resolvedName(c.id, $nameMap, null) || c.name || c.id}
                                                        {#if c.type === 'holon'}
                                                            <span class="ml-1 text-[10px] uppercase text-gray-400">holon</span>
                                                        {/if}
                                                    </div>
                                                    {#if c.resources.size > 0}
                                                        <div class="flex flex-wrap gap-1 mt-1">
                                                            {#each Array.from(c.resources) as r}
                                                                {@const [t, u] = r.split(':')}
                                                                <span class="text-[10px] bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">{resourceLabel(t, u)}</span>
                                                            {/each}
                                                        </div>
                                                    {/if}
                                                </div>
                                                <span class="text-gray-300 font-mono text-xs whitespace-nowrap">{c.events} shared events</span>
                                            </div>
                                        {/each}
                                    </div>
                                    <p class="text-[11px] text-gray-500 mt-3">Counterparty list is built from this user's own event stream. The aggregate "Co-participants" count is computed holon-wide and may be larger if some collaborators only appeared in adjacent quest events.</p>
                                </div>
                            {/if}
                        </div>

                        <!-- Offers & Requests — this member's marketplace items -->
                        <div class="grid md:grid-cols-2 gap-6">
                            {#if userOffers.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Offers</h3>
                                    <div class="space-y-2">
                                        {#each userOffers as offer}
                                            <div class="bg-green-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-green-300">{offer.title}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            {#if userRequests.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Requests</h3>
                                    <div class="space-y-2">
                                        {#each userRequests as request}
                                            <div class="bg-red-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-red-300">{request.title}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Needs & Collaboration -->
                        <div class="grid md:grid-cols-2 gap-6">
                            {#if user.needs && user.needs.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Needs</h3>
                                    <div class="space-y-2">
                                        {#each user.needs as need}
                                            <div class="bg-orange-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-orange-300">{need}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}

                            {#if user.appreciated && user.appreciated.length > 0}
                                <div class="bg-gray-700 rounded-xl p-6">
                                    <h3 class="text-xl font-semibold text-white mb-4">Appreciated</h3>
                                    <div class="space-y-2 max-h-48 overflow-y-auto">
                                        {#each user.appreciated as item}
                                            <div class="bg-pink-900 bg-opacity-30 rounded-lg p-3">
                                                <span class="text-pink-300">{typeof item === 'string' ? item : JSON.stringify(item)}</span>
                                            </div>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        </div>

                        <!-- Participation -->
                        {#if user.participated && Object.keys(user.participated).length > 0}
                            <div class="bg-gray-700 rounded-xl p-6">
                                <h3 class="text-xl font-semibold text-white mb-4">Participation</h3>
                                <div class="space-y-2 max-h-48 overflow-y-auto">
                                    {#each Object.entries(user.participated) as [key, value]}
                                        <div class="flex justify-between items-center py-2 border-b border-gray-600 last:border-0">
                                            <span class="text-white">{key}</span>
                                            <span class="text-gray-300">{typeof value === 'object' ? JSON.stringify(value) : value}</span>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
        {:else}
            <div class="flex items-center justify-center py-20 text-gray-400">
                <p>User not found</p>
            </div>
        {/if}
    </div>
</div>

<style>
    /* Custom scrollbar for better appearance */
    .overflow-y-auto::-webkit-scrollbar {
        width: 6px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-track {
        background: var(--color-bg-tertiary);
        border-radius: 3px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-thumb {
        background: #6b7280;
        border-radius: 3px;
    }
    
    .overflow-y-auto::-webkit-scrollbar-thumb:hover {
        background: #6b7280;
    }
</style>
