<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Ledger — every entry the diagrams are drawn from, as rows a thumb can
  // work. Same core walk as the Sankey (`buildLedger`), so a row and the bar
  // above it are the same number. Filters are pills; a row opens a sheet;
  // the sheet's "grouped as" narrows the list to that bar's entries.

  import {
    filterLedger,
    ledgerTrackKey,
    sortLedger,
    summarizeLedger,
    type LedgerDirection,
    type LedgerEntry,
    type LedgerSource,
    type LedgerTotals,
    type ValueFlowTrack,
  } from "@holons/core/flows";
  import PillSwitch from "./PillSwitch.svelte";
  import Sheet from "./Sheet.svelte";
  import Avatar from "./Avatar.svelte";
  import { formatter, relativeDay, stampFmt, trackLabel } from "./format";

  export let entries: LedgerEntry[] = [];
  /** Narrow to one unit (`id:unit`); empty for every unit. */
  export let track = "";
  /** Narrow to one Sankey bar; empty for every bar. */
  export let node = "";
  export let search = "";

  const PAGE = 40;

  const SOURCES: { id: LedgerSource | "all"; label: string }[] = [
    { id: "all", label: "Every source" },
    { id: "expenses", label: "Expenses" },
    { id: "rea", label: "Activity" },
    { id: "opencollective", label: "OpenCollective" },
    { id: "derived", label: "Rules" },
  ];

  let direction: LedgerDirection | "all" = "all";
  let source: LedgerSource | "all" = "all";
  let newestFirst = true;
  let limit = PAGE;
  let open: LedgerEntry | null = null;

  // Unit pills, in the order the entries first mention them.
  $: tracks = [
    ...new Map(
      entries.map((e) => [ledgerTrackKey(e), { id: e.track, unit: e.unit } as ValueFlowTrack]),
    ),
  ];

  // A window change can retire the unit being filtered on; fall back to
  // everything rather than showing an empty list with no visible cause.
  $: if (track && !tracks.some(([key]) => key === track)) track = "";
  $: if (node && !entries.some((e) => e.nodeId === node)) node = "";

  $: filtered = sortLedger(
    filterLedger(entries, { query: search, track, direction, nodeId: node, source }),
    newestFirst,
  );
  $: totals = summarizeLedger(filtered);

  $: filterKey = `${search}|${direction}|${track}|${node}|${source}`;
  $: if (filterKey) limit = PAGE;
  $: visible = filtered.slice(0, limit);

  $: nodeLabel = entries.find((e) => e.nodeId === node)?.nodeLabel ?? node;
  $: hasFilter = !!search || direction !== "all" || !!track || !!node || source !== "all";

  function clear() {
    search = "";
    direction = "all";
    track = "";
    node = "";
    source = "all";
  }

  const fmt = (e: LedgerEntry) => formatter({ id: e.track, unit: e.unit }, e.track === "money" ? 2 : 1)(e.amount);
  const fmtTotal = (t: LedgerTotals, v: number) =>
    formatter({ id: t.track, unit: t.unit }, t.track === "money" ? 2 : 1)(v);
  const sourceLabel = (s: LedgerSource) => SOURCES.find((x) => x.id === s)?.label ?? s;
  const others = (e: LedgerEntry) => e.participants.filter((n) => n !== e.party);
</script>

