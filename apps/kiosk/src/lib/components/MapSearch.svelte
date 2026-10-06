<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The map's search: a pill input over the earth that finds HUBS — the ones
  // on this dock, this deploy's registered labels and the global holon
  // registry (lib/holonsearch), with anything pasted whole accepted outright
  // — and PLACES, by name, from the geocoder (lib/placesearch). Owns nothing
  // but the query: a pick is handed back to whoever holds the map (the
  // dock's bar → DockView), which docks the hub or flies to it when it is
  // docked already, and flies the earth to the place.
  import { onDestroy } from "svelte";
  import { searchHolons } from "@holons/core/holosphere";
  import { getHolosphere } from "$lib/holosphere";
  import { dockEntries } from "$lib/dock";
  import { mergeHits, type HubHit } from "$lib/holonsearch";
  import { searchPlaces, type PlaceHit } from "$lib/placesearch";
  import { locale, t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  const MAPBOX_TOKEN: string = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

  export let onpick: (hit: HubHit) => void;
  export let onplace: (place: PlaceHit) => void;
  /** Where the map is looking, so nearby places rank first. */
  export let near: () => { lat: number; lng: number } | null = () => null;

  let query = "";
  let hits: HubHit[] = [];
  let places: PlaceHit[] = [];
  let searching = false;
  let searched = ""; // the query the rows on screen answer
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;

  function onInput() {
    clearTimeout(timer);
    const q = query.trim();
    if (q.length < 2) {
      reset();
      return;
    }
    // The dock and the labels answer at once; the registry and the geocoder
    // a beat later. Places already listed stay until their answer replaces
    // them — emptying the list on every keystroke made it jump.
    hits = mergeHits(q, [], $dockEntries);
    if (q.length < 3) places = [];
    searched = q;
    timer = setTimeout(() => void search(q), 250);
  }

  async function search(q: string) {
    const mine = ++seq;
    const fresh = () => mine === seq && query.trim() === q;
    searching = true;
    const hubs = (async () => {
      let found: Awaited<ReturnType<typeof searchHolons>> = [];
      try {
        found = await searchHolons(await getHolosphere(), q);
      } catch {
        found = [];
      }
      if (fresh()) hits = mergeHits(q, found, $dockEntries);
    })();
    // A place needs a little more to go on than a hub's name does.
    const spots = (async () => {
      let found: PlaceHit[] = [];
      try {
        if (q.length >= 3)
          found = await searchPlaces(q, MAPBOX_TOKEN, {
            proximity: near(),
            language: $locale,
          });
      } catch {
        found = [];
      }
      if (fresh()) places = found;
    })();
    await Promise.all([hubs, spots]);
    if (mine === seq) searching = false;
  }

  function reset() {
    clearTimeout(timer);
    seq += 1;
    searching = false;
    hits = [];
    places = [];
    searched = "";
  }

  function pick(hit: HubHit) {
    reset();
    query = "";
    onpick(hit);
  }

  function pickPlace(place: PlaceHit) {
    reset();
    query = "";
    onplace(place);
  }

  onDestroy(() => clearTimeout(timer));
</script>

<div class="mapsearch">
  <input
    type="search"
    bind:value={query}
    on:input={onInput}
    on:keydown={(e) => e.key === "Escape" && reset()}
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
  {#if hits.length || places.length}
    <div class="hits" role="listbox">
      {#if hits.length}
        <div role="group" aria-label={$t("dock.searchHubs")}>
          <p class="sect" aria-hidden="true">{$t("dock.searchHubs")}</p>
          {#each hits as hit (hit.id)}
            <button
              type="button"
              role="option"
              aria-selected="false"
              on:click={() => pick(hit)}
            >
              <span class="glyph" aria-hidden="true"
                ><Icon name="hexagon" /></span
              >
              <span class="hname">{hit.name}</span>
              {#if hit.docked}
                <span class="tag">{$t("dock.searchDocked")}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
      {#if places.length}
        <div role="group" aria-label={$t("dock.searchPlaces")}>
          <p class="sect" aria-hidden="true">{$t("dock.searchPlaces")}</p>
          {#each places as place (place.id)}
            <button
              type="button"
              role="option"
              aria-selected="false"
              on:click={() => pickPlace(place)}
            >
              <span class="glyph" aria-hidden="true"><Icon name="pin" /></span>
              <span class="hname">
                {place.name}
                {#if place.context}
                  <span class="where">{place.context}</span>
                {/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if searched && !searching}
    <div class="hits">
      <p class="none">{$t("dock.searchNone")}</p>
    </div>
  {/if}
</div>

<style>
  .mapsearch {
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
  /* Two short lists can outgrow a phone held sideways: the sheet scrolls
     inside itself rather than running off the bottom of the screen. */
  .hits {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    max-height: min(26rem, 65vh);
    overflow-y: auto;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow-soft);
  }
  /* What kind of thing the rows beneath are. */
  .sect {
    margin: 0;
    padding: 0.5rem 0.9rem 0.25rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .hits [role="group"] + [role="group"] {
    border-top: 1px solid var(--line);
  }
  .hits button {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-height: 44px;
    text-align: left;
    padding: 0.55rem 0.9rem;
    font-size: 0.85rem;
    font-family: inherit;
    color: var(--ink);
  }
  .hits button:active {
    background: var(--ghost);
  }
  .glyph {
    flex: none;
    display: grid;
    place-items: center;
    font-size: 1.05rem;
    color: var(--ink-soft);
  }
  .hname {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .where {
    margin-left: 0.3rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
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
