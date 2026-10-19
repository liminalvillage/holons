<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A steward putting a resource on offer — a workspace, a tool library,
  // design hours — with its terms of access: when, for whom, how. The terms
  // are stored with the offer on the holon's public settings, so whoever can
  // see the offer sees the same terms.
  import type { FlowGraphNode, ResourceOffer } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import { CAPITALS, capitalName, type Capital } from "$lib/capitals";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { removeOffer, saveOffer } from "$lib/resources";

  export let holon: FlowGraphNode;
  /** The offer being edited; null for a new one. */
  export let offer: ResourceOffer | null = null;

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  let capital: Capital = offer?.capital ?? "material";
  let title = offer?.title ?? "";
  let quantity: number | null = offer?.quantity ?? null;
  let unit = offer?.unit ?? "";
  let when = offer?.terms.when ?? "";
  let who = offer?.terms.who ?? "";
  let how = offer?.terms.how ?? "";
  let note = offer?.note ?? "";
  let busy = false;
  let error = "";

  async function save() {
    busy = true;
    error = "";
    try {
      await saveOffer(holon.id, {
        ...(offer ? { id: offer.id } : {}),
        capital,
        title,
        ...(quantity && quantity > 0 ? { quantity } : {}),
        ...(unit.trim() ? { unit } : {}),
        terms: { when, who, how },
        ...(note.trim() ? { note } : {}),
      });
      showNotice($t("offer.saved"));
      dispatch("changed");
      dispatch("close");
    } catch {
      error = $t("offer.failed");
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!offer) return;
    busy = true;
    error = "";
    try {
      await removeOffer(holon.id, offer.id);
      showNotice($t("offer.removed"));
      dispatch("changed");
      dispatch("close");
    } catch {
      error = $t("offer.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={offer ? $t("offer.editTitle") : $t("offer.newTitle")}
  on:close={() => dispatch("close")}
>
  <p class="muted lead">{$t("offer.lead")}</p>
  <form on:submit|preventDefault={save}>
    <label class="field">
      <span>{$t("give.capital")}</span>
      <select bind:value={capital}>
        {#each CAPITALS as c (c)}
          <option value={c}>{$t(capitalName(c))}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{$t("offer.title")}</span>
      <input
        bind:value={title}
        maxlength="120"
        required
        placeholder={$t("offer.titlePlaceholder")}
      />
    </label>
    <div class="row">
      <label class="field">
        <span>{$t("give.amount")}</span>
        <input type="number" min="0" step="any" bind:value={quantity} />
      </label>
      <label class="field">
        <span>{$t("give.unit")}</span>
        <input bind:value={unit} maxlength="40" />
      </label>
    </div>
    <fieldset>
      <legend>{$t("offer.terms")}</legend>
      <label class="field">
        <span>{$t("offer.when")}</span>
        <input
          bind:value={when}
          maxlength="200"
          placeholder={$t("offer.whenPlaceholder")}
        />
      </label>
      <label class="field">
        <span>{$t("offer.who")}</span>
        <input
          bind:value={who}
          maxlength="200"
          placeholder={$t("offer.whoPlaceholder")}
        />
      </label>
      <label class="field">
        <span>{$t("offer.how")}</span>
        <input
          bind:value={how}
          maxlength="200"
          placeholder={$t("offer.howPlaceholder")}
        />
      </label>
      <p class="muted public">{$t("offer.public")}</p>
    </fieldset>
    <label class="field">
      <span>{$t("give.note")}</span>
      <textarea bind:value={note} rows="2" maxlength="500"></textarea>
    </label>
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <button class="btn wide" type="submit" disabled={busy || !title.trim()}
      >{busy ? $t("claim.sending") : $t("offer.save")}</button
    >
    {#if offer}
      <button
        class="btn quiet wide gap"
        type="button"
        on:click={remove}
        disabled={busy}>{$t("offer.remove")}</button
      >
    {/if}
  </form>
</BottomSheet>

<style>
  .lead {
    margin-bottom: 12px;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }
  legend {
    font-size: 0.9rem;
    font-weight: 800;
    margin-bottom: 8px;
  }
  .public {
    font-size: 0.82rem;
    margin: -4px 0 12px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .field {
    display: grid;
    gap: 4px;
    margin: 0 0 12px;
  }
  .field span {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  input,
  select,
  textarea {
    width: 100%;
    min-height: var(--tap);
    padding: 10px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  textarea {
    resize: vertical;
  }
  .wide {
    width: 100%;
  }
  .gap {
    margin-top: 8px;
  }
</style>
