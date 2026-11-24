<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What the Flows board shows: one unit, one period. The same two choices
  // sit above the board's first graph (`compact`) and in the pills band's
  // Filters sheet; both read and write the shared stores, so a tap in either
  // place redraws every chart at once. No Apply step — kept per device.
  import { t, locale } from "$lib/i18n";
  import ChipRow from "./ChipRow.svelte";
  import Icon from "./Icon.svelte";
  import {
    flowsUnit,
    flowsUnitOptions,
    flowsEditUnits,
    flowsWindowChoice,
    pickFlowsUnit,
    pickFlowsWindow,
  } from "$lib/stores";
  import {
    describeWindow,
    describeWindowSpan,
    WINDOW_PRESETS,
    WINDOW_PRESET_LABELS,
  } from "$lib/flowswindow";
  import {
    formatLocalDate,
    windowFromChoice,
    type FlowsWindowPreset,
  } from "@holons/core/flows";

  /** The inline strip above the first graph: one row each, no explainers. */
  export let compact = false;

  const uid = Math.random().toString(36).slice(2, 8);

  $: period = $flowsWindowChoice;
  $: presets = WINDOW_PRESETS.map((p) => ({
    id: p,
    label: $t(WINDOW_PRESET_LABELS[p]),
  }));
  $: units = $flowsUnitOptions.length
    ? $flowsUnitOptions
    : [{ id: "all", label: $t("flows.trackAll") }];

  function pickPreset(preset: FlowsWindowPreset) {
    // Custom starts from the period it replaces, so the dates are a tweak
    // rather than two blanks.
    if (preset === "custom" && period.preset !== "custom") {
      const w = windowFromChoice(period);
      pickFlowsWindow({
        preset,
        from: w.from == null ? null : formatLocalDate(w.from),
        to: formatLocalDate(w.to ?? Date.now()),
      });
      return;
    }
    pickFlowsWindow({ ...period, preset });
  }
  function setBound(end: "from" | "to", value: string) {
    pickFlowsWindow({ ...period, preset: "custom", [end]: value || null });
  }
</script>

<!-- Two lines — unit, then period — each one row that never wraps and
     scrolls sideways. Inline (compact) drops the headings and explainers;
     the Filters sheet keeps them. -->
<div class="picker" class:compact>
  <div class="strip">
    <div class="control">
      <span class="k" class:sr={compact} id="fvp-unit-{uid}"
        >{$t("flows.trackLabel")}</span
      >
      <ChipRow
        options={units}
        value={$flowsUnit}
        onPick={pickFlowsUnit}
        labelledby="fvp-unit-{uid}"
      >
        <svelte:fragment slot="end">
          {#if $flowsEditUnits}
            <button
              type="button"
              class="edit"
              aria-label={$t("currencies.edit")}
              title={$t("currencies.edit")}
              on:click={() => $flowsEditUnits?.()}
              ><Icon name="pencil" class="ei" /></button
            >
          {/if}
        </svelte:fragment>
      </ChipRow>
    </div>

    <div class="control">
      <span class="k" class:sr={compact} id="fvp-period-{uid}">
        {$t("flows.windowLabel")}
        <span class="value">{describeWindowSpan(period, $t)}</span>
      </span>
      <ChipRow
        options={presets}
        value={period.preset}
        onPick={(p) => pickPreset(p as FlowsWindowPreset)}
        labelledby="fvp-period-{uid}"
      />
    </div>
  </div>

  {#if period.preset === "custom"}
    <div class="dates">
      <label class="date">
        <span>{$t("flows.windowFrom")}</span>
        <input
          type="date"
          value={period.from ?? ""}
          max={period.to ?? undefined}
          on:change={(e) => setBound("from", e.currentTarget.value)}
        />
      </label>
      <label class="date">
        <span>{$t("flows.windowTo")}</span>
        <input
          type="date"
          value={period.to ?? ""}
          min={period.from ?? undefined}
          on:change={(e) => setBound("to", e.currentTarget.value)}
        />
      </label>
    </div>
  {/if}
  {#if !compact}
    <p class="sub">{$t("flows.unitAbout")}</p>
    <p class="sub">
      {describeWindow(period, $t, $locale)} — {$t("flows.windowAbout")}
    </p>
  {/if}
</div>

<style>
  .edit {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 999px;
    border: 1.5px dashed var(--line);
    color: var(--ink-soft);
    touch-action: manipulation;
  }
  .edit :global(.ei) {
    width: 0.95rem;
    height: 0.95rem;
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
    color: var(--ink);
  }
  .compact .strip {
    gap: 0.15rem;
  }
  .picker.compact {
    margin-bottom: 1rem;
  }
  .strip {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .control {
    min-width: 0;
  }
  .k {
    display: block;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .k.sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .value {
    margin-left: 0.4rem;
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-soft);
  }
  .sub {
    margin: 0;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .dates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }
  .date {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--ink-soft);
  }
  .date input {
    min-height: 36px;
    padding: 0 0.6rem;
    border-radius: 10px;
    border: 1.5px solid var(--line);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
  }
</style>
