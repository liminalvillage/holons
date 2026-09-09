<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The voice agent's review drawer: every change the agent proposed sits
  // here as a row — what it targets, what would change — and NOTHING is
  // written until the user ticks what they want and taps Apply. Follow-up
  // utterances refine the rows in place; ✕ hides the drawer without dropping
  // them; Discard drops them. Bottom-anchored above the views' fab row so
  // the mic stays reachable while reviewing.
  import {
    hasDrifted,
    type FieldDiff,
    type StagedChange,
  } from "@holons/core/actions";
  import { holonId, rawQuests } from "$lib/stores";
  import { t } from "$lib/i18n";
  import {
    applyPlan,
    discardPlan,
    drawerOpen,
    pendingPlan,
    toggleSelected,
  } from "$lib/voice/plan";

  $: plan = $pendingPlan;
  $: changes = plan?.changeset.changes ?? [];
  $: selectedCount = changes.filter((c) => plan?.selected.has(c.id)).length;

  const FIELD_KEY = {
    title: "voice.plan.field.title",
    description: "voice.plan.field.description",
    category: "voice.plan.field.category",
    schedule: "voice.plan.field.schedule",
    participants: "voice.plan.field.participants",
    status: "voice.plan.field.status",
  } as const;
  type FieldName = keyof typeof FIELD_KEY;
  const fieldLabel = (field: string): string =>
    field in FIELD_KEY ? $t(FIELD_KEY[field as FieldName]) : field;

  const KIND_GLYPH: Record<StagedChange["kind"], string> = {
    create: "＋",
    update: "✎",
    participants: "👥",
    complete: "✓",
  };

  /** The live record moved, where this change touches it, since previewed. */
  function editedSince(c: StagedChange): boolean {
    const live = $rawQuests.find((q) => String(q.id ?? "") === c.localId);
    return hasDrifted(c, live);
  }

  function fmt(d: FieldDiff, side: "before" | "after"): string {
    const v = d[side];
    if (Array.isArray(v))
      return v.length ? v.join(", ") : $t("voice.plan.nobody");
    if (v == null || v === "") {
      return d.field === "schedule" ? $t("voice.plan.unscheduled") : "—";
    }
    return String(v);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && $drawerOpen) drawerOpen.set(false);
  }
</script>

<svelte:window on:keydown={onKey} />

