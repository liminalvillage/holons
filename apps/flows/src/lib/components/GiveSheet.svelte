<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Resourcing an account directly: the thing itself — space, tools, seeds,
  // skills, time, or money as one stream among eight — given to the Pot, a
  // fund, a project or a person. It is written on the recipient's own log
  // and counts once its stewards say it arrived; everything said here,
  // the proof too, is public.
  import type { FlowGraphNode, ResourceOffer } from "@holons/core/flows";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import {
    CAPITALS,
    capitalColour,
    capitalHint,
    capitalName,
    type Capital,
  } from "$lib/capitals";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { give } from "$lib/resources";

  /** Who receives it. */
  export let to: FlowGraphNode;
  /** Who may give: the signed-in person first, then the holons they steward. */
  export let givers: { id: string; label: string }[] = [];
  export let offers: ResourceOffer[] = [];
  /** Start on this offer. */
  export let offer: ResourceOffer | null = null;
  /** The reader stewards the recipient: they may record a gift from anyone, received as written. */
  export let steer = false;

  const dispatch = createEventDispatcher<{ close: void; changed: void }>();

  /** What each capital is usually counted in, to start the field with. */
  const UNIT: Record<Capital, string> = {
    material: "items",
    living: "kg",
    social: "introductions",
    intellectual: "hours",
    experiential: "hours",
    cultural: "events",
    spiritual: "sessions",
    financial: "EUR",
  };

  const OTHER = "__other";
  let from = givers[0]?.id ?? (steer ? OTHER : "");
  let otherName = "";
  $: giver = from === OTHER ? otherName.trim() : from;
  let capital: Capital = offer?.capital ?? "material";
  let offerId = offer?.id ?? "";
  let what = offer?.title ?? "";
  let amount = 1;
  let unit = offer?.unit ?? UNIT[capital];
  let proof = "";
  let note = "";
  let busy = false;
  let error = "";

  function pick(c: Capital) {
    if (unit === UNIT[capital]) unit = UNIT[c];
    capital = c;
    offerId = "";
  }

  function answer(id: string) {
    offerId = id;
    const o = offers.find((x) => x.id === id);
    if (!o) return;
    capital = o.capital;
    what = o.title;
    if (o.unit) unit = o.unit;
  }

  async function send() {
    busy = true;
    error = "";
    try {
      await give(to.id, {
        from: giver,
        name:
          from === OTHER
            ? otherName.trim()
            : givers.find((g) => g.id === from)?.label,
        capital,
        amount: Number(amount),
        unit,
        what: what.trim() || undefined,
        proof: proof.trim() || undefined,
        note: note.trim() || undefined,
        offer: offerId || undefined,
      });
      showNotice($t("give.sent", { name: to.label }));
      dispatch("changed");
      dispatch("close");
    } catch {
      error = $t("give.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet
  title={$t("give.title", { name: to.label })}
  on:close={() => dispatch("close")}
>
  <p class="muted lead">{$t("give.lead", { name: to.label })}</p>

  <form on:submit|preventDefault={send}>
    {#if givers.length > 1 || steer}
      <fieldset>
        <legend>{$t("give.from")}</legend>
        {#each givers as g (g.id)}
          <label class="pick">
            <input type="radio" bind:group={from} value={g.id} />
            <span>{g.label}</span>
          </label>
        {/each}
        {#if steer}
          <label class="pick">
            <input type="radio" bind:group={from} value={OTHER} />
            <span>{$t("give.someoneElse")}</span>
          </label>
          {#if from === OTHER}
            <input
              bind:value={otherName}
              maxlength="120"
              placeholder={$t("give.someoneElsePlaceholder")}
              aria-label={$t("give.someoneElse")}
            />
            <p class="muted hint">{$t("give.recordHint")}</p>
          {/if}
        {/if}
      </fieldset>
    {/if}

    {#if offers.length}
      <label class="field">
        <span>{$t("give.offer")}</span>
        <select
          value={offerId}
          on:change={(e) => answer(e.currentTarget.value)}
        >
          <option value="">{$t("give.noOffer")}</option>
          {#each offers as o (o.id)}
            <option value={o.id}>{o.title}</option>
          {/each}
        </select>
      </label>
    {/if}

    <fieldset>
      <legend>{$t("give.capital")}</legend>
      <div class="capitals">
        {#each CAPITALS as c (c)}
          <button
            type="button"
            class="cap"
            class:on={capital === c}
            aria-pressed={capital === c}
            on:click={() => pick(c)}
          >
            <i style="background:{capitalColour(c)}"></i>
            {$t(capitalName(c))}
          </button>
        {/each}
      </div>
      <p class="muted hint">{$t(capitalHint(capital))}</p>
    </fieldset>

    <label class="field">
      <span>{$t("give.what")}</span>
      <input
        bind:value={what}
        maxlength="120"
        placeholder={$t("give.whatPlaceholder")}
      />
    </label>
    <div class="row">
      <label class="field">
        <span>{$t("give.amount")}</span>
        <input
          type="number"
          min="0.01"
          step="any"
          bind:value={amount}
          inputmode="decimal"
          required
        />
      </label>
      <label class="field">
        <span>{$t("give.unit")}</span>
        <input bind:value={unit} maxlength="40" required />
      </label>
    </div>
    <label class="field">
      <span>{$t("give.proof")}</span>
      <input
        type="url"
        bind:value={proof}
        maxlength="500"
        placeholder="https://"
      />
    </label>
    <label class="field">
      <span>{$t("give.note")}</span>
      <textarea bind:value={note} rows="3" maxlength="500"></textarea>
    </label>
    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <button
      class="btn wide"
      type="submit"
      disabled={busy || !giver || !(Number(amount) > 0) || !unit.trim()}
      >{busy ? $t("claim.sending") : $t("give.send")}</button
    >
  </form>
</BottomSheet>

<style>
  .lead {
    margin-bottom: 12px;
  }
  fieldset {
    border: 0;
    margin: 0 0 12px;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  legend {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
    margin-bottom: 6px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--tap);
    padding: 0 12px;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    font-weight: 600;
  }
  .pick input {
    width: 20px;
    height: 20px;
    accent-color: var(--teal);
  }
  .capitals {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }
  .cap {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 12px;
    border: 1.5px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    font-size: 0.9rem;
    text-align: left;
  }
  .cap.on {
    border-color: var(--teal);
    background: var(--teal-wash);
  }
  .cap i {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border-radius: 4px;
  }
  .hint {
    font-size: 0.82rem;
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
</style>
