<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The value-equation editor: the weights the Status board scores with,
  // editable by the group that reads the board. Shown in two places — folded
  // into Settings under the Status toggle, and in the sheet the board's own
  // footer opens — so retuning never means finding a laptop.
  //
  // Editing follows the kiosk rule (no Apply step), but a put per tap would
  // storm the graph, so touches are coalesced into one write (see scheduleEq).
  // Weights are stored via core's `saveEquation`, which owns the migration,
  // coercion, and currency-list bookkeeping.
  import { onDestroy } from "svelte";
  import {
    DEFAULT_EQUATION,
    loadEquation,
    parseCurrencyCodes,
    saveEquation,
    type ScoreEquation,
  } from "@holons/core/scoring";
  import { getHolosphere } from "$lib/holosphere";
  import { t, type MessageKey } from "$lib/i18n";
  import Modal from "./Modal.svelte";

  /** The holon whose equation is being edited; null renders nothing. */
  export let holon: string | null = null;

  type EqRow = {
    key: string;
    labelKey: MessageKey;
    /** One line on what raising this weight rewards; read in the ⓘ sheet. */
    aboutKey: MessageKey;
    step: number;
  };

  const EQ_METRICS: EqRow[] = [
    {
      key: "initiated",
      labelKey: "status.metric.initiated",
      aboutKey: "status.about.initiated",
      step: 1,
    },
    {
      key: "completed",
      labelKey: "status.metric.completed",
      aboutKey: "status.about.completed",
      step: 1,
    },
    {
      key: "sent",
      labelKey: "status.metric.sent",
      aboutKey: "status.about.sent",
      step: 1,
    },
    {
      key: "received",
      labelKey: "status.metric.received",
      aboutKey: "status.about.received",
      step: 1,
    },
    {
      key: "collaboration",
      labelKey: "status.metric.collaboration",
      aboutKey: "status.about.collaboration",
      step: 1,
    },
  ];
  // Signals are derived from REA groupings and multiply larger counts, so they
  // move in finer steps — and they're the rows nobody guesses from the label,
  // which is what the ⓘ sheet is for.
  const EQ_SIGNALS: EqRow[] = [
    {
      key: "participation",
      labelKey: "status.metric.participation",
      aboutKey: "status.about.participation",
      step: 0.5,
    },
    {
      key: "coParticipants",
      labelKey: "status.metric.coParticipants",
      aboutKey: "status.about.coParticipants",
      step: 0.5,
    },
    {
      key: "activity",
      labelKey: "status.metric.activity",
      aboutKey: "status.about.activity",
      step: 0.5,
    },
    {
      key: "groupSize",
      labelKey: "status.metric.groupSize",
      aboutKey: "status.about.groupSize",
      step: 0.5,
    },
    {
      key: "variance",
      labelKey: "status.metric.variance",
      aboutKey: "status.about.variance",
      step: 0.5,
    },
  ];

  /** null while loading; the holon's equation once read. */
  let equation: ScoreEquation | null = null;
  /** The holon `equation` belongs to, so a holon switch reloads it. */
  let eqHolon: string | null = null;
  let eqState: "idle" | "saving" | "saved" = "idle";
  let eqTimer: ReturnType<typeof setTimeout> | null = null;
  let eqSavedTimer: ReturnType<typeof setTimeout> | null = null;

  $: void loadEq(holon);

  async function loadEq(id: string | null) {
    if (id === eqHolon) return;
    eqHolon = id;
    equation = null;
    if (!id) return;
    try {
      const hs = await getHolosphere();
      const eq = await loadEquation(hs, id);
      if (eqHolon === id)
        equation = { ...eq, currencies: { ...eq.currencies } };
    } catch (err) {
      console.error("[kiosk] failed to load the value equation", err);
      if (eqHolon === id) equation = { ...DEFAULT_EQUATION };
    }
  }

  /** Weight of `key`, whether it's a built-in metric or a currency code. */
  function eqWeight(
    eq: ScoreEquation | null,
    key: string,
    currency: boolean,
  ): number {
    if (!eq) return 0;
    const raw = currency
      ? eq.currencies?.[key]
      : (eq as unknown as Record<string, number>)[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  }

  function setEqWeight(key: string, currency: boolean, value: number) {
    if (!equation) return;
    // Round away float dust (0.1 + 0.2) so the stored weight reads cleanly.
    const v = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    equation = currency
      ? { ...equation, currencies: { ...equation.currencies, [key]: v } }
      : ({ ...equation, [key]: v } as ScoreEquation);
    scheduleEq();
  }

  function bumpEq(
    row: { key: string; step: number },
    currency: boolean,
    dir: 1 | -1,
  ) {
    if (!equation) return;
    setEqWeight(
      row.key,
      currency,
      eqWeight(equation, row.key, currency) + dir * row.step,
    );
  }

  /**
   * Coalesce a burst of taps into a single write. Every edit resets the timer,
   * so holding the + button costs one put, not twenty.
   */
  function scheduleEq() {
    if (eqTimer) clearTimeout(eqTimer);
    eqState = "saving";
    eqTimer = setTimeout(() => void flushEq(), 700);
  }

  async function flushEq() {
    eqTimer = null;
    const id = eqHolon;
    const eq = equation;
    if (!id || !eq) return;
    try {
      const hs = await getHolosphere();
      await saveEquation(hs, id, eq);
      if (eqHolon !== id) return;
      eqState = "saved";
      if (eqSavedTimer) clearTimeout(eqSavedTimer);
      eqSavedTimer = setTimeout(() => (eqState = "idle"), 2000);
    } catch (err) {
      console.error("[kiosk] failed to save the value equation", err);
      eqState = "idle";
    }
  }

  function resetEq() {
    if (!equation) return;
    equation = {
      ...DEFAULT_EQUATION,
      currencies: { ...DEFAULT_EQUATION.currencies },
    };
    scheduleEq();
  }

  /** The disclaimer's promise made operable: every weight to zero, in one tap. */
  function zeroEq() {
    if (!equation) return;
    const zeroed = { ...equation } as unknown as Record<string, unknown>;
    for (const row of [...EQ_METRICS, ...EQ_SIGNALS])
      zeroed[String(row.key)] = 0;
    const currencies: Record<string, number> = {};
    for (const code of Object.keys(equation.currencies ?? {}))
      currencies[code] = 0;
    equation = { ...(zeroed as unknown as ScoreEquation), currencies };
    scheduleEq();
  }

  // One list to render: contributions, signals, currencies. Rows arrive
  // pre-labelled and pre-explained so the markup is a single loop and a
  // language switch re-renders it.
  $: eqSections = !equation
    ? []
    : [
        {
          headKey: "settings.eqMetrics" as MessageKey,
          currency: false,
          rows: EQ_METRICS.map((row) => ({
            key: row.key,
            step: row.step,
            label: $t(row.labelKey),
            about: $t(row.aboutKey),
          })),
        },
        {
          headKey: "settings.eqSignals" as MessageKey,
          currency: false,
          rows: EQ_SIGNALS.map((row) => ({
            key: row.key,
            step: row.step,
            label: $t(row.labelKey),
            about: $t(row.aboutKey),
          })),
        },
        {
          // Always rendered, even with no currencies yet — it carries the
          // "add a currency" entry.
          headKey: "settings.eqCurrencies" as MessageKey,
          currency: true,
          rows: Object.keys(equation.currencies ?? {})
            .sort()
            .map((code) => ({
              key: code,
              step: 1,
              label: code,
              about: $t("status.about.currency", { currency: code }),
            })),
        },
      ];

  /** The ⓘ sheet: which section's rows are being explained, if any. */
  let eqInfo: {
    title: string;
    rows: { key: string; label: string; about: string }[];
  } | null = null;

  // ---- Adding a currency -------------------------------------------------
  // A holon can weigh any currency it actually uses, so the list isn't fixed:
  // new codes start at weight 0 (adding one changes no score until the group
  // decides it should) and are registered holon-wide by `saveEquation`.
  let currencyDraft = "";
  let addingCurrency = false;

  function addCurrencies() {
    if (!equation) return;
    const codes = parseCurrencyCodes(
      currencyDraft,
      Object.keys(equation.currencies ?? {}),
    );
    currencyDraft = "";
    addingCurrency = false;
    if (!codes.length) return;
    const currencies = { ...equation.currencies };
    for (const code of codes) currencies[code] = 0;
    equation = { ...equation, currencies };
    scheduleEq();
  }

  /** Weights render short: 2, 0.5, 0 — never 2.00. */
  function eqLabel(n: number): string {
    return String(Math.round(n * 100) / 100);
  }

  onDestroy(() => {
    if (eqTimer) {
      clearTimeout(eqTimer);
      // A pending edit must survive closing the panel mid-burst.
      void flushEq();
    }
    if (eqSavedTimer) clearTimeout(eqSavedTimer);
  });
</script>

{#if !equation}
  <p class="eq-loading">{$t("settings.eqLoading")}</p>
{:else}
  <div class="eq">
    {#each eqSections as section (section.headKey)}
      <div class="eq-head">
        <span>{$t(section.headKey)}</span>
        <button
          type="button"
          class="eq-info"
          aria-label={$t("settings.eqAboutAria", {
            section: $t(section.headKey),
          })}
          on:click={() =>
            (eqInfo = {
              title: $t("settings.eqAbout", { section: $t(section.headKey) }),
              rows: section.rows,
            })}>ⓘ</button
        >
      </div>
      {#each section.rows as row (row.key)}
        {@const weight = eqWeight(equation, row.key, section.currency)}
        <div class="eq-row">
          <span class="eq-name">{row.label}</span>
          <div class="eq-steps">
            <button
              type="button"
              class="eq-step"
              aria-label={$t("settings.eqLess", { metric: row.label })}
              on:click={() => bumpEq(row, section.currency, -1)}>−</button
            >
            <span
              class="eq-val"
              class:off={weight === 0}
              aria-label={$t("settings.eqValue", { metric: row.label })}
              >{eqLabel(weight)}</span
            >
            <button
              type="button"
              class="eq-step"
              aria-label={$t("settings.eqMore", { metric: row.label })}
              on:click={() => bumpEq(row, section.currency, 1)}>+</button
            >
          </div>
        </div>
      {/each}
      {#if section.currency}
        {#if addingCurrency}
          <div class="eq-add">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              autofocus
              bind:value={currencyDraft}
              placeholder={$t("settings.eqCurrencyPlaceholder")}
              on:keydown={(e) => {
                if (e.key === "Enter") addCurrencies();
                if (e.key === "Escape") {
                  currencyDraft = "";
                  addingCurrency = false;
                }
              }}
            />
            <button type="button" class="eq-add-go" on:click={addCurrencies}
              >{$t("settings.eqAdd")}</button
            >
          </div>
          <p class="eq-hint">{$t("settings.eqCurrencyStartsAtZero")}</p>
        {:else}
          <button
            type="button"
            class="eq-link eq-add-open"
            on:click={() => (addingCurrency = true)}
            >＋ {$t("settings.eqAddCurrency")}</button
          >
        {/if}
      {/if}
    {/each}

    <div class="eq-foot">
      <button type="button" class="eq-link" on:click={resetEq}
        >{$t("settings.eqReset")}</button
      >
      <button type="button" class="eq-link" on:click={zeroEq}
        >{$t("settings.eqZero")}</button
      >
      <span class="eq-state" class:on={eqState !== "idle"}>
        {eqState === "saving"
          ? $t("settings.eqSaving")
          : $t("settings.eqSaved")}
      </span>
    </div>
  </div>
{/if}

{#if eqInfo}
  <Modal on:close={() => (eqInfo = null)}>
    <div class="eq-about">
      <h4>{eqInfo.title}</h4>
      <dl>
        {#each eqInfo.rows as row (row.key)}
          <dt>{row.label}</dt>
          <dd>{row.about}</dd>
        {/each}
      </dl>
    </div>
  </Modal>
{/if}

<style>
  .eq-loading {
    margin: 0.4rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
  .eq {
    margin-top: 0.5rem;
    padding: 0.3rem 0.75rem 0.6rem;
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 12px;
    text-align: left;
    text-transform: none;
    letter-spacing: 0;
  }
  .eq-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.9rem 0 0.2rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  /* First section sits flush with the top of the card. */
  .eq-head:first-child {
    margin-top: 0.4rem;
  }
  .eq-info {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--teal-deep);
    font-size: 0.95rem;
    line-height: 1;
  }
  .eq-info:active {
    transform: scale(0.94);
  }
  .eq-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.3rem 0;
  }
  .eq-name {
    min-width: 0;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .eq-steps {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .eq-step {
    width: 40px;
    height: 40px;
    border-radius: 11px;
    background: var(--paper);
    border: 1.5px solid var(--line);
    color: var(--teal-deep);
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1;
    transition: transform 0.1s ease;
  }
  .eq-step:active {
    transform: scale(0.94);
  }
  .eq-val {
    min-width: 2.6rem;
    text-align: center;
    font-size: 1rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--ink);
  }
  /* A zeroed weight is a real choice, so it reads as "off", not as an error. */
  .eq-val.off {
    color: var(--muted);
    opacity: 0.7;
  }
  .eq-link {
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--muted);
    text-decoration: underline;
  }
  .eq-add {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }
  .eq-add input[type="text"] {
    flex: 1;
    min-width: 0;
    padding: 0.7rem 0.8rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--ink);
    background: var(--paper);
    border: 1.5px solid var(--line);
    border-radius: 12px;
  }
  .eq-add input[type="text"]:focus {
    outline: none;
    border-color: var(--teal);
  }
  .eq-add-go {
    flex: 0 0 auto;
    padding: 0.7rem 1rem;
    border-radius: 12px;
    background: var(--paper);
    border: 1.5px solid var(--line);
    color: var(--teal-deep);
    font-size: 0.9rem;
    font-weight: 700;
  }
  .eq-add-open {
    display: block;
    margin-top: 0.5rem;
  }
  .eq-hint {
    margin: 0.4rem 0 0;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--muted);
  }
  .eq-foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 0.9rem;
    padding-top: 0.6rem;
    border-top: 1.5px solid var(--line);
  }
  .eq-state {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
    opacity: 0;
    transition: opacity 0.2s ease;
  }
  .eq-state.on {
    opacity: 1;
  }

  /* ⓘ sheet explaining a section's rows. */
  .eq-about {
    text-align: left;
  }
  .eq-about h4 {
    margin: 0 0 0.9rem;
    font-size: 1.1rem;
    color: var(--ink);
  }
  .eq-about dl {
    margin: 0;
  }
  .eq-about dt {
    font-size: 0.92rem;
    font-weight: 700;
    color: var(--ink);
  }
  .eq-about dd {
    margin: 0.15rem 0 0.8rem;
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--muted);
  }
</style>
