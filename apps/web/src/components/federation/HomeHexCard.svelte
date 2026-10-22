<script lang="ts">
    // The home hex, configured like any other federation partner.
    //
    // A cell differs from a peer in one way that matters: it sits inside a nest
    // of coarser hexagons. So alongside the usual in/out lens rows this card
    // carries a reach — how far up the map's scalespace an item travels. Once a
    // lens is on, ordinary writes place themselves; nobody has to press publish.
    //
    // Deliberately a separate component from Federation.svelte: that one still
    // talks to holosphere.federate() positionally, and this path must go through
    // @holons/core/federation so the reach survives and stays validated.
    import { onMount, getContext } from "svelte";
    import { fade, slide } from "svelte/transition";
    import type { HoloSphere } from "holosphere";
    import { ArrowDown, ArrowUp, Loader, MapPin, Link2, AlertCircle } from "svelte-feathers";
    import { ID } from "../../dashboard/store";
    import {
        HOME_HEX_DEFAULT_HOPS,
        HOME_HEX_MAX_HOPS,
        mirrorItemToHomeHex,
        readHomeHexLink,
        readSettingsHex,
        setHomeHexLink,
        unlinkHomeHex,
        type HomeHexLink
    } from "@holons/core/federation";

    export let lenses: string[] = [];
    export let lensIcon: (lens: string) => string = () => "◆";

    const holosphere = getContext("holosphere") as HoloSphere;

    let loading = true;
    let saving = false;
    let error = "";
    let notice = "";
    /** The cell from settings.hex — present even when nothing is linked yet. */
    let cell: string | null = null;
    let link: HomeHexLink | null = null;
    /** Backfill progress, so a caretaker can see a big board being published. */
    let backfill: { lens: string; done: number; total: number } | null = null;

    $: linked = link !== null;

    /**
     * Roughly how wide the reach gets. H3 resolutions are ~7× in area per step,
     * so the honest unit is "how far out you can be zoomed and still see it".
     */
    const REACH_LABELS = [
        "this cell only",
        "the block",
        "the neighbourhood",
        "the district",
        "the town",
        "the wider area",
        "the region",
        "the wider region"
    ];
    function reachLabel(hops: number): string {
        if (hops <= 0) return "nowhere — nothing is placed on the map";
        return REACH_LABELS[Math.min(hops, REACH_LABELS.length - 1)];
    }

    async function load() {
        loading = true;
        error = "";
        try {
            if (!$ID) return;
            cell = await readSettingsHex(holosphere, $ID);
            link = cell ? await readHomeHexLink(holosphere, $ID) : null;
        } catch (err) {
            error = err instanceof Error ? err.message : "Could not read the home hex";
        } finally {
            loading = false;
        }
    }

    onMount(load);
    $: if ($ID) load();

    /** Persist the whole config — setHomeHexLink is a full replacement. */
    async function save(next: { inbound: string[]; outbound: string[]; hops: number }) {
        if (!$ID) return;
        saving = true;
        error = "";
        try {
            link = await setHomeHexLink(holosphere, $ID, next);
            notice = "Saved";
            setTimeout(() => (notice = ""), 2000);
        } catch (err) {
            error = err instanceof Error ? err.message : "Could not save";
            await load(); // don't leave the UI showing a state that never landed
        } finally {
            saving = false;
        }
    }

    async function linkHex() {
        await save({ inbound: [], outbound: [], hops: HOME_HEX_DEFAULT_HOPS });
    }

    async function unlink() {
        if (!$ID) return;
        saving = true;
        try {
            await unlinkHomeHex(holosphere, $ID);
            link = null;
            notice = "Unlinked — items already on the map stay until deleted";
            setTimeout(() => (notice = ""), 4000);
        } catch (err) {
            error = err instanceof Error ? err.message : "Could not unlink";
        } finally {
            saving = false;
        }
    }

    async function toggle(lens: string, direction: "inbound" | "outbound") {
        if (!link) return;
        const current = link[direction];
        const isOn = current.includes(lens);
        const next = isOn ? current.filter((l) => l !== lens) : [...current, lens];
        const config = {
            inbound: direction === "inbound" ? next : link.inbound,
            outbound: direction === "outbound" ? next : link.outbound,
            hops: link.hops
        };
        await save(config);
        // Turning a lens on only affects writes from here forward, so the board
        // a caretaker is looking at would stay absent from the map. Backfill it.
        if (!isOn && direction === "outbound") await backfillLens(lens);
    }

    async function setHops(hops: number) {
        if (!link) return;
        await save({ inbound: link.inbound, outbound: link.outbound, hops });
    }

    /** Place every item already on `lens` — one config read, N placements. */
    async function backfillLens(lens: string) {
        if (!$ID || !link) return;
        let items: Array<{ id: string;[k: string]: any }> = [];
        try {
            items = (await (holosphere as any).getAll($ID, lens)) ?? [];
        } catch {
            return;
        }
        const publishable = items.filter((i) => i && i.id && !i._deleted);
        if (publishable.length === 0) return;

        backfill = { lens, done: 0, total: publishable.length };
        for (const item of publishable) {
            try {
                await mirrorItemToHomeHex(holosphere, $ID, lens, item, link);
            } catch {
                // Best-effort: one unplaceable item must not stop the rest.
            }
            backfill = { ...backfill, done: backfill.done + 1 };
        }
        backfill = null;
        notice = `Placed ${publishable.length} ${lens} on the map`;
        setTimeout(() => (notice = ""), 3000);
    }
