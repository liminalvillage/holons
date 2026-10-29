<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // An admin edits the holon's onboarding steps: the path a newcomer walks
  // before their key is linked. The steps read top to bottom as a journey —
  // a numbered stop per step, its cards under it — and each card says who
  // ticks it. Nothing to save: every change is written a moment later
  // (`createAutosave`). The rules (ids given once, blank cards kept while
  // typed) are core's, see @holons/core/onboarding edit.ts.
  //
  // The Preview tab draws the very list a newcomer sees, standing on any
  // step, from the draft as it would be saved.
  import { createEventDispatcher, onDestroy, tick } from "svelte";
  import {
    DEFAULT_ONBOARDING_STEPS,
    addCard,
    addStep,
    draftIssues,
    moveCard,
    moveStep,
    removeCard,
    removeStep,
    updateCard,
    updateStep,
    type CardConfirm,
  } from "@holons/core/onboarding";
  import { createAutosave } from "$lib/autosave";
  import {
    previewSteps,
    saveOnboardingSteps,
    type OnboardingConfig,
    type OnboardingStep,
  } from "$lib/onboarding";
  import { t, type MessageKey } from "$lib/i18n";
  import type { IconName } from "$lib/icons";
  import Icon from "./Icon.svelte";
  import OnboardingSteps from "./OnboardingSteps.svelte";
  import SaveState from "./SaveState.svelte";
  import SidePanel from "./SidePanel.svelte";

  export let holon: string;
  export let config: OnboardingConfig;
  /** How many people are walking the steps right now. */
  export let walking = 0;

  const dispatch = createEventDispatcher<{ close: void }>();

  let draft: OnboardingConfig = structuredClone(config);
  let tab: "steps" | "preview" = "steps";
  let previewAt = 0;
  /** Card ids whose description and link are shown though empty. */
  let more = new Set<string>();
  /** The remove button waiting for its second tap. */
  let armed: string | null = null;
  let armTimer: ReturnType<typeof setTimeout> | null = null;

  const autosave = createAutosave<OnboardingStep[]>(
    () => structuredClone(draft.steps),
    async (steps) => {
      try {
        await saveOnboardingSteps(holon, steps);
        return true;
      } catch (err) {
        console.warn("[kiosk] onboarding steps not saved", err);
        return false;
      }
    },
  );

  function edit(next: OnboardingConfig) {
    draft = next;
    autosave.touch();
  }

  function close() {
    void autosave.flush();
    dispatch("close");
  }
  onDestroy(() => {
    void autosave.flush();
    if (armTimer) clearTimeout(armTimer);
  });

  // Escape closes this panel only, not the settings sheet under it.
  function onKey(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.stopImmediatePropagation();
    close();
  }

  async function focus(sel: string) {
    await tick();
    document.querySelector<HTMLElement>(`[data-onb="${sel}"]`)?.focus();
  }

  async function newStep() {
    const { config: next, step } = addStep(draft);
    edit(next);
    await focus(`step-${step.id}`);
  }

  async function newCard(stepId: string) {
    const { config: next, card } = addCard(draft, stepId);
    if (!card) return;
    edit(next);
    await focus(`card-${card.id}`);
  }

  /** Move, and keep the keyboard on the button that moved it. */
  async function move(
    kind: "step" | "card",
    by: -1 | 1,
    stepId: string,
    cardId = "",
  ) {
    edit(
      kind === "step"
        ? moveStep(draft, stepId, by)
        : moveCard(draft, stepId, cardId, by),
    );
    const id = kind === "step" ? stepId : cardId;
    const here = `${kind}-${by < 0 ? "up" : "down"}-${id}`;
    const other = `${kind}-${by < 0 ? "down" : "up"}-${id}`;
    await tick();
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-onb="${here}"]`,
    );
    if (btn && !btn.disabled) btn.focus();
    else document.querySelector<HTMLElement>(`[data-onb="${other}"]`)?.focus();
  }

  /** First tap arms, second removes; the arm drops after a few seconds. */
  function remove(key: string, apply: () => OnboardingConfig) {
    if (armTimer) clearTimeout(armTimer);
    if (armed !== key) {
      armed = key;
      armTimer = setTimeout(() => (armed = null), 3000);
      return;
    }
    armed = null;
    edit(apply());
  }

  function useSuggested() {
    edit({ ...draft, steps: structuredClone([...DEFAULT_ONBOARDING_STEPS]) });
  }

  const WHO: {
    id: CardConfirm;
    icon: IconName;
    label: MessageKey;
    hint: MessageKey;
  }[] = [
    {
      id: "self",
      icon: "person",
      label: "onb.whoSelf",
      hint: "onb.whoSelfHint",
    },
    {
      id: "admin",
      icon: "crown",
      label: "onb.whoAdmin",
      hint: "onb.whoAdminHint",
    },
    {
      id: "profile",
      icon: "card",
      label: "onb.whoProfile",
      hint: "onb.whoProfileHint",
    },
  ];
  const hintOf = (c: CardConfirm): MessageKey =>
    WHO.find((w) => w.id === c)?.hint ?? "onb.whoSelfHint";

  $: issues = draftIssues(draft);
  $: untitled = new Set(
    issues.flatMap((i) => (i.kind === "untitled-card" ? [i.card] : [])),
  );
  $: emptySteps = new Set(
    issues.flatMap((i) => (i.kind === "empty-step" ? [i.step] : [])),
  );
  // The step the preview stands on, kept inside the steps a save keeps.
  $: saved = previewSteps(holon, draft, -1).length;
  $: at = Math.min(previewAt, Math.max(0, saved - 1));
  $: preview = previewSteps(holon, draft, at);
  const value = (e: Event) =>
    (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;

  /** A card title wraps onto as many lines as it needs. */
  function grow(node: HTMLTextAreaElement, _value: string) {
    const fit = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    // A narrower field (the remove button armed beside it) wraps sooner.
    const seen = new ResizeObserver(fit);
    seen.observe(node);
    return { update: fit, destroy: () => seen.disconnect() };
  }
  /** A title is one line: Enter leaves the field instead of breaking it. */
  function oneLine(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
  }
</script>

<svelte:window on:keydown|capture={onKey} />

<SidePanel title={$t("onb.editTitle")} on:close={close}>
  <svelte:fragment slot="corner"><SaveState saver={autosave} /></svelte:fragment
  >

  <div slot="tabs" class="tabs" role="tablist" aria-label={$t("onb.editTitle")}>
    {#each [{ id: "steps", label: $t("onb.tabSteps"), icon: "list" }, { id: "preview", label: $t("onb.tabPreview"), icon: "eye" }] as item (item.id)}
      <button
        type="button"
        role="tab"
        id="onb-tab-{item.id}"
        aria-selected={tab === item.id}
        aria-controls="onb-panel"
        class="tab"
        class:on={tab === item.id}
        on:click={() => (tab = item.id === "steps" ? "steps" : "preview")}
        ><Icon name={item.icon === "list" ? "list" : "eye"} />
        {item.label}</button
      >
    {/each}
  </div>

  <div id="onb-panel" role="tabpanel" aria-labelledby="onb-tab-{tab}">
    {#if tab === "steps"}
      {#if walking}
        <p class="note">{$t("onb.walkingNote", { n: walking })}</p>
      {/if}

      {#if !draft.steps.length}
        <div class="empty">
          <p>{$t("onb.empty")}</p>
          <button type="button" class="primary" on:click={useSuggested}
            ><Icon name="sparkles" /> {$t("onb.useSuggested")}</button
          >
        </div>
      {:else}
        <ol class="journey">
          {#each draft.steps as step, si (step.id)}
            <li class="stop" class:last={si === draft.steps.length - 1}>
              <span class="node" aria-hidden="true">{si + 1}</span>
              <div class="stop-body">
                <div class="step-head">
                  <input
                    class="step-title"
                    data-onb="step-{step.id}"
                    value={step.title}
                    placeholder={$t("onb.stepTitle")}
                    aria-label={$t("onb.stepN", { n: si + 1 })}
                    on:input={(e) =>
                      edit(updateStep(draft, step.id, { title: value(e) }))}
                  />
                  <div class="tools">
                    <button
                      type="button"
                      class="tool"
                      data-onb="step-up-{step.id}"
                      disabled={si === 0}
                      aria-label={$t("onb.moveUp")}
                      title={$t("onb.moveUp")}
                      on:click={() => move("step", -1, step.id)}
                      ><Icon name="arrow-up" /></button
                    >
                    <button
                      type="button"
                      class="tool"
                      data-onb="step-down-{step.id}"
                      disabled={si === draft.steps.length - 1}
                      aria-label={$t("onb.moveDown")}
                      title={$t("onb.moveDown")}
                      on:click={() => move("step", 1, step.id)}
                      ><Icon name="arrow-down" /></button
                    >
                    <button
                      type="button"
                      class="tool danger"
                      class:armed={armed === `step:${step.id}`}
                      aria-label={armed === `step:${step.id}`
                        ? $t("onb.removeSure")
                        : $t("onb.removeStep")}
                      title={$t("onb.removeStep")}
                      on:click={() =>
                        remove(`step:${step.id}`, () =>
                          removeStep(draft, step.id),
                        )}
                      ><Icon
                        name="trash"
                      />{#if armed === `step:${step.id}`}<span
                          >{$t("onb.removeSure")}</span
                        >{/if}</button
                    >
                  </div>
                </div>
                {#if emptySteps.has(step.id) && step.cards.length !== 1}
                  <p class="issue">{$t("onb.emptyStep")}</p>
                {/if}

                <ul class="cards">
                  {#each step.cards as card, ci (card.id)}
                    <li class="card" class:untitled={untitled.has(card.id)}>
                      <div class="card-head">
                        <textarea
                          class="card-title"
                          rows="1"
                          data-onb="card-{card.id}"
                          value={card.title}
                          placeholder={$t("onb.cardTitle")}
                          aria-label={$t("onb.cardTitle")}
                          use:grow={card.title}
                          on:keydown={oneLine}
                          on:input={(e) =>
                            edit(
                              updateCard(draft, step.id, card.id, {
                                title: value(e),
                              }),
                            )}
                        ></textarea>
                        <div class="tools">
                          {#if step.cards.length > 1}
                            <button
                              type="button"
                              class="tool"
                              data-onb="card-up-{card.id}"
                              disabled={ci === 0}
                              aria-label={$t("onb.moveUp")}
                              title={$t("onb.moveUp")}
                              on:click={() =>
                                move("card", -1, step.id, card.id)}
                              ><Icon name="arrow-up" /></button
                            >
                            <button
                              type="button"
                              class="tool"
                              data-onb="card-down-{card.id}"
                              disabled={ci === step.cards.length - 1}
                              aria-label={$t("onb.moveDown")}
                              title={$t("onb.moveDown")}
                              on:click={() => move("card", 1, step.id, card.id)}
                              ><Icon name="arrow-down" /></button
                            >
                          {/if}
                          <button
                            type="button"
                            class="tool danger"
                            class:armed={armed === `card:${card.id}`}
                            aria-label={armed === `card:${card.id}`
                              ? $t("onb.removeSure")
                              : $t("onb.removeCard")}
                            title={$t("onb.removeCard")}
                            on:click={() =>
                              remove(`card:${card.id}`, () =>
                                removeCard(draft, step.id, card.id),
                              )}
                            ><Icon
                              name="trash"
                            />{#if armed === `card:${card.id}`}<span
                                >{$t("onb.removeSure")}</span
                              >{/if}</button
                          >
                        </div>
                      </div>
                      {#if untitled.has(card.id)}
                        <p class="issue">{$t("onb.untitled")}</p>
                      {/if}

                      <div
                        class="who"
                        role="radiogroup"
                        aria-label={$t("onb.who")}
                      >
                        {#each WHO as w (w.id)}
                          <button
                            type="button"
                            role="radio"
                            class="chip"
                            class:on={card.confirm === w.id}
                            aria-checked={card.confirm === w.id}
                            on:click={() =>
                              edit(
                                updateCard(draft, step.id, card.id, {
                                  confirm: w.id,
                                }),
                              )}
                            ><Icon name={w.icon} />
                            {$t(w.label)}</button
                          >
                        {/each}
                      </div>
                      <p class="hint">{$t(hintOf(card.confirm))}</p>

                      {#if card.description || card.link || more.has(card.id)}
                        <label class="field">
                          <span>{$t("onb.description")}</span>
                          <textarea
                            rows="2"
                            value={card.description ?? ""}
                            on:input={(e) =>
                              edit(
                                updateCard(draft, step.id, card.id, {
                                  description: value(e),
                                }),
                              )}
                          ></textarea>
                        </label>
                        <label class="field">
                          <span>{$t("onb.link")}</span>
                          <input
                            type="url"
                            inputmode="url"
                            placeholder="https://"
                            value={card.link ?? ""}
                            on:input={(e) =>
                              edit(
                                updateCard(draft, step.id, card.id, {
                                  link: value(e),
                                }),
                              )}
                          />
                        </label>
                      {:else}
                        <button
                          type="button"
                          class="more"
                          on:click={() => (more = new Set(more).add(card.id))}
                          ><Icon name="plus" /> {$t("onb.more")}</button
                        >
                      {/if}
                    </li>
                  {/each}
                </ul>
                <button
                  type="button"
                  class="add-card"
                  on:click={() => newCard(step.id)}
                  ><Icon name="plus" /> {$t("onb.addCard")}</button
                >
              </div>
            </li>
          {/each}
        </ol>
      {/if}

      <button type="button" class="add-step" on:click={newStep}
        ><Icon name="plus" /> {$t("onb.addStep")}</button
      >
    {:else}
      <p class="note">{$t("onb.previewNote")}</p>
      {#if preview.length > 1}
        <div class="who at" role="radiogroup" aria-label={$t("onb.previewAt")}>
          {#each preview as step, i (step.id)}
            <button
              type="button"
              role="radio"
              class="chip"
              class:on={at === i}
              aria-checked={at === i}
              title={step.title}
              on:click={() => (previewAt = i)}>{i + 1}</button
            >
          {/each}
        </div>
      {/if}
      {#if preview.length}
        <div class="phone">
          <OnboardingSteps steps={preview} let:card>
            {#if card.confirm === "self"}
              <span class="faux">{$t("onb.tick")}</span>
            {:else if card.confirm === "admin"}
              <p class="hint">{$t("onb.adminTicks")}</p>
            {:else}
              <p class="hint">{$t("onb.whoProfileHint")}</p>
            {/if}
          </OnboardingSteps>
        </div>
      {:else}
        <p class="note">{$t("onb.empty")}</p>
      {/if}
    {/if}
  </div>
</SidePanel>

<style>
  /* ── Tabs ─────────────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 1.2rem 0.7rem;
    border-bottom: 1px solid var(--line);
  }
  .tab {
    flex: 1 1 0;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    font-weight: 700;
    font-size: 0.9rem;
    touch-action: manipulation;
  }
  .tab.on {
    background: var(--paper);
    color: var(--ink);
  }

  .note {
    margin: 0.9rem 0 0;
    font-size: 0.85rem;
    line-height: 1.45;
    color: var(--muted);
  }

  /* ── The journey: a numbered stop per step on one line ───────────────── */
  .journey {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
  }
  .stop {
    position: relative;
    display: grid;
    grid-template-columns: 2rem 1fr;
    column-gap: 0.7rem;
    padding-bottom: 1.1rem;
  }
  /* The line that joins one stop to the next. */
  .stop::before {
    content: "";
    position: absolute;
    left: calc(1rem - 1px);
    top: 2.2rem;
    bottom: 0.2rem;
    width: 2px;
    border-radius: 2px;
    background: var(--line);
  }
  .stop.last::before {
    display: none;
  }
  .node {
    width: 2rem;
    height: 2rem;
    margin-top: 0.4rem;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 800;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 0 0 4px var(--teal-wash);
  }
  .stop-body {
    min-width: 0;
  }

  .step-head,
  .card-head {
    display: flex;
    align-items: flex-start;
    gap: 0.3rem;
  }
  input,
  textarea {
    font: inherit;
    color: var(--ink);
  }
  .step-title {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0.35rem 0.5rem;
    margin-left: -0.5rem;
    font-size: 1.08rem;
    font-weight: 800;
    background: transparent;
    border: 1.5px solid transparent;
    border-radius: 10px;
  }
  .step-title:hover {
    border-color: var(--line);
  }
  .step-title:focus,
  .card-title:focus,
  .field input:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--teal);
    background: var(--card);
  }
  .step-title::placeholder,
  .card-title::placeholder {
    color: var(--muted);
    font-weight: 600;
  }

  /* Move / remove: quiet until wanted. */
  .tools {
    display: flex;
    flex: 0 0 auto;
  }
  .tool {
    min-width: 36px;
    height: 44px;
    padding: 0 0.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    font-size: 0.95rem;
    touch-action: manipulation;
  }
  .tool:hover:not(:disabled) {
    background: var(--paper);
    color: var(--ink);
  }
  .tool:disabled {
    opacity: 0.3;
  }
  .tool.danger:hover {
    color: var(--danger);
  }
  .tool.armed {
    background: var(--danger);
    color: var(--on-danger);
    font-size: 0.8rem;
    font-weight: 700;
  }
  .tool.armed:hover {
    background: var(--danger);
    color: var(--on-danger);
  }

  /* ── Cards ────────────────────────────────────────────────────────────── */
  .cards {
    list-style: none;
    margin: 0.4rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .card {
    padding: 0.55rem 0.65rem 0.7rem 0.8rem;
    border-radius: 14px;
    background: var(--card);
    border: 1.5px solid var(--line);
    transition:
      box-shadow 0.15s ease,
      border-color 0.15s ease;
  }
  .card:focus-within {
    border-color: color-mix(in srgb, var(--teal) 45%, var(--line));
    box-shadow: var(--shadow-soft);
  }
  .card.untitled {
    border-style: dashed;
  }
  .card-title {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    resize: none;
    overflow: hidden;
    line-height: 1.35;
    padding: 0.6rem 0.45rem;
    margin-left: -0.45rem;
    font-weight: 700;
    background: transparent;
    border: 1.5px solid transparent;
    border-radius: 10px;
  }
  .issue {
    margin: 0 0 0.3rem;
    font-size: 0.78rem;
    color: var(--caution);
  }

  /* Who ticks it: three pills, the chosen one filled. */
  .who {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.3rem;
    margin-top: 0.15rem;
  }
  .chip {
    min-height: 40px;
    min-width: 0;
    padding: 0 0.4rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-weight: 700;
    border: 1.5px solid transparent;
    touch-action: manipulation;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .chip:hover:not(.on) {
    border-color: var(--line);
    color: var(--ink);
  }
  .chip.on {
    background: var(--teal);
    color: var(--on-teal);
  }
  .hint {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    line-height: 1.4;
    color: var(--muted);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-top: 0.6rem;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--muted);
  }
  .field input,
  .field textarea {
    padding: 0.55rem 0.7rem;
    min-height: 44px;
    font-size: 0.95rem;
    font-weight: 400;
    background: var(--paper);
    border: 1.5px solid transparent;
    border-radius: 10px;
    resize: vertical;
  }

  .more,
  .add-card {
    min-height: 40px;
    margin-top: 0.4rem;
    padding: 0 0.6rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border-radius: 10px;
    background: transparent;
    color: var(--teal-ink);
    font-size: 0.85rem;
    font-weight: 700;
    touch-action: manipulation;
  }
  .more {
    margin-left: -0.6rem;
  }
  .more:hover,
  .add-card:hover {
    background: var(--teal-wash);
  }
  .add-card {
    margin-top: 0.5rem;
  }

  .add-step {
    width: 100%;
    min-height: 52px;
    margin-top: 0.2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    border-radius: 14px;
    border: 2px dashed var(--line);
    background: transparent;
    color: var(--teal-ink);
    font-weight: 800;
    touch-action: manipulation;
  }
  .add-step:hover {
    border-color: var(--teal);
    background: var(--teal-wash);
  }

  .empty {
    margin: 1.4rem 0 1rem;
    padding: 1.4rem 1rem;
    border-radius: 16px;
    background: var(--paper);
    text-align: center;
    color: var(--ink-soft);
  }
  .empty p {
    margin: 0 0 0.8rem;
  }
  .primary {
    min-height: 44px;
    padding: 0 1.1rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
  }

  /* ── Preview ──────────────────────────────────────────────────────────── */
  .at {
    margin-top: 0.7rem;
    display: flex;
    flex-wrap: wrap;
  }
  .at .chip {
    min-width: 44px;
    justify-content: center;
  }
  .phone {
    margin-top: 0.8rem;
    padding: 0.6rem 0.8rem 0.9rem;
    border-radius: 22px;
    background: var(--paper-deep);
    border: 1px solid var(--line);
  }
  .faux {
    align-self: flex-start;
    margin-top: 0.3rem;
    padding: 0.45rem 1rem;
    border-radius: 999px;
    background: var(--teal);
    color: var(--on-teal);
    font-weight: 700;
    font-size: 0.9rem;
  }
</style>
