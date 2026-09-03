<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // The framing that gates switching the Status board ON: a ranking changes
  // how a group reads itself, so nobody turns one on without having read what
  // it does and doesn't mean. Shared by Settings and the tab strip's "+" menu
  // so both paths pass through the same words. Turning it off needs no
  // ceremony.
  import { createEventDispatcher } from "svelte";
  import Modal from "./Modal.svelte";
  import { t } from "$lib/i18n";

  const dispatch = createEventDispatcher<{ close: void; accept: void }>();
</script>

<Modal on:close={() => dispatch("close")}>
  <div class="confirm">
    <h4>{$t("settings.statusConfirmTitle")}</h4>
    <p class="lead">{$t("status.disclaimerLead")}</p>
    <p>{$t("status.disclaimerBody")}</p>
    <p>{$t("status.disclaimerUse")}</p>
    <p>{$t("status.disclaimerEquation")}</p>
    <div class="confirm-actions">
      <button type="button" on:click={() => dispatch("close")}>
        {$t("common.cancel")}
      </button>
      <button type="button" class="primary" on:click={() => dispatch("accept")}>
        {$t("settings.statusConfirmAccept")}
      </button>
    </div>
  </div>
</Modal>

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
  /* Beats the generic rule above (same file order, higher specificity). */
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
