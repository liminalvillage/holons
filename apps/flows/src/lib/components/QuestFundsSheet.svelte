<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Which funds' quests I see. Every quest is filed under a fund, so the
  // deck is the boards of the funds I follow: here I add or drop them,
  // largest first, with a search over every fund on the map.
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n";
  import type { FundEntry } from "$lib/quests";

  /** Every fund one may follow, heaviest first; null while it is read. */
  export let funds: FundEntry[] | null;
  export let followed: string[];

  const dispatch = createEventDispatcher<{
    close: void;
    change: { funds: string[] };
  }>();

  let query = "";
  const LIMIT = 60;

  $: q = query.trim().toLowerCase();
  $: shown = (
    q
      ? (funds ?? []).filter((f) => f.label.toLowerCase().includes(q))
      : (funds ?? [])
  ).slice(0, LIMIT);

  function toggle(id: string) {
    const next = followed.includes(id)
      ? followed.filter((f) => f !== id)
      : [...followed, id];
    dispatch("change", { funds: next });
  }
</script>

<BottomSheet title={$t("quests.funds.pick")} on:close={() => dispatch("close")}>
  <input
    class="search"
    type="search"
    bind:value={query}
    placeholder={$t("quests.funds.search")}
    aria-label={$t("quests.funds.search")}
  />
  {#if !funds}
    <p class="muted">{$t("quests.reading")}</p>
  {:else}
    <ul>
      {#each shown as f (f.id)}
        {@const on = followed.includes(f.id)}
        <li>
          <button class:on on:click={() => toggle(f.id)} aria-pressed={on}>
            <span class="name"><b>{f.label}</b></span>
            <span class="mark"><Icon name={on ? "check" : "plus"} /></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</BottomSheet>

<style>
  .search {
    width: 100%;
    min-height: var(--tap);
    padding: 0 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
    margin-bottom: 12px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  button {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button.on {
    border-color: var(--teal);
    background: var(--teal-wash);
  }
  .name {
    display: grid;
    gap: 2px;
  }
  .mark {
    flex: none;
    font-size: 1.1rem;
    color: var(--teal-ink);
  }
</style>
