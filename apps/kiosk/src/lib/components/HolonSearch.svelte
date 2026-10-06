<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a hub to add: a pill input over the map whose index is the global
  // holon registry plus this deploy's registered labels (lib/holonsearch),
  // with anything pasted whole accepted outright. Owns nothing but the
  // query — a pick hands the hub back to whoever holds the map (the dock's
  // bar → DockView.addHub), which docks it, or flies to it when it is
  // docked already.
  import { onDestroy } from "svelte";
  import { searchHolons } from "@holons/core/holosphere";
  import { getHolosphere } from "$lib/holosphere";
  import { dockEntries } from "$lib/dock";
  import { mergeHits, type HubHit } from "$lib/holonsearch";
  import { t } from "$lib/i18n";

  export let onpick: (hit: HubHit) => void;

  let query = "";
  let hits: HubHit[] = [];
  let searching = false;
  let searched = ""; // the query the rows on screen answer
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  $: docked = new Set($dockEntries.map((e) => e.id));

  function onInput() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      hits = [];
      searched = "";
      return;
    }
    // The local index answers at once; the registry a beat later.
    hits = mergeHits(q, [], docked);
    searched = q;
    timer = setTimeout(() => void search(q), 250);
  }

  async function search(q: string) {
    const mine = ++seq;
    searching = true;
    let found: Awaited<ReturnType<typeof searchHolons>> = [];
    try {
      found = await searchHolons(await getHolosphere(), q);
    } catch {
      found = [];
    } finally {
      if (mine === seq) searching = false;
    }
    if (mine !== seq || query.trim() !== q) return; // stale answer
    hits = mergeHits(q, found, docked);
    searched = q;
  }

  function pick(hit: HubHit) {
    clearTimeout(timer);
    seq += 1;
    hits = [];
    searched = "";
    query = "";
    onpick(hit);
  }

  function clear() {
    clearTimeout(timer);
    seq += 1;
    hits = [];
    searched = "";
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="hubsearch">
  <input
    type="search"
    bind:value={query}
    on:input={onInput}
    on:keydown={(e) => e.key === "Escape" && clear()}
    placeholder={$t("dock.searchPlaceholder")}
    aria-label={$t("dock.searchPlaceholder")}
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
  />
  {#if searching}
    <span class="searching">{$t("hex.searching")}</span>
  {/if}
  {#if hits.length}
    <div class="hits" role="listbox">
      {#each hits as hit (hit.id)}
        <button
          type="button"
          role="option"
          aria-selected="false"
          on:click={() => pick(hit)}
        >
          <span class="hname">{hit.name}</span>
          {#if hit.docked}
            <span class="tag">{$t("dock.searchDocked")}</span>
          {/if}
        </button>
      {/each}
    </div>
  {:else if searched && !searching}
    <div class="hits">
      <p class="none">{$t("dock.searchNone")}</p>
    </div>
  {/if}
</div>

<style>
  .hubsearch {
    position: relative;
    min-width: 0;
  }
  input {
    width: 100%;
    height: 2.6rem;
    padding: 0 2.2rem 0 1rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: color-mix(in srgb, var(--card) 88%, transparent);
    color: var(--ink);
    font-size: 0.92rem;
    font-family: inherit;
    box-shadow: var(--shadow-soft);
    backdrop-filter: blur(6px);
    -webkit-appearance: none;
    appearance: none;
  }
  /* The field is glass over the earth, so its hint takes the soft ink: the
     quietest one stops clearing the pane when dark imagery shows through. */
  input::placeholder {
    color: var(--ink-soft);
  }
  input::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
  input:focus {
    outline: none;
    border-color: var(--teal);
  }
  .searching {
    position: absolute;
    right: 1rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.72rem;
    color: var(--ink-soft);
    pointer-events: none;
  }
  .hits {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-soft);
    overflow: hidden;
  }
  .hits button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.9rem;
    font-size: 0.85rem;
    font-family: inherit;
    color: var(--ink);
    border-bottom: 1px solid var(--line);
  }
  .hits button:last-child {
    border-bottom: none;
  }
  .hname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    flex: none;
    font-size: 0.7rem;
    font-weight: 700;
    color: var(--teal-ink);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .none {
    margin: 0;
    padding: 0.65rem 0.9rem;
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