{#if $drawerOpen && plan && changes.length > 0}
  <div
    class="drawer"
    role="dialog"
    aria-label={$t("voice.plan.title", { n: changes.length })}
  >
    <header>
      <div class="heading">
        <strong>{$t("voice.plan.title", { n: changes.length })}</strong>
        <span class="sub">{$t("voice.plan.subtitle")}</span>
      </div>
      <button
        class="close"
        aria-label={$t("common.close")}
        title={$t("common.close")}
        on:click={() => drawerOpen.set(false)}>✕</button
      >
    </header>
    {#if plan.utterances.length}
      <p class="said">“{plan.utterances[plan.utterances.length - 1]}”</p>
    {/if}
    <ul class="rows">
      {#each changes as c (c.id)}
        {@const outcome = plan.outcomes[c.id]}
        <li
          class="row"
          class:off={!plan.selected.has(c.id)}
          class:failed={outcome && !outcome.ok}
        >
          <label class="tick">
            <input
              type="checkbox"
              checked={plan.selected.has(c.id)}
              disabled={plan.applying}
              on:change={() => toggleSelected(c.id)}
            />
          </label>
          <div class="body">
            <div class="head">
              <span class="kind"
                >{KIND_GLYPH[c.kind]} {$t(`voice.plan.kind.${c.kind}`)}</span
              >
              <span class="title">{c.title}</span>
              {#if c.holon !== $holonId}
                <span class="badge"
                  >{$t("voice.plan.inHolon", { holon: c.holon })}</span
                >
              {/if}
            </div>
            <dl class="diff">
              {#each c.diff as d (d.field)}
                <div class="line">
                  <dt>{fieldLabel(d.field)}</dt>
                  <dd>
                    {#if c.kind !== "create"}<s>{fmt(d, "before")}</s> →
                    {/if}<b>{fmt(d, "after")}</b>
                  </dd>
                </div>
              {/each}
            </dl>
            {#each c.warnings as w}
              <p class="warn">⚠ {w}</p>
            {/each}
            {#if editedSince(c)}
              <p class="warn">⚠ {$t("voice.plan.changedSince")}</p>
            {/if}
            {#if outcome}
              <p class="outcome" class:bad={!outcome.ok}>
                {outcome.ok
                  ? `✓ ${$t("voice.plan.done")}`
                  : `⚠ ${$t("voice.plan.failed")}: ${outcome.error ?? ""}`}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <footer>
      <button
        class="discard"
        disabled={plan.applying}
        on:click={() => discardPlan()}
      >
        {$t("voice.plan.discard")}
      </button>
      <button
        class="apply"
        disabled={plan.applying || selectedCount === 0}
        on:click={() => void applyPlan()}
      >
        {plan.applying
          ? $t("voice.plan.applying")
          : $t("voice.plan.apply", { n: selectedCount })}
      </button>
    </footer>
  </div>
{/if}

<style>
  /* Above the views' fab row (3.4rem at bottom 1.3rem), like the voice bubble;
     left-anchored so the bubble (right) and the drawer coexist on wide screens. */
  .drawer {
    position: fixed;
    left: calc(0.8rem + env(safe-area-inset-left));
    bottom: calc(1.3rem + 3.4rem + 0.8rem + env(safe-area-inset-bottom));
    width: min(34rem, calc(100vw - 1.6rem));
    max-height: min(60vh, 32rem);
    z-index: 69; /* under the voice bubble (70), over modals (50) */
    display: flex;
    flex-direction: column;
    background: var(--paper, #fff);
    color: var(--ink, #222);
    border-radius: 16px;
    box-shadow: var(--shadow-soft);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.8rem 0.6rem 0.4rem 1rem;
  }
  .heading {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .heading strong {
    font-size: 1rem;
  }
  .sub {
    color: var(--ink-soft, #666);
    font-size: 0.8rem;
  }
  .close {
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--ink-soft, #666);
    font-size: 1rem;
    cursor: pointer;
  }
  .close:active {
    background: var(--paper-deep, #eee);
  }
  .said {
    margin: 0;
    padding: 0 1rem 0.4rem;
    color: var(--ink-soft, #666);
    font-style: italic;
    font-size: 0.85rem;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0 0.6rem;
    overflow-y: auto;
    flex: 1 1 auto;
  }
  .row {
    display: flex;
    gap: 0.5rem;
    padding: 0.55rem 0.4rem;
    border-top: 1px solid var(--paper-deep, #eee);
  }
  .row.off .body {
    opacity: 0.45;
  }
  .row.failed .body {
    opacity: 1;
  }
  .tick {
    display: grid;
    place-items: start;
    padding-top: 0.15rem;
  }
  .tick input {
    width: 1.3rem;
    height: 1.3rem;
    accent-color: var(--teal);
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
  }
  .kind {
    font-size: 0.78rem;
    color: var(--ink-soft, #666);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .title {
    font-weight: 700;
  }
  .badge {
    font-size: 0.75rem;
    padding: 0.05rem 0.45rem;
    border-radius: 999px;
    background: var(--paper-deep, #eee);
    color: var(--ink-soft, #666);
  }
  .diff {
    margin: 0.25rem 0 0;
    font-size: 0.9rem;
  }
  .line {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
  }
  dt {
    flex: 0 0 4.5rem;
    color: var(--ink-soft, #666);
    font-size: 0.8rem;
  }
  dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  dd s {
    color: var(--ink-soft, #666);
  }
  .warn,
  .outcome {
    margin: 0.3rem 0 0;
    font-size: 0.8rem;
    color: var(--ink-soft, #666);
  }
  .outcome:not(.bad) {
    color: var(--teal);
  }
  .outcome.bad,
  .row.failed .warn {
    color: #dc2626;
  }
  footer {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    padding: 0.6rem 0.8rem calc(0.7rem + env(safe-area-inset-bottom));
    border-top: 1px solid var(--paper-deep, #eee);
  }
  footer button {
    min-height: 44px;
    padding: 0 1.2rem;
    border-radius: 12px;
    border: 0;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .apply {
    background: var(--teal);
    color: #fff;
  }
  .discard {
    background: var(--paper-deep, #eee);
    color: var(--ink, #222);
  }
  footer button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
