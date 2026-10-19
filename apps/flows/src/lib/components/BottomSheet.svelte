<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // What a tap brings forward: a sheet rising from the bottom edge, where a
  // thumb already is. A native <dialog> shown modally, so the page behind is
  // inert, focus is held inside, Escape closes it and focus goes back to
  // where it was — none of which has to be rebuilt here. A tap on the dimmed
  // page closes it too.
  import { createEventDispatcher, onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { t } from "$lib/i18n";

  /** The sheet's accessible name. */
  export let title: string;

  const dispatch = createEventDispatcher<{ close: void }>();
  let dialog: HTMLDialogElement | undefined;

  onMount(() => {
    dialog?.showModal();
    return () => dialog?.close();
  });

  // Dismiss on a click that both began and ended on the backdrop, so a drag
  // that merely ends outside the sheet does not close it.
  let downOnBackdrop = false;
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialog}
  aria-label={title}
  on:close={() => dispatch("close")}
  on:cancel|preventDefault={() => dispatch("close")}
  on:pointerdown|self={() => (downOnBackdrop = true)}
  on:click|self={() => {
    if (downOnBackdrop) dispatch("close");
    downOnBackdrop = false;
  }}
>
  <div class="sheet">
    <div class="grip" aria-hidden="true"></div>
    <header>
      <div class="head"><slot name="head"><h2>{title}</h2></slot></div>
      <button
        class="x"
        on:click={() => dispatch("close")}
        aria-label={$t("common.close")}><Icon name="close" /></button
      >
    </header>
    <div class="body"><slot /></div>
  </div>
</dialog>

<style>
  dialog {
    position: fixed;
    inset: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  dialog:not([open]) {
    display: none;
  }
  dialog::backdrop {
    background: rgba(20, 32, 31, 0.45);
  }
  .sheet {
    width: min(34rem, 100%);
    max-height: 86dvh;
    display: flex;
    flex-direction: column;
    background: var(--card);
    border-radius: 22px 22px 0 0;
    box-shadow: var(--shadow-sheet);
    padding-bottom: env(safe-area-inset-bottom);
    animation: rise 0.22s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  .grip {
    width: 40px;
    height: 4px;
    border-radius: 999px;
    background: var(--line);
    margin: 8px auto 0;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 8px 6px var(--gutter);
  }
  .head {
    flex: 1 1 auto;
    min-width: 0;
  }
  .head :global(h2) {
    font-size: 1.15rem;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .x {
    flex: 0 0 auto;
    width: var(--tap);
    height: var(--tap);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    color: var(--ink-soft);
    border-radius: 999px;
  }
  .body {
    overflow-y: auto;
    padding: 4px var(--gutter) 18px;
    overscroll-behavior: contain;
  }
  @media (min-width: 640px) {
    dialog {
      align-items: center;
    }
    .sheet {
      border-radius: 22px;
    }
    .grip {
      display: none;
    }
  }
  @keyframes rise {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      animation: none;
    }
  }
</style>