</script>

<section class="hexcard" transition:fade={{ duration: 150 }}>
    <header class="hexcard__head">
        <div class="hexcard__title">
            <span class="hexcard__pin"><MapPin size="16" /></span>
            <div>
                <h3>Home hex</h3>
                <p class="hexcard__sub">
                    The ground this holon stands on. Linked, it works like any other
                    federation partner — but what you send out appears on the map.
                </p>
            </div>
        </div>

        {#if loading}
            <span class="hexcard__spin"><Loader size="16" /></span>
        {:else if cell}
            <button
                type="button"
                class="hexcard__action"
                class:hexcard__action--danger={linked}
                on:click={linked ? unlink : linkHex}
                disabled={saving}
            >
                <Link2 size="14" />
                {linked ? "Unlink" : "Link home hex"}
            </button>
        {/if}
    </header>

    {#if error}
        <p class="hexcard__error" transition:slide><AlertCircle size="14" /> {error}</p>
    {/if}
    {#if notice}
        <p class="hexcard__notice" transition:slide>{notice}</p>
    {/if}

    {#if !loading && !cell}
        <p class="hexcard__empty">
            No hex address set. Pick one in <a href="/{$ID}/settings">Settings → Hex Address</a>
            to put this holon on the map.
        </p>
    {:else if cell}
        <p class="hexcard__cell"><code>{cell}</code></p>
    {/if}

    {#if linked && link}
        <div class="hexcard__reach" transition:slide>
            <div class="hexcard__reach-head">
                <label for="hex-reach">Scalespace reach</label>
                <span class="hexcard__reach-value">
                    {link.hops} {link.hops === 1 ? "level" : "levels"} up
                </span>
            </div>
            <input
                id="hex-reach"
                type="range"
                min="0"
                max={HOME_HEX_MAX_HOPS}
                value={link.hops}
                disabled={saving}
                on:change={(e) => setHops(Number(e.currentTarget.value))}
            />
            <p class="hexcard__reach-hint">
                Findable when zoomed out to about <strong>{reachLabel(link.hops)}</strong>.
                Each level places one more pointer, so reach costs a little storage.
            </p>
        </div>

        <div class="lens-list" transition:slide>
            <div class="lens-list__head">
                <span>Lens</span>
                <span class="lens-list__col" title="Inbound — read what others placed on this exact cell">
                    <ArrowDown size="12" /> In
                </span>
                <span class="lens-list__col" title="Outbound — place these on the map automatically">
                    <ArrowUp size="12" /> Out
                </span>
            </div>
            {#each lenses as lens}
                {@const isIn = link.inbound.includes(lens)}
                {@const isOut = link.outbound.includes(lens)}
                <div class="lens-row">
                    <span class="lens-row__name">
                        <span class="lens-row__icon">{lensIcon(lens)}</span>
                        <span>{lens}</span>
                        {#if backfill?.lens === lens}
                            <span class="lens-row__backfill">
                                placing {backfill.done}/{backfill.total}…
                            </span>
                        {/if}
                    </span>
                    <button
                        type="button"
                        class="toggle"
                        class:toggle--on={isIn}
                        class:toggle--in={isIn}
                        on:click={() => toggle(lens, "inbound")}
                        disabled={saving || !!backfill}
                        aria-pressed={isIn}
                        aria-label="{isIn ? 'Stop reading' : 'Read'} {lens} from this cell"
                        title="{isIn ? 'Stop reading' : 'Read'} {lens} placed on this exact cell"
                    >
                        <span class="toggle__dot"></span>
                    </button>
                    <button
                        type="button"
                        class="toggle"
                        class:toggle--on={isOut}
                        class:toggle--out={isOut}
                        on:click={() => toggle(lens, "outbound")}
                        disabled={saving || !!backfill}
                        aria-pressed={isOut}
                        aria-label="{isOut ? 'Stop placing' : 'Place'} {lens} on the map"
                        title="{isOut ? 'Stop placing' : 'Automatically place'} {lens} on the map"
                    >
                        <span class="toggle__dot"></span>
                    </button>
                </div>
            {/each}
        </div>
    {/if}
</section>

<style>
    .hexcard {
        background: var(--color-bg-secondary);
        border: 1px solid var(--color-bg-tertiary);
        border-radius: 0.75rem;
        overflow: hidden;
        margin-bottom: 1.5rem;
    }

    .hexcard__head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
        border-bottom: 1px solid var(--color-bg-tertiary);
    }
    .hexcard__title {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
    }
    .hexcard__title h3 {
        margin: 0;
        font-size: 1rem;
        color: var(--color-text-primary);
    }
    .hexcard__pin {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        flex: 0 0 32px;
        border-radius: 0.5rem;
        background: rgba(16, 185, 129, 0.12);
        color: #10b981;
    }
    .hexcard__sub {
        margin: 0.25rem 0 0;
        font-size: 0.8rem;
        line-height: 1.4;
        color: var(--color-text-muted);
        max-width: 46ch;
    }
    .hexcard__spin {
        color: var(--color-text-muted);
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .hexcard__action {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.4rem 0.75rem;
        font-size: 0.8rem;
        white-space: nowrap;
        border: 1px solid var(--color-border-light);
        border-radius: 0.5rem;
        background: var(--color-bg-tertiary);
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: border-color 150ms ease, color 150ms ease;
    }
    .hexcard__action:hover:not(:disabled) {
        border-color: #10b981;
        color: #10b981;
    }
    .hexcard__action--danger:hover:not(:disabled) {
        border-color: #ef4444;
        color: #ef4444;
    }
    .hexcard__action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .hexcard__error,
    .hexcard__notice,
    .hexcard__empty,
    .hexcard__cell {
        margin: 0;
        padding: 0.625rem 1rem;
        font-size: 0.8rem;
    }
    .hexcard__error {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        color: #fca5a5;
        background: rgba(239, 68, 68, 0.08);
    }
    .hexcard__notice {
        color: #6ee7b7;
        background: rgba(16, 185, 129, 0.08);
    }
    .hexcard__empty {
        color: var(--color-text-muted);
    }
    .hexcard__empty a {
        color: var(--color-accent);
    }
    .hexcard__cell code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.78rem;
        color: var(--color-text-secondary);
        background: var(--color-bg-tertiary);
        padding: 0.2rem 0.45rem;
        border-radius: 0.35rem;
    }

    .hexcard__reach {
        padding: 0.875rem 1rem;
        border-top: 1px solid var(--color-bg-tertiary);
    }
    .hexcard__reach-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.5rem;
    }
    .hexcard__reach-head label {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
    }
    .hexcard__reach-value {
        font-size: 0.75rem;
        color: #10b981;
    }
    .hexcard__reach input[type="range"] {
        width: 100%;
        accent-color: #10b981;
    }
    .hexcard__reach-hint {
        margin: 0.5rem 0 0;
        font-size: 0.75rem;
        line-height: 1.45;
        color: var(--color-text-muted);
    }
    .hexcard__reach-hint strong {
        color: var(--color-text-secondary);
        font-weight: 500;
    }

    /* Lens rows — same grid and pills as the partner cards next door. */
    .lens-list__head {
        display: grid;
        grid-template-columns: 1fr 56px 56px;
        gap: 0.5rem;
        padding: 0.5rem 1rem;
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
        background: rgba(255, 255, 255, 0.02);
        border-top: 1px solid var(--color-bg-tertiary);
        border-bottom: 1px solid var(--color-bg-tertiary);
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
        padding: 0.5rem 1rem;
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
        color: var(--color-text-secondary);
        text-transform: capitalize;
    }
    .lens-row__icon {
        font-size: 1rem;
    }
    .lens-row__backfill {
        font-size: 0.7rem;
        color: #10b981;
        text-transform: none;
    }

    .toggle {
        position: relative;
        width: 36px;
        height: 20px;
        border: 1px solid var(--color-border-light);
        border-radius: 9999px;
        background: var(--color-bg-secondary);
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
        background: var(--color-accent);
        border-color: var(--color-accent);
    }
    .toggle--on.toggle--out {
        background: #10b981;
        border-color: #10b981;
    }
</style>
