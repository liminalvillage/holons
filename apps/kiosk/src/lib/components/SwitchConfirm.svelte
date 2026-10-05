<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // "Go to another hub?" — the gate before a provenance badge leaves the
  // shown board for the holon a card came from. Leaving is a change of place
  // (the board closes into the map, another opens), so it never happens on a
  // stray tap. Driven by `switchRequest` in lib/dock; the yes closes any open
  // card first, then hands over to `confirmSwitch`.
  import Modal from "./Modal.svelte";
  import {
    cancelSwitch,
    confirmSwitch,
    labelFor,
    switchRequest,
  } from "$lib/dock";
  import { closeDetail, holonName } from "$lib/stores";
  import { t } from "$lib/i18n";

  $: req = $switchRequest;
  $: to = req ? req.name?.trim() || labelFor(req.id) : "";
  $: from = req?.from ? $holonName.trim() || labelFor(req.from) : "";

  function go(): void {
    closeDetail();
    confirmSwitch();
  }
</script>

{#if req}
  <Modal on:close={cancelSwitch}>
    <div class="confirm">
      <h4>{$t("switch.title")}</h4>
      <p class="lead">{$t("switch.lead", { to })}</p>
      <p>
        {from
          ? $t("switch.body", { from, to })
          : $t("switch.bodyNoFrom", { to })}
      </p>
      <div class="confirm-actions">
        <button type="button" on:click={cancelSwitch}>
          {$t("common.cancel")}
        </button>
        <button type="button" class="primary" on:click={go}>
          {$t("switch.open", { to })}
        </button>
      </div>
    </div>
  </Modal>
{/if}

<style>
  .confirm {
    text-align: left;
    color: var(--ink);
  }
  .confirm h4 {
    margin: 0 0 0.8rem;
    font-size: 1.15rem;
    color: var(--ink);
  }
  .confirm p {
    margin: 0 0 0.7rem;
    font-size: 0.92rem;
    line-height: 1.45;
    color: var(--muted);
  }
  .confirm .lead {
    font-size: 1rem;
    font-weight: 700;
    color: var(--ink);
  }
  .confirm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    margin-top: 1.1rem;
  }
  .confirm-actions button {
    flex: 1;
    min-width: 8rem;
    min-height: 52px;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    color: var(--teal-deep);
    font-size: 0.95rem;
    font-weight: 700;
    transition: transform 0.1s ease;
  }
  .confirm-actions button.primary {
    background: var(--teal);
    border-color: var(--teal);
    color: #fff;
    box-shadow: var(--shadow-soft);
  }
  .confirm-actions button:active {
    transform: scale(0.97);
  }
</style>
