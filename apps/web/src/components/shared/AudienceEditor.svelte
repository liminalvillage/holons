<script lang="ts">
    // SPDX-License-Identifier: AGPL-3.0-or-later
    //
    // Who may read a scope — a whole lens or one item — as a list of HOLONS.
    // The lock makes the scope private; the chips are the holons it is
    // shared with (this holon first, never removable); "add" offers the
    // federated partners and a name search over the registry. Keys never
    // appear: core resolves each holon to its readers (see @holons/core/privacy).
    import { createEventDispatcher, onMount } from "svelte";
    import { Lock, Unlock, X, Plus } from "svelte-feathers";
    import type { HoloSphere } from "holosphere";
    import {
        audience as readAudience,
        lock,
        privacyOfHolon,
        share,
        unlock,
        unshare,
        type Audience,
        type Scope,
    } from "@holons/core/privacy";
    import { getFederationSnapshot } from "@holons/core/federation";
    import { searchHolons, type HolonSearchHit } from "@holons/core/holosphere";

    export let holosphere: HoloSphere;
    export let scope: Scope;
    /** Shown instead of the holon id for the owner entry. */
    export let holonName = "";

    const dispatch = createEventDispatcher<{ change: Audience }>();

    let aud: Audience | null = null;
    let lensLocked = false;
    let loading = true;
    let busy = "";
    let error = "";
    let addOpen = false;
    let partners: Array<{ id: string; name: string }> = [];
    let names: Record<string, string> = {};
    let query = "";
    let hits: HolonSearchHit[] = [];
    let seq = 0;

    $: listed = new Set((aud?.holons ?? []).map((h) => h.holon));
    $: candidates = partners.filter((p) => !listed.has(p.id));
    $: canChange = !!holosphere?.loggedIn;
    const nameOf = (id: string) => (id === scope.holon ? holonName || id : names[id] ?? id);

    async function load() {
        loading = true;
        error = "";
        try {
            const flags = await privacyOfHolon(holosphere, scope.holon);
            lensLocked = !!flags[scope.lens]?.locked;
            aud = canChange ? await readAudience(holosphere, scope) : null;
            if (!aud) {
                aud = {
                    scope,
                    locked: scope.item ? lensLocked || !!flags[scope.lens]?.items.includes(scope.item) : lensLocked,
                    owned: false,
                    holons: [],
                };
            }
            if (canChange && partners.length === 0) {
                try {
                    const fed = await getFederationSnapshot(holosphere, scope.holon);
                    partners = fed.federated.map((id) => ({ id, name: fed.partnerNames[id] ?? id }));
                    names = { ...names, ...fed.partnerNames };
                } catch {
                    partners = [];
                }
            }
        } catch (err) {
            error = err instanceof Error ? err.message : "Could not load who may read this.";
        } finally {
            loading = false;
        }
    }

    async function run(label: string, fn: () => Promise<Audience>) {
        if (busy || !canChange) return;
        busy = label;
        error = "";
        try {
            aud = await fn();
            dispatch("change", aud);
        } catch (err) {
            error = err instanceof Error ? err.message : "Could not change that.";
        } finally {
            busy = "";
        }
    }

    const toggleLock = () => run("lock", () => (aud?.locked ? unlock(holosphere, scope) : lock(holosphere, scope)));
    const add = (id: string, name?: string) => {
        if (name) names = { ...names, [id]: name };
        addOpen = false;
        query = "";
        hits = [];
        return run(id, () => share(holosphere, scope, id));
    };
    const remove = (id: string) => run(id, () => unshare(holosphere, scope, id));

    async function search(q: string) {
        const mine = ++seq;
        const text = q.trim();
        if (text.length < 2) {
            hits = [];
            return;
        }
        const found = await searchHolons(holosphere, text);
        if (mine !== seq) return;
        hits = found.filter((h) => h.id !== scope.holon && !listed.has(h.id));
    }
    $: void search(query);

    onMount(load);
</script>

