<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What can be done with an account, as a row of round buttons under the
  // balance — the place a banking app puts them, within a thumb's reach.
  import Icon from "./Icon.svelte";
  import type { AccountAction } from "$lib/viewTypes";

  export let actions: AccountAction[] = [];
  export let onAct: (id: string) => void = () => {};
</script>

<div class="actions" style="--n:{Math.max(1, actions.length)}">
  {#each actions as action (action.id)}
    <svelte:element
      this={action.href ? "a" : "button"}
      class="action"
      class:main={action.main}
      href={action.href}
      disabled={action.href ? undefined : action.disabled}
      role={action.href ? undefined : "button"}
      on:click={() => {
        if (!action.href && !action.disabled) onAct(action.id);
      }}
    >
      <span class="disc"><Icon name={action.icon} /></span>
      <span class="text">{action.label}</span>
    </svelte:element>
  {/each}
</div>

<style>
  .actions {
    display: grid;
    grid-template-columns: repeat(var(--n), minmax(0, 1fr));
    gap: 6px;
    margin: 14px 0 4px;
  }
  .action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-height: 76px;
    padding: 4px 2px;
    font: inherit;
    color: var(--ink);
    text-decoration: none;
  }
  .action:disabled {
    opacity: 0.45;
  }
  .disc {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    background: var(--teal-wash);
    color: var(--teal-ink);
  }
  .main .disc {
    background: var(--teal);
    color: var(--on-teal);
  }
  .text {
    font-size: 0.8rem;
    font-weight: 700;
    text-align: center;
    line-height: 1.15;
    overflow-wrap: anywhere;
  }
</style>
