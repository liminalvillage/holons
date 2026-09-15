<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // SPDX-FileCopyrightText: Roberto Valenti and the Holons contributors
  //
  // A settings panel that does not cover what it edits.
  //
  // On a wide screen it docks to the right edge, leaving the board — and the
  // diagram that answers every change live — readable beside it. On a narrow
  // one it becomes a bottom sheet, which is where a thumb already is. The
  // scrim is deliberately light on the docked side: dimming the diagram would
  // throw away the reason for docking.
  //
  // Unlike `Modal`, this carries the full dialog contract: an accessible name,
  // a focus trap, and focus returned to whatever opened it.
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { t } from "$lib/i18n";

  /** The panel's accessible name, announced when it opens. */
  export let title: string;

  const dispatch = createEventDispatcher<{ close: void }>();
  const titleId = `panel-title-${Math.random().toString(36).slice(2, 9)}`;

  let panel: HTMLElement;
  let opener: HTMLElement | null = null;

  function close() {
    dispatch("close");
  }

  /** Everything a keyboard can land on, in document order. */
  function focusables(): HTMLElement[] {
    if (!panel) return [];
    return [
      ...panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // A modal dialog keeps the keyboard inside it; without this, Tab walks off
    // into the board behind and there is no way back except the mouse.
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  let downOnScrim = false;

  /**
   * Move the panel to the end of <body>.
   *
   * A z-index alone is not enough: the board's own sticky chrome (the tab
   * strip and its add button) sits in a stacking context that paints over a
   * fixed child of the board, whatever number it carries. Mounting at the
   * document root puts the dialog outside that argument entirely, which is
   * where a modal belongs anyway.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  onMount(async () => {
    opener = document.activeElement as HTMLElement | null;
    await tick();
    // Land on the panel itself, not its first control: a screen reader then
    // reads the name and the tab list before anything is changed by accident.
    panel?.focus();
  });

  onDestroy(() => {
    // Give the keyboard back to whatever opened the panel.
    opener?.focus?.();
  });
</script>

<svelte:window on:keydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="scrim"
  use:portal
  on:pointerdown|self={() => (downOnScrim = true)}
  on:click|self={() => {
    if (downOnScrim) close();
    downOnScrim = false;
  }}
>
  <div
    class="panel"
    bind:this={panel}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
  >
    <header class="head">
      <h2 id={titleId}>{title}</h2>
      <button class="x" on:click={close} aria-label={$t("common.close")}
        >✕</button
      >
    </header>
    <slot name="tabs" />
    <div class="body scroll">
      <slot />
    </div>
    <footer class="foot">
      <slot name="footer" />
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    /* Above the board's own sticky chrome (the tab strip's add button sits in
       the same stacking context), below the voice widget at 70. */
    z-index: 65;
    display: flex;
    /* Docked right on a wide screen; the flex direction flips below. */
    justify-content: flex-end;
    align-items: stretch;
    /* Light on purpose: the diagram behind must stay readable, because it is
       what the panel is editing. */
    background: rgba(20, 32, 31, 0.18);
    animation: panel-fade 0.18s ease both;
  }

  .panel {
    display: flex;
    flex-direction: column;
    width: min(27rem, 100%);
    max-height: 100dvh;
    background: var(--card);
    box-shadow: -18px 0 50px rgba(15, 30, 28, 0.28);
    animation: panel-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
  }

  .panel:focus {
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 1rem 0.8rem 0.6rem 1.2rem;
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 1.15rem;
    color: var(--ink);
  }

  .x {
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--paper);
    color: var(--ink-soft);
    font-size: 1rem;
    touch-action: manipulation;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.2rem 1.2rem 1rem;
    overscroll-behavior: contain;
  }

  .foot {
    padding: 0.8rem 1.2rem calc(0.9rem + env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--line);
    background: var(--card);
  }

  /* Phone: a bottom sheet, where the thumb already is. */
  @media (max-width: 720px) {
    .scrim {
      justify-content: stretch;
      align-items: flex-end;
      background: rgba(20, 32, 31, 0.42);
    }
    .panel {
      width: 100%;
      max-height: 88dvh;
      border-radius: 22px 22px 0 0;
      box-shadow: 0 -18px 50px rgba(15, 30, 28, 0.32);
      animation: sheet-in 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
    }
  }

  @keyframes panel-fade {
    from {
      opacity: 0;
    }
  }
  @keyframes panel-in {
    from {
      transform: translateX(3%);
      opacity: 0.4;
    }
  }
  @keyframes sheet-in {
    from {
      transform: translateY(6%);
      opacity: 0.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .panel {
      animation: none;
    }
  }
</style>
