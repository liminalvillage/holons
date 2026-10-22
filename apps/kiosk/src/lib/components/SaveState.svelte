<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // What an autosaving form says about its write, as a small pill that sits
  // where the eye already goes — a sheet's corner, beside its ✕ — so it stays
  // in view however far the form is scrolled: "Saving…", then "Saved" for a
  // moment, or a failure that is itself the retry button. Nothing at all while
  // there is nothing to say.
  import type { Autosaver } from "$lib/autosave";
  import { t } from "$lib/i18n";
  import Icon from "./Icon.svelte";

  export let saver: Autosaver;
</script>

<span class="save-state" role="status" aria-live="polite">
  {#if $saver === "saving"}
    <span class="pill">{$t("common.saving")}</span>
  {:else if $saver === "saved"}
    <span class="pill"><Icon name="check" /> {$t("common.saved")}</span>
  {:else if $saver === "error"}
    <button type="button" class="pill err" on:click={() => void saver.retry()}
      ><Icon name="warning" /> {$t("common.saveFailed")}</button
    >
  {/if}
</span>

<style>
  .save-state {
    display: inline-flex;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-height: 32px;
    padding: 0 0.75rem;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
    color: var(--ink-soft);
    background: var(--glass);
    border: none;
    animation: kiosk-fade 0.2s ease both;
  }
  .err {
    min-height: 44px;
    color: var(--on-danger);
    background: var(--danger);
    cursor: pointer;
  }
</style>
