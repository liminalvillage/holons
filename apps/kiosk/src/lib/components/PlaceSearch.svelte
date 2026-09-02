<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a place: Mapbox Geocoding behind a pill input, same token as the
  // basemap. Owns nothing but the query — a pick hands the coordinates back
  // to whoever holds the map (the dock's top bar → DockMap.flyTo).
  import { onDestroy } from "svelte";
  import { t } from "$lib/i18n";

  interface PlaceHit {
    label: string;
    lat: number;
    lng: number;
  }

  export let onpick: (hit: PlaceHit) => void;

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

  let query = "";
  let hits: PlaceHit[] = [];
  let searching = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function onInput() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 3) {
      hits = [];
      return;
    }
    timer = setTimeout(() => void search(q), 300);
  }

  async function search(q: string) {
    if (!MAPBOX_TOKEN) return;
    searching = true;
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&limit=5&types=address,poi,place,locality,neighborhood`,
      );
      const data = await res.json();
      if (query.trim() !== q) return; // stale response
      hits = (data?.features ?? []).map((f: any) => ({
        label: f.place_name as string,
        lng: f.center?.[0],
        lat: f.center?.[1],
      }));
    } catch {
      hits = [];
    } finally {
      searching = false;
    }
  }

  function pick(hit: PlaceHit) {
    hits = [];
    query = hit.label;
    onpick(hit);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="placesearch">
  <input
    type="search"
    bind:value={query}
    on:input={onInput}
    on:keydown={(e) => e.key === "Escape" && (hits = [])}
    placeholder={$t("hex.searchPlaceholder")}
    aria-label={$t("hex.searchPlaceholder")}
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
  />
  {#if searching}
    <span class="searching">{$t("hex.searching")}</span>
  {/if}
  {#if hits.length}
    <div class="hits">
      {#each hits as hit (hit.label)}
        <button type="button" on:click={() => pick(hit)}>
          {hit.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .placesearch {
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
    color: var(--muted);
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
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.9rem;
    font-size: 0.85rem;
    color: var(--ink);
    border-bottom: 1px solid var(--line);
  }
  .hits button:last-child {
    border-bottom: none;
  }
</style>
