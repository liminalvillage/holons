<script lang="ts">
  // SPDX-License-Identifier: AGPL-3.0-or-later
  import Icon from "$lib/components/Icon.svelte";
  // Generic "bring it forward" overlay: a dimmed backdrop and a card that zooms
  // up from the tapped element. Closes on backdrop tap, the ✕, or Escape.
  import { createEventDispatcher, onDestroy, onMount, tick } from "svelte";
  import { t } from "$lib/i18n";
  const dispatch = createEventDispatcher();
  export let tint: string = "var(--card)";
  /** Render the card as a hologram projection (see `.holo` in app.css). */
  export let holo = false;
  /** Source holon glow hue driving the projection's colour. */
  export let glow: string | undefined = undefined;
  /** Per-record clock seed [0,1) so the modal flickers on its own time. */
  export let seed: number | undefined = undefined;
  /** A wide card for sheets that carry a board preview beside a form. */
  export let wide = false;
  /** Show the pinned footer (the `footer` slot) under the scrolling body. */
  export let footer = false;
  /** The dialog's accessible name, when its title is not an <h2> inside. */
  export let label: string | undefined = undefined;
  // The corner: the ✕ and, through the `corner` slot, a sheet's one headline
  // action beside it. Its width is published as `--corner-w` on the card so
  // the sheet's title can keep clear of it (`padding-right: var(--corner-w)`).
  let cornerW = 0;
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
  // Keyboard: the dialog takes focus when it opens, keeps Tab inside it
  // (otherwise Tab walks off into the board behind), and hands focus back to
  // whatever opened it when it closes.
  let card: HTMLElement;
  let opener: HTMLElement | null = null;
  let labelledBy: string | undefined = undefined;

  function focusables(): HTMLElement[] {
    if (!card) return [];
    return [
      ...card.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab" || !card) return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && card.contains(active);
    // Only the topmost dialog steers: a sheet opened over this one owns Tab.
    if (
      !inside &&
      active &&
      active !== document.body &&
      active.closest('[role="dialog"]')
    )
      return;
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  onMount(async () => {
    opener = document.activeElement as HTMLElement | null;
    await tick();
    if (!card) return;
    // Named by its own heading when it has one.
    const h = card.querySelector<HTMLElement>("h1, h2, h3");
    if (!label && h) {
      if (!h.id) h.id = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
      labelledBy = h.id;
    }
    // Land on the dialog itself, unless something inside already took focus
    // (an autofocused field).
    if (!card.contains(document.activeElement))
      card.focus({ preventScroll: true });
  });

  onDestroy(() => {
    if (opener && opener.isConnected) opener.focus?.({ preventScroll: true });
  });
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
    class:wide
    style="--tint: {tint};{glow ? ` --glow: ${glow};` : ''}"
    style:--holo-seed={seed}
    style:--corner-w="{cornerW}px"
    role="dialog"
    aria-modal="true"
    aria-label={label}
    aria-labelledby={label ? undefined : labelledBy}
    tabindex="-1"
    bind:this={card}
  >
    <div class="corner" bind:clientWidth={cornerW}>
      <slot name="corner" />
      <button class="x" on:click={close} aria-label={$t("common.close")}
        ><Icon name="close" /></button
      >
    </div>
    <div class="body scroll">
      <slot />
    </div>
    {#if footer && $$slots.footer}
      <!-- A sheet's decisions, pinned under the scrolling body so they are
           always in reach — on a phone, right above the thumb. -->
      <div class="foot">
        <slot name="footer" />
      </div>
    {/if}
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
  .card:focus {
    outline: none; /* focused to anchor the keyboard, not to be marked */
  }
  .card {
    position: relative;
    width: min(34rem, 100%);
  }
  .card.wide {
    width: min(64rem, 100%);
  }
  .card {
    display: flex;
    flex-direction: column;
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
  .corner {
    position: absolute;
    top: 0.8rem;
    right: 0.8rem;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .x {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    font-size: 1.1rem;
    color: var(--ink-soft);
    background: var(--ghost);
    display: grid;
    place-items: center;
  }
  .x:active {
    transform: scale(0.92);
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    padding: 1.6rem 1.5rem 1.5rem;
  }
  .foot {
    flex: 0 0 auto;
    padding: 0.8rem 1.5rem 1.1rem;
    border-top: 1px solid var(--line);
    background: color-mix(in srgb, var(--tint) 70%, var(--card));
  }
  :global(:root[data-theme="dark"]) .foot {
    background: color-mix(in srgb, var(--tint) 18%, var(--card));
  }
  /* A phone: the card is a sheet rising from the bottom edge, full width,
     with the home-indicator inset kept clear under the footer. */
  @media (max-width: 640px) {
    .backdrop {
      align-items: flex-end;
      padding: 0;
    }
    .card,
    .card.wide {
      width: 100%;
      max-height: 94dvh;
      border-radius: 22px 22px 0 0;
      animation: rise 0.28s cubic-bezier(0.2, 0.9, 0.3, 1.05) both;
    }
    .body {
      padding: 1.3rem 1.1rem 1.2rem;
    }
    .foot {
      padding: 0.7rem 1.1rem calc(0.9rem + env(safe-area-inset-bottom, 0px));
    }
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(40px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: kiosk-fade 0.2s ease both;
    }
  }
</style>
