<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A resource base as coloured blocks: one block per gift received, in the
  // eight capitals' order and colour. The colours are never the only cue: the
  // blocks carry their names for a screen reader and a pointer, and `legend`
  // writes them out.
  import {
    capitalColour,
    capitalName,
    capitalRows,
    type Capital,
  } from "$lib/capitals";
  import { t } from "$lib/i18n";

  export let byCapital: Partial<Record<Capital, number>> | null | undefined;
  /** Blocks drawn before the rest is a number. */
  export let max = 24;
  /** Write each capital's name and count beside the blocks. */
  export let legend = false;
  export let size: "small" | "large" = "small";

  $: rows = capitalRows(byCapital);
  $: blocks = rows.flatMap((r) => Array.from({ length: r.n }, () => r.capital));
  $: shown = blocks.slice(0, max);
  $: more = blocks.length - shown.length;
  $: said = rows.map((r) => `${r.n} ${$t(capitalName(r.capital))}`).join(", ");
</script>

{#if rows.length}
  <span class="blocks {size}" role="img" aria-label={said}>
    {#each shown as c, i (i)}
      <i style="background:{capitalColour(c)}" title={$t(capitalName(c))}></i>
    {/each}
    {#if more > 0}<b>+{more}</b>{/if}
  </span>
  {#if legend}
    <ul class="legend">
      {#each rows as r (r.capital)}
        <li>
          <i style="background:{capitalColour(r.capital)}"></i>{$t(
            capitalName(r.capital),
          )}
          <b>{r.n}</b>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .blocks {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    vertical-align: middle;
  }
  .blocks i {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .blocks.large i {
    width: 16px;
    height: 16px;
    border-radius: 4px;
  }
  .blocks b {
    font-size: 0.75rem;
    color: var(--muted);
    margin-left: 2px;
  }
  .legend {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .legend b {
    color: var(--ink);
    font-variant-numeric: tabular-nums;
  }
</style>