<div class="aud">
    <div class="aud__head">
        <button
            type="button"
            class="aud__lock"
            class:aud__lock--on={!!aud?.locked}
            aria-pressed={!!aud?.locked}
            disabled={loading || !!busy || !canChange || (!!aud?.locked && !aud.owned) || (!!scope.item && lensLocked)}
            title={aud?.locked ? "Unlock — anyone can read it" : "Lock — only this holon and the holons it is shared with can read it"}
            on:click={toggleLock}
        >
            {#if aud?.locked}<Lock size="14" /> Private{:else}<Unlock size="14" /> Public{/if}
        </button>
        {#if !canChange}<span class="aud__hint">Log in with your key to change this.</span>{/if}
    </div>
    {#if scope.item && lensLocked}
        <p class="aud__hint">The whole lens is locked; this item follows it.</p>
    {:else if aud?.locked && !aud.owned && canChange}
        <p class="aud__hint">Locked by another key — only its owner changes who reads it.</p>
    {:else if aud?.locked && aud.owned}
        <div class="aud__chips">
            {#each aud.holons as h (h.holon)}
                <span
                    class="aud__chip"
                    class:aud__chip--self={h.self}
                    title={h.status === "synced"
                        ? `${h.readers} readers, all have it`
                        : h.status === "pending"
                          ? `${h.readers} readers, on its way to them`
                          : "no readers yet — nothing signed says who is in it"}
                >
                    <span class="aud__dot aud__dot--{h.status}"></span>
                    {h.self ? `Members of ${nameOf(h.holon)}` : nameOf(h.holon)}
                    {#if !h.self}
                        <button type="button" class="aud__x" aria-label="Stop sharing with {nameOf(h.holon)}" disabled={!!busy} on:click={() => remove(h.holon)}>
                            <X size="12" />
                        </button>
                    {/if}
                </span>
            {/each}
            <button type="button" class="aud__chip aud__chip--add" aria-expanded={addOpen} disabled={!!busy} on:click={() => (addOpen = !addOpen)}>
                <Plus size="12" /> Share with…
            </button>
        </div>
        {#if addOpen}
            <div class="aud__picker">
                {#if candidates.length}
                    <p class="aud__group">Federated holons</p>
                    <div class="aud__opts">
                        {#each candidates as p (p.id)}
                            <button type="button" class="aud__opt" disabled={!!busy} on:click={() => add(p.id, p.name)}>{p.name}</button>
                        {/each}
                    </div>
                {/if}
                <p class="aud__group">Any holon</p>
                <input class="aud__search" type="search" bind:value={query} placeholder="Name or holon id" autocomplete="off" />
                {#if hits.length}
                    <div class="aud__opts">
                        {#each hits as h (h.id)}
                            <button type="button" class="aud__opt" disabled={!!busy} on:click={() => add(h.id, h.name)}>
                                {h.name}{#if h.name !== h.id}<span class="aud__id">{h.id}</span>{/if}
                            </button>
                        {/each}
                    </div>
                {:else if query.trim().length >= 2}
                    <p class="aud__hint">No holon by that name.</p>
                {/if}
            </div>
        {/if}
    {/if}
    {#if error}<p class="aud__err">{error}</p>{/if}
</div>

<style>
    .aud { display: flex; flex-direction: column; gap: 0.5rem; }
    .aud__head { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
    .aud__lock {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.35rem 0.75rem; border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.06);
        color: #cbd5e1; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    }
    .aud__lock--on { background: rgba(45, 212, 191, 0.2); border-color: rgba(45, 212, 191, 0.5); color: #99f6e4; }
    .aud__lock:disabled { opacity: 0.5; cursor: default; }
    .aud__hint { margin: 0; font-size: 0.75rem; color: #94a3b8; }
    .aud__err { margin: 0; font-size: 0.78rem; color: #fca5a5; }
    .aud__chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .aud__chip {
        display: inline-flex; align-items: center; gap: 0.35rem;
        padding: 0.3rem 0.4rem 0.3rem 0.6rem; border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.05);
        color: #e2e8f0; font-size: 0.78rem;
    }
    .aud__chip--self { border-style: dashed; padding-right: 0.7rem; }
    .aud__chip--add { cursor: pointer; border-color: rgba(45, 212, 191, 0.5); color: #99f6e4; padding-right: 0.7rem; }
    .aud__dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: #64748b; }
    .aud__dot--synced { background: #34d399; }
    .aud__dot--pending { background: #fbbf24; }
    .aud__x { display: inline-grid; place-items: center; width: 1.4rem; height: 1.4rem; border: none; background: none; color: #94a3b8; cursor: pointer; border-radius: 50%; }
    .aud__x:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .aud__picker { padding: 0.6rem; border-radius: 0.6rem; border: 1px dashed rgba(255, 255, 255, 0.2); display: flex; flex-direction: column; gap: 0.4rem; }
    .aud__group { margin: 0; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
    .aud__opts { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .aud__opt {
        display: inline-flex; align-items: center; gap: 0.4rem;
        padding: 0.35rem 0.7rem; border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.06);
        color: #e2e8f0; font-size: 0.78rem; cursor: pointer;
    }
    .aud__id { font-size: 0.68rem; color: #94a3b8; }
    .aud__search {
        width: 100%; padding: 0.45rem 0.6rem; border-radius: 0.5rem;
        border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(0, 0, 0, 0.25); color: #fff; font-size: 0.85rem;
    }
</style>
