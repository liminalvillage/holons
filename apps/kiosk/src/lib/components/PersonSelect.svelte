<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script lang="ts" context="module">
  /** Someone the selector can offer: a member record, or an id + name. */
  export type PersonOption = {
    id: string | number;
    name?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
</script>

<script lang="ts">
  // The one way to pick a person, everywhere on the kiosk: a trigger (the
  // caller's own button, via the `trigger` slot and its `toggle`) opens a
  // menu with a search bar over avatar + name rows. By default it offers the
  // holon's members; `people` swaps in another list (a fund's candidates).
  // With `federation` on, a search also finds people of partner holons
  // (`$lib/fedpeople`). Who matches a search is core's (`findPeople`); what
  // a pick *means* is the caller's. The menu is portalled to <body> with a
  // fixed position, so a card's overflow or a sheet's stacking can't clip it.
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { findPeople } from "@holons/core/holons";
  import { loadMembers, members } from "$lib/members";
  import { loadFedPeople, type FederationPerson } from "$lib/fedpeople";
  import { personName } from "$lib/data";
  import { nameOf } from "$lib/names";
  import { t } from "$lib/i18n";
  import { avatarUrl, avatarInitial, hideImg, showImg } from "./Avatars.svelte";

  /** The trigger's text (default trigger) and the menu's accessible name. */
  export let label = "";
  /** Who to offer; omitted → the holon's members. */
  export let people: PersonOption[] | null = null;
  /** Ids to leave out (whoever is already on the list). */
  export let exclude: readonly (string | number | null | undefined)[] = [];
  /** Also search the people of the holon's federation partners. */
  export let federation = false;
  /** An extra last entry (e.g. "Someone else…"); picking it fires `other`. */
  export let otherLabel = "";
  export let disabled = false;
  /** The trigger spans its row (a full-width "＋ Add someone"). */
  export let block = false;
  /** The trigger grows like its siblings in a wrapping row of buttons. */
  export let grow = false;

  const dispatch = createEventDispatcher<{
    pick: PersonOption;
    other: void;
  }>();

  onMount(() => {
    if (!people) void loadMembers();
  });

  let open = false;
  let query = "";
  let active = 0;
  let anchor: HTMLElement;
  let input: HTMLInputElement;
  let menuStyle = "";
  let fed: FederationPerson[] = [];
  let fedLoaded = false;

  $: out = new Set(exclude.filter((x) => x != null).map(String));
  $: pool = (people ?? $members).filter((p) => !out.has(String(p.id)));
  const nameFor = (p: PersonOption) => p.name || personName(p);
  $: shown = query.trim()
    ? findPeople(
        pool.map((p) => ({ ...p, id: String(p.id), name: nameFor(p) })),
        query,
        50,
      )
    : pool
        .map((p) => ({ ...p, id: String(p.id), name: nameFor(p) }))
        .sort((a, b) => a.name.localeCompare(b.name));
  $: local = new Set(shown.map((p) => p.id));
  $: fedHits =
    federation && query.trim()
      ? findPeople(
          fed.filter((p) => !out.has(p.id) && !local.has(p.id)),
          query,
          20,
        )
      : [];
  $: rows = [
    ...shown.map((p) => ({ p, via: "" })),
    ...fedHits.map((p) => ({
      p: {
        id: p.id,
        name: p.name || $nameOf(p.id),
        username: p.username,
        first_name: p.first_name,
        last_name: p.last_name,
      },
      via: p.holons.map((h) => $nameOf(h)).join(", "),
    })),
  ];
  $: count = rows.length + (otherLabel ? 1 : 0);
  $: if (active >= count) active = Math.max(0, count - 1);

  export async function toggle() {
    if (open) return close();
    if (disabled) return;
    open = true;
    query = "";
    active = 0;
    if (federation && !fedLoaded) {
      fedLoaded = true;
      void loadFedPeople().then((list) => (fed = list));
    }
    place();
    await tick();
    // A finger tap shouldn't throw the on-screen keyboard over the list.
    if (matchMedia("(pointer: fine)").matches) input?.focus();
  }

  function close() {
    open = false;
  }

  /** Under the trigger, or above it when the screen has no room below. */
  function place() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 16);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    menuStyle =
      below >= 260 || below >= above
        ? `left:${left}px;top:${r.bottom + 4}px;width:${w}px;max-height:${Math.min(400, below)}px`
        : `left:${left}px;bottom:${window.innerHeight - r.top + 4}px;width:${w}px;max-height:${Math.min(400, above)}px`;
  }

  function choose(i: number) {
    if (i < rows.length) {
      const { p } = rows[i];
      const pick: PersonOption = { id: p.id };
      for (const k of ["name", "username", "first_name", "last_name"] as const)
        if (p[k]) pick[k] = p[k];
      // Hand back the caller's own id type (a member's numeric Telegram id).
      const orig = pool.find((x) => String(x.id) === p.id);
      if (orig) pick.id = orig.id;
      dispatch("pick", pick);
    } else dispatch("other");
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation(); // the menu closes, not the sheet around it
      close();
      anchor?.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % Math.max(1, count);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + count) % Math.max(1, count);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (count) choose(active);
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // Any press outside the trigger and the menu closes it.
  let menu: HTMLElement;
  function onDocDown(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node;
    if (menu?.contains(t) || anchor?.contains(t)) return;
    close();
  }
  onMount(() => document.addEventListener("pointerdown", onDocDown, true));
  onDestroy(() => {
    if (typeof document !== "undefined")
      document.removeEventListener("pointerdown", onDocDown, true);
  });
