<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Shares, or amounts in one of the units the Pot holds. Shown only when
  // there is something to count: an empty Pot has only shares to show.
  import { t } from "$lib/i18n";

  export let units: string[] = [];
  /** "" is shares. */
  export let value = "";
  export let hrefOf: (unit: string) => string;
</script>

{#if units.length}
  <div class="switch" role="group" aria-label={$t("unit.label")}>
    <a
      href={hrefOf("")}
      class:on={value === ""}
      aria-current={value === "" ? "true" : undefined}
      data-sveltekit-replacestate
      data-sveltekit-noscroll>{$t("unit.share")}</a
    >
    {#each units as unit (unit)}
      <a
        href={hrefOf(unit)}
        class:on={value === unit}
        aria-current={value === unit ? "true" : undefined}
        data-sveltekit-replacestate
        data-sveltekit-noscroll>{unit}</a
      >
    {/each}
  </div>
{/if}

<style>
  .switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--paper-deep);
    max-width: 100%;
    overflow-x: auto;
  }
  a {
    min-height: 40px;
    padding: 0 16px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    font-size: 0.88rem;
    font-weight: 700;
    text-decoration: none;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  a.on {
    background: var(--card);
    color: var(--ink);
    box-shadow: var(--shadow-soft);
  }
</style>
