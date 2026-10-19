<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The same parties a diagram draws, as rows. A bar can be a hair tall; a
  // row is always a full finger. It is also the diagram for anyone who does
  // not see it: real buttons, in order, each saying who and how much.
  import Icon from "./Icon.svelte";
  import KindChip from "./KindChip.svelte";
  import { t } from "$lib/i18n";
  import type { FlowListRow } from "$lib/viewTypes";

  export let rows: FlowListRow[] = [];
  export let selectedId: string | null = null;
  /** A row with a link is an anchor; one without calls `onSelect`. */
  export let hrefOf: ((row: FlowListRow) => string | null) | null = null;
  export let onSelect: ((row: FlowListRow) => void) | null = null;
  /**
   * Rows shown before a "Show more" — a Pot pays thousands directly, and a
   * page of thousands of rows is no list. 0 shows them all.
   */
  export let limit = 0;

  let shown = limit;
  let from: FlowListRow[] | null = null;
  // Another party's rows start short again.
  $: if (rows !== from) {
    from = rows;
    shown = limit;
  }
  $: visible = shown > 0 ? rows.slice(0, shown) : rows;
</script>

<ul class="list">
  {#each visible as row (row.id)}
    {@const href = hrefOf?.(row) ?? null}
    <li>
      <svelte:element
        this={href ? "a" : "button"}
        class="row"
        class:selected={selectedId === row.id}
        {href}
        role={href ? undefined : "button"}
        on:click={() => {
          if (!href) onSelect?.(row);
        }}
      >
        <span class="who">
          <span class="name">{row.label}</span>
          <span class="meta">
            <KindChip kind={row.kind} />
            {#if row.note}<span class="note">{row.note}</span>{/if}
          </span>
        </span>
        <span class="value">{row.value}</span>
        <span class="go"><Icon name="chevron-right" /></span>
      </svelte:element>
    </li>
  {/each}
</ul>
{#if visible.length < rows.length}
  <button class="btn quiet wide more" on:click={() => (shown += limit * 2)}
    >{$t("common.showMore", {
      n: Math.min(limit * 2, rows.length - visible.length),
    })}</button
  >
{/if}

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 56px;
    padding: 8px 12px 8px 14px;
    text-align: left;
    text-decoration: none;
    color: inherit;
    font: inherit;
  }
  .row.selected {
    background: var(--teal-wash);
  }
  .who {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .note {
    font-size: 0.76rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .value {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .more {
    margin-top: 8px;
  }
  .go {
    color: var(--muted);
    display: inline-flex;
  }
</style>
