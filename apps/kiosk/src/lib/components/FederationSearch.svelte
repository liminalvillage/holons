<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts">
  // Find someone beyond the holon: a search box over the people of its
  // federation partners (`$lib/fedpeople`, core's loadFederationPeople).
  // The pickers list the holon's own members at once; this opens inline
  // under them from their "Search the federation…" entry — inline, not a
  // sheet, because the cards it serves are sheets already. Who matches is
  // core's (`findPeople`); this only shows the hits and hands back the one
  // tapped, in the shape a card stores a person.
  import { createEventDispatcher, onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { findPeople } from "@holons/core/holons";
  import { loadFedPeople, type FederationPerson } from "$lib/fedpeople";
  import { nameOf } from "$lib/names";
  import { t } from "$lib/i18n";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";

  /** Ids already on the list, left out of the hits. */
  export let exclude: readonly (string | number | undefined)[] = [];

  const dispatch = createEventDispatcher<{
    pick: {
      id: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    close: void;
  }>();

  let query = "";
  let people: FederationPerson[] = [];
  let loading = true;
  let input: HTMLInputElement;

  onMount(() => {
    input?.focus();
    void loadFedPeople().then((list) => {
      people = list;
      loading = false;
    });
  });

  $: out = new Set(exclude.map((id) => String(id)));
  $: hits = findPeople(
    people.filter((p) => !out.has(p.id)),
    query,
  );

  function pick(p: FederationPerson) {
    const { id, username, first_name, last_name } = p;
    dispatch("pick", { id, username, first_name, last_name });
    query = "";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // the search closes, not the sheet around it
      dispatch("close");
    }
  }
</script>

<div class="fed">
  <div class="bar">
    <Icon name="globe" />
    <input
      bind:this={input}
      type="search"
      bind:value={query}
      on:keydown={onKey}
      placeholder={$t("people.searchFederationPlaceholder")}
      aria-label={$t("people.searchFederation")}
      autocomplete="off"
      enterkeyhint="search"
    />
    <button
      type="button"
      class="x"
      aria-label={$t("common.close")}
      title={$t("common.close")}
      on:click={() => dispatch("close")}><Icon name="close" /></button
    >
  </div>
  {#if hits.length}
    <ul class="hits">
      {#each hits as p (p.id)}
        <li>
          <button type="button" class="hit" on:click={() => pick(p)}>
            <span class="av">
              <span class="ini">{avatarInitial(p.name || $nameOf(p.id))}</span>
              <img
                src={avatarUrl(p.id)}
                alt=""
                loading="lazy"
                on:error={hideImg}
                on:load={showImg}
              />
            </span>
            <span class="who">
              <span class="nm">{p.name || $nameOf(p.id)}</span>
              <span class="via"
                >{$t("people.via", {
                  name: p.holons.map((h) => $nameOf(h)).join(", "),
                })}</span
              >
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="note">
      {#if loading}{$t(
          "people.searchingFederation",
        )}{:else if !people.length}{$t(
          "people.federationEmpty",
        )}{:else if query.trim()}{$t("people.federationNoHits")}{:else}{$t(
          "people.federationHint",
          { n: people.length },
        )}{/if}
    </p>
  {/if}
</div>

<style>
  .fed {
    width: 100%;
    margin-top: 0.5rem;
    text-align: left;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-left: 0.7rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    color: var(--ink-soft);
  }
  .bar input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    border: none;
    background: transparent;
    font: inherit;
    font-size: 1rem; /* keeps iOS from zooming the page on focus */
    color: var(--ink);
  }
  .bar input:focus {
    outline: none;
  }
  .x {
    min-width: 44px;
    min-height: 44px;
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .hits {
    list-style: none;
    margin: 0.35rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
    max-height: 16rem;
    overflow-y: auto;
  }
  .hit {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.35rem 0.7rem;
    text-align: left;
    font: inherit;
    color: var(--ink);
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    touch-action: manipulation;
    cursor: pointer;
  }
  .av {
    position: relative;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    overflow: hidden;
    background: var(--teal);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .ini {
    font-size: 0.78rem;
    font-weight: 800;
    color: #fff;
  }
  .av img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .who {
    display: grid;
    min-width: 0;
  }
  .nm {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .via {
    font-size: 0.78rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    margin: 0.35rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
</style>
