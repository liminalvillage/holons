<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // Putting a quest on the board: what I want to make happen, a line about
  // it, until when, and what it needs — each a quantity in its own unit,
  // "people" for a headcount — and under which fund it is filed: a quest
  // goes on a fund's board, never straight on the Pot. Core checks the rest.
  import { PEOPLE_UNIT } from "@holons/core/tasks";
  import { createEventDispatcher } from "svelte";
  import BottomSheet from "./BottomSheet.svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n";
  import { showNotice } from "$lib/notice";
  import { propose } from "$lib/quests";

  /** The boards it may be filed under: the funds followed, or one event. */
  export let boards: { id: string; label: string }[];
  export let party: string;
  export let name = "";
  /** The holon it is proposed for — a project, when proposed from its card. */
  export let holon: string | undefined = undefined;

  const dispatch = createEventDispatcher<{
    close: void;
    proposed: { id: string };
  }>();

  const inDays = (d: number) => {
    const at = new Date(Date.now() + d * 86_400_000);
    return at.toISOString().slice(0, 10);
  };

  let board = boards[0]?.id ?? "";
  let title = "";
  let summary = "";
  let until = inDays(14);
  let rows = [
    { label: "", quantity: "2", unit: PEOPLE_UNIT },
    { label: "", quantity: "1", unit: "" },
  ];
  let busy = false;
  let error = "";

  // The end of the chosen day, local time.
  $: untilMs = until ? new Date(`${until}T23:59:59`).getTime() : NaN;
  // "people" in the reader's own language is still a headcount.
  const unitOf = (raw: string) => {
    const u = raw.trim().toLowerCase();
    return u === $t("quests.unit.people").toLowerCase()
      ? PEOPLE_UNIT
      : u || undefined;
  };
  $: needs = rows
    .map((r) => ({
      label: r.label.trim(),
      quantity: Number(r.quantity),
      unit: unitOf(r.unit),
    }))
    .filter((r) => r.label && r.quantity > 0);
  $: valid =
    !!board && !!title.trim() && untilMs > Date.now() && needs.length > 0;

  const addRow = () =>
    (rows = [...rows, { label: "", quantity: "1", unit: "" }]);
  const dropRow = (i: number) => (rows = rows.filter((_, j) => j !== i));

  // What it gives back when it happens — optional, a label and maybe how much.
  let yieldRows: { label: string; quantity: string; unit: string }[] = [];
  $: yields = yieldRows
    .map((r) => ({
      label: r.label.trim(),
      quantity: Number(r.quantity) > 0 ? Number(r.quantity) : undefined,
      unit: r.unit.trim() || undefined,
    }))
    .filter((r) => r.label);
  const addYield = () =>
    (yieldRows = [...yieldRows, { label: "", quantity: "", unit: "" }]);
  const dropYield = (i: number) =>
    (yieldRows = yieldRows.filter((_, j) => j !== i));

  async function send() {
    if (!valid) {
      error = $t("quests.form.invalid");
      return;
    }
    busy = true;
    error = "";
    try {
      const { id } = await propose(board, {
        party,
        name: name || undefined,
        title: title.trim(),
        summary: summary.trim() || undefined,
        until: untilMs,
        needs,
        ...(yields.length ? { yields } : {}),
        ...(holon ? { holon } : {}),
      });
      showNotice($t("quests.form.sent"));
      dispatch("proposed", { id });
      dispatch("close");
    } catch {
      error = $t("quests.failed");
    } finally {
      busy = false;
    }
  }
</script>

