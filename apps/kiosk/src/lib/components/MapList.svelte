<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The map, read as a list: the hubs on the dock, then what the selected
  // lens holds in the cells on screen. It lies over the earth's pane — the
  // map stays mounted beneath, so what is listed is exactly what the view
  // behind it would light — and owns nothing: the rows come from the map
  // (lib/maplist), and a tap is handed back to it. A hub opens like its orb
  // does; its pin, and a lens row, go back to the earth and show the thing
  // where it is.
  import { holonColor, holonColors } from "$lib/palette";
  import { lensColor, type LensId } from "$lib/maplens";
  import type { HubRow, LensRow } from "$lib/maplist";
  import { t, type MessageKey } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  export let hubs: readonly HubRow[] = [];
  export let lens: LensId | null = null;
  export let rows: readonly LensRow[] = [];
  /** How many records the lens holds in view — more than `rows` when capped. */
  export let total = 0;
  export let onopen: (id: string) => void;
  export let onshowhub: (id: string) => void;
  export let onshowrow: (row: LensRow) => void;

  $: lensName = lens ? $t(`lens.${lens}` as MessageKey) : "";
</script>

<section class="maplist" aria-label={$t("dock.list")}>
  <div class="group">
    <h3>{$t("dock.boards")}<span class="n">{hubs.length}</span></h3>
    {#if hubs.length === 0}
      <p class="hint">{$t("dock.emptyTitle")}</p>
    {:else}
      <ul>
        {#each hubs as hub (hub.id)}
          <li>
            <button
              type="button"
              class="row"
              aria-label={$t("dock.open", { name: hub.name })}
              on:click={() => onopen(hub.id)}
            >
              <span
                class="dot"
                style:--c={holonColor(hub.id, $holonColors)}
                aria-hidden="true"
              ></span>
              <span class="label">{hub.name}</span>
              {#if !hub.hex}
                <span class="quiet">{$t("map.listNoPlace")}</span>
              {/if}
            </button>
            {#if hub.hex}
              <button
                type="button"
                class="show"
                aria-label={$t("map.listShow", { name: hub.name })}
                title={$t("map.listShow", { name: hub.name })}
                on:click={() => onshowhub(hub.id)}
              >
                <Icon name="pin" />
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <div class="group">
    {#if !lens}
      <h3>{$t("map.listInViewBare")}</h3>
      <p class="hint">{$t("map.listPickLens")}</p>
    {:else}
      <h3>
        <span class="dot" style:--c={lensColor(lens)} aria-hidden="true"></span>
        {$t("map.listInView", { lens: lensName })}<span class="n">{total}</span>
      </h3>
      {#if rows.length === 0}
        <p class="hint">{$t("map.listEmpty")}</p>
      {:else}
        <ul>
          {#each rows as row (row.id)}
            <li>
              <button
                type="button"
                class="row"
                aria-label={$t("map.listShow", { name: row.label })}
                on:click={() => onshowrow(row)}
              >
                <span class="label">{row.label}</span>
                <span class="chev" aria-hidden="true">›</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if total > rows.length}
          <p class="hint">{$t("map.listMore", { n: rows.length })}</p>
        {/if}
      {/if}
    {/if}
  </div>
</section>

<style>
  /* The same pane the earth is (DockMap .mapwrap): same frame, same curve,
     so switching to the list turns the pane over rather than replacing it.
     It sits above the sky's orbs and under the bar and the "+" that float
     over the pane, and keeps its rows clear of both. */
  .maplist {
    position: absolute;
    inset: var(--frame, 0px) var(--frame, 0px)
      calc(var(--dock-lens) + env(safe-area-inset-bottom));
    z-index: 4;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 4.6rem clamp(0.9rem, 4vw, 2rem) 5.4rem;
    background: var(--card);
    border-radius: calc(var(--radius) + 8px);
    box-shadow: var(--shadow-soft);
    text-transform: none;
    letter-spacing: 0;
  }
  /* The bar wraps to two lines on a narrow screen (see DockView .topbar). */
  @media (max-width: 40rem) {
    .maplist {
      padding-top: 7.6rem;
    }
  }
  .group {
    max-width: 44rem;
    margin: 0 auto;
  }
  .group + .group {
    margin-top: 1.6rem;
  }
  /* Room for both: the hubs and the lens side by side, so a long dock does
     not push what the lens holds off the bottom of the pane. */
  @media (min-width: 56rem) {
    .maplist {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-content: start;
      column-gap: clamp(1.5rem, 4vw, 3rem);
    }
    .group {
      width: 100%;
      margin: 0;
    }
    .group:first-child {
      justify-self: end;
    }
    .group + .group {
      margin-top: 0;
    }
  }
  h3 {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.3rem;
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .n {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--ghost);
    font-size: 0.72rem;
    letter-spacing: 0;
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: stretch;
    border-top: 1px solid var(--line);
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0.5rem 0.2rem;
    text-align: left;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--ink);
  }
  .row:active,
  .show:active {
    opacity: 0.7;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background: var(--c);
  }
  .quiet {
    flex: none;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .show {
    flex: none;
    width: 48px;
    display: grid;
    place-items: center;
    font-size: 1.2rem;
    color: var(--teal-ink);
  }
  .chev {
    flex: none;
    font-size: 1.1rem;
    line-height: 1;
    color: var(--ink-soft);
  }
  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.88rem;
    color: var(--ink-soft);
  }
</style>
