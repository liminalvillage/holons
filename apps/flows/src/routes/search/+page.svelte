<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Find a party by name. The whole map is already on the device, so every
  // keystroke searches it there. What is typed may also be an address or an
  // id pasted from somewhere: those are answered first, as the one party
  // they mean.
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
  import { pct } from "$lib/format";
  import { index } from "$lib/graph";
  import { t, type MessageKey } from "$lib/i18n";
  import { addressHref, hrefFor, parseTarget, searchHref } from "$lib/urls";
  import type { FlowListRow } from "$lib/viewTypes";

  const PAGE = 50;
  const KINDS: { kind: FlowPartyKind | ""; label: MessageKey }[] = [
    { kind: "", label: "search.all" },
    { kind: "fund", label: "eco.funds" },
    { kind: "project", label: "eco.projects" },
    { kind: "person", label: "eco.people" },
  ];
  const isKind = (v: string | null): v is FlowPartyKind =>
    v === "fund" ||
    v === "project" ||
    v === "person" ||
    v === "placeholder" ||
    v === "pot";

  let query = $page.url.searchParams.get("q") ?? "";
  let kind: FlowPartyKind | "" = isKind($page.url.searchParams.get("kind"))
    ? ($page.url.searchParams.get("kind") as FlowPartyKind)
    : "";
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
    ? listParties($index, { query, ...(kind ? { kind } : {}) })
    : [];
  $: rows = matches.slice(0, limit).map(
    (r): FlowListRow => ({
      id: r.id,
      label: r.label,
      kind: r.kind,
      value: pct(r.share),
    }),
  );
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
          value: pct(exactNode.share),
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
  {:else if !exactNode}
    <p class="muted count" role="status">{$t("search.none")}</p>
  {/if}
{/if}

<style>
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
