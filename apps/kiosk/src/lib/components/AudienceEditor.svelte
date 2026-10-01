<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  //
  // Who may read a scope — a whole board (lens) or one card — as a list of
  // HOLONS. The lock makes the scope private; the chips are the holons it is
  // shared with (this hub first, never removable); "add" offers the federated
  // partners and a name search over the registry. Keys never appear: core
  // resolves each holon to its readers and hands keys out on its own
  // (see @holons/core/privacy).
  import { createEventDispatcher, onMount } from "svelte";
  import {
    audience as readAudience,
    lock,
    privacyOfHolon,
    share,
    unlock,
    unshare,
    type Audience,
    type Scope,
  } from "@holons/core/privacy";
  import { getFederationSnapshot } from "@holons/core/federation";
  import { searchHolons, type HolonSearchHit } from "@holons/core/holosphere";
  import type { HoloSphere } from "holosphere";
  import { getHolosphere } from "$lib/holosphere";
  import { holonName, partnerNames } from "$lib/stores";
  import { isLoggedIn, loginOpen } from "$lib/auth";
  import { t } from "$lib/i18n";

  export let scope: Scope;
  /** One row: the lock and a count; chips and the picker fold out when locked. */
  export let compact = false;
  /** A title above the editor (the lens name on a board, nothing on a card). */
  export let title = "";

  const dispatch = createEventDispatcher<{ change: Audience }>();

  let hs: HoloSphere | null = null;
  let aud: Audience | null = null;
  /** The whole lens is locked: a card inside follows it and cannot be locked alone. */
  let lensLocked = false;
  let loading = true;
  let busy = "";
  let error = "";
  let addOpen = false;
  let partners: Array<{ id: string; name: string }> = [];
  let query = "";
  let hits: HolonSearchHit[] = [];
  let searching = false;
  let searchSeq = 0;
  let names: Record<string, string> = {};
  let alive = true;

  $: scopeKey = `${scope.holon}|${scope.lens}|${scope.item ?? ""}`;
  $: void reload(scopeKey, $isLoggedIn);
  $: listed = new Set((aud?.holons ?? []).map((h) => h.holon));
  $: candidates = partners.filter((p) => !listed.has(p.id));
  $: others = (aud?.holons ?? []).filter((h) => !h.self);

  function nameOf(id: string): string {
    if (id === scope.holon) return $holonName || id;
    return $partnerNames[id] ?? names[id] ?? id;
  }

  function announce() {
    window.dispatchEvent(
      new CustomEvent("kiosk:privacy-changed", {
        detail: { holon: scope.holon, lens: scope.lens, item: scope.item },
      }),
    );
  }

  async function reload(_key: string, loggedIn: boolean) {
    loading = true;
    error = "";
    try {
      hs = await getHolosphere();
      const flags = await privacyOfHolon(hs, scope.holon);
      lensLocked = !!flags[scope.lens]?.locked;
      aud = loggedIn ? await readAudience(hs, scope) : null;
      if (!aud) {
        aud = {
          scope,
          locked: scope.item
            ? lensLocked || !!flags[scope.lens]?.items.includes(scope.item)
            : lensLocked,
          owned: false,
          holons: [],
        };
      }
      if (loggedIn && partners.length === 0) {
        try {
          const fed = await getFederationSnapshot(hs, scope.holon);
          partners = fed.federated.map((id) => ({
            id,
            name: $partnerNames[id] ?? fed.partnerNames[id] ?? id,
          }));
          names = { ...names, ...fed.partnerNames };
        } catch {
          partners = [];
        }
      }
    } catch (err) {
      console.error("[kiosk] audience load failed", err);
      if (alive) error = $t("audience.failed");
    } finally {
      if (alive) loading = false;
    }
  }

  async function run(label: string, fn: (h: HoloSphere) => Promise<Audience>) {
    if (!hs || busy) return;
    if (!$isLoggedIn) {
      loginOpen.set(true);
      return;
    }
    busy = label;
    error = "";
    try {
      aud = await fn(hs);
      dispatch("change", aud);
      announce();
    } catch (err) {
      console.error("[kiosk] privacy change failed", err);
      error = err instanceof Error ? err.message : $t("audience.failed");
    } finally {
      busy = "";
    }
  }

  const toggleLock = () =>
    run("lock", (h) => (aud?.locked ? unlock(h, scope) : lock(h, scope)));
  const add = (id: string, name?: string) => {
    if (name) names = { ...names, [id]: name };
    addOpen = false;
    query = "";
    hits = [];
    return run(id, (h) => share(h, scope, id));
  };
  const remove = (id: string) => run(id, (h) => unshare(h, scope, id));

  async function search(q: string) {
    const seq = ++searchSeq;
    const text = q.trim();
    if (!hs || text.length < 2) {
      hits = [];
      return;
    }
    searching = true;
    try {
      const found = await searchHolons(hs, text);
      if (seq !== searchSeq) return;
      hits = found.filter((h) => h.id !== scope.holon && !listed.has(h.id));
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }
  $: void search(query);

  onMount(() => () => {
    alive = false;
  });
</script>

<div class="audience" class:compact>
  <div class="head">
    {#if title}<span class="title">{title}</span>{/if}
    <button
      type="button"
      class="lockbtn"
      class:on={!!aud?.locked}
      aria-pressed={!!aud?.locked}
      aria-label={$t(aud?.locked ? "audience.unlock" : "audience.lock")}
      title={$t(aud?.locked ? "audience.unlock" : "audience.lock")}
      disabled={loading ||
        !!busy ||
        (!!aud?.locked && !aud.owned) ||
        (!!scope.item && lensLocked)}
      on:click={toggleLock}
    >
      <Icon name={aud?.locked ? "lock" : "unlock"} />
      <span class="lbl"
        >{$t(aud?.locked ? "audience.locked" : "audience.open")}</span
      >
    </button>
    {#if aud?.locked && aud.owned && others.length}
      <span class="count"
        >{$t("audience.sharedWith", { n: others.length })}</span
      >
    {/if}
  </div>

  {#if scope.item && lensLocked}
    <p class="note">{$t("audience.lensLocked")}</p>
  {:else if aud?.locked && !aud.owned && $isLoggedIn}
    <p class="note">{$t("audience.notOwner")}</p>
  {:else if aud?.locked && aud.owned}
    <div class="chips">
      {#each aud.holons as h (h.holon)}
        <span
          class="chip"
          class:self={h.self}
          title={$t(
            h.status === "synced"
              ? "audience.synced"
              : h.status === "pending"
                ? "audience.pending"
                : "audience.noReaders",
            { n: h.readers },
          )}
        >
          <span class="dot {h.status}" aria-hidden="true"></span>
          <span class="name"
            >{h.self
              ? $t("audience.members", { name: nameOf(h.holon) })
              : nameOf(h.holon)}</span
          >
          {#if !h.self}
            <button
              type="button"
              class="x"
              aria-label={$t("audience.remove", { name: nameOf(h.holon) })}
              disabled={!!busy}
              on:click={() => remove(h.holon)}><Icon name="close" /></button
            >
          {/if}
        </span>
      {/each}
      <button
        type="button"
        class="chip add"
        aria-expanded={addOpen}
        disabled={!!busy}
        on:click={() => (addOpen = !addOpen)}
        ><Icon name="plus" /> {$t("audience.add")}</button
      >
    </div>
    {#if addOpen}
      <div class="picker">
        {#if candidates.length}
          <p class="group">{$t("audience.federated")}</p>
          <div class="options">
            {#each candidates as p (p.id)}
              <button
                type="button"
                class="opt"
                disabled={!!busy}
                on:click={() => add(p.id, p.name)}>{p.name}</button
              >
            {/each}
          </div>
        {/if}
        <p class="group">{$t("audience.search")}</p>
        <input
          class="search"
          type="search"
          bind:value={query}
          placeholder={$t("audience.searchPlaceholder")}
          autocomplete="off"
          enterkeyhint="search"
        />
        {#if hits.length}
          <div class="options">
            {#each hits as h (h.id)}
              <button
                type="button"
                class="opt"
                disabled={!!busy}
                on:click={() => add(h.id, h.name)}
                >{h.name}{#if h.name !== h.id}<span class="id">{h.id}</span
                  >{/if}</button
              >
            {/each}
          </div>
        {:else if query.trim().length >= 2 && !searching}
          <p class="note">{$t("audience.noHits")}</p>
        {/if}
      </div>
    {/if}
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .audience {
    text-transform: none;
    letter-spacing: 0;
    text-align: left;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .title {
    font-weight: 700;
    color: var(--ink);
  }
  .lockbtn {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 44px;
    min-width: 44px;
    padding: 0 0.8rem;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--muted);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .lockbtn.on {
    background: var(--teal-deep);
    border-color: var(--teal-deep);
    color: #fff;
  }
  .lockbtn:disabled {
    opacity: 0.5;
  }
  .lockbtn :global(svg) {
    width: 1.1em;
    height: 1.1em;
  }
  .compact .lockbtn .lbl {
    display: none;
  }
  .count {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 44px;
    padding: 0 0.3rem 0 0.7rem;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.55);
    border: 1.5px solid var(--line);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--ink);
  }
  .chip.self {
    padding-right: 0.8rem;
    border-style: dashed;
  }
  .chip.add {
    padding: 0 0.8rem;
    border-color: var(--teal-deep);
    color: var(--teal-deep);
  }
  .chip .name {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }
  .dot.synced {
    background: #2f8f5b;
  }
  .dot.pending {
    background: #d9a21b;
  }
  .x {
    width: 44px;
    height: 44px;
    margin: -0.5rem -0.3rem -0.5rem 0;
    border: none;
    background: none;
    color: var(--muted);
    display: grid;
    place-items: center;
  }
  .x :global(svg),
  .chip.add :global(svg) {
    width: 0.9em;
    height: 0.9em;
  }
  .picker {
    margin-top: 0.5rem;
    padding: 0.6rem 0.7rem;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.45);
    border: 1.5px dashed var(--line);
  }
  .group {
    margin: 0.2rem 0 0.3rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.4rem;
  }
  .opt {
    min-height: 44px;
    padding: 0 0.8rem;
    border-radius: 10px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font-weight: 600;
    font-size: 0.85rem;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  .opt .id {
    font-size: 0.7rem;
    color: var(--muted);
    font-weight: 500;
  }
  .search {
    width: 100%;
    min-height: 44px;
    padding: 0 0.7rem;
    border-radius: 10px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 0.9rem;
  }
  .note {
    margin: 0.5rem 0 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--muted);
  }
  .err {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    font-weight: 600;
    color: #9a3b2f;
  }
</style>
