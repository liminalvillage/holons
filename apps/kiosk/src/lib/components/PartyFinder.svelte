<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a party for the split: a person or a holon, by name or by id.
  //
  // One box serves both. The registry answers names; a full id typed in
  // (a Telegram id, a hex key, a `holon_…`) is offered as is, so someone
  // who is not registered yet can still be seated. Core says which kind a
  // hit is (`splitPartyKind`); the editor decides what to do with it.
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/i18n";
  import { getReaStore } from "$lib/holosphere";
  import { searchHolons, type HolonSearchHit } from "@holons/core/holosphere";
  import { splitPartyKind } from "@holons/core/flows";

  /** Ids already seated, left out of the hits. */
  export let exclude: readonly string[] = [];
  export let placeholder = "";
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
    if (text.length < 2) {
      hits = [];
      return;
    }
    searching = true;
    try {
      const store = await getReaStore();
      const found = await searchHolons(store as any, text);
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
    dispatch("pick", {
      id: h.id,
      name: h.name,
      kind: splitPartyKind(h.id, h.type),
    });
    query = "";
    hits = [];
  }
</script>

<div class="finder">
  <input
    type="search"
    bind:value={query}
    placeholder={placeholder || $t("alloc.findParty")}
    aria-label={placeholder || $t("alloc.findParty")}
    autocomplete="off"
    enterkeyhint="search"
    {disabled}
  />
  {#if hits.length}
    <ul class="hits">
      {#each hits as h (h.id)}
        <li>
          <button type="button" class="hit" on:click={() => pick(h)} {disabled}>
            <span class="hname">{h.name}</span>
            <span class="hkind"
              >{$t(
                splitPartyKind(h.id, h.type) === "person"
                  ? "alloc.kindPerson"
                  : "alloc.kindHolon",
              )}</span
            >
            {#if h.name !== h.id}<span class="hid">{h.id}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if query.trim().length >= 2 && !searching}
    <p class="note">{$t("alloc.findNoHits")}</p>
  {/if}
</div>

<style>
  .finder {
    margin-top: 0.5rem;
  }
  .finder input {
    width: 100%;
    min-height: 48px;
    padding: 0.4rem 0.7rem;
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .hits {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .hit {
    width: 100%;
    min-height: 44px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 0.6rem;
    padding: 0.4rem 0.7rem;
    text-align: left;
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    touch-action: manipulation;
  }
  .hname {
    font-weight: 600;
  }
  .hkind {
    font-size: 0.75rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
  }
  .hid {
    flex-basis: 100%;
    font-size: 0.75rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .note {
    margin: 0.3rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
</style>
