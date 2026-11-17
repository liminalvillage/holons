<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a party by name. The whole map is already on the device, so every
  // keystroke searches it there. What is typed may also be an address or an
  // id pasted from somewhere: those are answered first, as the one party
  // they mean. Pots the map does not reach yet — just started, seated by
  // nobody — are found on the network's registry, below the map's own.
  import {
    listParties,
    resolveParty,
    type FlowPartyKind,
  } from "@holons/core/flows";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/stores";
  import FlowList from "$lib/components/FlowList.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import SnapshotStatus from "$lib/components/SnapshotStatus.svelte";
  import { index } from "$lib/graph";
  import { potFinder } from "$lib/discover";
  import type { HolonSearchHit } from "@holons/core/holosphere";
  import { t, type MessageKey, pctOf } from "$lib/i18n";
  import { addressHref, hrefFor, parseTarget, searchHref } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  const PAGE = 50;
  // Every holon is a pot — one that passes money on to pots or to people —
  // so the filter is pots or people; a link may still name `fund` or `project`.
  type Filter = FlowPartyKind | "pots" | "";
  const KINDS: { kind: Filter; label: MessageKey }[] = [
    { kind: "", label: "search.all" },
    { kind: "pots", label: "search.pots" },
    { kind: "person", label: "eco.people" },
  ];
  const POTS = new Set<FlowPartyKind>(["pot", "fund", "project"]);
  const isKind = (v: string | null): v is FlowPartyKind =>
    v === "fund" ||
    v === "project" ||
    v === "person" ||
    v === "placeholder" ||
    v === "pot";

  let query = $page.url.searchParams.get("q") ?? "";
  const asked = $page.url.searchParams.get("kind");
  let kind: Filter =
    asked === "pots" ? "pots" : isKind(asked) ? (asked as FlowPartyKind) : "";
  let limit = PAGE;

  // The address follows what is typed, without a history entry per letter.
  let synced = "";
  $: {
    const href = searchHref(query, kind || undefined);
    if (href !== synced) {
      synced = href;
      limit = PAGE;
      try {
        replaceState(href, {});
      } catch {
        /* the router is not up yet: the first render already has the URL */
      }
    }
  }

  $: target = parseTarget(query);
  $: exact =
    $index && target && target.type !== "query"
      ? resolveParty($index, target.value)
      : null;
  $: exactNode = exact && $index ? ($index.byId.get(exact.id) ?? null) : null;
  $: matches = $index
    ? kind === "pots"
      ? listParties($index, { query }).filter((r) => POTS.has(r.kind))
      : listParties($index, { query, ...(kind ? { kind } : {}) })
    : [];
  $: rows = matches.slice(0, limit).map(
    (r): FlowListRow => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      value: $pctOf(r.share),
    }),
  );
  // ── Pots on the network, not on this map ──
  let network: HolonSearchHit[] = [];
  const find = potFinder((hits) => (network = hits));
  $: find(kind === "person" ? "" : query);
  $: elsewhere = network.filter((h) => !$index?.byId.has(h.id));

  $: hrefOf = (row: FlowListRow) => {
    const n = $index?.byId.get(row.id);
    return n ? hrefFor(n) : null;
  };
</script>

<svelte:head><title>{$t("nav.search")} · Flows</title></svelte:head>

<h1 class="sr-only">{$t("nav.search")}</h1>
<div class="box">
  <span class="glass"><Icon name="search" /></span>
  <label class="sr-only" for="q">{$t("search.field")}</label>
  <input
    id="q"
    type="search"
    bind:value={query}
    placeholder={$t("search.placeholder")}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    enterkeyhint="search"
  />
</div>

<div class="kinds" role="group" aria-label={$t("search.kindLabel")}>
  {#each KINDS as k (k.kind)}
    <button
      class:on={kind === k.kind}
      aria-pressed={kind === k.kind}
      on:click={() => (kind = k.kind)}>{$t(k.label)}</button
    >
  {/each}
</div>

<SnapshotStatus />

{#if $index}
  {#if exactNode}
    <h2 class="section-title">
      {exact?.via === "address"
        ? $t("search.byAddress")
        : exact?.via === "alias"
          ? $t("search.byClaim")
          : $t("search.byId")}
    </h2>
    <FlowList
      rows={[
        {
          id: exactNode.id,
          label: exactNode.label,
          kind: exactNode.kind,
          value: $pctOf(exactNode.share),
        },
      ]}
      {hrefOf}
    />
    {#if exact?.others?.length && target?.type === "address"}
      <a class="more" href={addressHref(target.value)}
        >{$t("search.alsoPaid", { n: exact.others.length })}</a
      >
    {/if}
  {/if}

  {#if rows.length}
    <p class="muted count" role="status">
      {$t("search.count", { n: matches.length })}
    </p>
    <FlowList {rows} {hrefOf} />
    {#if matches.length > limit}
      <button class="btn quiet wide" on:click={() => (limit += PAGE)}
        >{$t("search.more", {
          n: Math.min(PAGE, matches.length - limit),
        })}</button
      >
    {/if}
  {:else if !exactNode && elsewhere.length}
    <!-- Nothing on the map; the network's list follows. -->
  {:else if !exactNode && target?.type === "address"}
    <!-- An address may be paid by the Pot's table without being on the map. -->
    <p class="muted count" role="status">
      <a href={addressHref(target.value)}>{$t("search.noneAtAddress")}</a>
    </p>
  {:else if !exactNode}
    <p class="muted count" role="status">{$t("search.none")}</p>
  {/if}

  {#if elsewhere.length}
    <h2 class="section-title">{$t("search.network")}</h2>
    <p class="muted count">{$t("search.networkLead")}</p>
    <ul class="net">
      {#each elsewhere as h (h.id)}
        <li>
          <a href="/h/{encodeURIComponent(h.id)}">
            <span class="who">
              <b>{h.name}</b>
              <!-- Two pots may share a name: the id tells them apart. -->
              <i>{h.id}</i>
            </span>
            <Icon name="chevron-right" />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .net {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .net a {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 52px;
    padding: 0 14px;
    border-radius: 14px;
    background: var(--card);
    border: 1px solid var(--line);
    color: var(--ink);
    text-decoration: none;
  }
  .net .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .net b {
    font-weight: 700;
    overflow-wrap: anywhere;
  }
  .net i {
    font-style: normal;
    font-size: 0.76rem;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .box {
    position: relative;
  }
  .glass {
    position: absolute;
    left: 14px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    font-size: 1.15rem;
    display: inline-flex;
    pointer-events: none;
  }
  input {
    width: 100%;
    min-height: 52px;
    padding: 0 14px 0 44px;
    border-radius: 14px;
    border: 1.5px solid var(--line);
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  .kinds {
    display: flex;
    gap: 8px;
    margin: 12px 0;
    overflow-x: auto;
    padding-bottom: 2px;
  }
  .kinds button {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1.5px solid var(--line);
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .kinds button.on {
    background: var(--teal);
    border-color: var(--teal);
    color: var(--on-teal);
  }
  .count {
    font-size: 0.85rem;
    margin: 12px 0 8px;
  }
  .more {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    font-weight: 700;
  }
  .wide {
    width: 100%;
    margin-top: 12px;
  }
</style>
