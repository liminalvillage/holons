<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // One row of radio chips that never wraps and scrolls sideways, its right
  // edge fading while there is more. A chip given a `colour` wears it — a
  // unit's colour from `$lib/unithues`, the same as its Sankey lane — tinted
  // at rest, solid (darkened enough for white text) when picked.
  //
  // Used for the Flows board's unit and period strip and for the currency
  // row of the add-expense sheet, so a unit looks the same wherever it is
  // chosen.
  export let options: { id: string; label: string; colour?: string }[] = [];
  export let value: string | null = null;
  export let onPick: (id: string) => void = () => {};
  /** Id of the element naming the group, or a label of its own. */
  export let labelledby: string | undefined = undefined;
  export let label: string | undefined = undefined;
</script>

<div
  class="chips"
  role="radiogroup"
  tabindex="-1"
  aria-labelledby={labelledby}
  aria-label={labelledby ? undefined : label}
>
  {#each options as o (o.id)}
    <button
      type="button"
      role="radio"
      class="chip"
      class:unit={!!o.colour}
      style:--u={o.colour}
      class:on={value === o.id}
      aria-checked={value === o.id}
      on:click={() => onPick(o.id)}
      >{#if o.colour}<i class="dot"></i>{/if}{o.label}</button
    >
  {/each}
  <!-- A trailing action (the unit row's ✎), riding the same scroll. -->
  <slot name="end" />
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.35rem;
    padding: 0.25rem 1.5rem 0.25rem 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    mask-image: linear-gradient(
      to right,
      #000 calc(100% - 1.5rem),
      transparent
    );
  }
  .chips::-webkit-scrollbar {
    display: none;
  }
  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 32px;
    padding: 0 0.7rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 700;
    font-size: 0.78rem;
    white-space: nowrap;
    touch-action: manipulation;
    transition:
      background 0.18s ease,
      transform 0.1s ease;
  }
  .chip:active {
    transform: scale(0.95);
  }
  .chip.on {
    background: var(--teal);
    color: var(--on-teal);
    box-shadow: var(--shadow-soft);
  }
  .chip.unit {
    background: color-mix(in srgb, var(--u) 16%, var(--paper));
    color: var(--ink);
  }
  .chip.unit.on {
    background: color-mix(in srgb, var(--u) 72%, black);
    color: #fff;
  }
  .dot {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--u);
  }
  .chip.unit.on .dot {
    background: #fff;
  }
</style>
