<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The dock's drawer: every hub this person has that is NOT anchored — no
  // place of its own, and no federation with anyone — listed
  // and searchable, the same drawer over the holosphere and the geosphere.
  // The sky shows only what is anchored (DockView, `anchoredIds`); this is
  // where everything else waits.
  //
  // It owns nothing but its open/closed state and its query: a tap on a row
  // opens the hub, and the grip hands the press to the dock (`grab`), which
  // carries it like an orb — dropped on a hexagon it asks to make that cell
  // the hub's home, dropped on an orb it opens the pair's flows. Either way
  // the hub becomes anchored and leaves the drawer for the sky.
  import Identicon from "./Identicon.svelte";
  import Icon from "./Icon.svelte";
  import { holonColor, holonColors } from "$lib/palette";
  import { matchesDock, type DockEntry } from "$lib/dock";
  import { t } from "$lib/i18n";

  export let entries: readonly DockEntry[] = [];
  /** Long-press edit mode is up: each row grows a ✕, like the orbs. */
  export let editing = false;
  /** The hub being carried out of the drawer, if any. */
  export let carrying: string | null = null;
  export let onopen: (e: MouseEvent, id: string) => void;
  export let onforget: (id: string) => void;
  /** The grip's pointer events, handed to the dock's carry. */
  export let grab: {
    down: (e: PointerEvent, id: string) => void;
    move: (e: PointerEvent) => void;
    up: () => void;
    leave: () => void;
  };

  const OPEN_KEY = "kiosk_dock_drawer";
  let open = (() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  })();
  function toggle() {
    open = !open;
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* private mode — the choice just won't survive a reload */
    }
  }

  let query = "";
  $: rows = entries.filter((e) => matchesDock(e, query));
</script>

<aside class="drawer" class:open aria-label={$t("dock.drawer")}>
  <button
    type="button"
    class="handle"
    aria-expanded={open}
    on:click={toggle}
    title={$t("dock.drawer")}
  >
    <Icon name="list" />
    <span class="handle__label">{$t("dock.drawer")}</span>
    <span class="n">{entries.length}</span>
    <span class="chev" aria-hidden="true"
      ><Icon name={open ? "chevron-down" : "chevron-up"} /></span
    >
  </button>

  {#if open}
    <div class="body">
      <label class="search">
        <Icon name="search" />
        <input
          type="search"
          bind:value={query}
          placeholder={$t("dock.drawerSearch")}
          aria-label={$t("dock.drawerSearch")}
        />
      </label>
      {#if entries.length === 0}
        <p class="hint">{$t("dock.drawerEmpty")}</p>
      {:else if rows.length === 0}
        <p class="hint">{$t("dock.drawerNone")}</p>
      {:else}
        <ul>
          {#each rows as e (e.id)}
            <li class:carried={carrying === e.id}>
              <button
                type="button"
                class="row"
                aria-label={$t("dock.open", { name: e.name })}
                on:click={(ev) => onopen(ev, e.id)}
              >
                <span
                  class="mark"
                  style:--c={holonColor(e.id, $holonColors)}
                  aria-hidden="true"><Identicon seed={e.id} /></span
                >
                <span class="label">{e.name}</span>
              </button>
              {#if editing}
                <button
                  type="button"
                  class="forget"
                  aria-label={$t("dock.delete", { name: e.name })}
                  title={$t("dock.delete", { name: e.name })}
                  on:click={() => onforget(e.id)}>&times;</button
                >
              {:else}
                <span
                  class="grip"
                  role="button"
                  tabindex="-1"
                  aria-label={$t("dock.drawerDrag", { name: e.name })}
                  title={$t("dock.drawerDrag", { name: e.name })}
                  on:pointerdown={(ev) => grab.down(ev, e.id)}
                  on:pointermove={grab.move}
                  on:pointerup={grab.up}
                  on:pointercancel={grab.up}
                  on:pointerleave={grab.leave}
                >
                  <Icon name="grip" />
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</aside>

<style>
  /* Docked to the right edge, between the top bar and the tray — the map's
     cell panel holds the left — and never in the way of the earth beneath:
     closed, it is just its handle. */
  .drawer {
    position: absolute;
    right: calc(env(safe-area-inset-right) + var(--frame, 0px) + 0.8rem);
    top: calc(env(safe-area-inset-top) + var(--frame, 0px) + 4.4rem);
    z-index: 7;
    width: min(18rem, calc(100vw - 2rem));
    max-height: calc(
      100% - var(--dock-tray, 0px) - env(safe-area-inset-top) - 5.2rem
    );
    display: flex;
    flex-direction: column;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 14px;
    box-shadow: var(--shadow-soft);
    overflow: hidden;
    text-transform: none;
    letter-spacing: 0;
  }
  .drawer:not(.open) {
    width: auto;
  }
  .handle {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    padding: 0.4rem 0.8rem;
    font-family: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink);
    text-align: left;
  }
  .handle__label {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .n {
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--ghost);
    font-size: 0.72rem;
  }
  .chev {
    display: grid;
    color: var(--ink-soft);
  }
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--line);
  }
  .search {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.5rem 0.6rem;
    padding: 0 0.6rem;
    min-height: 40px;
    border-radius: 999px;
    background: var(--ghost);
    color: var(--ink-soft);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.92rem;
    color: var(--ink);
    outline: none;
  }
  ul {
    margin: 0;
    padding: 0 0.3rem 0.4rem;
    list-style: none;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  li {
    display: flex;
    align-items: stretch;
    border-top: 1px solid var(--line);
  }
  li:first-child {
    border-top: 0;
  }
  li.carried {
    opacity: 0.4;
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 48px;
    padding: 0.4rem 0.4rem;
    text-align: left;
    font-family: inherit;
    font-size: 0.95rem;
    color: var(--ink);
  }
  .row:active {
    opacity: 0.7;
  }
  .mark {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border-radius: 50%;
    background: var(--c);
    overflow: hidden;
  }
  .mark :global(svg) {
    width: 70%;
    height: 70%;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The grip is what carries a hub out: touch-action none, so the press is
     the dock's and the list itself still scrolls under a finger elsewhere. */
  .grip,
  .forget {
    flex: none;
    width: 44px;
    display: grid;
    place-items: center;
    color: var(--ink-soft);
  }
  .grip {
    cursor: grab;
    touch-action: none;
  }
  .forget {
    font-size: 1.3rem;
    color: var(--danger);
  }
  .hint {
    margin: 0.2rem 0.9rem 0.8rem;
    font-size: 0.88rem;
    color: var(--ink-soft);
  }

  /* A phone: a sheet along the bottom, above the add button, opened from
     its handle. */
  @media (max-width: 40rem) {
    .drawer {
      top: auto;
      left: calc(env(safe-area-inset-left) + 0.6rem);
      right: calc(env(safe-area-inset-right) + 0.6rem);
      bottom: calc(var(--dock-tray, 0px) - 0.4rem);
      width: auto;
      max-height: 55%;
    }
    .drawer:not(.open) {
      left: auto;
    }
  }
</style>