<BottomSheet title={$t("quests.propose")} on:close={() => dispatch("close")}>
  <form on:submit|preventDefault={send}>
    {#if boards.length > 1}
      <label class="field">
        <span>{$t("quests.form.fund")}</span>
        <select bind:value={board}>
          {#each boards as b (b.id)}
            <option value={b.id}>{b.label}</option>
          {/each}
        </select>
      </label>
    {:else if boards.length === 1}
      <p class="muted under">{$t("quests.in", { fund: boards[0].label })}</p>
    {:else}
      <p class="notice warn">{$t("quests.funds.none")}</p>
    {/if}
    <label class="field">
      <span>{$t("quests.form.title")}</span>
      <input bind:value={title} maxlength="120" required />
    </label>
    <label class="field">
      <span>{$t("quests.form.summary")}</span>
      <textarea bind:value={summary} rows="3" maxlength="1000"></textarea>
    </label>
    <label class="field">
      <span>{$t("quests.form.until")}</span>
      <input type="date" bind:value={until} min={inDays(0)} />
    </label>

    <p class="label">{$t("quests.form.needs")}</p>
    <p class="muted hint">{$t("quests.form.needsHint")}</p>
    {#each rows as r, i (i)}
      <div class="need">
        <input
          bind:value={r.label}
          maxlength="120"
          placeholder={$t("quests.needLabel")}
          aria-label={$t("quests.needLabel")}
        />
        <input
          bind:value={r.quantity}
          type="number"
          inputmode="decimal"
          min="0.01"
          step="any"
          aria-label={$t("quests.needQuantity")}
        />
        <input
          bind:value={r.unit}
          maxlength="24"
          placeholder={$t("quests.needUnit")}
          aria-label={$t("quests.needUnit")}
        />
        {#if rows.length > 1}
          <button
            type="button"
            class="drop"
            on:click={() => dropRow(i)}
            aria-label={$t("quests.form.removeRow")}
            ><Icon name="close" /></button
          >
        {/if}
      </div>
    {/each}
    <button type="button" class="btn quiet wide" on:click={addRow}
      ><Icon name="plus" /> {$t("quests.form.addRow")}</button
    >

    <p class="label">{$t("quests.form.yields")}</p>
    <p class="muted hint">{$t("quests.form.yieldsHint")}</p>
    {#each yieldRows as r, i (i)}
      <div class="need">
        <input
          bind:value={r.label}
          maxlength="120"
          placeholder={$t("quests.needLabel")}
          aria-label={$t("quests.needLabel")}
        />
        <input
          bind:value={r.quantity}
          type="number"
          inputmode="decimal"
          min="0.01"
          step="any"
          aria-label={$t("quests.needQuantity")}
        />
        <input
          bind:value={r.unit}
          maxlength="24"
          placeholder={$t("quests.needUnit")}
          aria-label={$t("quests.needUnit")}
        />
        <button
          type="button"
          class="drop"
          on:click={() => dropYield(i)}
          aria-label={$t("quests.form.removeRow")}><Icon name="close" /></button
        >
      </div>
    {/each}
    <button type="button" class="btn quiet wide" on:click={addYield}
      ><Icon name="plus" /> {$t("quests.form.addYield")}</button
    >

    {#if error}<p class="notice warn" role="alert">{error}</p>{/if}
    <button class="btn wide send" type="submit" disabled={busy || !valid}
      >{$t("quests.form.send")}</button
    >
  </form>
</BottomSheet>

<style>
  .field {
    display: grid;
    gap: 4px;
    margin: 12px 0;
  }
  .field span,
  .label {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .label {
    margin-top: 16px;
  }
  .hint {
    font-size: 0.85rem;
    margin-bottom: 8px;
  }
  input,
  select,
  textarea {
    width: 100%;
    min-height: var(--tap);
    padding: 0 12px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 16px;
  }
  textarea {
    padding: 12px;
    resize: vertical;
  }
  .under {
    margin-top: 4px;
  }
  .need {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 72px 92px auto;
    gap: 6px;
    margin-bottom: 8px;
    align-items: center;
  }
  .drop {
    width: 36px;
    height: 36px;
    border: 0;
    background: none;
    color: var(--muted);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .wide {
    width: 100%;
  }
  .send {
    margin-top: 16px;
  }
  .notice {
    margin-top: 12px;
  }
</style>