</script>

<svelte:window on:resize={() => open && place()} />

<span class="anchor" class:block class:grow bind:this={anchor}>
  <slot name="trigger" {toggle} {open}>
    <button
      type="button"
      class="face"
      {disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      on:pointerdown|stopPropagation
      on:click|stopPropagation={toggle}>{label}</button
    >
  </slot>
</span>

{#if open}
  <div
    class="menu"
    bind:this={menu}
    use:portal
    style={menuStyle}
    role="dialog"
    aria-label={label}
  >
    <div class="bar">
      <Icon name="search" />
      <input
        bind:this={input}
        type="search"
        bind:value={query}
        on:input={() => (active = 0)}
        on:keydown={onKey}
        placeholder={federation
          ? $t("people.searchAnyone")
          : $t("people.searchMembers")}
        aria-label={label}
        autocomplete="off"
        enterkeyhint="search"
      />
    </div>
    <ul class="list" role="listbox" aria-label={label}>
      {#each rows as { p, via }, i (p.id)}
        <li role="option" aria-selected={i === active}>
          <button
            type="button"
            class="row"
            class:active={i === active}
            on:mouseenter={() => (active = i)}
            on:click={() => choose(i)}
          >
            <span class="av">
              <span class="ini">{avatarInitial(p.name)}</span>
              <img
                src={avatarUrl(p.id)}
                alt=""
                loading="lazy"
                on:error={hideImg}
                on:load={showImg}
              />
            </span>
            <span class="who">
              <span class="nm">{p.name}</span>
              {#if via}<span class="via">{$t("people.via", { name: via })}</span
                >{/if}
            </span>
          </button>
        </li>
      {/each}
      {#if otherLabel}
        <li role="option" aria-selected={active === rows.length}>
          <button
            type="button"
            class="row other"
            class:active={active === rows.length}
            on:mouseenter={() => (active = rows.length)}
            on:click={() => choose(rows.length)}
            ><Icon name="plus" /> {otherLabel}</button
          >
        </li>
      {/if}
    </ul>
    {#if !rows.length}
      <p class="note">
        {query.trim()
          ? $t("people.noMatch")
          : federation
            ? $t("people.typeToSearchFederation")
            : $t("people.noOneLeft")}
      </p>
    {:else if federation && !query.trim()}
      <p class="note">{$t("people.typeToSearchFederation")}</p>
    {/if}
  </div>
{/if}

<style>
  .anchor {
    display: inline-flex;
    flex: 0 0 auto;
  }
  .anchor.block {
    display: flex;
    width: 100%;
  }
  .anchor.grow {
    flex: 1 1 auto;
    min-width: 8rem;
  }
  .anchor.block > :global(*),
  .anchor.grow > :global(*) {
    flex: 1;
  }
  .face {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 2rem;
    padding: 0 0.9rem;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--teal-ink);
    background: var(--glass);
    box-shadow: var(--shadow-soft);
    transition: transform 0.1s ease;
  }
  .face:active {
    transform: scale(0.94);
  }
  .face:disabled {
    opacity: 0.6;
  }

  .menu {
    position: fixed;
    z-index: 90; /* above Modal (50) and SidePanel (65) */
    display: flex;
    flex-direction: column;
    padding: 0.5rem;
    text-align: left;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 12px 32px rgba(28, 48, 46, 0.22);
  }
  .bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-left: 0.7rem;
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
  .list {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
    overscroll-behavior: contain;
  }
  .row {
    width: 100%;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.3rem 0.6rem;
    text-align: left;
    font: inherit;
    font-weight: 700;
    color: var(--ink);
    background: transparent;
    border: none;
    border-radius: 10px;
    touch-action: manipulation;
    cursor: pointer;
  }
  .row.active {
    background: var(--ghost);
  }
  .row.other {
    color: var(--teal-ink);
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
    font-size: 0.75rem;
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
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .nm,
  .via {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .via {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-soft);
  }
  .note {
    margin: 0.5rem 0.4rem 0.2rem;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
</style>
