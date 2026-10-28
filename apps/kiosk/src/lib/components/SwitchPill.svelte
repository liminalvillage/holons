<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // An on/off switch dressed as a pill for the pills band: an icon, a word,
  // and a small track at its tail. The band's device-wide toggles (Show
  // federated, the Tasks views' Done) are this with their own store.
  import Icon from "./Icon.svelte";
  import type { IconName } from "$lib/icons";

  export let on: boolean;
  export let icon: IconName;
  export let label: string;
  /** What the switch does, for assistive tech (the word alone is terse). */
  export let aria: string;
  export let onToggle: () => void;
  /** Hide the text label (the band is packing pills onto one row). */
  export let compact = false;
  /** Force the text label on regardless of screen width. */
  export let expanded = false;
</script>

<button
  type="button"
  class="switch"
  class:on
  class:compact
  class:expanded
  role="switch"
  aria-checked={on}
  aria-label={aria}
  title={label}
  on:click={onToggle}
>
  <Icon name={icon} class="picon" />
  <span class="txt">{label}</span>
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</button>

<style>
  /* Same paper track as the segmented pills beside it (see PillSwitch), with
     a small switch at its tail saying on/off. */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    height: calc(2.5rem + 8px);
    padding: 0 0.6rem 0 0.85rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--muted);
    touch-action: manipulation;
    transition:
      color 0.2s ease,
      transform 0.1s ease;
  }
  .switch:active {
    transform: scale(0.95);
  }
  .switch :global(.picon) {
    width: 1.1rem;
    height: 1.1rem;
    color: var(--ink);
  }
  .switch.on {
    color: var(--teal-ink);
  }
  .switch.on :global(.picon) {
    color: var(--teal-ink);
  }
  .txt {
    font-size: 0.86rem;
    font-weight: 700;
    color: inherit;
  }
  .track {
    position: relative;
    width: 2.1rem;
    height: 1.25rem;
    border-radius: 999px;
    background: var(--paper-deep);
    transition: background 0.2s ease;
    flex: none;
  }
  .knob {
    position: absolute;
    top: 0.15rem;
    left: 0.15rem;
    width: 0.95rem;
    height: 0.95rem;
    border-radius: 50%;
    background: var(--card);
    box-shadow: var(--shadow-soft);
    transition: transform 0.2s ease;
  }
  .switch.on .track {
    background: var(--teal);
  }
  .switch.on .knob {
    transform: translateX(0.85rem);
  }
  /* Small screens drop the word; the icon and the switch carry it. */
  @media (max-width: 560px) {
    .txt {
      display: none;
    }
  }
  .switch.compact .txt {
    display: none;
  }
  .switch.expanded .txt {
    display: inline;
  }
</style>