<section class="panel">
  <header class="head">
    <div class="titles">
      <h2>Ledger</h2>
      <p class="sub">Every entry the diagrams are drawn from.</p>
    </div>
  </header>

  <div class="search">
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
    <input
      type="search"
      bind:value={search}
      aria-label="Search the ledger"
      placeholder="A name, a note, a source…"
    />
  </div>

  <div class="filters">
    <PillSwitch
      options={[
        { id: "all", label: "All" },
        { id: "in", label: "In" },
        { id: "out", label: "Out" },
      ]}
      value={direction}
      onChange={(id) => (direction = id as LedgerDirection | "all")}
      label="Which way it moved"
    />
    {#if tracks.length > 1}
      <PillSwitch
        options={[
          { id: "", label: "Every unit" },
          ...tracks.map(([key, t]) => ({ id: key, label: trackLabel(t) })),
        ]}
        value={track}
        onChange={(id) => (track = id)}
        label="Which unit"
        compact
      />
    {/if}
    <PillSwitch
      options={SOURCES}
      value={source}
      onChange={(id) => (source = id as LedgerSource | "all")}
      label="Which source"
      compact
    />
    <PillSwitch
      options={[
        { id: "new", label: "Newest first" },
        { id: "old", label: "Oldest first" },
      ]}
      value={newestFirst ? "new" : "old"}
      onChange={(id) => (newestFirst = id === "new")}
      label="Sort order"
      compact
    />
    {#if node}
      <button type="button" class="chip" on:click={() => (node = "")} title="Show every entry again">
        In {nodeLabel} <span aria-hidden="true">✕</span>
      </button>
    {/if}
    {#if hasFilter}
      <button type="button" class="link" on:click={clear}>Clear</button>
    {/if}
  </div>

  <div class="totals">
    <span class="count">
      {filtered.length}
      {filtered.length === 1 ? "entry" : "entries"}
      {#if filtered.length !== entries.length}
        <span class="dim">of {entries.length}</span>
      {/if}
    </span>
    <!-- One total per unit: hours are not euros, and this repo has no
         exchange rate that could honestly merge them. -->
    {#each totals as t (t.key)}
      <span class="total">
        <span class="dim">{trackLabel({ id: t.track, unit: t.unit })}</span>
        <span class="in">+{fmtTotal(t, t.totalIn)}</span>
        <span class="out">−{fmtTotal(t, t.totalOut)}</span>
      </span>
    {/each}
  </div>

  {#if !filtered.length}
    <p class="empty">
      No entry matches that.
      <button type="button" class="link" on:click={clear}>Clear the filters</button>
    </p>
  {:else}
    <ul class="rows">
      {#each visible as e (e.id)}
        <li>
          <button type="button" class="row" class:derived={e.derived} on:click={() => (open = e)}>
            {#if e.partyId}
              <Avatar id={e.partyId} name={e.party} size={40} />
            {:else}
              <span class="mark {e.direction}" aria-hidden="true">{e.direction === "in" ? "↓" : "↑"}</span>
            {/if}
            <span class="body">
              <span class="title">
                <span class="arrow {e.direction}" aria-hidden="true">{e.direction === "in" ? "↓" : "↑"}</span>
                <span class="sr-only">{e.direction === "in" ? "In from" : "Out to"}</span>
                {e.party}
                {#if e.derived}<span class="badge">rule</span>{/if}
              </span>
              <span class="meta">
                {e.description || e.nodeLabel}{others(e).length ? ` · with ${others(e).join(", ")}` : ""}
              </span>
            </span>
            <span class="right">
              <span class="amount {e.direction}">{e.direction === "in" ? "+" : "−"}{fmt(e)}</span>
              <span class="date">{relativeDay(e.timestamp)}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
    {#if filtered.length > visible.length}
      <button type="button" class="more" on:click={() => (limit += PAGE)}>
        Show {Math.min(PAGE, filtered.length - visible.length)} more
      </button>
    {/if}
  {/if}
</section>

{#if open}
  {@const e = open}
  <Sheet title={e.description || e.nodeLabel} on:close={() => (open = null)}>
    <p class="big {e.direction}">{e.direction === "in" ? "+" : "−"}{fmt(e)}</p>
    <p class="sub">{stampFmt.format(e.timestamp)}</p>
    <dl class="detail">
      <div class="drow">
        <dt>{e.direction === "in" ? "From" : "To"}</dt>
        <dd class="with-face">
          {#if e.partyId}<Avatar id={e.partyId} name={e.party} size={24} />{/if}
          {e.party}
        </dd>
      </div>
      {#if others(e).length}
        <div class="drow"><dt>With</dt><dd>{others(e).join(", ")}</dd></div>
      {/if}
      <div class="drow"><dt>Kind</dt><dd>{e.kind}{e.derived ? " (rule)" : ""}</dd></div>
      <div class="drow"><dt>Source</dt><dd>{sourceLabel(e.source)}</dd></div>
      <div class="drow">
        <dt>Grouped as</dt>
        <dd>
          <button
            type="button"
            class="link"
            on:click={() => {
              node = e.nodeId;
              track = ledgerTrackKey(e);
              open = null;
            }}
          >
            {e.nodeLabel}
          </button>
        </dd>
      </div>
      {#if e.reference}
        <div class="drow"><dt>Record</dt><dd class="mono">{e.reference}</dd></div>
      {/if}
    </dl>
  </Sheet>
{/if}

<style>
  .panel {
    animation: flows-rise 0.42s ease both;
  }

  .head {
    margin-bottom: 0.8rem;
  }

  h2 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
    margin-bottom: 0.6rem;
  }

  .search-icon {
    position: absolute;
    left: 0.9rem;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
  }

  .search input {
    width: 100%;
    min-height: 2.9rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-text-primary);
    font-size: 0.95rem;
    padding: 0.5rem 1rem 0.5rem 2.4rem;
  }

  .search input:focus {
    outline: none;
    border-color: #0f766e;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.7rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.5rem;
    background: #0f766e;
    color: #f0fdfa;
    border-radius: 999px;
    font-size: 0.82rem;
    padding: 0 0.8rem;
  }

  .link {
    color: #5eead4;
    font-size: 0.82rem;
    text-decoration: underline;
    min-height: 2.5rem;
    padding: 0 0.2rem;
  }

  .totals {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem 1.1rem;
    font-size: 0.82rem;
    color: var(--color-text-secondary);
    margin-bottom: 0.6rem;
  }

  .count,
  .dim {
    color: var(--color-text-muted);
  }

  .total {
    display: inline-flex;
    gap: 0.45rem;
    align-items: baseline;
  }

  .in {
    color: #5eead4;
  }

  .out {
    color: #fca5a5;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.45rem;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 3.6rem;
    padding: 0.55rem 0.7rem;
    border-radius: 14px;
    background: var(--color-bg-secondary);
    border: 1.5px solid var(--color-border);
    text-align: left;
    touch-action: manipulation;
    transition: transform 0.1s ease;
  }

  .row:active {
    transform: scale(0.985);
  }

  .row.derived .title,
  .row.derived .amount {
    color: var(--color-text-muted);
  }

  .mark {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--color-bg-tertiary);
    font-weight: 700;
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .title {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
    font-weight: 600;
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .arrow.in,
  .mark.in {
    color: #5eead4;
  }

  .arrow.out,
  .mark.out {
    color: #fca5a5;
  }

  .meta {
    font-size: 0.78rem;
    color: var(--color-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    display: inline-block;
    background: var(--color-bg-tertiary);
    color: var(--color-text-muted);
    border-radius: 999px;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.05rem 0.4rem;
  }

  .right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    white-space: nowrap;
  }

  .amount {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .date {
    font-size: 0.72rem;
    color: var(--color-text-muted);
  }

  .more {
    margin-top: 0.7rem;
    width: 100%;
    min-height: 2.75rem;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    color: var(--color-text-secondary);
    font-size: 0.85rem;
  }

  .empty {
    color: var(--color-text-muted);
    text-align: center;
    padding: 2rem 1rem;
  }

  .big {
    margin: 0;
    font-size: 1.8rem;
  }

  .detail {
    margin: 0.8rem 0 0;
    display: grid;
    gap: 0.6rem;
  }

  .drow {
    display: flex;
    gap: 1rem;
    justify-content: space-between;
    align-items: flex-start;
    font-size: 0.92rem;
  }

  .drow dt {
    color: var(--color-text-muted);
    flex: 0 0 auto;
  }

  .drow dd {
    margin: 0;
    color: var(--color-text-primary);
    text-align: right;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .with-face {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .mono {
    font-family: var(--font-family-mono, monospace);
    font-size: 0.8rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes flows-rise {
    from {
      opacity: 0;
      translate: 0 14px;
    }
    to {
      opacity: 1;
      translate: 0 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .panel {
      animation: none;
    }
  }
</style>
