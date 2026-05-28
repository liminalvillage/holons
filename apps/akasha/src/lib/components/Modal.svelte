<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Generic "bring it forward" overlay: a dimmed backdrop and a card that zooms
  // up from the tapped element. Closes on backdrop tap, the ✕, or Escape.
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();
  export let tint: string = "var(--card)";
  function close() {
    dispatch("close");
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window on:keydown={onKey} />

<div
  class="backdrop"
  on:pointerdown|self={close}
  role="presentation"
  aria-hidden="true"
>
  <div class="card" style="background: {tint};" role="dialog" aria-modal="true">
    <button class="x" on:click={close} aria-label="Close">✕</button>
    <div class="body scroll">
      <slot />
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.4rem;
    background: rgba(20, 32, 31, 0.42);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    animation: akasha-fade 0.2s ease both;
  }
  .card {
    position: relative;
    width: min(34rem, 100%);
    max-height: 86dvh;
    border-radius: 22px;
    box-shadow: 0 30px 70px rgba(15, 30, 28, 0.4);
    animation: pop 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    overflow: hidden;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.86) translateY(18px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }
  .x {
    position: absolute;
    top: 0.8rem;
    right: 0.8rem;
    z-index: 2;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 1.1rem;
    color: var(--ink-soft);
    background: rgba(255, 255, 255, 0.55);
    display: grid;
    place-items: center;
  }
  .x:active {
    transform: scale(0.92);
  }
  .body {
    padding: 1.6rem 1.5rem 1.5rem;
    max-height: 86dvh;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: akasha-fade 0.2s ease both;
    }
  }
</style>
