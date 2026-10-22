<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  //
  // A bottom sheet: the kiosk's "bring it forward" card, done the way a phone
  // does it. On a narrow screen it slides up from the bottom edge and takes the
  // width; on a wide one it is a centred card. Closes on backdrop tap, the ✕,
  // or Escape. Rendered on <body> so no transformed ancestor can clip it.
  //
  // Dismisses on CLICK, not pointerdown: closing on pointerdown unmounts the
  // backdrop before the paired click lands, which then hits whatever is now
  // under the finger.
  import { createEventDispatcher, onDestroy } from "svelte";

  export let title = "";
  /** Accessible name when the sheet has no visible title. */
  export let label = "";

  const dispatch = createEventDispatcher<{ close: void }>();

  function close() {
    dispatch("close");
  }

  let downOnBackdrop = false;
  function onBackdropDown() {
    downOnBackdrop = true;
  }
  function onBackdropClick() {
    if (downOnBackdrop) close();
    downOnBackdrop = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode === document.body) document.body.removeChild(node);
      },
    };
  }

  // Lock the page behind the sheet so a scroll inside it stays inside it.
  let prev: string | null = null;
  if (typeof document !== "undefined") {
    prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  onDestroy(() => {
    if (typeof document !== "undefined" && prev !== null) {
      document.body.style.overflow = prev;
    }
  });
</script>

<svelte:window on:keydown={onKey} />

<!-- Escape is handled on the window above; the backdrop itself is not a
     focus stop. -->
<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
<div
  class="backdrop"
  use:portal
  on:pointerdown|self={onBackdropDown}
  on:click|self={onBackdropClick}
>
  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-label={title || label || undefined}
  >
    <div class="grip" aria-hidden="true"></div>
    <button type="button" class="x" on:click={close} aria-label="Close">✕</button>
    {#if title}
      <h3 class="title">{title}</h3>
    {/if}
    <div class="body">
      <slot />
    </div>
    {#if $$slots.actions}
      <div class="actions">
        <slot name="actions" />
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    animation: sheet-fade 0.18s ease both;
  }

  .sheet {
    position: relative;
    width: 100%;
    max-height: 88dvh;
    display: flex;
    flex-direction: column;
    background: var(--color-bg-secondary);
    border: 1px solid var(--color-border);
    border-bottom: none;
    border-radius: 22px 22px 0 0;
    box-shadow: 0 -20px 60px rgba(0, 0, 0, 0.45);
    padding: 0.5rem 1.1rem calc(1rem + env(safe-area-inset-bottom));
    animation: sheet-rise 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
  }

  .grip {
    width: 2.6rem;
    height: 0.3rem;
    margin: 0.2rem auto 0.7rem;
    border-radius: 999px;
    background: var(--color-border-light);
  }

  .x {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 1rem;
    color: var(--color-text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }

  .x:active {
    transform: scale(0.92);
  }

  .title {
    margin: 0 3rem 0.6rem 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text-primary);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .actions {
    display: flex;
    gap: 0.6rem;
    padding-top: 0.9rem;
  }

  .actions :global(button) {
    flex: 1 1 0;
    min-height: 3rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.95rem;
    touch-action: manipulation;
  }

  .actions :global(.primary) {
    background: var(--flow-accent, #0f766e);
    color: #f0fdfa;
  }

  .actions :global(.primary:disabled) {
    opacity: 0.45;
  }

  .actions :global(.ghost) {
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-secondary);
  }

  .actions :global(.danger) {
    background: rgba(239, 68, 68, 0.14);
    color: #fca5a5;
  }

  @media (min-width: 640px) {
    .backdrop {
      align-items: center;
      padding: 1.4rem;
    }
    .sheet {
      width: min(30rem, 100%);
      max-height: 86dvh;
      border-radius: 22px;
      border-bottom: 1px solid var(--color-border);
      padding-bottom: 1.1rem;
      animation: sheet-pop 0.24s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
    }
    .grip {
      display: none;
    }
    .title {
      margin-top: 0.7rem;
    }
  }

  @keyframes sheet-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes sheet-rise {
    from {
      transform: translateY(40px);
      opacity: 0.6;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes sheet-pop {
    from {
      transform: scale(0.9) translateY(14px);
      opacity: 0;
    }
    to {
      transform: scale(1) translateY(0);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .backdrop,
    .sheet {
      animation: sheet-fade 0.15s ease both;
    }
  }
</style>
