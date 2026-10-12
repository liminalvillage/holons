<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a party for the split: a person or a holon, by name or by id — the
  // same finder the kiosk's sheet has. Core says which kind a hit is
  // (`splitPartyKind`); the editor decides what to do with it.
  import { createEventDispatcher } from "svelte";
  import type { HoloSphere } from "holosphere";
  import { searchHolons, type HolonSearchHit } from "@holons/core/holosphere";
  import { splitPartyKind } from "@holons/core/flows";

  export let holosphere: HoloSphere | null = null;
  /** Ids already seated, left out of the hits. */
  export let exclude: readonly string[] = [];
  export let placeholder = "Add a partner holon or a person — name or id";
  export let disabled = false;

  const dispatch = createEventDispatcher<{
    pick: { id: string; name: string; kind: "person" | "holon" };
  }>();

  let query = "";
  let hits: HolonSearchHit[] = [];
  let searching = false;
  let seq = 0;

  async function search(q: string) {
    const mine = ++seq;
    const text = q.trim();
    if (!holosphere || text.length < 2) {
      hits = [];
      return;
    }
    searching = true;
    try {
      const found = await searchHolons(holosphere, text);
      if (mine !== seq) return;
      const out = new Set(exclude);
      hits = found.filter((h) => !out.has(h.id));
    } catch {
      if (mine === seq) hits = [];
    } finally {
      if (mine === seq) searching = false;
    }
  }
  $: void search(query);

  function pick(h: HolonSearchHit) {
    dispatch("pick", { id: h.id, name: h.name, kind: splitPartyKind(h.id, h.type) });
    query = "";
    hits = [];
  }
</script>

<div class="finder">
  <input
    type="search"
    bind:value={query}
    {placeholder}
    aria-label={placeholder}
    autocomplete="off"
    disabled={disabled || !holosphere}
  />
  {#if hits.length}
    <ul class="hits">
      {#each hits as h (h.id)}
        <li>
          <button type="button" class="hit" on:click={() => pick(h)} {disabled}>
            <span class="hname">{h.name}</span>
            <span class="hkind">{splitPartyKind(h.id, h.type)}</span>
            {#if h.name !== h.id}<span class="hid">{h.id}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if query.trim().length >= 2 && !searching}
    <p class="muted">Nothing found. A full id works too.</p>
  {/if}
</div>

<style>
  .finder {
    margin-top: 0.5rem;
  }
  .finder input {
    width: 100%;
    padding: 0.4rem 0.6rem;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid rgba(128, 128, 128, 0.45);
    border-radius: 0.5rem;
  }
  .hits {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  .hit {
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem 0.5rem;
    padding: 0.35rem 0.6rem;
    text-align: left;
    font: inherit;
    color: inherit;
    background: transparent;
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 0.5rem;
    cursor: pointer;
  }
  .hit:hover {
    border-color: rgba(128, 128, 128, 0.8);
  }
  .hname {
    font-weight: 600;
  }
  .hkind {
    font-size: 0.7rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    border: 1px solid rgba(128, 128, 128, 0.4);
  }
  .hid {
    flex-basis: 100%;
    font-size: 0.72rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .muted {
    margin: 0.3rem 0 0;
    font-size: 0.8rem;
    color: var(--color-text-muted);
  }
</style>
