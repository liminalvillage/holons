<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The "Show federated" switch — whether every view folds the federation
  // partners' items in beside this holon's own. Off shows the holon (its own
  // records plus the holograms placed in it); on adds every partner's. One
  // device-wide choice shared by all views; the orthogonal Layout pill only
  // changes how items render. Mirrored cards keep their glow edge either way,
  // coloured by the hash of the holon they belong to.
  import Icon from "./Icon.svelte";
  import { scope } from "$lib/stores";
  import { setScope, type Scope } from "$lib/config";
  import { t } from "$lib/i18n";

  /** Hide the text label (the band is packing pills onto one row). */
  export let compact = false;
  /** Force the text label on regardless of screen width. */
  export let expanded = false;

  $: on = $scope === "networked";

  function toggle() {
    const next: Scope = on ? "all" : "networked";
    scope.set(next);
    setScope(next);
  }
</script>

<button
  type="button"
  class="fedswitch"
  class:on
  class:compact
  class:expanded
  role="switch"
  aria-checked={on}
  aria-label={$t("scope.aria")}
  title={$t("scope.federated")}
  on:click={toggle}
>
  <Icon name="globe" class="picon" />
  <span class="txt">{$t("scope.federated")}</span>
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</button>

<style>
  /* Same paper track as the segmented pills beside it (see PillSwitch), with
     a small switch at its tail saying on/off. */
  .fedswitch {
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
  .fedswitch:active {
    transform: scale(0.95);
  }
  .fedswitch :global(.picon) {
    width: 1.1rem;
    height: 1.1rem;
    color: var(--ink);
  }
  .fedswitch.on {
    color: var(--teal-deep);
  }
  .fedswitch.on :global(.picon) {
    color: var(--teal-deep);
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
  .fedswitch.on .track {
    background: var(--teal);
  }
  .fedswitch.on .knob {
    transform: translateX(0.85rem);
  }
  /* Small screens drop the word; the icon and the switch carry it. */
  @media (max-width: 560px) {
    .txt {
      display: none;
    }
  }
  .fedswitch.compact .txt {
    display: none;
  }
  .fedswitch.expanded .txt {
    display: inline;
  }
</style>
