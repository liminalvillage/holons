<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A holon's mark (`$lib/identicon`), drawn inline. Like Icon it is sized
  // 1em and painted `currentColor`, so the caller sets the size and the
  // colour on the element around it. Decorative: the name beside it is the
  // accessible text.
  import { IDENTICON_SIZE, identiconCells } from "$lib/identicon";

  export let seed: string;
  /** Extra class for the caller's own styling. */
  let className = "";
  export { className as class };

  $: cells = identiconCells(seed);
</script>

<svg
  class="identicon {className}"
  viewBox="0 0 {IDENTICON_SIZE} {IDENTICON_SIZE}"
  aria-hidden="true"
  focusable="false"
>
  {#each cells as [c, r] (c * IDENTICON_SIZE + r)}
    <rect x={c} y={r} width="1" height="1" />
  {/each}
</svg>

<style>
  .identicon {
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    fill: currentColor;
    /* Adjacent cells must meet without a hairline seam between them. */
    shape-rendering: crispEdges;
    overflow: visible;
  }
</style>
