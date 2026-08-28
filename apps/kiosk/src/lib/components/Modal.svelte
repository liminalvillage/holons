<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Generic "bring it forward" overlay: a dimmed backdrop and a card that zooms
  // up from the tapped element. Closes on backdrop tap, the ✕, or Escape.
  import { createEventDispatcher } from "svelte";
  import { t } from "$lib/i18n";
  const dispatch = createEventDispatcher();
  export let tint: string = "var(--card)";
  /** Render the card as a hologram projection (see `.holo` in app.css). */
  export let holo = false;
  /** Source holon glow hue driving the projection's colour. */
  export let glow: string | undefined = undefined;
  /** Per-record clock seed [0,1) so the modal flickers on its own time. */
  export let seed: number | undefined = undefined;
  function close() {
    dispatch("close");
  }
  // Dismiss on CLICK, not pointerdown. Closing on pointerdown unmounts the
  // backdrop before the browser dispatches the paired click, which then lands
  // on whatever is now under the finger — a card, or its ✕/✓ corner button —
  // so a tap meant to dismiss the sheet deleted or completed a task instead.
  // Requiring the pointer to have both gone down AND come up on the backdrop
  // keeps a drag that merely ends outside the card from dismissing it.
  let downOnBackdrop = false;
  function onBackdropDown() {
    downOnBackdrop = true;
  }
  function onBackdropClick() {
    if (downOnBackdrop) close();
    downOnBackdrop = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window on:keydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="backdrop"
  on:pointerdown|self={onBackdropDown}
  on:click|self={onBackdropClick}
>
  <div
    class="card"
    class:holo
    style="--tint: {tint};{glow ? ` --glow: ${glow};` : ''}"
    style:--holo-seed={seed}
    role="dialog"
    aria-modal="true"
  >
    <button class="x" on:click={close} aria-label={$t("common.close")}>✕</button
    >
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
    animation: kiosk-fade 0.2s ease both;
  }
  .card {
    position: relative;
    width: min(34rem, 100%);
    max-height: 86dvh;
    border-radius: 22px;
    background: var(--tint);
    box-shadow: 0 30px 70px rgba(15, 30, 28, 0.4);
    animation: pop 0.26s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
    overflow: hidden;
  }
  /* Dark skin: the post-it palette is re-cast as deep jewel tones (see
     app.css), and flooding a whole dialog with one turns it into a muddy
     ground that every form field then sits on. Keep the card on the normal
     card surface and let the category colour through as a wash — the note
     still identifies itself, the content stays legible. */
  :global(:root[data-theme="dark"]) .card {
    background: color-mix(in srgb, var(--tint) 30%, var(--card));
  }
  /* The ✕ rides a translucent-white disc, which is a bright hole on a dark
     card; flip it to a dark one. */
  :global(:root[data-theme="dark"]) .x {
    background: rgba(0, 0, 0, 0.28);
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
      animation: kiosk-fade 0.2s ease both;
    }
  }
</style>
