<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One icon from the catalog (`$lib/icons`), drawn inline so it renders the
  // same on every device. Sized 1em and coloured `currentColor`, it sits in
  // text like a glyph would — the caller sets font-size and colour on the
  // element around it, never on the icon.
  import { ICONS, type IconName } from "$lib/icons";

  export let name: IconName;
  /** Extra class for the caller's own styling. */
  let className = "";
  export { className as class };

  $: def = ICONS[name];
</script>

<svg
  class="icon {className}"
  viewBox="0 0 24 24"
  aria-hidden="true"
  focusable="false"
>
  {#each def.paths as p, i (i)}
    <path d={p.d} class:filled={p.fill} />
  {/each}
</svg>

<style>
  .icon {
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    vertical-align: -0.125em;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    overflow: visible;
  }
  .filled {
    fill: currentColor;
    stroke: none;
  }
</style>
