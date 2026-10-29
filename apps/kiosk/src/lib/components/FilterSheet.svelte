<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // The pills band's Filters sheet: every choice of WHAT the board shows and
  // in which order, in one place. Federated (partners' items beside this
  // holon's own) is device-wide and offered on every tab; the Tasks tab adds
  // Done (completed tasks too) and Sort. How items are laid out is not a
  // filter — that stays the band's Layout pill.
  //
  // Kiosk rule: no Apply step. Every tap takes effect at once and is
  // remembered on the device; the board behind the sheet updates live.
  import { createEventDispatcher } from "svelte";
  import Modal from "./Modal.svelte";
  import Icon from "./Icon.svelte";
  import { activeTab, scope, showCompleted, taskSort } from "$lib/stores";
  import {
    setScope,
    setShowCompleted,
    setTaskSort,
    type Scope,
  } from "$lib/config";
  import type { TaskSort } from "$lib/data";
  import { SORT_SEGMENTS } from "$lib/pills";
  import { t } from "$lib/i18n";

  const dispatch = createEventDispatcher();

  $: federated = $scope === "networked";
  $: tasks = $activeTab === "tasks";

  function toggleFederated() {
    const next: Scope = federated ? "all" : "networked";
    scope.set(next);
    setScope(next);
  }
  function toggleDone() {
    const next = !$showCompleted;
    showCompleted.set(next);
    setShowCompleted(next);
  }
  function pickSort(s: TaskSort) {
    taskSort.set(s);
    setTaskSort(s);
  }
</script>

<Modal on:close={() => dispatch("close")}>
  <div class="filters">
    <h3>{$t("filters.title")}</h3>

    <section>
      <h4>{$t("filters.show")}</h4>
      <div class="row">
        <span class="rowlabel"
          ><Icon name="globe" class="ri" />
          <span
            >{$t("scope.federated")}
            <span class="sub">{$t("scope.aria")}</span></span
          ></span
        >
        <button
          type="button"
          class="switch"
          class:on={federated}
          role="switch"
          aria-checked={federated}
          aria-label={$t("scope.aria")}
          on:click={toggleFederated}
        >
          <span class="knob"></span>
        </button>
      </div>
      {#if tasks}
        <div class="row">
          <span class="rowlabel"
            ><Icon name="check" class="ri" />
            <span
              >{$t("pills.done")}
              <span class="sub">{$t("pills.doneAria")}</span></span
            ></span
          >
          <button
            type="button"
            class="switch"
            class:on={$showCompleted}
            role="switch"
            aria-checked={$showCompleted}
            aria-label={$t("pills.doneAria")}
            on:click={toggleDone}
          >
            <span class="knob"></span>
          </button>
        </div>
      {/if}
    </section>

    {#if tasks}
      <section>
        <h4 id="filters-sort">{$t("filters.sortBy")}</h4>
        <div class="chips" role="radiogroup" aria-labelledby="filters-sort">
          {#each SORT_SEGMENTS as s (s.id)}
            <button
              type="button"
              class="chip"
              class:on={$taskSort === s.id}
              role="radio"
              aria-checked={$taskSort === s.id}
              on:click={() => pickSort(s.id)}
            >
              <Icon name={s.icon} class="ci" />
              {$t(s.labelKey)}
            </button>
          {/each}
        </div>
      </section>
    {/if}
  </div>
</Modal>

<style>
  .filters {
    color: var(--ink);
  }
  h3 {
    margin: 0 0 1rem;
    padding-right: calc(var(--corner-w, 44px) + 0.4rem);
    font-size: 1.1rem;
    line-height: 1.3;
  }
  section + section {
    margin-top: 1.2rem;
    padding-top: 1rem;
    border-top: 1.5px solid var(--line);
  }
  h4 {
    margin: 0 0 0.35rem;
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  /* Same row + switch shape as the calendar settings' toggles. */
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 44px;
    padding: 0.5rem 0;
  }
  .rowlabel {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    color: var(--ink);
    font-weight: 700;
    font-size: 0.95rem;
  }
  .rowlabel :global(.ri) {
    flex: none;
    width: 1.15rem;
    height: 1.15rem;
    margin-top: 0.1rem;
  }
  .sub {
    display: block;
    font-weight: 500;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .switch {
    flex: 0 0 auto;
    width: 3.1rem;
    height: 1.8rem;
    border-radius: 999px;
    background: var(--line);
    position: relative;
    transition: background 0.18s ease;
  }
  .switch.on {
    background: var(--teal);
  }
  .knob {
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--shadow-soft);
    transition: transform 0.18s ease;
  }
  .switch.on .knob {
    transform: translateX(1.3rem);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-top: 0.3rem;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 999px;
    background: var(--paper);
    color: var(--ink-soft);
    font-weight: 700;
    font-size: 0.9rem;
    touch-action: manipulation;
    transition:
      background 0.18s ease,
      transform 0.1s ease;
  }
  .chip:active {
    transform: scale(0.95);
  }
  .chip.on {
    background: var(--teal-deep);
    color: var(--on-teal);
  }
  .chip :global(.ci) {
    width: 1.05rem;
    height: 1.05rem;
  }
</style>
